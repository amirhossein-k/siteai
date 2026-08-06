import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  placeOrder,
  type E2EState,
} from "./helpers/fixtures";
import { formatPrice } from "./helpers/money";

/**
 * Journey 8 — Order tracking.
 *
 * A customer places an order through the real checkout API, then finds it in
 * the "سفارشات من" list and opens the detail page: status badge, payment
 * badge, line items, totals and the status timeline are all rendered.
 */
test.describe("Order tracking", () => {
  // Logged-in customer session (cookie from storageState) for the whole spec.
  test.use({ storageState: getState().customerStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let productId = "";
  const slug = "tracking-prod";
  const price = 640_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 7);

    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `کولهپشتی ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 380_000,
      stock: 15,
    });
  });

  test("customer sees the order and opens its detail page", async ({
    page,
    playwright,
  }) => {
    // Place an order as the customer through the real API.
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const { orderId } = await placeOrder({
      customer: customerCtx,
      items: [
        { id: productId, quantity: 2, price, name: `کولهپشتی ${state.prefix}` },
      ],
      paymentMethod: "manual",
    });

    // Orders list shows the new order.
    await page.goto("/orders");
    await expect(page.getByText(`سفارش #${orderId.slice(-8)}`)).toBeVisible();

    // Open the order detail.
    await page.locator(`a[href="/orders/${orderId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));

    // Status badge: pending payment (badge + timeline both render it).
    await expect(page.getByText("در انتظار پرداخت").first()).toBeVisible();
    // Payment badge: pending.
    await expect(page.getByText("در انتظار").first()).toBeVisible();

    // Line items + totals.
    await expect(page.getByText(`کولهپشتی ${state.prefix}`)).toBeVisible();
    await expect(page.getByText(formatPrice(price * 2)).first()).toBeVisible();

    // Status timeline card is rendered.
    await expect(page.getByText("وضعیت سفارش")).toBeVisible();
  });
});
