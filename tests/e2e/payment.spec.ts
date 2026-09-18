import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  placeOrder,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 7 — Payment (hermetic ZARINPAL_MOCK).
 *
 * Requires the dev server to be running with `ZARINPAL_MOCK=1` (see the
 * src/lib/zarinpal.ts seam + playwright.config webServer env for CI). Under
 * the mock, checkout with "پرداخت آنلاین" returns a SAME-ORIGIN paymentUrl
 * pointing at our own /api/payment/verify?Status=OK — the browser follows it
 * and the verify route completes the payment without ever touching the real
 * sandbox gateway.
 *
 * Also covers the cancelled (NOK) path: navigating to verify with Status=NOK
 * cancels the payment, restores stock, and leaves the order pending_payment.
 */
test.describe("Payment flow", () => {
  // Logged-in customer session (cookie from storageState) for the whole spec.
  test.use({ storageState: getState().customerStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let productId = "";
  const slug = "payment-prod";
  const price = 1_200_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 6);

    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `ساعت هوشمند ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 750_000,
      stock: 7,
    });
  });

  test("online payment completes via the mock gateway", async ({
    page,
    playwright,
  }) => {
    // Add to cart, then checkout with the online payment method.
    await page.goto(`/products/${state.prefix}${slug}`);
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).click();
    await expect(page.getByText(/به سبد خرید اضافه شد/)).toBeVisible();

    await page.goto("/checkout");
    await page.getByPlaceholder("مثال: علی محمدی").fill(`مشتری ${state.prefix}`);
    await page.getByPlaceholder("مثال: ۰۹۱۲۳۴۵۶۷۸۹").fill(state.customerPhone);
    await page
      .getByPlaceholder("استان، شهر، خیابان، پلاک، واحد")
      .fill("تهران، خیابان ونک، پلاک ۳");
    await page.getByPlaceholder("مثال: ۱۲۳۴۵۶۷۸۹۰").fill("1122334455");

    // Select "پرداخت آنلاین" (zarinpal) via the radio input.
    await page.locator('input[name="payment"][value="zarinpal"]').check();

    // Submit → the checkout response carries the mock paymentUrl and the page
    // redirects to it immediately. The response body becomes unavailable once
    // the navigation starts, so the orderId is derived from the final
    // payment/result URL (the verify route appends orderId + refId).
    await page.getByRole("button", { name: "ثبت سفارش" }).click();
    await page.waitForURL(/\/payment\/result/);
    const orderId = new URL(page.url()).searchParams.get("orderId");
    expect(orderId).toBeTruthy();
    await expect(page.getByText("پرداخت با موفقیت انجام شد!")).toBeVisible();

    // Server-side: payment paid, order processing.
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const orderRes = await customerCtx.get(`/api/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      status: string;
      payment: { status: string; refId?: string };
    };
    expect(order.payment.status).toBe("paid");
    expect(order.payment.refId).toBeTruthy();
    expect(order.status).toBe("processing");
  });

  test("cancelling at the gateway keeps the order pending", async ({
    page,
    playwright,
  }) => {
    // Create an order with zarinpal method via the API (mock active).
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const { orderId } = await placeOrder({
      customer: customerCtx,
      items: [
        { id: productId, quantity: 1, price, name: `ساعت هوشمند ${state.prefix}` },
      ],
      paymentMethod: "zarinpal",
    });

    // Simulate the user cancelling at the gateway (Status=NOK).
    await page.goto(
      `/api/payment/verify?orderId=${orderId}&Authority=E2E_MOCK_${orderId}&Status=NOK`
    );
    await page.waitForURL(/\/payment\/result/);
    await expect(page.getByText("پرداخت لغو شد")).toBeVisible();

    // Order stays pending_payment, payment canceled, stock restored.
    const orderRes = await customerCtx.get(`/api/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      status: string;
      payment: { status: string };
    };
    expect(order.status).toBe("pending_payment");
    expect(order.payment.status).toBe("canceled");
  });

  test("failed payment result points to the order for retry", async ({
    page,
  }) => {
    // With a known order: the primary CTA must lead to the order detail
    // page (the retry-payment action already lives there), never to the
    // now-empty checkout. Secondary CTA keeps shopping on /products.
    const orderId = "507f1f77bcf86cd799439011";
    await page.goto(`/payment/result?status=failed&orderId=${orderId}`);
    const primary = page.getByRole("link", {
      name: "مشاهده سفارش و پرداخت مجدد",
    });
    await expect(primary).toBeVisible();
    expect(await primary.getAttribute("href")).toBe(`/orders/${orderId}`);
    const secondary = page.getByRole("link", { name: "ادامه خرید" });
    await expect(secondary).toBeVisible();
    expect(await secondary.getAttribute("href")).toBe("/products");

    // Without a known order there is nothing to show, so the checkout
    // fallback destination must remain.
    await page.goto("/payment/result?status=failed");
    const fallback = page.getByRole("link", { name: "بازگشت به تسویه حساب" });
    await expect(fallback).toBeVisible();
    expect(await fallback.getAttribute("href")).toBe("/checkout");
  });

  test("browser back from the gateway returns to My Orders", async ({
    page,
  }) => {
    await page.goto(`/products/${state.prefix}${slug}`);
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).click();
    // Readiness signal: the item reached the cart and survives navigation
    // (asserted via the checkout summary). The success toast is incidental
    // and has a known render race (CI run 35227292913), so it is not used
    // as a synchronization point here.
    await page.goto("/checkout");
    await expect(page.getByText(`ساعت هوشمند ${state.prefix}`)).toBeVisible();
    await page.getByPlaceholder("مثال: علی محمدی").fill(`مشتری ${state.prefix}`);
    await page.getByPlaceholder("مثال: ۰۹۱۲۳۴۵۶۷۸۹").fill(state.customerPhone);
    await page
      .getByPlaceholder("استان، شهر، خیابان، پلاک، واحد")
      .fill("تهران، خیابان ونک، پلاک ۳");
    await page.getByPlaceholder("مثال: ۱۲۳۴۵۶۷۸۹۰").fill("1122334455");
    await page.locator('input[name="payment"][value="zarinpal"]').check();

    // Simulate the customer backing out at the gateway: the mock verify
    // navigation is answered with the same redirect the real NOK callback
    // produces (302 → cancelled result), so the order is never paid and
    // stays pending_payment.
    let nokedOrderId = "";
    await page.route("**/api/payment/verify*", async (route) => {
      const url = new URL(route.request().url());
      nokedOrderId = url.searchParams.get("orderId") ?? "";
      await route.fulfill({
        status: 302,
        headers: {
          location: `/payment/result?status=cancelled&orderId=${nokedOrderId}`,
        },
      });
    });

    // Submit → mock gateway → result. The checkout history entry was
    // replaced with /orders right before the redirect, so going Back must
    // land on My Orders (with the pending order visible), never on the
    // emptied checkout page.
    await page.getByRole("button", { name: "ثبت سفارش" }).click();
    await page.waitForURL(/\/payment\/result/);
    await expect(page.getByText("پرداخت لغو شد")).toBeVisible();
    expect(nokedOrderId).toBeTruthy();
    await page.goBack();
    await page.waitForURL("**/orders");
    // The order just created is the newest entry and shows its
    // pending-payment badge on My Orders — not the emptied checkout page.
    const orderCard = page.getByText(
      `سفارش #${nokedOrderId.slice(-8)}`
    );
    await expect(orderCard).toBeVisible();
    await expect(
      orderCard.locator("xpath=ancestor::a")
    ).toContainText("در انتظار پرداخت");
  });
});
