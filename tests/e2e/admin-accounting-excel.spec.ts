import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, createProduct, placeOrder, type E2EState } from "./helpers/fixtures";
import { connectDb, disconnectDb, clearAccountingConfig } from "./helpers/db";

/**
 * Journey 20 — Accounting Excel V2 export (Session 82 Phase F).
 *
 * Seeds the full accounting chain through the REAL APIs: purchased-sourcing
 * product (accounting init wizard) → purchase + receive (FIFO cost layer) →
 * customer sale (FIFO COGS snapshot) → admin expense (operating expenses).
 * Then opens the /admin/reports/accounting page, verifies the V2 datasets
 * render, and downloads the 17-sheet workbook — asserting the sheet names,
 * the P&L reconciliation (net = gross + discounts), the COGS rows, and the
 * FIFO layer value by parsing the downloaded XLSX with ExcelJS.
 *
 * The global accounting-config singleton stamped by the init wizard is
 * removed in afterAll (the verify-accounting.js convention) so the
 * post-cutover stock-edit enforcement never leaks into later specs.
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Admin accounting Excel export", () => {
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let customerCtx: APIRequestContext;
  let productId = "";
  let purchaseId = "";
  let expenseId = "";
  const productName = "دفترحسابسنج";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });

    const categoryId = await createCategory(adminCtx, state.prefix, 31);
    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}acct-excel-prod`,
      name: `${productName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 200_000,
      supplierPrice: 90_000,
      stock: 0,
    });

    // Convert consignment → purchased via the accounting init wizard (the only
    // real-API path). Stock 0 → converts with NO opening layer; the receipt
    // creates the FIFO layer instead (exact same flow as admin-purchases).
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    await mongoose.connection.db
      ?.collection<{ _id: string }>("ratelimits")
      .deleteMany({ _id: { $regex: "^rl:accounting-init:" } });
    await mongoose.connection.db
      ?.collection<{ _id: unknown }>("accountingconfigs")
      .deleteMany({ _id: "accounting" } as never);

    const initRes = await adminCtx.post("/api/admin/accounting/initialize", {
      data: {
        confirmValuation: true,
        cutoverDate: new Date().toISOString(),
        items: [{ productId }],
      },
    });
    if (initRes.status() !== 200) {
      console.error("  [DEBUG] init failed: " + (await initRes.text()));
    }
    expect(initRes.status()).toBe(200);
    const init = (await initRes.json()) as { initialized: boolean };
    expect(init.initialized).toBe(true);

    // Purchase 10 units @ 100,000 (unit cost from the PurchaseItem, never
    // substituted from the current supplierPrice 90,000).
    const purchaseRes = await adminCtx.post("/api/admin/purchases", {
      data: {
        supplier: state.supplierId,
        purchaseDate: new Date().toISOString(),
        reference: `${state.prefix}acct-excel-ref`,
        items: [{ product: productId, quantity: 10, unitCost: 100_000 }],
      },
    });
    if (purchaseRes.status() !== 201) {
      console.error("  [DEBUG] purchase create failed: " + (await purchaseRes.text()));
    }
    expect(purchaseRes.status()).toBe(201);
    const purchase = (await purchaseRes.json()) as {
      purchase: { id: string; items: Array<{ id: string }> };
    };
    purchaseId = purchase.purchase.id;

    const orderRes = await adminCtx.patch(
      `/api/admin/purchases/${purchaseId}`,
      { data: { action: "order" } }
    );
    expect(orderRes.status()).toBe(200);

    // Receive all 10 → stock 10 + a single FIFO layer @ 100,000.
    await mongoose.connection.db
      ?.collection<{ _id: string }>("ratelimits")
      .deleteMany({ _id: { $regex: "^rl:purchase-write:" } });
    const recRes = await adminCtx.post(
      `/api/admin/purchases/${purchaseId}/receive`,
      {
        data: {
          key: `${state.prefix}recv-${Date.now()}`,
          items: [{ itemId: purchase.purchase.items[0].id, quantity: 10 }],
        },
      }
    );
    expect(recRes.status()).toBe(200);

    // Sale: customer buys 4 → fifoUnitCost 100,000 snapshot + no SupplierOrder
    // (purchased-sourcing payout safety).
    await placeOrder({
      customer: customerCtx,
      items: [
        {
          id: productId,
          quantity: 4,
          price: 200_000,
          name: `${productName} ${state.prefix}`,
        },
      ],
      paymentMethod: "manual",
    });

    // Expense: 1,500,000 advertising → operating expenses + net profit.
    const expenseRes = await adminCtx.post("/api/admin/expenses", {
      data: {
        category: "advertising",
        description: `${state.prefix}تبلیغات اکسل`,
        amount: 1_500_000,
        paymentMethod: "bank",
        status: "pending",
      },
    });
    expect(expenseRes.status()).toBe(201);
    expenseId = ((await expenseRes.json()) as { expense: { _id: string } }).expense._id;
    const payRes = await adminCtx.post(`/api/admin/expenses/${expenseId}/pay`);
    expect(payRes.status()).toBe(200);
    await disconnectDb();
  });

  test.afterAll(async () => {
    // Scoped self-cleanup — remove ONLY this journey's own PREFIX'd rows
    // (category/product/purchase/movements/expense), because global-teardown
    // only runs at the very END of the run. Without this, the expense (and
    // sale/purchase) rows created here leak into LATER specs' shared-window
    // assertions (admin-expenses asserts an EXACT report total for the month;
    // this journey's 1,500,000 expense inflated it to 4,500,000).
    //
    // NOTE: NOT cleanupByPrefix — that helper also deletes the shared E2E
    // customer/supplier users (their names embed the run prefix) and would
    // break every later spec. This purge is scoped to our own slug/name/id
    // patterns and never touches users.
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    const db = mongoose.connection.db;
    if (!db) throw new Error("Not connected to MongoDB");
    const esc = state.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc);
    const catRe = new RegExp(`^${esc}acct-excel`);
    const prodRe = new RegExp(`^${esc}acct-excel`);
    const ownProducts = await db
      .collection("products")
      .find({ slug: prodRe })
      .project({ _id: 1 })
      .toArray();
    const productIds = ownProducts.map(
      (r) => r._id as InstanceType<typeof mongoose.Types.ObjectId>
    );
    if (productIds.length > 0) {
      await db
        .collection("purchaseorders")
        .deleteMany({ "items.product": { $in: productIds } });
      await db
        .collection("inventorymovements")
        .deleteMany({ product: { $in: productIds } });
      await db
        .collection("products")
        .deleteMany({ _id: { $in: productIds } });
    }
    // The expense embeds the run prefix in its description.
    await db
      .collection("expenses")
      .deleteMany({ description: re });
    await db.collection("categories").deleteMany({ slug: catRe });
    // Restore the GLOBAL accounting config singleton this journey stamped.
    await clearAccountingConfig();
    await disconnectDb();
  });

  test("accounting report page renders the V2 datasets", async ({ page }) => {
    await page.goto("/admin/reports/accounting");
    // NOTE: use the literal string here — the fa() regex helper would treat
    // the parentheses in "(V2)" as a regex group and never match.
    await expect(
      page.getByRole("heading", { name: "دفتر حسابداری (V2)" }).first()
    ).toBeVisible();
    // The order-items view renders with the seeded sale row.
    await expect(
      page.getByText(`${productName} ${state.prefix}`).first()
    ).toBeVisible();
    // The summary cards render from server data.
    await expect(page.getByText("فروش ناخالص", { exact: true }).first()).toBeVisible();
  });

  test("Excel export downloads the 17-sheet accounting workbook with reconciled values", async ({
    page,
  }) => {
    await page.goto("/admin/reports/accounting");

    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "خروجی اکسل" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^accounting-.*\.xlsx$/);

    // Parse the downloaded workbook and assert sheet names + reconciliation.
    const { default: ExcelJS } = await import("exceljs");
    const path = await download.path();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path!);

    const names = workbook.worksheets.map((ws) => ws.name);
    const expected = [
      "خلاصه",
      "فروش",
      "سفارش‌ها",
      "اقلام فروش",
      "پرداخت‌ها",
      "مرجوعی‌ها",
      "مشتریان",
      "کوپن‌ها",
      "خریدها",
      "اقلام خرید",
      "هزینه‌ها",
      "موجودی",
      "گردش موجودی",
      "لایه‌های FIFO",
      "بهای تمام‌شده",
      "سود و زیان",
      "خلاصه حسابداری",
    ];
    for (const sheet of expected) {
      expect(names, `sheet ${sheet}`).toContain(sheet);
    }
    expect(names.length).toBe(17);

    // P&L reconciliation: net = gross + discounts (discounts are negative).
    const pnl = workbook.getWorksheet("سود و زیان");
    const pnlByLabel: Record<string, number> = {};
    pnl?.eachRow((row, n) => {
      if (n === 1) return;
      const label = String(row.getCell(1).value);
      const v = row.getCell(2).value;
      if (typeof v === "number") pnlByLabel[label] = v;
    });
    const gross = pnlByLabel["فروش ناخالص"] ?? 0;
    const net = pnlByLabel["فروش خالص"] ?? 0;
    const discounts =
      (pnlByLabel["تخفیف محصول"] ?? 0) + (pnlByLabel["تخفیف کوپن"] ?? 0);
    expect(Math.abs(net - (gross + discounts))).toBeLessThanOrEqual(1);

    // COGS sheet has the seeded FIFO row (100,000 × 4 = 400,000).
    const cogs = workbook.getWorksheet("بهای تمام‌شده");
    let sawFifoRow = false;
    cogs?.eachRow((row, n) => {
      if (n === 1) return;
      if (String(row.getCell(3).value || "").includes(productName)) {
        sawFifoRow = true;
        expect(row.getCell(6).value).toBe(4); // quantity
        expect(row.getCell(7).value).toBe(100_000); // fifo unit cost
      }
    });
    expect(sawFifoRow).toBe(true);

    // FIFO layers: the seeded layer remains at 6 × 100,000 = 600,000.
    const layers = workbook.getWorksheet("لایه‌های FIFO");
    let layerValue = 0;
    let layerQty = 0;
    layers?.eachRow((row, n) => {
      if (n === 1) return;
      const rem = row.getCell(8).value;
      const uc = row.getCell(9).value;
      if (typeof rem === "number" && typeof uc === "number") {
        layerQty += rem;
        layerValue += rem * uc;
      }
    });
    expect(layerQty).toBe(6);
    expect(layerValue).toBe(600_000);

    // خلاصه حسابداری carries the valuation-basis note (FIFO).
    const acct = workbook.getWorksheet("خلاصه حسابداری");
    let sawValuation = false;
    acct?.eachRow((row) => {
      if (String(row.getCell(1).value).includes("FIFO")) sawValuation = true;
    });
    expect(sawValuation).toBe(true);
  });
});
