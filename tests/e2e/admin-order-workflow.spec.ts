import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  placeOrder,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 9 — Admin order workflow.
 *
 * Admin (storageState) opens a freshly placed order and drives it through the
 * claim-based lifecycle: pending_payment → processing → confirmed → shipped
 * (capturing provider + tracking code), asserting the UI badge after each
 * transition and the shipping card at the end. Server state is verified
 * through the admin orders API.
 */
test.describe("Admin order workflow", () => {
  // Logged-in admin session for the whole spec.
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let customerCtx: APIRequestContext;
  let productId = "";
  const slug = "admin-order-prod";
  const price = 3_200_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 8);

    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `یخچال ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 2_400_000,
      stock: 4,
    });
  });

  test("drives the order through the lifecycle with shipping metadata", async ({
    page,
  }) => {
    // Place an order as the customer (manual payment → pending_payment).
    const { orderId } = await placeOrder({
      customer: customerCtx,
      items: [{ id: productId, quantity: 1, price, name: `یخچال ${state.prefix}` }],
      paymentMethod: "manual",
    });

    // Admin list: find the order via the search box.
    await page.goto("/admin/orders");
    await page.getByPlaceholder("جستجوی سفارش...").fill(orderId);
    await page.locator(`a[href="/admin/orders/${orderId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${orderId}$`));

    // Initial status badge.
    await expect(page.getByText("در انتظار پرداخت").first()).toBeVisible();

    // --- pending_payment → processing ---
    await page.locator("select").selectOption("processing");
    await page
      .getByPlaceholder("دلیل تغییر وضعیت...")
      .fill("بررسی اولیه انجام شد");
    await page.getByRole("button", { name: "ذخیره تغییر وضعیت" }).click();
    await expect(page.getByText("در حال پردازش").first()).toBeVisible();

    // --- processing → confirmed ---
    await page.locator("select").selectOption("confirmed");
    await page.getByRole("button", { name: "ذخیره تغییر وضعیت" }).click();
    await expect(page.getByText("تأیید شده").first()).toBeVisible();

    // --- confirmed → shipped (shipping metadata captured) ---
    await page.locator("select").selectOption("shipped");
    await page
      .getByPlaceholder("مثلاً تیپاکس، پست پیشتاز...")
      .fill("پست پیشتاز");
    await page.getByPlaceholder("کد رهگیری مرسوله...").fill("E2E-TRK-100");
    await page.getByRole("button", { name: "ذخیره تغییر وضعیت" }).click();
    await expect(page.getByText("ارسال شده").first()).toBeVisible();

    // Shipping info card renders provider + tracking code.
    await expect(page.getByText("اطلاعات ارسال")).toBeVisible();
    await expect(page.getByText("پست پیشتاز")).toBeVisible();
    await expect(page.getByText("E2E-TRK-100")).toBeVisible();

    // Server-side: status shipped + shipping subdocument persisted.
    const orderRes = await adminCtx.get(`/api/admin/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      status: string;
      shipping?: { provider: string; trackingCode: string };
    };
    expect(order.status).toBe("shipped");
    expect(order.shipping?.provider).toBe("پست پیشتاز");
    expect(order.shipping?.trackingCode).toBe("E2E-TRK-100");
  });
});
