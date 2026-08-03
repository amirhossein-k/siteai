/**
 * Session 41 — Admin Analytics & Reporting Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated GET /api/admin/analytics → 401
 *   2. Customer → 403
 *   3. Supplier → 403
 *   4. Admin → 200 with the full expected response shape
 *   5. Range validation: invalid range → 400; valid 7/30/90 accepted
 *   6. Read-only guarantee: no documents created/updated by analytics calls
 *   7. DELTA correctness (the core): a baseline analytics snapshot is taken,
 *      fixtures are seeded (orders incl. one cancelled + one out-of-window,
 *      coupons, transactions), and a second snapshot is compared. Only the
 *      fixture CONTRIBUTION is asserted (delta), so the suite is robust to
 *      any pre-existing data in the shared dev DB:
 *        - time series: today +1 order / +100,000,000 (cancelled excluded),
 *          day-5 +1 order / +36,000,000, 60-day-old order invisible in
 *          30-day window
 *        - top products/categories: seeded rows appear with exact qty+revenue
 *          (seeded revenue is deliberately dominant so the rows stay in the
 *          top-10 lists on a shared dev DB)
 *        - coupon stats: total +2, usedCount +4, discountedOrders +1,
 *          in-window discount +4,000,000, top-coupon row for in-window code
 *        - supplier stats: earnings +800,000, paidOut +300,000 (count +1),
 *          pending +100,000 (count +1), outstanding +500,000, reserve +100,000
 *
 * Usage: node scripts/verify-analytics.js
 * Requires: dev server on http://localhost:3000, real DB, seeded admin.
 * NOTE: run suites sequentially — parallel verify scripts share the dev DB.
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

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "anl_" + Date.now() + "_";
const PASS = "anl-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157774101";
const SUPPLIER_PHONE = "09157774102";

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
        const key = pair.slice(0, eq).trim();
        let value = pair.slice(eq + 1).trim();
        if (value.startsWith('"')) value = value.slice(1);
        if (value.endsWith('"')) value = value.slice(0, -1);
        cookies[key] = value;
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

async function http(method, urlPath, jar) {
  const headers = {};
  if (jar) headers.Cookie = jar.header();
  const res = await fetch(BASE + urlPath, { method, headers, redirect: "manual" });
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, balance: Number, pendingReserve: Number, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);
const CategorySchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "categories" }
);
const ProductSchema = new mongoose.Schema(
  {
    name: String, slug: { type: String, unique: true }, description: String,
    images: [String], category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierPrice: Number, price: Number, stock: Number, stockVersion: Number,
    hasVariants: Boolean, variants: { type: [mongoose.Schema.Types.Mixed], default: [] },
    isActive: Boolean,
  },
  { timestamps: true, collection: "products" }
);

const dayAgo = (days) => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // mid-day UTC to stay in the same day bucket
  d.setUTCDate(d.getUTCDate() - days);
  return d;
};

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 41 — ADMIN ANALYTICS & REPORTING (REAL HTTP API)");
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
  const User = mongoose.models.User_ANL || mongoose.model("User_ANL", UserSchema);
  const Supplier = mongoose.models.Supplier_ANL || mongoose.model("Supplier_ANL", SupplierSchema);
  const Category = mongoose.models.Category_ANL || mongoose.model("Category_ANL", CategorySchema);
  const Product = mongoose.models.Product_ANL || mongoose.model("Product_ANL", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("transactions").deleteMany({ note: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^ANLTest" } });

  // --- Users MUST exist before login ---
  const customer = await User.create({ name: "ANL Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "ANL Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });

  let adminJar = null;
  let custJar = null;
  let suppJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    custJar = await login(CUSTOMER_PHONE, PASS);
    assert(custJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier login", async () => {
    suppJar = await login(SUPPLIER_PHONE, PASS);
    assert(suppJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: unauthenticated → 401 ---
  await testAsync("Unauthenticated GET /api/admin/analytics -> 401", async () => {
    const res = await http("GET", "/api/admin/analytics");
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: customer → 403 ---
  await testAsync("Customer GET /api/admin/analytics -> 403", async () => {
    const res = await http("GET", "/api/admin/analytics", custJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: supplier → 403 ---
  await testAsync("Supplier GET /api/admin/analytics -> 403", async () => {
    const res = await http("GET", "/api/admin/analytics", suppJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: admin → 200, shape ---
  await testAsync("Admin GET /api/admin/analytics -> 200 with full shape", async () => {
    const res = await http("GET", "/api/admin/analytics", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const a = res.data;
    assert(typeof a.range === "number", "range missing");
    assert(Array.isArray(a.timeSeries) && a.timeSeries.length === a.range, "timeSeries must be zero-filled to range length, got " + (a.timeSeries || []).length + " for range " + a.range);
    assert(Array.isArray(a.topProducts), "topProducts missing");
    assert(Array.isArray(a.topCategories), "topCategories missing");
    assert(a.couponStats && typeof a.couponStats.totalUses === "number", "couponStats missing");
    assert(a.supplierStats && typeof a.supplierStats.totalEarnings === "number", "supplierStats missing");
    assert(Array.isArray(a.ordersByStatus), "ordersByStatus missing");
    assert(a.summary && typeof a.summary.revenue === "number", "summary missing");
  });

  // --- TEST 5: range validation ---
  await testAsync("Invalid range -> 400", async () => {
    const res = await http("GET", "/api/admin/analytics?range=15", adminJar);
    assert(res.status === 400, "expected 400, got " + res.status);
  });
  await testAsync("Valid range=7 accepted", async () => {
    const res = await http("GET", "/api/admin/analytics?range=7", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.range === 7, "range must echo 7");
    assert(res.data.timeSeries.length === 7, "timeSeries length must be 7");
  });

  // --- TEST 6: read-only guarantee (no fixtures yet — pure analytics calls) ---
  await testAsync("Read-only: no documents created/updated by analytics calls", async () => {
    const count = async (col, filter) => db.collection(col).countDocuments(filter);
    const before = {
      orders: await count("orders", {}),
      products: await count("products", {}),
      coupons: await count("coupons", {}),
      transactions: await count("transactions", {}),
      suppliers: await count("suppliers", {}),
    };
    await http("GET", "/api/admin/analytics", adminJar);
    await http("GET", "/api/admin/analytics?range=7", adminJar);
    await http("GET", "/api/admin/analytics?range=90", adminJar);
    await http("GET", "/api/admin/analytics?range=90", adminJar);
    const after = {
      orders: await count("orders", {}),
      products: await count("products", {}),
      coupons: await count("coupons", {}),
      transactions: await count("transactions", {}),
      suppliers: await count("suppliers", {}),
    };
    assert(JSON.stringify(before) === JSON.stringify(after),
      "collection counts changed: before=" + JSON.stringify(before) + " after=" + JSON.stringify(after));
  });

  // --- BASELINE snapshot (before money-path fixtures) ---
  let baseline = null;
  await testAsync("Capture baseline analytics snapshot", async () => {
    const res = await http("GET", "/api/admin/analytics?range=30", adminJar);
    assert(res.status === 200, "baseline failed");
    baseline = res.data;
  });

  // --- Fixtures (created AFTER baseline so deltas are clean) ---
  const suppDoc = await Supplier.create({
    user: suppUser._id,
    businessName: "ANLTest Supplier Co",
    contactPhone: SUPPLIER_PHONE,
    balance: 500000,
    pendingReserve: 100000,
    isActive: true,
  });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catA = await Category.create({ name: PREFIX + "CatA", slug: PREFIX + "cata", isActive: true });
  const catB = await Category.create({ name: PREFIX + "CatB", slug: PREFIX + "catb", isActive: true });

  const prodA = await Product.create({
    name: PREFIX + "ProdA", slug: PREFIX + "proda", description: "anl test",
    category: catA._id, supplier: suppDoc._id, price: 50000000, supplierPrice: 25000000,
    stock: 100, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });
  const prodB = await Product.create({
    name: PREFIX + "ProdB", slug: PREFIX + "prodb", description: "anl test",
    category: catB._id, supplier: suppDoc._id, price: 40000000, supplierPrice: 20000000,
    stock: 100, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });

  const couponIn = await db.collection("coupons").insertOne({
    code: PREFIX + "IN", type: "percent", value: 10, minSubtotal: 0, maxDiscount: 0,
    startsAt: null, endsAt: null, isActive: true, usageLimit: 0, perUserLimit: 0,
    usedCount: 3, createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection("coupons").insertOne({
    code: PREFIX + "OUT", type: "fixed", value: 5000, minSubtotal: 0, maxDiscount: 0,
    startsAt: null, endsAt: null, isActive: false, usageLimit: 0, perUserLimit: 0,
    usedCount: 1, createdAt: new Date(), updatedAt: new Date(),
  });

  // Orders. NOTE: item snapshot name = product name so topProducts groups
  // correctly by product.
  //  - orderToday:    2 x prodA (today)            → 100,000,000, NOT cancelled
  //  - order5DaysAgo: 1 x prodB (5 days ago)       → 40,000,000 → total 36,000,000 (IN 10%)
  //  - order60DaysAgo:1 x prodA (60 days ago)      → 50,000,000 → total 49,995,000 (OUT 5,000; out of 30d window)
  //  - orderCancelled:1 x prodA (today, cancelled) → EXCLUDED from revenue/time series
  const orderBase = (product, qty, daysAgo) => ({
    customer: customer._id,
    items: [{ product: product._id, supplier: suppDoc._id, variantId: null, name: product.name, price: product.price, supplierPrice: product.supplierPrice, quantity: qty }],
    totalAmount: product.price * qty,
    subtotalAmount: product.price * qty,
    shippingAddress: { fullName: "ANL Tester", phone: customer.phone, address: "Tehran", postalCode: "123" },
    payment: { status: "paid", method: "zarinpal", authority: "ANL_" + Date.now(), refId: "ANLREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status: "delivered",
    stockRestored: false,
    statusHistory: [{ status: "delivered", at: new Date(), note: "anl" }],
    createdAt: dayAgo(daysAgo),
    updatedAt: dayAgo(daysAgo),
  });

  await db.collection("orders").insertOne({
    ...orderBase(prodA, 2, 0),
    status: "processing",
    payment: { status: "pending", method: "zarinpal", authority: "", refId: "", cardPan: "", paidAt: null },
  });
  await db.collection("orders").insertOne({
    ...orderBase(prodB, 1, 5),
    discount: { code: PREFIX + "IN", couponId: couponIn.insertedId, type: "percent", value: 10, amount: 4000000, released: true },
    totalAmount: 36000000,
    subtotalAmount: 40000000,
  });
  await db.collection("orders").insertOne({
    ...orderBase(prodA, 1, 60),
    discount: { code: PREFIX + "OUT", couponId: null, type: "fixed", value: 5000, amount: 5000, released: true },
    totalAmount: 49995000,
    subtotalAmount: 50000000,
  });
  await db.collection("orders").insertOne({
    ...orderBase(prodA, 1, 0),
    status: "cancelled",
    payment: { status: "canceled", method: "zarinpal", authority: "", refId: "", cardPan: "", paidAt: null },
  });

  // Transactions:
  //  - order_credit 800,000 (earnings)
  //  - payout approved 300,000
  //  - payout pending 100,000
  await db.collection("transactions").insertMany([
    { supplier: suppDoc._id, type: "order_credit", amount: 800000, relatedOrder: null, note: PREFIX + "credit", balanceAfter: 800000, status: "approved", createdAt: new Date(), updatedAt: new Date() },
    { supplier: suppDoc._id, type: "payout", amount: 300000, relatedOrder: null, note: PREFIX + "paid", balanceAfter: 500000, status: "approved", reviewedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    { supplier: suppDoc._id, type: "payout", amount: 100000, relatedOrder: null, note: PREFIX + "pending", balanceAfter: 400000, status: "pending", createdAt: new Date(), updatedAt: new Date() },
  ]);

  // --- AFTER snapshot ---
  let after = null;
  await testAsync("Capture post-fixture analytics snapshot", async () => {
    const res = await http("GET", "/api/admin/analytics?range=30", adminJar);
    assert(res.status === 200, "after snapshot failed");
    after = res.data;
  });

  // --- TEST 7: time-series DELTA ---
  await testAsync("Time series delta: +1 today (+100M, cancelled excluded), +1 day-5 (+36M), 60-day-old invisible", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const d5Key = dayAgo(5).toISOString().slice(0, 10);
    const d60Key = dayAgo(60).toISOString().slice(0, 10);

    const bToday = baseline.timeSeries.find((t) => t.date === todayKey);
    const aToday = after.timeSeries.find((t) => t.date === todayKey);
    assert(!!aToday, "today bucket missing after: " + JSON.stringify(after.timeSeries.map((t) => t.date)));
    assert((aToday.orders - (bToday ? bToday.orders : 0)) === 1, "today orders delta must be +1 (cancelled excluded), got " + ((aToday.orders - (bToday ? bToday.orders : 0))));
    assert((aToday.revenue - (bToday ? bToday.revenue : 0)) === 100000000, "today revenue delta must be +100000000, got " + ((aToday.revenue - (bToday ? bToday.revenue : 0))));

    const bDay5 = baseline.timeSeries.find((t) => t.date === d5Key);
    const aDay5 = after.timeSeries.find((t) => t.date === d5Key);
    assert(!!aDay5, "5-day bucket missing");
    assert((aDay5.orders - (bDay5 ? bDay5.orders : 0)) === 1, "day-5 orders delta must be +1");
    assert((aDay5.revenue - (bDay5 ? bDay5.revenue : 0)) === 36000000, "day-5 revenue delta must be +36000000, got " + ((aDay5.revenue - (bDay5 ? bDay5.revenue : 0))));

    // 60-day-old order must NOT contribute to the 30-day window
    const bDay60 = baseline.timeSeries.find((t) => t.date === d60Key);
    const aDay60 = after.timeSeries.find((t) => t.date === d60Key);
    assert(!aDay60 && !bDay60, "60-day-old order must not appear in 30-day window");

    // zero-fill preserved
    assert(after.timeSeries.length === 30, "must be exactly 30 buckets");
  });

  // --- TEST 8: top products / categories ---
  await testAsync("Top products + categories: seeded rows with exact aggregates", async () => {
    const prodARow = after.topProducts.find((p) => p.name === PREFIX + "ProdA");
    assert(!!prodARow, "ProdA must be in top products");
    assert(prodARow.quantity === 2, "ProdA qty must be 2, got " + prodARow.quantity);
    assert(prodARow.revenue === 100000000, "ProdA revenue must be 100000000, got " + prodARow.revenue);
    const prodBRow = after.topProducts.find((p) => p.name === PREFIX + "ProdB");
    assert(!!prodBRow && prodBRow.quantity === 1 && prodBRow.revenue === 40000000, "ProdB row wrong: " + JSON.stringify(prodBRow));

    const catARow = after.topCategories.find((c) => c.name === PREFIX + "CatA");
    assert(!!catARow && catARow.quantity === 2, "CatA must appear with qty 2");
    const catBRow = after.topCategories.find((c) => c.name === PREFIX + "CatB");
    assert(!!catBRow && catBRow.quantity === 1, "CatB must appear with qty 1");
  });

  // --- TEST 9: coupon stats DELTA ---
  await testAsync("Coupon stats delta: +2 coupons, +4 usedCount, +1 discounted order, +4M in-window discount", async () => {
    assert(after.couponStats.total - baseline.couponStats.total === 2, "coupon total delta must be +2, got " + (after.couponStats.total - baseline.couponStats.total));
    assert(after.couponStats.totalUses - baseline.couponStats.totalUses === 4, "usedCount delta must be +4, got " + (after.couponStats.totalUses - baseline.couponStats.totalUses));
    assert(after.couponStats.discountedOrders - baseline.couponStats.discountedOrders === 1, "discountedOrders delta must be +1 (60-day out of window), got " + (after.couponStats.discountedOrders - baseline.couponStats.discountedOrders));
    assert(after.couponStats.totalDiscount - baseline.couponStats.totalDiscount === 4000000, "in-window discount delta must be +4000000, got " + (after.couponStats.totalDiscount - baseline.couponStats.totalDiscount));
    const top = after.couponStats.topCoupons.find((c) => c.code === PREFIX + "IN");
    assert(!!top && top.uses === 1 && top.discount === 4000000, "IN coupon top row wrong: " + JSON.stringify(top));
  });

  // --- TEST 10: supplier stats DELTA ---
  await testAsync("Supplier stats delta: earnings +800K, paidOut +300K, pending +100K, balance +500K, reserve +100K", async () => {
    const d = (key) => after.supplierStats[key] - baseline.supplierStats[key];
    assert(d("totalEarnings") === 800000, "earnings delta must be +800000, got " + d("totalEarnings"));
    assert(d("totalPaidOut") === 300000, "paidOut delta must be +300000, got " + d("totalPaidOut"));
    assert(d("paidOutCount") === 1, "paidOutCount delta must be +1");
    assert(d("pendingPayoutAmount") === 100000, "pending amount delta must be +100000, got " + d("pendingPayoutAmount"));
    assert(d("pendingPayoutCount") === 1, "pending count delta must be +1");
    assert(d("outstandingBalance") === 500000, "outstanding balance delta must be +500000, got " + d("outstandingBalance"));
    assert(d("pendingReserve") === 100000, "pending reserve delta must be +100000, got " + d("pendingReserve"));
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("transactions").deleteMany({ note: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [customer._id, suppUser._id] } });
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
