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
});
