import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, createProduct, type E2EState } from "./helpers/fixtures";

/**
 * ZWNJ-tolerant Persian matcher: some UI labels contain U+200C (e.g.
 * «پیش‌نویس»), which invisible bytes would break an exact-string match on.
 * Building a regex with `\u200c?` between every char keeps assertions robust
 * regardless of whether the label contains the zero-width joiner.
 */
function fa(text: string): RegExp {
  return new RegExp(
    text
      .split("")
      .map((ch) => (ch === " " ? "\\s+" : `${ch}\\u200c?`))
      .join("")
  );
}

const PERSIAN = {
  purchases: "خریدها",
  newPurchase: "خرید جدید",
  createDraft: "ایجاد خرید",
  draft: "پیش‌نویس",
  ordered: "ثبت سفارش",
  partialReceived: "دریافت جزئی",
  received: "دریافت کامل",
  receiveAll: "دریافت همه باقیمانده",
  receiptHistory: "سوابق دریافت",
  purchasesReport: "گزارش خرید",
};


/**
 * Journey 19 — Admin Purchases (Session 82 Phase B).
 *
 * The admin creates a DRAFT purchase through the real /admin/purchases UI
 * (product picker restricted to `sourcing: "purchased"` products), orders it,
 * receives a partial quantity, verifies the remaining quantity, receives the
 * rest, and confirms the received status — then verifies the server-side
 * inventory (stock + FIFO cost layer) and that the purchase appears in the
 * purchases report.
 *
 * Seeding uses the REAL APIs only: the product is created via the admin
 * products API (consignment by default), then converted to `sourcing:
 * "purchased"` through the accounting init wizard (the only real-API path —
 * the wizard is itself part of Session 82 Phase A). The wizard stamps the
 * GLOBAL accounting config singleton; this suite's afterAll removes it
 * immediately (the verify-accounting.js convention) so the post-cutover
 * stock-edit enforcement never leaks into later specs (global-teardown also
 * removes it at run end, plus the purchase rows + movements).
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Admin purchases", () => {
  // Logged-in admin session for the whole spec.
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let productId = "";
  let purchaseId = "";
  let purchaseNumber = "";
  const productName = "خریدسنج";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    const categoryId = await createCategory(adminCtx, state.prefix, 21);
    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}purchase-prod`,
      name: `${productName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 200_000,
      supplierPrice: 90_000,
      // Stock 0 so the receipt quantities are provable (0 → 10).
      stock: 0,
    });

    // Convert consignment → purchased via the accounting init wizard (the only
    // real-API path; the admin products POST never maps `sourcing`). Stock 0 →
    // converts with NO opening layer (receipt will create the layer instead).
    //
    // The wizard is rate-limited `accounting-init` 3/15min PER ACTOR and the
    // E2E shares the seeded admin with the regression verify suites — so the
    // journey clears its OWN accounting-init keys first (the exact
    // self-healing convention verify-accounting.js uses before each successful
    // init: `clearInitKeys`). This is a test-state sweep, never production
    // rate-limit logic.
    const { connectDb, disconnectDb } = await import("./helpers/db");
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    await mongoose.connection.db
      ?.collection<{ _id: string }>("ratelimits")
      .deleteMany({ _id: { $regex: "^rl:accounting-init:" } });
    // Clear any leftover config singleton from a crashed previous run — the
    // wizard returns 400 "already initialized" if the singleton is stamped
    // (the same hermetic sweep verify-accounting.js performs).
    await mongoose.connection.db
      ?.collection<{ _id: unknown }>("accountingconfigs")
      .deleteMany({ _id: "accounting" } as never);
    await disconnectDb();

    const initRes = await adminCtx.post("/api/admin/accounting/initialize", {
      data: {
        confirmValuation: true,
        cutoverDate: new Date().toISOString(),
        items: [{ productId }],
      },
    });
    expect(initRes.status()).toBe(200);
    const init = (await initRes.json()) as { initialized: boolean };
    expect(init.initialized).toBe(true);

    // Sanity: the product is now purchased-sourcing (the create-form picker
    // relies on this).
    const searchRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(searchRes.ok()).toBeTruthy();
    const body = (await searchRes.json()) as {
      data?: Array<{ _id: string; sourcing: string }>;
    };
    const row = (body.data ?? []).find((p) => p._id === productId);
    expect(row?.sourcing).toBe("purchased");
  });

  test.afterAll(async () => {
    // Restore the pre-run state: delete the GLOBAL accounting config singleton
    // this journey stamped (the exact convention verify-accounting.js uses at
    // suite end). Without this, the post-cutover stock-edit enforcement would
    // leak into every later spec in the run.
    const { connectDb, disconnectDb, clearAccountingConfig } = await import(
      "./helpers/db"
    );
    await connectDb();
    await clearAccountingConfig();
    await disconnectDb();
  });

  test("admin creates a draft purchase through the UI", async ({ page }) => {
    await page.goto("/admin/purchases");
    await expect(
      page.getByRole("heading", { name: fa(PERSIAN.purchases) }).first()
    ).toBeVisible();

    // Open the create form.
    await page.getByRole("link", { name: fa(PERSIAN.newPurchase) }).click();
    await expect(page).toHaveURL(/\/admin\/purchases\/new$/);
    await expect(
      page.getByRole("heading", { name: fa(PERSIAN.newPurchase) })
    ).toBeVisible();

    // Supplier = the per-run supplier seeded by global-setup.
    await page
      .locator("select")
      .first()
      .selectOption({ label: `فروشنده ${state.prefix}` });

    // Product = the purchased-sourcing fixture (the picker only lists purchased).
    await page
      .locator("select")
      .nth(1)
      .selectOption({ label: `${productName} ${state.prefix}` });

    // Quantity 10 @ 50,000 Toman.
    await page.getByPlaceholder("تعداد").fill("10");
    await page.getByPlaceholder("هزینه واحد").fill("50000");

    // The label contains a ZWNJ (پیش‌نویس) — match by regex to stay
    // resilient to the invisible U+200C.
    await page.getByRole("button", { name: fa(PERSIAN.createDraft) }).click();

    // Redirected to the detail page with a draft badge + a P-number.
    await expect(page).toHaveURL(/\/admin\/purchases\/[0-9a-f]{24}$/);
    purchaseId = page.url().split("/").pop() ?? "";
    await expect(page.getByText(fa(PERSIAN.draft)).first()).toBeVisible();
    const heading = page.getByRole("heading").first();
    await expect(heading).toHaveText(/^P-\d{4}-/);
    purchaseNumber = (await heading.textContent())?.trim() ?? "";

    // Draft summary shows the confirmed line amounts (10 × 50,000 = 500,000).
    await expect(page.getByText("۵۰۰٬۰۰۰ تومان", { exact: true }).first()).toBeVisible();
  });

  test("order, receive partially, verify remaining, receive the rest", async ({
    page,
  }) => {
    await page.goto(`/admin/purchases/${purchaseId}`);
    await expect(page.getByText(fa(PERSIAN.draft)).first()).toBeVisible();

    // Order the draft → status badge «ثبت سفارش».
    await page.getByRole("button", { name: fa(PERSIAN.ordered) }).click();
    await expect(page.getByText(fa(PERSIAN.ordered)).first()).toBeVisible();

    // Line row shows سفارش ۱۰ / دریافت ۰ / باقیمانده ۱۰.
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText("۱۰");

    // Partial receive: 4 of 10.
    await page
      .getByLabel(`تعداد دریافت ${productName} ${state.prefix}`)
      .fill("4");
    await page.getByRole("button", { name: "دریافت", exact: true }).click();

    // After refetch: دریافت ۴ / باقیمانده ۶ + partially_received badge.
    await expect(
      page.getByText(fa(PERSIAN.partialReceived)).first()
    ).toBeVisible();
    await expect(row).toContainText("۶");

    // Receive the remaining 6 → received badge + zero outstanding.
    await page.getByRole("button", { name: fa(PERSIAN.receiveAll) }).click();
    await expect(page.getByText(fa(PERSIAN.received)).first()).toBeVisible();
    await expect(row).toContainText("۰");

    // The receipts history lists both receive operations.
    await expect(page.getByText(fa(PERSIAN.receiptHistory))).toBeVisible();
    await expect(page.getByText("قلم", { exact: false }).first()).toBeVisible();
  });

  test("inventory reflects the receipts and the purchase appears in the report", async ({
    page,
  }) => {
    // Server-side inventory: stock 0 → 10 with an exact FIFO cost layer.
    const res = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data?: Array<{
        _id: string;
        stock: number;
        costLayers?: Array<{
          qty: number;
          remaining: number;
          unitCost: number;
          source: string;
        }>;
      }>;
    };
    const product = (body.data ?? []).find((p) => p._id === productId);
    expect(product?.stock).toBe(10);
    // Two receipts (4 + 6) → two FIFO cost layers, each exactly its quantity.
    const layers = product?.costLayers ?? [];
    expect(layers).toHaveLength(2);
    expect(layers[0]?.qty).toBe(4);
    expect(layers[0]?.remaining).toBe(4);
    expect(layers[0]?.unitCost).toBe(50_000);
    expect(layers[0]?.source).toBe("receipt");
    expect(layers[1]?.qty).toBe(6);
    expect(layers[1]?.remaining).toBe(6);
    expect(layers[1]?.unitCost).toBe(50_000);
    expect(layers[1]?.source).toBe("receipt");

    // The purchase appears in the purchases report (today's window).
    await page.goto("/admin/reports/purchases?preset=today");
    await expect(
      page.getByRole("heading", { name: fa(PERSIAN.purchasesReport) })
    ).toBeVisible();
    await expect(page.getByText(purchaseNumber).first()).toBeVisible();
  });

  test("sidebar links the purchases section", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.getByRole("link", { name: fa(PERSIAN.purchases) }).click();
    await expect(page).toHaveURL(/\/admin\/purchases$/);
    await expect(
      page.getByRole("heading", { name: fa(PERSIAN.purchases) }).first()
    ).toBeVisible();
  });
});
