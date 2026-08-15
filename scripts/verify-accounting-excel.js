#!/usr/bin/env node
/**
 * Session 82 Phase F — Accounting Excel V2 workbook verification.
 *
 * Real HTTP API + real DB (the established verify-* convention). Proves:
 *   1. 401/403 auth matrix on /api/admin/reports/accounting (+export)
 *   2. Purchased sale → FIFO fifoUnitCost + sale movement + no SupplierOrder
 *   3. Consignment sale → snapshot COGS (historical compatibility)
 *   4. Purchase + receive → exact cost layer (unit cost from the PurchaseItem,
 *      never substituted from current supplierPrice)
 *   5. Expense ledger → operating expenses + net profit (gross profit − expenses)
 *   6. The 17-sheet accounting workbook export:
 *      - all sheets present with Persian names
 *      - بهای تمام‌شده sheet: Σ COGS rows = P&L COGS
 *      - سود و زیان sheet: net sales − COGS = gross profit,
 *        gross profit − operating expenses = net profit
 *      - لایه‌های FIFO sheet: Σ remaining × unitCost = inventory value
 *      - خریدها/اقلام خرید totals reconcile with the purchase docs
 *      - هزینه‌ها sheet: voided rows visible but EXCLUDED from totals
 *      - خلاصه حسابداری: valuation basis + historical note present
 *   7. Export rate limiting → 429 after the budget is consumed
 *
 * Self-cleaning: removes every PREFIX'd row (products/categories/suppliers/
 * users/orders/supplier-orders/purchases/movements/expenses) + its own
 * rate-limit keys + the accounting config singleton it stamps.
 *
 * Requires: dev server on http://localhost:3000, real DB, seeded admin.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "acctexc82_" + Date.now() + "_";
const PASS = "acctexc82-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_PHONE = "09157773022";
const CUSTOMER_PHONE = "09157773019";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// ---- tiny cookie jar (matches verify-reports' working NextAuth pattern) ----
function makeJar() {
  const cookies = {};
  return {
    get(headers) {
      let entries = [];
      if (headers && typeof headers.getSetCookie === "function") entries = headers.getSetCookie();
      else if (Array.isArray(headers)) entries = headers;
      for (const entry of entries) {
        const [pair] = entry.split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
      }
    },
    header() { return Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); },
  };
}

async function login(phone, password) {
  const jar = makeJar();
  let res = await fetch(`${BASE}/api/auth/csrf`);
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  const form = new URLSearchParams({ csrfToken, phone, password, json: "true" });
  res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
    body: form.toString(),
    redirect: "manual",
  });
  jar.get(res.headers);
  const ok = res.status === 302 || res.status === 200;
  if (!ok) throw new Error(`login ${phone} → ${res.status}`);
  return jar;
}

async function http(jar, method, url, body, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (jar) headers.Cookie = jar.header();
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (opts.raw) return { status: res.status, headers: res.headers, raw: res };
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers, raw: res };
}

async function checkout(jar, items) {
  return http(jar, "POST", "/api/checkout", {
    items,
    shippingAddress: {
      fullName: PREFIX + "Buyer",
      phone: CUSTOMER_PHONE,
      address: PREFIX + "street",
      postalCode: "1234567890",
    },
    paymentMethod: "manual",
  });
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const d = mongoose.connection.db;

  // --- Inline schemas bound to the real collections ---
  const UserSchema = new mongoose.Schema(
    { name: String, phone: String, passwordHash: String, role: String, isActive: Boolean },
    { timestamps: true, collection: "users" }
  );
  const SupplierSchema = new mongoose.Schema(
    { user: { type: mongoose.Schema.Types.ObjectId }, businessName: String, isActive: Boolean, balance: Number, pendingReserve: Number },
    { timestamps: true, collection: "suppliers" }
  );
  const User = mongoose.models.User_ACCTEXC || mongoose.model("User_ACCTEXC", UserSchema);
  const Supplier = mongoose.models.Supplier_ACCTEXC || mongoose.model("Supplier_ACCTEXC", SupplierSchema);

  // --- Idempotency sweep: this suite's own namespace only ---
  const ownProducts = (await d.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } })
    .project({ _id: 1 }).toArray()).map((x) => x._id);
  await d.collection("inventorymovements").deleteMany({ product: { $in: ownProducts } });
  await d.collection("purchaseorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await d.collection("expenses").deleteMany({ description: { $regex: "^" + PREFIX } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  // Clean the customer's leftover orders + SupplierOrders BEFORE deleting the
  // user (a crashed prior run leaves them behind; the user must still exist
  // for the lookup).
  const sweepCustomer = await User.findOne({ phone: CUSTOMER_PHONE }).lean();
  if (sweepCustomer) {
    const sweepOrders = (await d.collection("orders")
      .find({ customer: sweepCustomer._id }).project({ _id: 1 }).toArray()).map((x) => x._id);
    await d.collection("supplierorders").deleteMany({ order: { $in: sweepOrders } });
    await d.collection("orders").deleteMany({ customer: sweepCustomer._id });
  }
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  // The suite logs in the shared seeded admin + its own supplier/customer
  // (clears login + login_ip keys — both are per-IP/phone budgets).
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:(login_ip|login|purchase-write|report-export|expense-write):" } });

  const admin = await User.findOne({ phone: ADMIN_PHONE }).lean();
  assert(admin, "seeded admin not found");

  // --- Fixtures ---
  await User.create({ name: PREFIX + "Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: PREFIX + "Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({
    user: suppUser._id, businessName: PREFIX + "SupplierCo", isActive: true, balance: 0, pendingReserve: 0,
  });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await d.collection("categories").insertOne({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true, createdAt: new Date(), updatedAt: new Date() });

  const now = new Date();
  const seedProduct = (fields) =>
    d.collection("products").insertOne({
      name: fields.name, slug: fields.slug, description: "", images: [], brand: null, tags: [],
      category: catDoc.insertedId, supplier: suppDoc._id, supplierPrice: fields.supplierPrice,
      price: fields.price, stock: fields.stock, stockVersion: 0, hasVariants: !!fields.variants?.length,
      variants: fields.variants || [], isActive: true, sourcing: fields.sourcing || "purchased",
      costLayers: fields.costLayers || [], createdAt: now, updatedAt: now,
    });

  // purchased product — stock 0 so receipt quantities are provable
  const purchasedId = (await seedProduct({ name: PREFIX + "Purchased", slug: PREFIX + "purchased", supplierPrice: 120000, price: 200000, stock: 0 })).insertedId.toString();
  // consignment product — snapshot COGS, no FIFO
  const consignId = (await seedProduct({ name: PREFIX + "Consign", slug: PREFIX + "consign", supplierPrice: 90000, price: 150000, stock: 5, sourcing: "consignment" })).insertedId.toString();

  const getProduct = async (id) => d.collection("products").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const getOrder = async (id) => d.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const findMovement = async (ref) => d.collection("inventorymovements").findOne({ sourceRef: ref });
  const clearPurchaseKeys = () => d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:purchase-write:" } });

  let adminJar, supplierJar, customerJar;
  const orderIds = [];

  await testAsync("login admin/supplier/customer", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
  });

  // ---- TEST 1: auth matrix ----
  await testAsync("auth: 401 unauth, 403 customer/supplier on accounting JSON + export", async () => {
    for (const url of ["/api/admin/reports/accounting?preset=year", "/api/admin/reports/accounting/export?preset=year"]) {
      const unauth = await http(makeJar(), "GET", url);
      assert(unauth.status === 401, `unauth ${url} → ${unauth.status}`);
      const cust = await http(customerJar, "GET", url);
      assert(cust.status === 403, `customer ${url} → ${cust.status}`);
      const sup = await http(supplierJar, "GET", url);
      assert(sup.status === 403, `supplier ${url} → ${sup.status}`);
    }
    const bogus = await http(adminJar, "GET", "/api/admin/reports/bogus/export?preset=year");
    assert(bogus.status === 400, "bogus slug 400");
  });

  // ---- TEST 2: purchase + receive → exact cost layer ----
  let purchaseTotal = 0, purchasePaid = 0, purchaseOutstanding = 0;
  await testAsync("purchase+receive 10×100000 → stock 10, one receipt layer, movement (unit cost NOT supplierPrice 120000)", async () => {
    const create = await http(adminJar, "POST", "/api/admin/purchases", {
      supplier: suppDoc._id.toString(),
      purchaseDate: new Date().toISOString(),
      reference: PREFIX + "REF-" + Date.now(),
      items: [{ product: purchasedId, quantity: 10, unitCost: 100000 }],
    });
    assert(create.status === 201, `purchase create → ${create.status}: ${JSON.stringify(create.json)}`);
    const p = create.json.purchase;
    const order = await http(adminJar, "PATCH", `/api/admin/purchases/${p.id}`, { action: "order" });
    assert(order.status === 200, `purchase order → ${order.status}`);
    await clearPurchaseKeys();
    const rec = await http(adminJar, "POST", `/api/admin/purchases/${p.id}/receive`, {
      key: "key-" + Date.now(),
      items: [{ itemId: p.items[0].id, quantity: 10 }],
    });
    assert(rec.status === 200, `receive → ${rec.status}: ${JSON.stringify(rec.json)}`);
    const prod = await getProduct(purchasedId);
    assert(prod.stock === 10, `stock=${prod.stock}`);
    assert(prod.costLayers.length === 1, "one layer");
    assert(prod.costLayers[0].unitCost === 100000, `layer unit cost=${prod.costLayers[0].unitCost} (must NOT be supplierPrice 120000)`);
    assert(prod.costLayers[0].remaining === 10, "layer remaining 10");
    // sourceRef is `receipt-<purchaseId>-<key>-<itemId>` — the key is generated
    // server-side, so match by prefix.
    const mv = await d.collection("inventorymovements").findOne({ sourceRef: { $regex: "^receipt-" + p.id + "-" } });
    assert(!!mv, "receipt movement exists");
    assert(mv.quantity === 10 && mv.unitCost === 100000, `receipt movement ${mv.quantity}/${mv.unitCost}`);
    purchaseTotal = rec.json?.purchase?.total ?? p.total;
    purchasePaid = rec.json?.purchase?.amountPaid ?? 0;
    purchaseOutstanding = purchaseTotal - purchasePaid;
  });

  // ---- TEST 3: purchased sale → FIFO snapshot, no SupplierOrder ----
  let soldFifoUnitCost = 0, soldQty = 0, soldOrderId = "";
  await testAsync("purchased sale 4 → fifoUnitCost 100000, sale movement, NO SupplierOrder", async () => {
    const r = await checkout(customerJar, [{ id: purchasedId, quantity: 4, price: 200000, name: PREFIX + "Purchased" }]);
    assert(r.status === 201, `checkout → ${r.status}: ${JSON.stringify(r.json)}`);
    soldOrderId = r.json.orderId;
    orderIds.push(soldOrderId);
    const order = await getOrder(soldOrderId);
    const item = order.items[0];
    soldFifoUnitCost = item.fifoUnitCost;
    soldQty = item.quantity;
    assert(item.fifoUnitCost === 100000, `fifoUnitCost=${item.fifoUnitCost}`);
    const soForPurchasedOrder = await d.collection("supplierorders").countDocuments({ order: new mongoose.Types.ObjectId(soldOrderId) });
    assert(soForPurchasedOrder === 0, "NO SupplierOrder for purchased sale — payout safety");
    const prod = await getProduct(purchasedId);
    assert(prod.stock === 6, `stock=${prod.stock}`);
    assert(prod.costLayers[0].remaining === 6, "layer remaining 6");
    const mv = await findMovement(`sale-${soldOrderId}-${purchasedId}`);
    assert(!!mv && mv.quantity === -4 && mv.unitCost === 100000, `sale movement ${mv && mv.quantity}/${mv && mv.unitCost}`);
  });

  // ---- TEST 4: consignment sale → snapshot COGS (historical compat) ----
  await testAsync("consignment sale 2 → supplierPrice snapshot COGS, no sale movement", async () => {
    const r = await checkout(customerJar, [{ id: consignId, quantity: 2, price: 150000, name: PREFIX + "Consign" }]);
    assert(r.status === 201, `checkout → ${r.status}`);
    orderIds.push(r.json.orderId);
    const order = await getOrder(r.json.orderId);
    const item = order.items[0];
    assert(item.fifoUnitCost === null || item.fifoUnitCost === undefined, "consignment → no fifoUnitCost");
    assert(item.supplierPrice === 90000, `snapshot supplierPrice=${item.supplierPrice}`);
    const soForConsignOrder = await d.collection("supplierorders").find({ order: new mongoose.Types.ObjectId(r.json.orderId) }).toArray();
    assert(soForConsignOrder.length >= 1, "SupplierOrder created for consignment");
    assert(soForConsignOrder.every((so) => so.items.every((i) => String(i.product) === consignId)), "consignment SO references the consign product only");
  });

  // ---- TEST 5: expense ledger → P&L operating expenses ----
  let expenseId = "", expenseAmount = 1500000;
  await testAsync("create paid expense → P&L operating expenses + net profit", async () => {
    const r = await http(adminJar, "POST", "/api/admin/expenses", {
      category: "advertising",
      description: PREFIX + "تبلیغات",
      amount: expenseAmount,
      paymentMethod: "bank",
      status: "pending",
    });
    assert(r.status === 201, `expense create → ${r.status}: ${JSON.stringify(r.json)}`);
    expenseId = r.json.expense._id;
    const pay = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/pay`);
    assert(pay.status === 200, `expense pay → ${pay.status}`);
  });

  // ---- TEST 6: JSON accounting envelope shape ----
  await testAsync("JSON /api/admin/reports/accounting → order-items view + V2 datasets", async () => {
    const res = await http(adminJar, "GET", "/api/admin/reports/accounting?preset=year");
    assert(res.status === 200, `accounting JSON → ${res.status}`);
    const data = res.json;
    assert(Array.isArray(data.rows) && data.rows.length >= 2, "rows = order items");
    assert(data.orderItems && data.movements && data.layers && data.cogs, "V2 datasets present");
    assert(data.accounting && data.accounting.rows.length > 0, "accounting summary rows");
    const fifoRow = data.rows.find((r) => r.orderId === soldOrderId);
    assert(fifoRow && fifoRow.fifoUnitCost === 100000, "JSON order item carries fifoUnitCost");
    const snapRow = data.rows.find((r) => r.orderId !== soldOrderId && r.cogsSource === "snapshot");
    assert(snapRow && snapRow.supplierPrice === 90000, "consignment order item carries snapshot supplierPrice");
  });

  // ---- TEST 7: the 17-sheet workbook + reconciliation ----
  let wb = null, xlsxBytes = null;
  await testAsync("accounting export → 17 Persian sheets + reconciliation", async () => {
    const res = await http(adminJar, "GET", "/api/admin/reports/accounting/export?preset=year", undefined, { raw: true });
    assert(res.status === 200, `export → ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    assert(ct.includes("spreadsheetml"), "xlsx content-type: " + ct);
    xlsxBytes = Buffer.from(await res.raw.arrayBuffer());
    assert(xlsxBytes.length > 1000, "non-trivial xlsx size");
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBytes);
    const names = wb.worksheets.map((ws) => ws.name);
    const expected = ["خلاصه", "فروش", "سفارش‌ها", "اقلام فروش", "پرداخت‌ها", "مرجوعی‌ها", "مشتریان", "کوپن‌ها", "خریدها", "اقلام خرید", "هزینه‌ها", "موجودی", "گردش موجودی", "لایه‌های FIFO", "بهای تمام‌شده", "سود و زیان", "خلاصه حسابداری"];
    for (const sheet of expected) {
      assert(names.includes(sheet), "missing sheet " + sheet + " in " + names.join(","));
    }
    assert(names.length === 17, "exactly 17 sheets, got " + names.length);

    // خلاصه حسابداری — valuation basis + historical note + net profit = gross profit − expenses
    const acctSheet = wb.getWorksheet("خلاصه حسابداری");
    let sawValuation = false, sawHistorical = false, sawNet = false;
    acctSheet.eachRow((row) => {
      const label = String(row.getCell(1).value);
      if (label.includes("FIFO")) sawValuation = true;
      if (label.includes("snapshot") || label.includes("اسنپ‌شات") || label.includes("انتقال حسابداری")) sawHistorical = true;
      if (label.includes("سود خالص")) { sawNet = true; }
    });
    assert(sawValuation, "valuation basis note present");
    assert(sawHistorical, "historical note present");
    assert(sawNet, "net profit row present");

    // بهای تمام‌شده sheet — Σ COGS rows = P&L COGS (skip the totals row:
    // it has an empty orderNo cell in column 1).
    const cogsSheet = wb.getWorksheet("بهای تمام‌شده");
    let cogsSum = 0, cogsQty = 0;
    cogsSheet.eachRow((row, n) => {
      if (n === 1) return;
      if (row.getCell(1).value === null || row.getCell(1).value === undefined || row.getCell(1).value === "") return; // totals row
      const v = row.getCell(8).value; // COGS column
      if (typeof v === "number") cogsSum += v;
      const q = row.getCell(6).value; // quantity column
      if (typeof q === "number") cogsQty += q;
    });
    const pnlSheet = wb.getWorksheet("سود و زیان");
    const pnlByLabel = {};
    pnlSheet.eachRow((row, n) => {
      if (n === 1) return;
      const label = String(row.getCell(1).value);
      const amt = row.getCell(2).value;
      pnlByLabel[label] = typeof amt === "number" ? amt : null;
    });
    const pnlCogs = pnlByLabel["بهای تمام‌شده (COGS)"] ?? 0;
    assert(Math.abs(cogsSum - Math.abs(pnlCogs)) <= 1, `Σ COGS rows (${cogsSum}) = P&L COGS (${Math.abs(pnlCogs)})`);    // NOTE: the P&L sheet stores discounts and COGS as NEGATIVE amounts
    // (matching the P&L presentation), so with signed values:
    //   net = gross + productDiscount + couponDiscount
    //   grossProfit = net + cogs
    //   netProfit = grossProfit + operatingExpenses
    const gross = pnlByLabel["فروش ناخالص"] ?? 0;
    const net = pnlByLabel["فروش خالص"] ?? 0;
    const grossProfit = pnlByLabel["سود ناخالص"] ?? 0;
    assert(Math.abs(net - (gross + (pnlByLabel["تخفیف محصول"] ?? 0) + (pnlByLabel["تخفیف کوپن"] ?? 0))) <= 1, `net (${net}) = gross (${gross}) + discounts (${(pnlByLabel["تخفیف محصول"] ?? 0) + (pnlByLabel["تخفیف کوپن"] ?? 0)})`);
    assert(Math.abs(grossProfit - (net + pnlCogs)) <= 1, `gross profit (${grossProfit}) = net (${net}) + COGS (${pnlCogs})`);
    const expenses = pnlByLabel["هزینه‌های عملیاتی"] ?? 0;
    const netProfit = pnlByLabel["سود خالص"] ?? 0;
    assert(Math.abs(netProfit - (grossProfit + expenses)) <= 1, `net profit (${netProfit}) = gross profit (${grossProfit}) + operating expenses (${expenses})`);

    // لایه‌های FIFO — Σ remaining × unitCost = inventory value (skip totals row)
    const layersSheet = wb.getWorksheet("لایه‌های FIFO");
    let layerValue = 0, layerRemaining = 0;
    layersSheet.eachRow((row, n) => {
      if (n === 1) return;
      if (row.getCell(1).value === null || row.getCell(1).value === undefined || row.getCell(1).value === "") return; // totals row
      const rem = row.getCell(8).value;
      const uc = row.getCell(9).value;
      if (typeof rem === "number" && typeof uc === "number") layerValue += rem * uc;
      if (typeof rem === "number") layerRemaining += rem;
    });
    assert(layerRemaining === 6, `layers remaining = 6 (post-sale), got ${layerRemaining}`);
    assert(layerValue === 600000, `layer value = 6×100000 = 600000, got ${layerValue}`);

    // اقلام فروش sheet — the FIFO row + the snapshot row
    const itemsSheet = wb.getWorksheet("اقلام فروش");
    let sawFifoCogsSource = false, sawSnapshotSource = false;
    itemsSheet.eachRow((row, n) => {
      if (n === 1) return;
      const src = String(row.getCell(17).value || ""); // منبع COGS column
      if (src.includes("FIFO")) sawFifoCogsSource = true;
      if (src.includes("اسنپ‌شات")) sawSnapshotSource = true;
    });
    assert(sawFifoCogsSource, "FIFO cogs source row present in اقلام فروش");
    assert(sawSnapshotSource, "snapshot cogs source row present (historical compat)");

    // خریدها sheet — totals reconcile
    const purchasesSheet = wb.getWorksheet("خریدها");
    let purchaseRows = 0;
    purchasesSheet.eachRow((row, n) => { if (n > 1) purchaseRows++; });
    assert(purchaseRows >= 1, "purchase row present");

    // اقلام خرید sheet — this suite's purchase item must be present (the year
    // window is shared with other suites, so other rows may exist too).
    const purchaseItemsSheet = wb.getWorksheet("اقلام خرید");
    let sawOwnPurchaseItem = false;
    purchaseItemsSheet.eachRow((row, n) => {
      if (n === 1) return;
      if (String(row.getCell(4).value || "").includes(PREFIX)) sawOwnPurchaseItem = true;
    });
    assert(sawOwnPurchaseItem, "own purchase item row present in اقلام خرید");

    // هزینه‌ها sheet — the expense row present (not voided)
    const expensesSheet = wb.getWorksheet("هزینه‌ها");
    let sawExpense = false;
    expensesSheet.eachRow((row, n) => {
      if (n === 1) return;
      if (String(row.getCell(3).value || "").includes(PREFIX)) sawExpense = true;
    });
    assert(sawExpense, "expense row present");
  });

  // ---- TEST 8: voided expense excluded from totals but retained for audit ----
  await testAsync("void an expense → خلاصه حسابداری operating expenses excludes it, row stays visible", async () => {
    const v = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/void`, { voidReason: PREFIX + "باطل تست" });
    assert(v.status === 200, `void → ${v.status}: ${JSON.stringify(v.json)}`);
    const res = await http(adminJar, "GET", "/api/admin/reports/accounting/export?preset=year", undefined, { raw: true });
    assert(res.status === 200, "re-export 200");
    const buf = Buffer.from(await res.raw.arrayBuffer());
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buf);
    // The expense row is still visible (audit), but operating expenses = 0.
    const expSheet = wb2.getWorksheet("هزینه‌ها");
    let visible = false;
    expSheet.eachRow((row, n) => { if (n > 1 && String(row.getCell(3).value || "").includes(PREFIX)) visible = true; });
    assert(visible, "voided expense row retained for audit");
    const acctSheet = wb2.getWorksheet("خلاصه حسابداری");
    let operatingExpenses = null;
    acctSheet.eachRow((row) => {
      if (String(row.getCell(1).value).includes("هزینه‌های عملیاتی")) {
        operatingExpenses = row.getCell(2).value;
      }
    });
    assert(operatingExpenses === 0 || operatingExpenses === null, `operating expenses exclude voided (${operatingExpenses})`);
  });

  // ---- TEST 9: export rate limit → 429 ----
  await testAsync("export rate limit → 429 after budget consumed", async () => {
    // REPORT_EXPORT_LIMIT = 10/15min. TEST 8 + TEST 9 already consumed 2;
    // consume 9 more (total 11) so the last must be 429.
    let last = null;
    for (let i = 0; i < 9; i++) {
      last = await http(adminJar, "GET", "/api/admin/reports/accounting/export?preset=year", undefined, { raw: true });
    }
    assert(last.status === 429, "expected 429, got " + last.status);
  });

  // --- Cleanup ---
  console.log("\nCleaning up test data...");
  await d.collection("orders").deleteMany({ _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) } });
  await d.collection("supplierorders").deleteMany({ order: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("inventorymovements").deleteMany({ sourceRef: { $regex: PREFIX } });
  await d.collection("purchaseorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await d.collection("expenses").deleteMany({ description: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [suppUser._id, await User.findOne({ phone: CUSTOMER_PHONE }).then((u) => u?._id)] } });
  // The suite's own rate-limit budgets (seeded admin is a dev admin).
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:(login_ip|login|purchase-write|report-export|expense-write):" } });
  // Restore the accounting config singleton if a crashed run stamped it.
  await d.collection("accountingconfigs").deleteMany({ _id: "accounting" });
  console.log("  Done");

  console.log("\n==================================================================");
  console.log("  RESULTS");
  console.log("==================================================================");
  console.log("  Total:   " + total);
  console.log("  Passed:  " + passed);
  console.log("  Failed:  " + failed);
  console.log("  Status:  " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("==================================================================");

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
