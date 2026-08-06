import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  placeOrder,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 10 — Supplier workflow.
 *
 * Supplier (storageState) sees the supplier order created from a customer's
 * purchase of their product, opens the detail page and drives it through the
 * supplier lifecycle: pending → confirmed → shipped, asserting the status
 * badges in the UI and the server state via the supplier orders API.
 */
test.describe("Supplier workflow", () => {
  // Logged-in supplier session for the whole spec.
  test.use({ storageState: getState().supplierStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let customerCtx: APIRequestContext;
  let supplierCtx: APIRequestContext;
  let productId = "";
  const slug = "supplier-order-prod";
  const price = 460_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    supplierCtx = await playwright.request.newContext({
      storageState: state.supplierStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 9);

    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `جاروبرقی ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 280_000,
      stock: 6,
    });
  });

  test("supplier confirms and ships the order", async ({ page }) => {
    // Customer purchases the supplier's product → a SupplierOrder is created.
    const { orderId } = await placeOrder({
      customer: customerCtx,
      items: [
        { id: productId, quantity: 1, price, name: `جاروبرقی ${state.prefix}` },
      ],
      paymentMethod: "manual",
    });

    // Supplier orders list shows the new supplier order (#last6 of the order id).
    await page.goto("/supplier/orders");
    await expect(page.getByText(`#${orderId.slice(-6)}`)).toBeVisible();

    // Open the supplier order detail — anchored href: only detail links match
    // (`/supplier/orders/<id>`), never the bare `/supplier/orders` nav link.
    await page.locator('a[href^="/supplier/orders/"]').first().click();
    await expect(page).toHaveURL(/\/supplier\/orders\//);

    // Initial status: pending.
    await expect(page.getByText("در انتظار تأیید").first()).toBeVisible();

    // Quick action: confirm.
    await page.getByRole("button", { name: "تأیید", exact: true }).click();
    await expect(page.getByText("تأیید شده").first()).toBeVisible();

    // Quick action: ship.
    await page.getByRole("button", { name: "ارسال", exact: true }).click();
    await expect(page.getByText("ارسال شده").first()).toBeVisible();

    // Server-side: the supplier order reached shipped.
    const listRes = await supplierCtx.get("/api/supplier/orders");
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as Array<{
      _id: string;
      order: { _id: string } | string;
      status: string;
    }>;
    const so = list.find(
      (o) => String((o.order as { _id?: string })?._id || o.order) === orderId
    );
    expect(so).toBeTruthy();
    expect(so!.status).toBe("shipped");
  });
});
