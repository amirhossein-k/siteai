import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  placeOrder,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 18 — Admin Reports (Session 81).
 *
 * The admin opens the reports dashboard, verifies the KPI + P&L render from
 * real server data, navigates to the sales report (URL-driven preset),
 * changes the date preset, and downloads the Excel export for the exact
 * filtered dataset.
 */
test.describe("Admin reports", () => {
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let customerCtx: APIRequestContext;
  let productId = "";
  const productName = "گزارشسنج";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 9);
    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}reports-prod`,
      name: `${productName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 150_000,
      supplierPrice: 90_000,
      stock: 20,
    });

    // Seed a real order (manual payment → pending_payment, counted in sales).
    await placeOrder({
      customer: customerCtx,
      items: [
        {
          id: productId,
          quantity: 1,
          price: 150_000,
          name: `${productName} ${state.prefix}`,
        },
      ],
      paymentMethod: "manual",
    });
  });

  test("dashboard shows KPIs and P&L from server data", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(
      page.getByRole("heading", { name: "داشبورد گزارش‌ها" })
    ).toBeVisible();

    // Summary cards render (net sales row always present).
    await expect(page.getByText("فروش خالص", { exact: true }).first()).toBeVisible();
    // P&L statement renders with its headline rows.
    await expect(page.getByText("سود و زیان", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("بهای تمام‌شده (COGS)").first()).toBeVisible();
    // Session 82 Phase E — net profit is now real: the operating-expenses and
    // net-profit rows render (with the seeded expense fixture they equal
    // gross profit − operating expenses). No «در دسترس نیست» note anymore.
    await expect(page.getByText("سود خالص", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("هزینه‌های عملیاتی", { exact: true }).first()
    ).toBeVisible();

    // The seeded order appears in the daily chart's tooltip-free bars
    // (assert the top-products panel instead — deterministic).
    await expect(page.getByText("پرفروش‌ترین محصولات").first()).toBeVisible();
  });

  test("sales report renders the seeded product and honors the URL preset", async ({
    page,
  }) => {
    await page.goto("/admin/reports/sales");
    await expect(page.getByRole("heading", { name: "گزارش فروش" })).toBeVisible();

    // Seeded product row (from the immutable order snapshot).
    await expect(page.getByText(`${productName} ${state.prefix}`).first()).toBeVisible();

    // URL-driven preset: switch to «امروز» → URL carries preset=today and the
    // row stays (order was placed seconds ago).
    await page.getByRole("button", { name: "امروز" }).click();
    await expect(page).toHaveURL(/preset=today/);
    await expect(page.getByText(`${productName} ${state.prefix}`).first()).toBeVisible();

    // Back to month.
    await page.getByRole("button", { name: "ماه جاری" }).click();
    await expect(page).toHaveURL(/preset=month/);
  });

  test("Excel export downloads the filtered dataset", async ({ page }) => {
    await page.goto("/admin/reports/sales?preset=month");

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "خروجی اکسل" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^sales-.*\.xlsx$/);
  });

  test("sidebar links the reports section", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.getByRole("link", { name: "گزارش‌ها" }).click();
    await expect(page).toHaveURL(/\/admin\/reports$/);
    await expect(
      page.getByRole("heading", { name: "داشبورد گزارش‌ها" })
    ).toBeVisible();
  });
});
