import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  createCoupon,
  addToCartAndAwaitToast,
  type E2EState,
} from "./helpers/fixtures";
import { formatPrice, couponDiscount } from "./helpers/money";

/**
 * Journey 6 — Coupon application.
 *
 * Admin creates a 10% percent coupon (public eligibility, min subtotal below
 * the seeded cart total). The customer applies it on the checkout page and
 * the discount math (mirrored by helpers/money.ts) is asserted in the UI, then
 * verified server-side on the created order.
 */
test.describe("Coupon application", () => {
  // Logged-in customer session (cookie from storageState) for the whole spec.
  test.use({ storageState: getState().customerStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let couponCode = "";
  const slug = "coupon-prod";
  const price = 500_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // Code is derived from the run prefix so the global-teardown regex
    // `^e2e_<ts>_` (case-insensitive) matches it — coupon rows must not leak.
    couponCode = `${state.prefix.toUpperCase()}COUPON`;
    const categoryId = await createCategory(adminCtx, state.prefix, 5);

    await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `کتابخانه ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 300_000,
      stock: 9,
    });

    await createCoupon(adminCtx, {
      code: couponCode,
      type: "percent",
      value: 10,
      minSubtotal: 100_000,
      maxDiscount: 0,
      isPublic: true,
    });
  });

  test("applies a percent coupon and records the discount", async ({
    page,
    playwright,
  }) => {
    // Cart with a single item → subtotal = price.
    await page.goto(`/products/${state.prefix}${slug}`);
    await addToCartAndAwaitToast(page);

    await page.goto("/checkout");
    await page.getByPlaceholder("مثال: علی محمدی").fill(`مشتری ${state.prefix}`);
    await page.getByPlaceholder("مثال: ۰۹۱۲۳۴۵۶۷۸۹").fill(state.customerPhone);
    await page
      .getByPlaceholder("استان، شهر، خیابان، پلاک، واحد")
      .fill("تهران، خیابان ولیعصر، پلاک ۲");
    await page.getByPlaceholder("مثال: ۱۲۳۴۵۶۷۸۹۰").fill("9876543210");

    // Apply the coupon.
    await page.getByPlaceholder("کد تخفیف").fill(couponCode);
    await page.getByRole("button", { name: "اعمال" }).click();

    // Expected discount: floor(500_000 × 10 / 100) = 50_000, no cap.
    const discount = couponDiscount(price, "percent", 10, 0);
    expect(discount).toBe(50_000);
    // The applied coupon chip shows the code.
    await expect(page.getByText(couponCode, { exact: false }).first()).toBeVisible();
    // Discount row renders −{formatPrice(discount)}.
    await expect(
      page.getByText(`−${formatPrice(discount)}`, { exact: false }).first()
    ).toBeVisible();
    // Payable = subtotal − discount.
    await expect(page.getByText(formatPrice(price - discount)).first()).toBeVisible();

    // Place the order.
    const [checkoutRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/checkout") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "ثبت سفارش" }).click(),
    ]);
    const { orderId } = (await checkoutRes.json()) as { orderId: string };
    expect(orderId).toBeTruthy();

    // Server-side: the order carries the coupon discount.
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const orderRes = await customerCtx.get(`/api/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      discount: { amount: number; code: string } | null;
    };
    expect(order.discount).toBeTruthy();
    expect(order.discount!.code).toBe(couponCode);
    expect(order.discount!.amount).toBe(discount);
  });
});
