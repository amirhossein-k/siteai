import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, createProduct, type E2EState } from "./helpers/fixtures";

/**
 * Journey 20 — FIFO sale + refund (Session 82 Phase C).
 *
 * The admin receives purchased inventory through the REAL purchases API
 * (10 × 50,000 → one FIFO cost layer), a customer buys 2 units through the
 * REAL storefront checkout (cart → shipping → cash order), the sale consumes
 * the FIFO layer and snapshots fifoUnitCost with NO SupplierOrder (payout
 * safety), and an admin refund restores the exact layer through the REAL
 * /admin/orders/[id] refund UI. A consignment product sale is verified to keep
 * the marketplace SupplierOrder payout path untouched.
 *
 * Seeding uses real APIs only (admin products + accounting init wizard for the
 * purchased conversion + purchases create/order/receive). The refund requires
 * payment.status=paid, which the system only reaches via the payment gateway —
 * the journey marks the fixture order paid directly in the DB (the same
 * state-setup verify-fifo.js uses); the refund itself is exercised through the
 * real admin UI. The wizard stamps the GLOBAL accounting config singleton;
 * this suite's afterAll removes it immediately (the verify-accounting.js
 * convention) so the post-cutover stock-edit enforcement never leaks into
 * later specs (global-teardown also removes it at run end).
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
function fa(text: string): RegExp {
  return new RegExp(
    text
      .split("")
      .map((ch) => (ch === " " ? "\\s+" : `${ch}\\u200c?`))
      .join("")
  );
}

test.describe("FIFO sale + refund", () => {
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let purchasedId = "";
  let consignId = "";
  let orderId = "";
  const productName = "سنجشFIFO";
  const consignName = "ملکیFIFO";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    const categoryId = await createCategory(adminCtx, state.prefix, 22);

    // Purchased fixture: stock 0 → converted to purchased via the wizard (no
    // opening layer); the purchase receipt creates the FIFO layer.
    purchasedId = await createProduct(adminCtx, {
      slug: `${state.prefix}fifo-prod`,
      name: `${productName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 200_000,
      supplierPrice: 90_000,
      stock: 0,
    });

    // Consignment fixture: the existing marketplace flow must stay untouched.
    consignId = await createProduct(adminCtx, {
      slug: `${state.prefix}fifo-consign`,
      name: `${consignName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 150_000,
      supplierPrice: 60_000,
      stock: 5,
    });

    // Convert consignment → purchased via the accounting init wizard (the
    // only real-API path). Stock 0 → no opening layer (receipt creates it).
    // Self-healing sweeps (same conventions as verify-accounting.js /
    // admin-purchases.spec.ts): the E2E shares the seeded admin's rate-limit
    // budget with the regression verify suites.
    const { connectDb, disconnectDb } = await import("./helpers/db");
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    await mongoose.connection.db
      ?.collection<{ _id: string }>("ratelimits")
      .deleteMany({ _id: { $regex: "^rl:accounting-init:" } });
    await mongoose.connection.db
      ?.collection<{ _id: unknown }>("accountingconfigs")
      .deleteMany({ _id: "accounting" } as never);
    await disconnectDb();

    const initRes = await adminCtx.post("/api/admin/accounting/initialize", {
      data: {
        confirmValuation: true,
        cutoverDate: new Date().toISOString(),
        items: [{ productId: purchasedId }],
      },
    });
    expect(initRes.status()).toBe(200);

    // Receive 10 × 50,000 through the real purchases API (create → order → receive).
    // Self-healing rate-limit sweep (the E2E shares the seeded admin with the
    // regression verify suites' purchase-write budget).
    const { connectDb: cDb, disconnectDb: dDb } = await import("./helpers/db");
    await cDb();
    await mongoose.connection.db
      ?.collection<{ _id: string }>("ratelimits")
      .deleteMany({ _id: { $regex: "^rl:purchase-write:" } });

    const create = await adminCtx.post("/api/admin/purchases", {
      data: {
        supplier: state.supplierId,
        purchaseDate: new Date().toISOString(),
        reference: `${state.prefix}FIFO-PO`,
        items: [{ product: purchasedId, quantity: 10, unitCost: 50_000 }],
      },
    });
    expect(create.status()).toBe(201);
    const purchase = (await create.json()) as {
      purchase: { id: string; items: Array<{ id: string }> };
    };
    const purchaseId = purchase.purchase.id;
    const itemId = purchase.purchase.items[0].id;

    const orderRes = await adminCtx.patch(
      `/api/admin/purchases/${purchaseId}`,
      { data: { action: "order" } }
    );
    expect(orderRes.status()).toBe(200);

    const rec = await adminCtx.post(`/api/admin/purchases/${purchaseId}/receive`, {
      data: {
        key: `${state.prefix}receive-full`,
        items: [{ itemId, quantity: 10 }],
      },
    });
    expect(rec.status()).toBe(200);
    await dDb();
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

  test("customer buys purchased stock → FIFO layer consumed, no supplier payout", async ({
    browser,
    playwright,
  }) => {
    const ctx = await browser.newContext({
      storageState: state.customerStatePath,
    });
    const customerPage = await ctx.newPage();

    await customerPage.goto(`/products/${state.prefix}fifo-prod`);
    await customerPage
      .getByRole("button", { name: "افزودن به سبد خرید" })
      .click();
    await expect(customerPage.getByText(/به سبد خرید اضافه شد/)).toBeVisible();

    await customerPage.goto("/checkout");
    await expect(
      customerPage.getByRole("heading", { name: "اطلاعات ارسال" })
    ).toBeVisible();
    await customerPage
      .getByPlaceholder("مثال: علی محمدی")
      .fill(`مشتری ${state.prefix}`);
    await customerPage
      .getByPlaceholder("مثال: ۰۹۱۲۳۴۵۶۷۸۹")
      .fill(state.customerPhone);
    await customerPage
      .getByPlaceholder("استان، شهر، خیابان، پلاک، واحد")
      .fill("تهران، خیابان آزادی، پلاک ۱");
    await customerPage
      .getByPlaceholder("مثال: ۱۲۳۴۵۶۷۸۹۰")
      .fill("1234567890");

    const [checkoutRes] = await Promise.all([
      customerPage.waitForResponse(
        (r) => r.url().includes("/api/checkout") && r.request().method() === "POST"
      ),
      customerPage.getByRole("button", { name: "ثبت سفارش" }).click(),
    ]);
    const { orderId: created } = (await checkoutRes.json()) as { orderId: string };
    expect(created).toBeTruthy();
    orderId = created;
    await ctx.close();

    // The order item snapshots the exact weighted FIFO unit cost (50000).
    // `/api/orders?id=` returns the ORDER OBJECT directly (not paginated).
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const orderRes = await customerCtx.get(`/api/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      items?: Array<{ quantity: number; fifoUnitCost?: number | null }>;
    };
    const line = order.items?.[0];
    // The storefront cart defaults to quantity 1 per click.
    expect(line?.quantity).toBe(1);
    expect(line?.fifoUnitCost).toBe(50_000);

    // Stock 10 → 9; layers 10×50000 → 9×50000 (exact FIFO consumption).
    const productsRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(productsRes.ok()).toBeTruthy();
    const body = (await productsRes.json()) as {
      data?: Array<{
        _id: string;
        stock: number;
        costLayers?: Array<{ remaining: number; unitCost: number }>;
      }>;
    };
    const product = (body.data ?? []).find((p) => p._id === purchasedId);
    expect(product?.stock).toBe(9);
    const layers = product?.costLayers ?? [];
    expect(layers.reduce((s, l) => s + l.remaining, 0)).toBe(9);
    expect(layers.every((l) => l.unitCost === 50_000)).toBe(true);

    // Payout safety: NO SupplierOrder was created for the purchased units.
    const { connectDb, disconnectDb } = await import("./helpers/db");
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    const supplierOrderCount = await mongoose.connection.db
      ?.collection("supplierorders")
      .countDocuments({ "items.product": { $in: [purchasedId] } });
    expect(supplierOrderCount).toBe(0);
    // Audit trail: one sale movement with the exact consumed cost.
    const saleMv = await mongoose.connection.db
      ?.collection("inventorymovements")
      .findOne({ sourceRef: `sale-${orderId}-${purchasedId}` });
    expect(saleMv).toBeTruthy();
    expect(saleMv?.quantity).toBe(-1);
    expect(saleMv?.totalCost).toBe(50_000);
    await disconnectDb();
  });

  test("admin refund restores the exact FIFO layer through the UI", async ({
    page,
  }) => {
    // State setup: the system only reaches payment.status=paid via the
    // gateway; mark this fixture order paid so the refund button appears.
    const { connectDb, disconnectDb } = await import("./helpers/db");
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    await mongoose.connection.db
      ?.collection("orders")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(orderId) },
        { $set: { "payment.status": "paid", status: "processing" } }
      );
    await disconnectDb();

    await page.goto(`/admin/orders/${orderId}`);
    await page
      .getByRole("button", { name: fa("بازپرداخت سفارش") })
      .click();
    await expect(
      page.getByRole("heading", { name: fa("بازپرداخت سفارش") })
    ).toBeVisible();
    await page.getByPlaceholder("دلیل بازپرداخت را وارد کنید...").fill(
      `${state.prefix}بازپرداخت E2E`
    );
    await page.getByRole("button", { name: fa("تأیید بازپرداخت") }).click();
    await expect(page.getByText(/بازپرداخت شد/).first()).toBeVisible();

    // Server-side: stock 8 → 10, layer quantity restored at the SNAPSHOT cost
    // (50000 — never the current supplierPrice 90000).
    const res = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data?: Array<{
        _id: string;
        stock: number;
        costLayers?: Array<{ remaining: number; unitCost: number }>;
      }>;
    };
    const product = (body.data ?? []).find((p) => p._id === purchasedId);
    expect(product?.stock).toBe(10);
    const layers = product?.costLayers ?? [];
    expect(layers.reduce((s, l) => s + l.remaining, 0)).toBe(10);
    expect(layers.every((l) => l.unitCost === 50_000)).toBe(true);

    const { connectDb: c2, disconnectDb: d2 } = await import("./helpers/db");
    await c2();
    const { default: mongoose2 } = await import("mongoose");
    const restockMv = await mongoose2.connection.db
      ?.collection("inventorymovements")
      .findOne({ sourceRef: `return_restock-${orderId}-${purchasedId}` });
    expect(restockMv).toBeTruthy();
    expect(restockMv?.quantity).toBe(1);
    await d2();
  });

  test("consignment sale keeps the marketplace payout path (API)", async ({
    playwright,
  }) => {
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const res = await customerCtx.post("/api/checkout", {
      data: {
        items: [
          {
            id: consignId,
            quantity: 2,
            price: 150_000,
            name: `${consignName} ${state.prefix}`,
          },
        ],
        shippingAddress: {
          fullName: `مشتری ${state.prefix}`,
          phone: state.customerPhone,
          address: "تهران، خیابان آزادی، پلاک ۱",
          postalCode: "1234567890",
        },
        paymentMethod: "manual",
      },
    });
    expect(res.status()).toBe(201);
    const { orderId: consignOrder } = (await res.json()) as { orderId: string };

    // The consignment line has NO fifoUnitCost and its SupplierOrder payout
    // (amountOwed = 2 × 60000) is created — the marketplace flow is intact.
    const orderRes = await customerCtx.get(`/api/orders?id=${consignOrder}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      items?: Array<{ fifoUnitCost?: number | null }>;
    };
    expect((order.items?.[0]?.fifoUnitCost ?? null)).toBeNull();

    const { connectDb, disconnectDb } = await import("./helpers/db");
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    const so = await mongoose.connection.db
      ?.collection("supplierorders")
      .findOne({ order: new mongoose.Types.ObjectId(consignOrder) });
    expect(so).toBeTruthy();
    expect(so?.amountOwed).toBe(120_000);
    const saleMv = await mongoose.connection.db
      ?.collection("inventorymovements")
      .countDocuments({ sourceRef: `sale-${consignOrder}-${consignId}` });
    expect(saleMv).toBe(0);
    await disconnectDb();
  });

  test("inventory report values purchased stock from FIFO layers", async () => {
    // After the refund: 10 units @ 50000 layer cost → value 500,000 (NOT
    // current stock × current supplierPrice 90000 = 900,000).
    const res = await adminCtx.get(
      `/api/admin/reports/inventory?preset=today&product=${purchasedId}`
    );
    expect(res.ok()).toBeTruthy();
    const report = (await res.json()) as {
      rows?: Array<{ productId: string; currentStock: number; unitCost: number; inventoryValue: number }>;
    };
    const row = (report.rows ?? []).find((r) => r.productId === purchasedId);
    expect(row).toBeTruthy();
    expect(row?.currentStock).toBe(10);
    expect(row?.unitCost).toBe(50_000);
    expect(row?.inventoryValue).toBe(500_000);
  });
});
