/**
 * Session 81 — Admin Reports subsystem verification (real HTTP API + real DB)
 *
 * Seeds deterministic fixtures with SNAPSHOT prices and a bounded custom date
 * range (day 3 of the current UTC month) so the suite is immune to data left
 * behind by other suites. Verifies:
 *   1. 401/403 auth matrix on the data + export endpoints
 *   2. Invalid report slug / filters → 400
 *   3. Dashboard KPIs (gross/net/coupon/product discounts, COGS, profit,
 *      refunds, paid/pending/outstanding) match hand-computed numbers
 *   4. Sales report: HISTORICAL prices (product price changed after the
 *      orders → report still uses snapshots) + per-product math + totals
 *   5. Reconciliation: Σ sales.netSales == Σ orders.totalAmount in window
 *   6. Orders / Payments / Refunds / Coupons / Customers / Inventory / P&L
 *   7. Excel export: correct content-type, sheet set, header row, key values
 *      (parsed with exceljs)
 *   8. Export rate limit → 429 after the budget is consumed
 *   9. Dashboard full workbook contains all 9 sheets
 *  10. Profitability report (Session 88): JSON shape, netSales − cogs =
 *      grossProfit, grossProfit − operatingExpenses = netProfit, product rows
 *      reconcile with the KPIs, COGS from the historical item snapshot,
 *      category profitability intentionally empty, waterfall reconciliation
 *  11. Profitability trend: per-bucket from/to boundaries, contiguity, window
 *      coverage, zero-filled empty periods, Σ buckets = report totals, and the
 *      day/week/month groups (+ invalid group → 400)
 *  12. Profitability Excel export: valid xlsx with the 5 dedicated sheets and
 *      a product-sheet Σ that reconciles with the report
 *
 * Usage: node scripts/verify-reports.js  (dev server on :3000, real DB)
 * Self-cleaning: removes every PREFIX'd row + its own rate-limit keys.
 */
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "rpt81_" + Date.now() + "_";
const PASS = "rpt81-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157773021";
const CUSTOMER2_PHONE = "09157773022";
const SUPPLIER_PHONE = "09157773023";
const COUPON_CODE = "RPT81_" + Date.now().toString(36).toUpperCase().slice(-6);

// --- Deterministic seed window: day 3 of the current UTC month, 12:00 UTC ---
const now = new Date();
const SEED_DATE = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 3, 12, 0, 0));
const RANGE_FROM = SEED_DATE.toISOString().slice(0, 8) + "01";
const RANGE_TO = SEED_DATE.toISOString().slice(0, 10);

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

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
  let res = await fetch(BASE + "/api/auth/csrf");
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  const form = new URLSearchParams({ csrfToken, phone, password, json: "true" });
  res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Cookie: jar.header() },
    body: form.toString(),
    redirect: "manual",
  });
  jar.get(res.headers);
  return jar;
}

async function http(method, urlPath, jar, body) {
  const headers = { "Content-Type": "application/json" };
  if (jar) headers.Cookie = jar.header();
  const raw = await fetch(BASE + urlPath, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  if (jar) jar.get(raw.headers);
  let data = null;
  // Clone so the caller can still read the raw body (export tests use
  // res.raw.arrayBuffer()).
  const text = await raw.clone().text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: raw.status, data, headers: raw.headers, raw };
}

const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, isActive: Boolean, balance: Number, pendingReserve: Number },
  { timestamps: true, collection: "suppliers" }
);
const CategorySchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "categories" }
);
const ProductSchema = new mongoose.Schema(
  { name: String, slug: String, category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" }, supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" }, price: Number, supplierPrice: Number, stock: Number, stockVersion: Number, hasVariants: Boolean, variants: Array, isActive: Boolean },
  { timestamps: true, collection: "products" }
);

function item(product, name, price, originalPrice, discountAmount, supplierPrice, quantity) {
  return {
    product: product._id, supplier: product.supplier, variantId: null, sku: "",
    name, price, originalPrice, discountAmount, supplierPrice, quantity,
  };
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 81 — ADMIN REPORTS (REAL HTTP API)");
  console.log("==================================================================");

  try {
    const ping = await fetch(BASE + "/api/auth/csrf");
    assert(ping.status === 200, "dev server not reachable");
    console.log("\n  Dev server reachable\n");
  } catch {
    console.error("\nERROR: dev server not reachable. Start it with: npm run dev");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  const User = mongoose.models.User_RPT || mongoose.model("User_RPT", UserSchema);
  const Supplier = mongoose.models.Supplier_RPT || mongoose.model("Supplier_RPT", SupplierSchema);
  const Category = mongoose.models.Category_RPT || mongoose.model("Category_RPT", CategorySchema);
  const Product = mongoose.models.Product_RPT || mongoose.model("Product_RPT", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: COUPON_CODE });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, CUSTOMER2_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^Rpt81Test" } });
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:report-export:" } });

  const admin = await User.findOne({ phone: ADMIN_PHONE }).lean();
  assert(admin, "seeded admin not found");

  // --- Fixtures ---
  const customer = await User.create({ name: "Rpt81 Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customer2 = await User.create({ name: "Rpt81 Customer2", phone: CUSTOMER2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Rpt81 Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "Rpt81Test Supplier Co", isActive: true, balance: 0, pendingReserve: 0 });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const prodA = await Product.create({ name: PREFIX + "ProdA", slug: PREFIX + "proda", category: catDoc._id, supplier: suppDoc._id, price: 1000, supplierPrice: 400, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodB = await Product.create({ name: PREFIX + "ProdB", slug: PREFIX + "prodb", category: catDoc._id, supplier: suppDoc._id, price: 500, supplierPrice: 200, stock: 5, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // Discounted product: 20% active → effective 800, original 1000, discount 200
  const prodD = await Product.create({ name: PREFIX + "ProdD", slug: PREFIX + "prodd", category: catDoc._id, supplier: suppDoc._id, price: 1000, supplierPrice: 300, stock: 5, stockVersion: 0, hasVariants: false, variants: [], isActive: true, discount: { type: "percent", value: 20, startsAt: null, endsAt: null, isActive: true } });

  const couponDoc = await db.collection("coupons").insertOne({
    code: COUPON_CODE, type: "percent", value: 10, minSubtotal: 0, maxDiscount: 0,
    startsAt: null, endsAt: null, isActive: true, isPublic: false,
    eligibility: { mode: "public", assignedUsers: [], groups: [] },
    usageLimit: 0, perUserLimit: 0, usedCount: 2,
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  });

  const mkOrder = (fields) => db.collection("orders").insertOne({
    customer: fields.customer,
    items: fields.items,
    totalAmount: fields.totalAmount,
    subtotalAmount: fields.subtotalAmount,
    discount: fields.discount,
    shippingAddress: { fullName: "Rpt81", phone: "0912", address: "Tehran", postalCode: "" },
    payment: fields.payment,
    status: fields.status,
    stockRestored: false,
    refund: fields.refund || null,
    statusHistory: [{ status: fields.status, at: SEED_DATE, note: "rpt81 seed" }],
    createdAt: SEED_DATE, updatedAt: SEED_DATE,
  });

  // Order 1 — paid/delivered, coupon 250 (subtotal 2500 → total 2250)
  const o1 = await mkOrder({
    customer: customer._id,
    items: [item(prodA, PREFIX + "ProdA", 1000, 1000, 0, 400, 2), item(prodB, PREFIX + "ProdB", 500, 500, 0, 200, 1)],
    subtotalAmount: 2500, totalAmount: 2250,
    discount: { code: COUPON_CODE, couponId: couponDoc.insertedId, type: "percent", value: 10, amount: 250, released: true },
    payment: { status: "paid", method: "zarinpal", authority: "RPT81A1", refId: "RPT81REF1", cardPan: "1234", paidAt: SEED_DATE },
    status: "delivered",
  });
  // Order 2 — pending payment, product discount (D: 1000→800, disc 200)
  const o2 = await mkOrder({
    customer: customer._id,
    items: [item(prodD, PREFIX + "ProdD", 800, 1000, 200, 300, 1)],
    subtotalAmount: 800, totalAmount: 800,
    discount: null,
    payment: { status: "pending", method: "zarinpal", authority: "RPT81A2", refId: "", cardPan: "", paidAt: null },
    status: "processing",
  });
  // Order 3 — refunded, coupon 100 (subtotal 1000 → total 900)
  const o3 = await mkOrder({
    customer: customer._id,
    items: [item(prodA, PREFIX + "ProdA", 1000, 1000, 0, 400, 1)],
    subtotalAmount: 1000, totalAmount: 900,
    discount: { code: COUPON_CODE, couponId: couponDoc.insertedId, type: "percent", value: 10, amount: 100, released: true },
    payment: { status: "refunded", method: "zarinpal", authority: "RPT81A3", refId: "RPT81REF3", cardPan: "4321", paidAt: SEED_DATE },
    status: "delivered",
    refund: { reason: "بازپرداخت تست", refundedAt: SEED_DATE, refundedBy: admin._id },
  });
  // Order 4 — failed payment (another customer)
  const o4 = await mkOrder({
    customer: customer2._id,
    items: [item(prodB, PREFIX + "ProdB", 500, 500, 0, 200, 3)],
    subtotalAmount: 1500, totalAmount: 1500,
    discount: null,
    payment: { status: "failed", method: "zarinpal", authority: "RPT81A4", refId: "", cardPan: "", paidAt: null },
    status: "processing",
  });
  // Order 5 — cancelled (excluded from every sales figure)
  await mkOrder({
    customer: customer._id,
    items: [item(prodA, PREFIX + "ProdA", 1000, 1000, 0, 400, 1)],
    subtotalAmount: 1000, totalAmount: 1000,
    discount: null,
    payment: { status: "canceled", method: "zarinpal", authority: "RPT81A5", refId: "", cardPan: "", paidAt: null },
    status: "cancelled",
  });

  // --- Historical-price proof: mutate the CURRENT product price AFTER seeding ---
  await Product.findByIdAndUpdate(prodA._id, { $set: { price: 99999, supplierPrice: 88888 } });
  await Product.findByIdAndUpdate(prodB._id, { $set: { price: 77777, supplierPrice: 66666 } });

  const RANGE = `preset=custom&from=${RANGE_FROM}&to=${RANGE_TO}`;
  const rangeOf = (extra) => RANGE + (extra ? "&" + extra : "");

  let adminJar = null;
  let customerJar = null;
  let supplierJar = null;

  await testAsync("Admin / customer / supplier logins", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(adminJar.header().includes("session-token"), "no admin session");
    assert(customerJar.header().includes("session-token"), "no customer session");
    assert(supplierJar.header().includes("session-token"), "no supplier session");
  });

  // --- 1. Auth matrix ---
  await testAsync("401 unauthenticated on data + export", async () => {
    assert((await http("GET", "/api/admin/reports/sales?preset=today", null)).status === 401, "sales 401");
    assert((await http("GET", "/api/admin/reports/dashboard?preset=today", null)).status === 401, "dashboard 401");
    assert((await http("GET", "/api/admin/reports/sales/export?preset=today", null)).status === 401, "export 401");
  });

  await testAsync("403 customer / supplier on data + export", async () => {
    assert((await http("GET", "/api/admin/reports/sales?preset=today", customerJar)).status === 403, "customer sales 403");
    assert((await http("GET", "/api/admin/reports/sales/export?preset=today", supplierJar)).status === 403, "supplier export 403");
  });

  await testAsync("Invalid report slug -> 400", async () => {
    assert((await http("GET", "/api/admin/reports/bogus?preset=today", adminJar)).status === 400, "bogus slug 400");
    assert((await http("GET", "/api/admin/reports/bogus/export?preset=today", adminJar)).status === 400, "bogus export 400");
  });

  await testAsync("Invalid filters -> 400", async () => {
    assert((await http("GET", "/api/admin/reports/sales?preset=forever", adminJar)).status === 400, "bad preset 400");
    assert((await http("GET", "/api/admin/reports/sales?preset=custom&from=2026-08-13&to=2026-08-01", adminJar)).status === 400, "from>to 400");
    assert((await http("GET", "/api/admin/reports/orders?preset=custom&from=2026-08-13", adminJar)).status === 400, "missing to 400");
    assert((await http("GET", "/api/admin/reports/sales?preset=today&status=weird", adminJar)).status === 400, "bad status 400");
    assert((await http("GET", "/api/admin/reports/sales?preset=today&page=0", adminJar)).status === 400, "bad page 400");
  });

  // --- 2. Dashboard KPIs (hand-computed) ---
  let dash = null;
  await testAsync("Dashboard KPIs match hand-computed values", async () => {
    const res = await http("GET", "/api/admin/reports/dashboard?" + RANGE, adminJar);
    assert(res.status === 200, "dashboard 200: " + JSON.stringify(res.data).slice(0, 120));
    dash = res.data;
    const s = dash.summary;
    assert(s.orders === 4, "orders 4, got " + s.orders);
    assert(s.unitsSold === 8, "units 8, got " + s.unitsSold);
    assert(s.grossSales === 6000, "gross 6000, got " + s.grossSales);
    assert(s.productDiscount === 200, "product discount 200, got " + s.productDiscount);
    assert(s.couponDiscount === 350, "coupon discount 350, got " + s.couponDiscount);
    assert(s.netSales === 5450, "net 5450, got " + s.netSales);
    assert(s.cogs === 2300, "cogs 2300, got " + s.cogs);
    assert(s.grossProfit === 3150, "gross profit 3150, got " + s.grossProfit);
    assert(s.refunds === 900, "refunds 900, got " + s.refunds);
    assert(s.refundedOrders === 1, "refunded orders 1, got " + s.refundedOrders);
    assert(s.paidAmount === 3150, "paid 3150, got " + s.paidAmount);
    assert(s.pendingAmount === 800, "pending 800, got " + s.pendingAmount);
    assert(s.outstandingAmount === 2300, "outstanding 2300, got " + s.outstandingAmount);
    assert(s.avgOrderValue === 1363, "aov 1363, got " + s.avgOrderValue);
    console.log("\n      net=5450 profit=3150 margin=" + s.grossMargin + " inventory=" + s.inventoryValue);
  });

  await testAsync("Dashboard P&L statement is present with correct rows", async () => {
    const rows = dash.pnl.current.rows;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert(byKey.gross.amount === 6000, "pnl gross");
    assert(byKey.net.amount === 5450, "pnl net");
    assert(byKey.cogs.amount === -2300, "pnl cogs");
    assert(byKey.grossProfit.amount === 3150, "pnl profit");
    // Session 82 Phase E: net profit = gross profit − operating expenses. This
    // suite records no expenses, so operatingExpenses = 0 and netProfit equals
    // grossProfit — it is NO LONGER flagged unavailable (the expense ledger is
    // authoritative; a real zero is not a fake zero).
    assert(byKey.operatingExpenses.amount === 0, "pnl operating expenses 0");
    assert(byKey.netProfit.unavailable === undefined, "net profit is available");
    assert(byKey.netProfit.amount === 3150, "pnl net profit = gross profit (no expenses)");
    assert(byKey.inventory.amount > 0, "inventory value present");
    console.log("\n      margin=" + byKey.margin.percent);
  });

  // --- 3. Sales report: historical prices + per-product math ---
  let sales = null;
  await testAsync("Sales report uses HISTORICAL snapshots (not current price)", async () => {
    const res = await http("GET", "/api/admin/reports/sales?" + RANGE, adminJar);
    assert(res.status === 200, "sales 200");
    sales = res.data;
    const a = sales.rows.find((r) => r.productId === String(prodA._id));
    const b = sales.rows.find((r) => r.productId === String(prodB._id));
    const d = sales.rows.find((r) => r.productId === String(prodD._id));
    assert(!!a && !!b && !!d, "all three products present");
    // Current prices were mutated to 99999/88888 — snapshots must win.
    assert(a.grossSales === 3000, "A gross from snapshots 3000, got " + a.grossSales);
    assert(a.cogs === 1200, "A cogs from snapshots 1200, got " + a.cogs);
    assert(b.grossSales === 2000, "B gross 2000, got " + b.grossSales);
    // D: 1000 gross − 200 product discount = 800 net (no coupon)
    assert(d.grossSales === 1000 && d.productDiscount === 200 && d.netSales === 800, "D discount math");
    // Coupon allocation: A gets 200 (O1) + 100 (O3); B gets 50 (O1)
    assert(a.couponDiscount === 300, "A coupon 300, got " + a.couponDiscount);
    assert(b.couponDiscount === 50, "B coupon 50, got " + b.couponDiscount);
    assert(a.netSales === 2700, "A net 2700, got " + a.netSales);
    assert(b.netSales === 1950, "B net 1950, got " + b.netSales);
    // Refund attribution: O3 refunded (A ×1) → returned qty 1, amount 900
    assert(a.returnedQuantity === 1, "A returned qty 1");
    assert(a.returnedAmount === 900, "A returned amount 900, got " + a.returnedAmount);
    assert(a.netSalesAfterReturns === 1800, "A net after returns 1800, got " + a.netSalesAfterReturns);
    console.log("\n      A gross=3000 net=2700 | B net=1950 | D net=800");
  });

  await testAsync("Sales totals reconcile: Σ net == Σ order totals (5450)", async () => {
    const t = sales.totals;
    assert(t.quantity === 8, "total qty 8, got " + t.quantity);
    assert(t.grossSales === 6000, "total gross 6000, got " + t.grossSales);
    assert(t.productDiscount === 200, "total prod disc 200");
    assert(t.couponDiscount === 350, "total coupon 350");
    assert(t.netSales === 5450, "total net 5450, got " + t.netSales);
    assert(t.cogs === 2300, "total cogs 2300");
    assert(t.returnedAmount === 900, "total returned 900");
    assert(t.netSalesAfterReturns === 4550, "total net after returns 4550");
  });

  await testAsync("Sales report respects product / category / q filters", async () => {
    const byCat = await http("GET", "/api/admin/reports/sales?" + RANGE + "&category=" + String(catDoc._id), adminJar);
    if (byCat.status !== 200 || byCat.data.total !== 3) {
      const inCat = await db.collection("products").find({ category: catDoc._id }).toArray();
      const ordersIn = await db.collection("orders").find({ "items.name": { $regex: "^" + PREFIX } }).toArray();
      console.log("\n      [debug] category=" + String(catDoc._id) + " status=" + byCat.status + " total=" + (byCat.data && byCat.data.total));
      console.log("      [debug] products with category:", inCat.map((p) => p.name));
      console.log("      [debug] order item products:", ordersIn.map((o) => o.items.map((i) => i.name + "=" + String(i.product))));
    }
    assert(byCat.status === 200 && byCat.data.total === 3, "category filter keeps 3 products");
    const byQ = await http("GET", "/api/admin/reports/sales?" + RANGE + "&q=" + encodeURIComponent(PREFIX + "prodb"), adminJar);
    if (byQ.status !== 200 || byQ.data.total !== 1) {
      console.log("\n      [debug] q=" + PREFIX + "prodb status=" + byQ.status + " total=" + (byQ.data && byQ.data.total) + " rows=" + JSON.stringify((byQ.data && byQ.data.rows || []).map((r) => r.name + "|" + r.sku)));
    }
    assert(byQ.status === 200 && byQ.data.total === 1 && byQ.data.rows[0].sku === "", "q filter narrows to B");
    const empty = await http("GET", "/api/admin/reports/sales?" + RANGE + "&q=zzz-no-such-user", adminJar);
    assert(empty.status === 200 && empty.data.total === 0, "unknown q -> empty, got " + empty.data.total);
  });

  // --- 4. Orders report ---
  await testAsync("Orders report: paid/pending/refunded splits", async () => {
    const res = await http("GET", "/api/admin/reports/orders?" + RANGE, adminJar);
    assert(res.status === 200, "orders 200");
    const rows = res.data.rows;
    assert(rows.length === 4, "4 orders, got " + rows.length);
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    const o1r = byId[String(o1.insertedId)];
    const o2r = byId[String(o2.insertedId)];
    const o3r = byId[String(o3.insertedId)];
    const o4r = byId[String(o4.insertedId)];
    assert(o1r.netAmount === 2250 && o1r.paidAmount === 2250 && o1r.couponDiscount === 250, "O1 numbers");
    assert(o2r.netAmount === 800 && o2r.paidAmount === 0 && o2r.outstandingAmount === 800 && o2r.productDiscount === 200, "O2 numbers");
    assert(o3r.paidAmount === 900 && o3r.refundedAmount === 900, "O3 refunded");
    assert(o4r.outstandingAmount === 1500, "O4 failed outstanding");
    const t = res.data.totals;
    assert(t.netAmount === 5450 && t.paidAmount === 3150 && t.refundedAmount === 900 && t.outstandingAmount === 2300, "orders totals");
  });

  await testAsync("Orders report status filter", async () => {
    const res = await http("GET", "/api/admin/reports/orders?" + RANGE + "&status=processing", adminJar);
    assert(res.status === 200 && res.data.total === 2, "2 processing orders (O2,O4)");
    const delivered = await http("GET", "/api/admin/reports/orders?" + RANGE + "&status=delivered", adminJar);
    assert(delivered.data.total === 2, "2 delivered (O1,O3)");
  });

  // --- 5. Payments report ---
  await testAsync("Payments report splits paid/outstanding by order", async () => {
    const res = await http("GET", "/api/admin/reports/payments?" + RANGE, adminJar);
    assert(res.status === 200, "payments 200");
    assert(res.data.total === 4, "4 payments rows");
    const paid = res.data.rows.filter((r) => r.paidAmount > 0);
    assert(paid.length === 2, "2 paid rows (O1,O3)");
    const t = res.data.totals;
    assert(t.amount === 5450 && t.paidAmount === 3150 && t.refundedAmount === 900 && t.outstandingAmount === 2300, "payments totals");
    const onlyPaid = await http("GET", "/api/admin/reports/payments?" + RANGE + "&paymentStatus=paid", adminJar);
    assert(onlyPaid.data.total === 1, "paymentStatus=paid -> 1 (O1 only; O3 is refunded)");
    const manual = await http("GET", "/api/admin/reports/payments?" + RANGE + "&method=manual", adminJar);
    assert(manual.data.total === 0, "method=manual -> 0");
  });

  // --- 6. Refunds report ---
  await testAsync("Refunds report lists the refunded order", async () => {
    const res = await http("GET", "/api/admin/reports/refunds?" + RANGE, adminJar);
    assert(res.status === 200, "refunds 200");
    assert(res.data.total === 1, "1 refunded order");
    const row = res.data.rows[0];
    assert(row._id === String(o3.insertedId), "refunded order is O3");
    assert(row.refundAmount === 900, "refund amount 900");
    assert(row.reason === "بازپرداخت تست", "reason preserved");
    assert(row.refundedBy === admin.name || row.refundedBy === "مدیر سیستم", "refunder named");
  });

  // --- 7. Coupons report ---
  await testAsync("Coupons report aggregates usage/discount without double-count", async () => {
    const res = await http("GET", "/api/admin/reports/coupons?" + RANGE, adminJar);
    assert(res.status === 200, "coupons 200");
    assert(res.data.total === 1, "1 coupon used");
    const c = res.data.rows[0];
    assert(c.code === COUPON_CODE, "code match");
    assert(c.uses === 2 && c.orders === 2, "2 uses");
    assert(c.grossSales === 3500, "gross 3500 (subtotals), got " + c.grossSales);
    assert(c.totalDiscount === 350, "discount 350");
    assert(c.netSales === 3150, "net 3150, got " + c.netSales);
    assert(c.avgOrderValue === 1575, "aov 1575");
    const filtered = await http("GET", "/api/admin/reports/coupons?" + RANGE + "&coupon=" + COUPON_CODE, adminJar);
    assert(filtered.data.total === 1, "coupon filter works");
  });

  // --- 8. Customers report ---
  await testAsync("Customers report per-customer aggregates", async () => {
    const res = await http("GET", "/api/admin/reports/customers?" + RANGE, adminJar);
    assert(res.status === 200, "customers 200");
    const c1 = res.data.rows.find((r) => r.customerId === String(customer._id));
    const c2 = res.data.rows.find((r) => r.customerId === String(customer2._id));
    assert(!!c1 && !!c2, "both customers present");
    assert(c1.orders === 3 && c1.units === 5, "C1 orders/units");
    assert(c1.grossSales === 4500, "C1 gross 4500");
    assert(c1.discounts === 550, "C1 discounts 550 (200 product + 350 coupon), got " + c1.discounts);
    assert(c1.netSales === 3950, "C1 net 3950");
    assert(c1.refunds === 900 && c1.netRevenue === 3050, "C1 refunds/netRevenue");
    assert(c2.netSales === 1500 && c2.orders === 1, "C2 net/orders");
    const q = await http("GET", "/api/admin/reports/customers?" + RANGE + "&q=" + CUSTOMER2_PHONE, adminJar);
    assert(q.data.total === 1 && q.data.rows[0].customerId === String(customer2._id), "phone search filters to C2");
  });

  // --- 9. Inventory report ---
  await testAsync("Inventory report stock math + statuses", async () => {
    const res = await http("GET", "/api/admin/reports/inventory?" + RANGE, adminJar);
    assert(res.status === 200, "inventory 200");
    const a = res.data.rows.find((r) => r.productId === String(prodA._id));
    const b = res.data.rows.find((r) => r.productId === String(prodB._id));
    const d = res.data.rows.find((r) => r.productId === String(prodD._id));
    assert(!!a && !!b && !!d, "products in inventory");
    assert(a.currentStock === 10 && a.salesQuantity === 3 && a.returnedQuantity === 1, "A stock math");
    assert(a.openingStock === 12, "A opening reconstructed 12");
    assert(a.unitCost === 88888, "A current cost 88888, got " + a.unitCost);
    assert(a.inventoryValue === 888880, "A value 888880");
    assert(a.stockStatus === "in_stock", "A in_stock");
    assert(b.stockStatus === "low_stock", "B low_stock (5 <= threshold)");
    assert(d.movement === "fast" || d.movement === "slow", "D has movement");
  });

  // --- 10. P&L report ---
  await testAsync("P&L report statement + previous period", async () => {
    const res = await http("GET", "/api/admin/reports/pnl?" + RANGE, adminJar);
    assert(res.status === 200, "pnl 200");
    const pnl = res.data;
    const byKey = Object.fromEntries(pnl.current.rows.map((r) => [r.key, r]));
    assert(byKey.gross.amount === 6000 && byKey.net.amount === 5450 && byKey.grossProfit.amount === 3150, "pnl current");
    assert(byKey.gross.percent === 100, "gross 100%");
    // Previous equal-length window had no orders → null previous
    assert(pnl.previous === null, "previous null (no data), got " + JSON.stringify(pnl.previous));
    assert(pnl.change.netSales === null, "change null when no previous");
    console.log("\n      margin=" + byKey.margin.percent + " cogs=" + byKey.cogs.amount);
  });

  // --- 11. Excel exports ---
  let salesXlsx = null;
  await testAsync("Sales export -> valid xlsx with Summary + detail sheet", async () => {
    const res = await http("GET", "/api/admin/reports/sales/export?" + RANGE, adminJar);
    assert(res.status === 200, "export 200");
    const ct = res.headers.get("content-type") || "";
    assert(ct.includes("spreadsheetml"), "xlsx content-type: " + ct);
    assert((res.headers.get("content-disposition") || "").includes("attachment"), "attachment header");
    const buf = Buffer.from(await res.raw.arrayBuffer());
    assert(buf.length > 1000, "non-trivial xlsx size");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((ws) => ws.name);
    assert(names.includes("خلاصه") && names.includes("فروش"), "sheets: " + names.join(","));
    const salesSheet = wb.getWorksheet("فروش");
    // Header row + 3 product rows + totals row
    assert(salesSheet.rowCount >= 5, "rowCount " + salesSheet.rowCount);
    const header = salesSheet.getRow(1);
    assert(String(header.getCell(3).value).includes("نام محصول"), "header label");
    const summarySheet = wb.getWorksheet("خلاصه");
    let foundNet = false;
    summarySheet.eachRow((row) => {
      if (String(row.getCell(1).value).includes("فروش خالص")) {
        foundNet = true;
        assert(Number(row.getCell(2).value) === 5450, "summary net cell 5450, got " + row.getCell(2).value);
      }
    });
    assert(foundNet, "net sales row present in summary");
    salesXlsx = buf;
  });

  await testAsync("Dashboard export -> 9 sheets (full accountant workbook)", async () => {
    const res = await http("GET", "/api/admin/reports/dashboard/export?" + RANGE, adminJar);
    assert(res.status === 200, "dashboard export 200");
    const buf = Buffer.from(await res.raw.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((ws) => ws.name);
    for (const expected of ["خلاصه", "سود و زیان", "فروش", "سفارش‌ها", "پرداخت‌ها", "بازگشت‌ها", "کوپن‌ها", "مشتریان", "موجودی"]) {
      assert(names.includes(expected), "missing sheet " + expected + " in " + names.join(","));
    }
  });

  // --- 12. Profitability report (Session 88) ---
  let profitKpi = null;
  await testAsync("Profitability report: shape + accounting reconciliation", async () => {
    const res = await http("GET", "/api/admin/reports/profitability?" + RANGE, adminJar);
    assert(res.status === 200, "profitability 200: " + JSON.stringify(res.data).slice(0, 140));
    const p = res.data;
    for (const key of ["kpis", "waterfall", "products", "categories", "expenses", "diagnostics", "health", "trend"]) {
      assert(Array.isArray(p[key]), "missing array: " + key);
    }

    const kpi = Object.fromEntries(p.kpis.map((k) => [k.key, k.value]));
    profitKpi = kpi;
    // Hand-computed from the SAME seeded snapshots the sales/dashboard suites assert
    assert(kpi.grossSales === 6000, "grossSales 6000, got " + kpi.grossSales);
    assert(kpi.productDiscount === 200, "productDiscount 200, got " + kpi.productDiscount);
    assert(kpi.couponDiscount === 350, "couponDiscount 350, got " + kpi.couponDiscount);
    assert(kpi.netSales === 5450, "netSales 5450, got " + kpi.netSales);
    assert(kpi.cogs === 2300, "cogs 2300, got " + kpi.cogs);
    assert(kpi.grossProfit === 3150, "grossProfit 3150, got " + kpi.grossProfit);

    // Reconciliation: netSales − cogs = grossProfit; grossProfit − opex = netProfit
    assert(kpi.netSales - kpi.cogs === kpi.grossProfit, "netSales − cogs = grossProfit");
    assert(
      kpi.grossProfit - (kpi.operatingExpenses ?? 0) === kpi.netProfit,
      "grossProfit − operatingExpenses = netProfit, got " +
        JSON.stringify({ gp: kpi.grossProfit, opex: kpi.operatingExpenses, np: kpi.netProfit })
    );

    // Product rows reconcile with the KPIs
    const sum = (f) => p.products.reduce((s, r) => s + f(r), 0);
    assert(sum((r) => r.netSales) === kpi.netSales, "Σ product netSales = netSales, got " + sum((r) => r.netSales));
    assert(sum((r) => r.cogs) === kpi.cogs, "Σ product cogs = cogs, got " + sum((r) => r.cogs));
    assert(sum((r) => r.grossProfit) === kpi.grossProfit, "Σ product grossProfit = grossProfit");

    // COGS must come from the HISTORICAL item snapshot: prodA/prodB current
    // supplierPrice was mutated to 88888/66666 after seeding.
    const a = p.products.find((r) => r.productId === String(prodA._id));
    const b = p.products.find((r) => r.productId === String(prodB._id));
    const d = p.products.find((r) => r.productId === String(prodD._id));
    assert(a && a.cogs === 1200, "prodA cogs 1200 from snapshot, got " + (a && a.cogs));
    assert(b && b.cogs === 800, "prodB cogs 800 from snapshot, got " + (b && b.cogs));
    assert(d && d.cogs === 300, "prodD cogs 300 from snapshot, got " + (d && d.cogs));
    assert(a.netSales === 2700 && b.netSales === 1950 && d.netSales === 800, "per-product net sales");

    // Category profitability stays INTENTIONALLY unavailable (no immutable
    // category snapshot exists on OrderItem).
    assert(p.categories.length === 0, "categories intentionally empty");

    // Waterfall reconciles to the KPIs
    const wf = Object.fromEntries(p.waterfall.map((s) => [s.key, s]));
    assert(wf.grossProfit.amount === kpi.grossProfit, "waterfall grossProfit = KPI grossProfit");
    assert(wf.cogs.amount === -kpi.cogs, "waterfall cogs is subtractive");
    assert(wf.netProfit.amount === kpi.netProfit, "waterfall netProfit = KPI netProfit");
    assert(wf.netProfit.cumulative === kpi.netProfit, "waterfall netProfit cumulative");
    console.log("\n      netSales=" + kpi.netSales + " cogs=" + kpi.cogs + " gp=" + kpi.grossProfit + " np=" + kpi.netProfit);
  });

  await testAsync("Profitability trend: buckets carry their OWN boundaries + zero-fill", async () => {
    const res = await http("GET", "/api/admin/reports/profitability?" + RANGE, adminJar);
    assert(res.status === 200, "profitability 200");
    const trend = res.data.trend;

    // A 3-day window auto-selects `day` → exactly 3 daily buckets
    assert(trend.length === 3, "3 daily buckets, got " + trend.length);
    const prefix = RANGE_FROM.slice(0, 8); // e.g. "2026-08-"
    const expected = [1, 2, 3].map((d) => prefix + String(d).padStart(2, "0"));
    assert(trend.map((t) => t.label).join(",") === expected.join(","), "labels " + trend.map((t) => t.label).join(","));

    // The Session 87 bug: EVERY bucket carried the whole report window.
    const distinct = new Set(trend.map((t) => t.from + "|" + t.to));
    assert(distinct.size === trend.length, "bucket boundaries must be distinct per bucket");

    const DAY_MS = 24 * 60 * 60 * 1000;
    for (const t of trend) {
      assert(new Date(t.to).getTime() - new Date(t.from).getTime() === DAY_MS - 1, "daily bucket spans exactly one day");
    }

    // Coverage + contiguity (window start = day 1 00:00 UTC)
    const windowStart = new Date(RANGE_FROM + "T00:00:00.000Z").getTime();
    assert(new Date(trend[0].from).getTime() <= windowStart, "first bucket covers the window start");
    for (let i = 1; i < trend.length; i++) {
      assert(new Date(trend[i].from).getTime() === new Date(trend[i - 1].to).getTime() + 1, "buckets are contiguous");
    }

    // All seeded orders sit on day 3 (SEED_DATE 12:00 UTC)
    const last = trend[trend.length - 1];
    assert(last.netSales === 5450, "day-3 bucket netSales 5450, got " + last.netSales);
    assert(last.cogs === 2300, "day-3 bucket cogs 2300, got " + last.cogs);
    assert(last.grossProfit === 3150, "day-3 bucket grossProfit 3150");
    assert(last.grossProfit - last.expenses === last.netProfit, "bucket netProfit = grossProfit − expenses");

    // Zero-filled empty periods (days 1 and 2 held no orders/expenses)
    assert(trend[0].netSales === 0 && trend[0].cogs === 0 && trend[0].grossProfit === 0, "day 1 zero-filled");
    assert(trend[0].expenses === 0 && trend[0].netProfit === 0, "day 1 expenses/profit zero");
    assert(trend[1].netSales === 0 && trend[1].netProfit === 0, "day 2 zero-filled");

    // Σ over buckets reconciles with the report totals → bucketing loses nothing
    assert(trend.reduce((s, t) => s + t.netSales, 0) === profitKpi.netSales, "Σ trend netSales = KPI netSales");
    assert(trend.reduce((s, t) => s + t.cogs, 0) === profitKpi.cogs, "Σ trend cogs = KPI cogs");
    assert(trend.reduce((s, t) => s + t.netProfit, 0) === profitKpi.netProfit, "Σ trend netProfit = KPI netProfit");
    console.log("\n      trend buckets: " + trend.map((t) => t.label + "=" + t.netSales).join(" | "));
  });

  await testAsync("Profitability trend groups: week / month honoured, invalid -> 400", async () => {
    const dayRes = await http("GET", "/api/admin/reports/profitability?" + rangeOf("group=day"), adminJar);
    assert(dayRes.status === 200, "group=day 200");
    assert(dayRes.data.trend.length === 3, "group=day -> 3 buckets, got " + dayRes.data.trend.length);

    const weekRes = await http("GET", "/api/admin/reports/profitability?" + rangeOf("group=week"), adminJar);
    assert(weekRes.status === 200, "group=week 200");
    const weeks = weekRes.data.trend;
    assert(weeks.length >= 1 && weeks.length <= 2, "a 3-day window spans 1-2 ISO weeks, got " + weeks.length);
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < weeks.length; i++) {
      const from = new Date(weeks[i].from);
      assert(from.getUTCDay() === 1, "week bucket starts on a Monday");
      assert(new Date(weeks[i].to).getTime() - from.getTime() === WEEK_MS - 1, "week bucket spans 7 days");
      if (i > 0) {
        assert(new Date(weeks[i].from).getTime() === new Date(weeks[i - 1].to).getTime() + 1, "weeks are contiguous");
      }
    }
    assert(weeks.reduce((s, t) => s + t.netSales, 0) === profitKpi.netSales, "Σ weekly netSales = KPI netSales");

    const monthRes = await http("GET", "/api/admin/reports/profitability?" + rangeOf("group=month"), adminJar);
    assert(monthRes.status === 200, "group=month 200");
    assert(monthRes.data.trend.length === 1, "one UTC month -> 1 bucket, got " + monthRes.data.trend.length);
    assert(monthRes.data.trend[0].netSales === profitKpi.netSales, "monthly bucket netSales = KPI netSales");
    assert(
      monthRes.data.trend[0].grossProfit - monthRes.data.trend[0].expenses === monthRes.data.trend[0].netProfit,
      "monthly bucket netProfit relation"
    );

    // Invalid non-empty group -> 400 (case-sensitive whitelist)
    assert((await http("GET", "/api/admin/reports/profitability?" + rangeOf("group=yearly"), adminJar)).status === 400, "group=yearly 400");
    assert((await http("GET", "/api/admin/reports/profitability?" + rangeOf("group=DAY"), adminJar)).status === 400, "group=DAY 400");
    // Empty group is treated as absent (the existing parser semantics)
    assert((await http("GET", "/api/admin/reports/profitability?" + rangeOf("group="), adminJar)).status === 200, "empty group ignored -> 200");
  });

  await testAsync("Profitability export -> valid xlsx with the 5 dedicated sheets", async () => {
    const res = await http("GET", "/api/admin/reports/profitability/export?" + RANGE, adminJar);
    assert(res.status === 200, "profitability export 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 140));
    const ct = res.headers.get("content-type") || "";
    assert(ct.includes("spreadsheetml"), "xlsx content-type: " + ct);
    assert((res.headers.get("content-disposition") || "").includes("attachment"), "attachment header");
    const buf = Buffer.from(await res.raw.arrayBuffer());
    assert(buf.length > 1000, "non-trivial xlsx size");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((ws) => ws.name);
    for (const expected of ["خلاصه سودآوری", "آبشار سودآوری", "سودآوری محصولات", "تحلیل هزینه‌ها", "روند"]) {
      assert(names.includes(expected), "missing sheet " + expected + " in " + names.join(","));
    }
    // The generic (order-labeled) summary sheet must not leak in — it threw the
    // `summary.orders` TypeError that made this endpoint 500 before Session 88.
    assert(!names.includes("خلاصه"), "no generic summary sheet: " + names.join(","));

    // KPI sheet carries the report's net sales
    const kpiSheet = wb.getWorksheet("خلاصه سودآوری");
    let netFound = false;
    kpiSheet.eachRow((row) => {
      if (String(row.getCell(1).value).includes("فروش خالص")) {
        netFound = true;
        assert(Number(row.getCell(2).value) === profitKpi.netSales, "KPI sheet net sales, got " + row.getCell(2).value);
      }
    });
    assert(netFound, "net-sales KPI row present");

    // Waterfall sheet lists the net-profit step
    const wfSheet = wb.getWorksheet("آبشار سودآوری");
    let npFound = false;
    wfSheet.eachRow((row) => {
      if (String(row.getCell(1).value) === "سود خالص") npFound = true;
    });
    assert(npFound, "waterfall net-profit row present");
    assert(wfSheet.rowCount === 9, "waterfall sheet = header + 8 steps, got " + wfSheet.rowCount);

    // Product sheet: Σ netSales reconciles with the report
    const prodSheet = wb.getWorksheet("سودآوری محصولات");
    assert(String(prodSheet.getRow(1).getCell(4).value).includes("فروش خالص"), "product sheet header");
    let sumNet = 0;
    let productRows = 0;
    prodSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const v = row.getCell(4).value;
      if (typeof v === "number") {
        sumNet += v;
        productRows++;
      }
    });
    assert(productRows === 3, "3 product rows in the sheet, got " + productRows);
    assert(sumNet === profitKpi.netSales, "Σ product-sheet netSales = KPI netSales, got " + sumNet);

    // Trend sheet: header + one row per bucket
    const trendSheet = wb.getWorksheet("روند");
    assert(String(trendSheet.getRow(1).getCell(4).value).includes("فروش خالص"), "trend sheet header");
    assert(trendSheet.rowCount === 4, "trend sheet = header + 3 buckets, got " + trendSheet.rowCount);

    // Expense sheet exists (rows depend on the ledger, so only the header is asserted)
    const expSheet = wb.getWorksheet("تحلیل هزینه‌ها");
    assert(String(expSheet.getRow(1).getCell(1).value).includes("دسته"), "expense sheet header");

    console.log("\n      profitability sheets: " + names.join(", "));
  });

  await testAsync("Export rate limit -> 429 after budget consumed", async () => {
    // We have consumed 3 exports above (sales, dashboard, profitability); the
    // limit is 10/15min → 7 more allowed, so request #11 is the first 429.
    let last = null;
    for (let i = 0; i < 8; i++) {
      last = await http("GET", "/api/admin/reports/orders/export?" + RANGE, adminJar);
    }
    assert(last.status === 429, "expected 429 after budget, got " + last.status + " " + JSON.stringify(last.data).slice(0, 80));
    console.log("\n      rate-limited after 11 exports in window");
  });

  // --- Cleanup ---
  console.log("\nCleaning up test data...");
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: COUPON_CODE });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [customer._id, customer2._id, suppUser._id] } });
  // The suite's own export rate-limit budget (the seeded admin is a dev admin).
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:report-export:" } });
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
}

run().catch((err) => { console.error("\nTest suite error:", err); process.exit(1); });
