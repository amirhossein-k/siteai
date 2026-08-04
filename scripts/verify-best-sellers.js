/**
 * Session 56 — Best-Sellers (Product.soldCount) Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Seed admin login
 *   2. sort=best_selling ranks by soldCount desc (newest breaks ties)
 *   3. LEAK SCAN — soldCount never appears in the public list response
 *   4. LEAK SCAN — soldCount never appears in the public detail response
 *   5. Refund reversal: paid order refunded via the real admin API decrements
 *      soldCount by exactly the item quantities (simple products)
 *   6. Double refund → 400, soldCount NOT decremented twice
 *   7. Variant-order refund decrements the PRODUCT-level counter by item qty
 *      (variant-level sales are future scope — the counter is the product sum)
 *   8. Legacy floor: refunding a product with soldCount 0 can never go negative
 *   9. Pending (unpaid) orders can't be refunded → 400 and NEVER counted
 *  10. Admin cancelling a PAID order reverses soldCount (paid-only rule);
 *      admin cancelling a PENDING order never touches it
 *  11. Checkout (non-gateway method) creates a PENDING order and NEVER
 *      increments soldCount (the paid-only rule; refunds prove the counter
 *      math — the payment-verify increment is gated by the same atomic claim
 *      that verify-payment-retry already exercises)
 *  12. CMS block: GET /api/admin/homepage/sections idempotently seeds the
 *      best-sellers default section; GET /api/homepage includes it, positioned
 *      after special-picks (sortOrder)
 *
 * Requires: dev server on http://localhost:3000, real DB.
 * Usage: node scripts/verify-best-sellers.js
 *
 * IMPORTANT: cleans up its own PREFIX'd fixtures. Must run AFTER
 * verify-coupon-eligibility in the sequential regression (shared DB).
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
const PREFIX = "bestsell_" + Date.now() + "_";
const PASS = "bestsell-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157770011";

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

async function http(method, urlPath, jar, body, extraHeaders) {
  const headers = { ...(extraHeaders || {}) };
  if (jar) headers.Cookie = jar.header();
  let requestBody = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: requestBody, redirect: "manual" });
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

/** Deep scan for a forbidden key across the whole response object graph. */
function deepHasKey(node, key) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => deepHasKey(n, key));
  if (Object.prototype.hasOwnProperty.call(node, key)) return true;
  return Object.values(node).some((v) => deepHasKey(v, key));
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, isActive: Boolean },
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
    isActive: Boolean, soldCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "products" }
);
async function makePaidOrder(db, { customer, items }) {
  const res = await db.collection("orders").insertOne({
    customer: customer._id,
    items,
    totalAmount: items.reduce((s, i) => s + i.price * i.quantity, 0),
    shippingAddress: { fullName: "BestSell Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "BSPAID_" + Date.now(), refId: "BSREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status: "processing",
    stockRestored: false,
    statusHistory: [{ status: "processing", at: new Date(), note: "paid" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return res.insertedId.toString();
}

async function getSoldCount(db, productId) {
  const doc = await db.collection("products").findOne({ _id: productId }, { projection: { soldCount: 1 } });
  return doc ? doc.soldCount ?? 0 : null;
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 56 — BEST-SELLERS (Product.soldCount) (REAL HTTP API)");
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
  const User = mongoose.models.User_BSELL || mongoose.model("User_BSELL", UserSchema);
  const Supplier = mongoose.models.Supplier_BSELL || mongoose.model("Supplier_BSELL", SupplierSchema);
  const Category = mongoose.models.Category_BSELL || mongoose.model("Category_BSELL", CategorySchema);
  const Product = mongoose.models.Product_BSELL || mongoose.model("Product_BSELL", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^BestSellTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "BestSell Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "BestSell Supplier", phone: "09157770012", passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "BestSellTest Supplier Co", contactPhone: "09157770012", isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  // Simple products with ACCRUED soldCount (simulating prior paid sales).
  const p1 = await Product.create({ name: PREFIX + "top", slug: PREFIX + "top", description: "bs", category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const p2 = await Product.create({ name: PREFIX + "mid", slug: PREFIX + "mid", description: "bs", category: catDoc._id, supplier: suppDoc._id, price: 20000, supplierPrice: 8000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const p3 = await Product.create({ name: PREFIX + "none", slug: PREFIX + "none", description: "bs", category: catDoc._id, supplier: suppDoc._id, price: 15000, supplierPrice: 6000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // Same soldCount as p2 but NEWER — tie-break must prefer p4.
  const p4 = await Product.create({ name: PREFIX + "tie", slug: PREFIX + "tie", description: "bs", category: catDoc._id, supplier: suppDoc._id, price: 25000, supplierPrice: 9000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  // Variant product (for the variant-order reversal test).
  const vRed = new mongoose.Types.ObjectId();
  const pVariant = await Product.create({
    name: PREFIX + "variant", slug: PREFIX + "variant", description: "bs",
    category: catDoc._id, supplier: suppDoc._id, price: 12000, supplierPrice: 6000,
    stock: 15, stockVersion: 0, hasVariants: true, isActive: true,
    variants: [
      { _id: vRed, sku: PREFIX + "-RED", attributes: [{ attributeId: new mongoose.Types.ObjectId(), name: "رنگ", value: "قرمز" }], price: 12000, supplierPrice: 6000, stock: 10, stockVersion: 0, images: [], isActive: true },
    ],
  });

  // Checkout fixture (test 10): fresh product with stock.
  const pCart = await Product.create({ name: PREFIX + "cart", slug: PREFIX + "cart", description: "bs", category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000, stock: 5, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  // Accrued counts: p1=5, p2=3, p4=3, p3=0, pVariant=4, pCart=0.
  await db.collection("products").updateMany(
    { _id: { $in: [p1._id, p2._id, p4._id, p3._id, pVariant._id] } },
    { $set: { soldCount: 5 } }
  );
  await db.collection("products").updateMany(
    { _id: { $in: [p2._id, p4._id] } },
    { $set: { soldCount: 3 } }
  );
  await db.collection("products").updateOne({ _id: p3._id }, { $set: { soldCount: 0 } });
  await db.collection("products").updateOne({ _id: pVariant._id }, { $set: { soldCount: 4 } });

  let adminJar = null;
  let customerJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 2: sort=best_selling ranking ---
  await testAsync("sort=best_selling ranks by soldCount desc, newest tie-break", async () => {
    const res = await http("GET", "/api/products?sort=best_selling&limit=100", null);
    assert(res.status === 200, "expected 200, got " + res.status);
    const mine = res.data.data.filter((p) => String(p.slug || "").startsWith(PREFIX));
    assert(mine.length === 6, "expected 6 PREFIX products in response, got " + mine.length);
    // p1 (5) first; then p4 (3, newer) before p2 (3); pVariant (4) is second overall.
    const order = mine.map((p) => p.slug);
    assert(order[0] === PREFIX + "top", "p1 (soldCount 5) must rank first, got " + order[0]);
    const variantIdx = order.indexOf(PREFIX + "variant");
    const tieIdx4 = order.indexOf(PREFIX + "tie");
    const tieIdx2 = order.indexOf(PREFIX + "mid");
    assert(variantIdx < tieIdx4, "pVariant (4) must outrank the 3s");
    assert(tieIdx4 < tieIdx2, "newer tie (p4) must precede older tie (p2)");
    assert(order.indexOf(PREFIX + "none") > tieIdx2, "p3 (0) must rank last among these");
  });

  // --- TEST 3: list leak scan ---
  await testAsync("LEAK SCAN: soldCount never appears in the public list", async () => {
    const res = await http("GET", "/api/products?sort=best_selling&limit=100", null);
    assert(!deepHasKey(res.data, "soldCount"), "soldCount leaked in list response!");
  });

  // --- TEST 4: detail leak scan ---
  await testAsync("LEAK SCAN: soldCount never appears in the public detail", async () => {
    const res = await http("GET", "/api/products?slug=" + encodeURIComponent(PREFIX + "top"), null);
    assert(res.status === 200, "detail expected 200, got " + res.status);
    assert(!deepHasKey(res.data, "soldCount"), "soldCount leaked in detail response!");
  });

  // --- TEST 5: refund reversal (simple products) ---
  let refundedOrderId = null;
  await testAsync("Refund reverses soldCount by item quantities (simple)", async () => {
    // p1: 5 -> 3 (qty 2), p2: 3 -> 2 (qty 1)
    refundedOrderId = await makePaidOrder(db, {
      customer,
      items: [
        { product: p1._id, supplier: suppDoc._id, variantId: null, name: p1.name, price: p1.price, supplierPrice: p1.supplierPrice, quantity: 2 },
        { product: p2._id, supplier: suppDoc._id, variantId: null, name: p2.name, price: p2.price, supplierPrice: p2.supplierPrice, quantity: 1 },
      ],
    });
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId: refundedOrderId, reason: "test reversal" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert((await getSoldCount(db, p1._id)) === 3, "p1 soldCount must be 3 after refund, got " + (await getSoldCount(db, p1._id)));
    assert((await getSoldCount(db, p2._id)) === 2, "p2 soldCount must be 2 after refund, got " + (await getSoldCount(db, p2._id)));
  });

  // --- TEST 6: double refund → 400, no double decrement ---
  await testAsync("Double refund -> 400, soldCount not decremented twice", async () => {
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId: refundedOrderId, reason: "again" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert((await getSoldCount(db, p1._id)) === 3, "p1 soldCount must stay 3, got " + (await getSoldCount(db, p1._id)));
  });

  // --- TEST 7: variant-order refund decrements the PRODUCT-level counter ---
  await testAsync("Variant-order refund decrements product-level counter by qty", async () => {
    const orderId = await makePaidOrder(db, {
      customer,
      items: [
        { product: pVariant._id, supplier: suppDoc._id, variantId: vRed, name: pVariant.name, price: pVariant.price, supplierPrice: pVariant.supplierPrice, quantity: 3 },
      ],
    });
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "variant reversal" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert((await getSoldCount(db, pVariant._id)) === 1, "pVariant soldCount must be 4-3=1, got " + (await getSoldCount(db, pVariant._id)));
  });

  // --- TEST 8: legacy floor — soldCount 0 can never go negative ---
  await testAsync("Refund of a legacy 0-count product stays at 0 (never negative)", async () => {
    const orderId = await makePaidOrder(db, {
      customer,
      items: [
        { product: p3._id, supplier: suppDoc._id, variantId: null, name: p3.name, price: p3.price, supplierPrice: p3.supplierPrice, quantity: 2 },
      ],
    });
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "legacy floor" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert((await getSoldCount(db, p3._id)) === 0, "p3 soldCount must stay 0, got " + (await getSoldCount(db, p3._id)));
  });

  // --- TEST 9: pending order can't be refunded and is never counted ---
  await testAsync("Pending (unpaid) order cannot refund -> 400, never counted", async () => {
    const inserted = await db.collection("orders").insertOne({
      customer: customer._id,
      items: [{ product: p2._id, supplier: suppDoc._id, variantId: null, name: p2.name, price: p2.price, supplierPrice: p2.supplierPrice, quantity: 9 }],
      totalAmount: p2.price * 9,
      shippingAddress: { fullName: "T", phone: customer.phone, address: "Tehran", postalCode: "" },
      payment: { status: "pending", method: "zarinpal", authority: "BSPEND_" + Date.now(), refId: "", cardPan: "", paidAt: null },
      status: "pending_payment",
      stockRestored: false,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "test" }],
    });
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId: inserted.insertedId.toString(), reason: "test" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert((await getSoldCount(db, p2._id)) === 2, "pending order must not count, soldCount still " + (await getSoldCount(db, p2._id)));
  });

  // --- TEST 10: admin cancellation — paid reverses, pending never counted ---
  await testAsync("Admin cancel of a PAID order reverses soldCount; pending cancel untouched", async () => {
    // Paid order on p2 (currently soldCount 2): cancel via the real admin
    // orders API → 2 -> 1 (qty 1).
    const paidOrderId = await makePaidOrder(db, {
      customer,
      items: [
        { product: p2._id, supplier: suppDoc._id, variantId: null, name: p2.name, price: p2.price, supplierPrice: p2.supplierPrice, quantity: 1 },
      ],
    });
    const cancelRes = await http("PUT", "/api/admin/orders?id=" + paidOrderId, adminJar, { status: "cancelled", note: "cancel paid" });
    assert(cancelRes.status === 200, "admin cancel of paid order expected 200, got " + cancelRes.status + " " + JSON.stringify(cancelRes.data).slice(0, 150));
    assert(cancelRes.data.status === "cancelled", "order must be cancelled");
    assert((await getSoldCount(db, p2._id)) === 1, "p2 soldCount must be 2-1=1 after admin cancel, got " + (await getSoldCount(db, p2._id)));

    // Pending order on p3 (soldCount 0): cancel via admin -> stays 0.
    const pendingInsert = await db.collection("orders").insertOne({
      customer: customer._id,
      items: [{ product: p3._id, supplier: suppDoc._id, variantId: null, name: p3.name, price: p3.price, supplierPrice: p3.supplierPrice, quantity: 4 }],
      totalAmount: p3.price * 4,
      shippingAddress: { fullName: "T", phone: customer.phone, address: "Tehran", postalCode: "" },
      payment: { status: "pending", method: "zarinpal", authority: "BSCANPEND_" + Date.now(), refId: "", cardPan: "", paidAt: null },
      status: "pending_payment",
      stockRestored: false,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "test" }],
    });
    const cancelPending = await http("PUT", "/api/admin/orders?id=" + pendingInsert.insertedId.toString(), adminJar, { status: "cancelled", note: "cancel pending" });
    assert(cancelPending.status === 200, "admin cancel of pending order expected 200, got " + cancelPending.status);
    assert((await getSoldCount(db, p3._id)) === 0, "pending cancel must not touch soldCount, got " + (await getSoldCount(db, p3._id)));
  });

  // --- TEST 11: checkout creates a PENDING order that never counts ---
  await testAsync("Checkout (pending) never increments soldCount (paid-only rule)", async () => {
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [{ id: String(pCart._id), quantity: 2, price: 10000, name: pCart.name }],
      shippingAddress: { fullName: "BestSell Tester", phone: CUSTOMER_PHONE, address: "Tehran", postalCode: "12345" },
      paymentMethod: "cash",
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(!!res.data.orderId, "no orderId from checkout");

    const orderDoc = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(orderDoc && orderDoc.payment.status === "pending", "order must be pending, got " + (orderDoc && orderDoc.payment.status));
    // A pending order must NEVER move the counter — soldCount stays 0.
    assert((await getSoldCount(db, pCart._id)) === 0, "pending checkout must not count, soldCount still " + (await getSoldCount(db, pCart._id)));
  });

  // --- TEST 11: CMS block seeded + present in public composition ---
  await testAsync("CMS: best-sellers default section seeded + in public composition", async () => {
    const seedRes = await http("GET", "/api/admin/homepage/sections", adminJar);
    assert(seedRes.status === 200, "sections GET expected 200, got " + seedRes.status + " " + JSON.stringify(seedRes.data).slice(0, 120));
    const sections = seedRes.data.sections || [];
    const bs = sections.find((s) => s.slug === "best-sellers");
    assert(!!bs, "best-sellers section must be seeded (idempotent)");
    assert(bs.component === "best-sellers", "wrong component: " + bs.component);
    const special = sections.find((s) => s.slug === "special-picks");
    assert(special && bs.sortOrder >= special.sortOrder, "best-sellers must come at/after special-picks");

    const pubRes = await http("GET", "/api/homepage", null);
    assert(pubRes.status === 200, "homepage API expected 200, got " + pubRes.status);
    const pubBs = (pubRes.data.sections || []).find((s) => s.slug === "best-sellers");
    assert(!!pubBs && pubBs.component === "best-sellers", "best-sellers missing from public composition");
    assert(Array.isArray(pubBs.content) && pubBs.content.length === 0, "data-driven section must expose empty content array");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
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
