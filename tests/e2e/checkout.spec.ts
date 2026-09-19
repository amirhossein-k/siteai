import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  addToCartAndAwaitToast,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 5 — Checkout.
 *
 * Customer (storageState) adds a product to the cart, fills the shipping
 * address, keeps the default manual payment method, and places the order.
 * The success page shows the order number; the created order is verified
 * server-side through the customer orders API (pending_payment).
 */
test.describe("Checkout", () => {
  // Logged-in customer session (cookie from storageState) for the whole spec.
  test.use({ storageState: getState().customerStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  const slug = "checkout-prod";
  const price = 900_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 4);

    await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `هدفون بیسیم ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 550_000,
      stock: 12,
    });
  });

  test("places a manual-payment order end-to-end", async ({
    page,
    playwright,
  }) => {
    // 1. Add to cart from the product page.
    await page.goto(`/products/${state.prefix}${slug}`);
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).click();
    await addToCartAndAwaitToast(page);

    // 2. Checkout page — the shipping-form card renders (proves the cart has
    // items; the breadcrumb "تسویه حساب" is a span, not a heading).
    await page.goto("/checkout");
    await expect(
      page.getByRole("heading", { name: "اطلاعات ارسال" })
    ).toBeVisible();

    // Fill the shipping form explicitly (hermetic — the session may or may
    // not carry name/phone into the prefill state).
    await page.getByPlaceholder("مثال: علی محمدی").fill(`مشتری ${state.prefix}`);
    await page.getByPlaceholder("مثال: ۰۹۱۲۳۴۵۶۷۸۹").fill(state.customerPhone);
    await page
      .getByPlaceholder("استان، شهر، خیابان، پلاک، واحد")
      .fill("تهران، خیابان آزادی، پلاک ۱");
    await page.getByPlaceholder("مثال: ۱۲۳۴۵۶۷۸۹۰").fill("1234567890");

    // 3. Submit and capture the created order id.
    const [checkoutRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/checkout") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "ثبت سفارش" }).click(),
    ]);
    const { orderId } = (await checkoutRes.json()) as { orderId: string };
    expect(orderId).toBeTruthy();

    // 4. Success state shows the order number.
    await expect(page.getByText("سفارش با موفقیت ثبت شد!")).toBeVisible();
    await expect(page.getByText(`#${orderId.slice(-8)}`)).toBeVisible();

    // 5. Server-side: order exists, pending payment + pending_payment status.
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const orderRes = await customerCtx.get(`/api/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      status: string;
      payment: { status: string };
    };
    expect(order.status).toBe("pending_payment");
    expect(order.payment.status).toBe("pending");
  });
});
