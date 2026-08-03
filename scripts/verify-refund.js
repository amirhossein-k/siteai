/**
 * Session 32 — Admin Refund Flow Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated refund → 401
 *   2. Customer cannot refund → 403
 *   3. Supplier cannot refund → 403
 *   4. Admin refunds a PAID simple order → 200 + payment.status=refunded
 *   5. Refund metadata saved (reason, refundedAt, refundedBy)
 *   6. Stock restored exactly once (8 → 10 after refund of qty 2)
 *   7. Pending (unpaid) order cannot refund → 400
 *   8. Refunded order cannot refund twice → 400 (atomic claim), stock NOT increased again
 *   9. Variant order refund restores variant stock + summary correctly
 *  10. Simple product refund works (separate fixture)
 *  11. Refund event pushed to statusHistory with reason
 *
 * Usage: node scripts/verify-refund.js
 * Requires: dev server on http://localhost:3000, real DB.
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
const PREFIX = "refund_" + Date.now() + "_";
const PASS = "refund-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157770001";
const SUPPLIER_PHONE = "09157770002";

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
    isActive: Boolean,
  },
  { timestamps: true, collection: "products" }
);
const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [{ product: mongoose.Schema.Types.ObjectId, supplier: mongoose.Schema.Types.ObjectId, variantId: mongoose.Schema.Types.ObjectId, name: String, price: Number, supplierPrice: Number, quantity: Number }],
    totalAmount: Number,
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    payment: { status: String, method: String, authority: String, refId: String, cardPan: String, paidAt: Date },
    status: String,
    stockRestored: Boolean,
    statusHistory: [{ status: String, at: Date, note: String }],
  },
  { timestamps: true, collection: "orders" }
);

// Simulate a PAID order whose stock is still RESERVED (stockRestored=false).
// product stock must already be decremented by the reservation (like a real checkout).
async function makePaidOrder(db, { customer, product, qty, variantId = null, status = "processing" }) {
  const res = await db.collection("orders").insertOne({
    customer: customer._id,
    items: [{
      product: product._id,
      supplier: new mongoose.Types.ObjectId(),
      variantId: variantId ? new mongoose.Types.ObjectId(String(variantId)) : null,
      name: product.name,
      price: product.price,
      supplierPrice: product.supplierPrice,
      quantity: qty,
    }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "Refund Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "REFPAID_" + Date.now(), refId: "REFREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status,
    stockRestored: false,
    statusHistory: [{ status: "processing", at: new Date(), note: "paid" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return res.insertedId.toString();
}

async function getStock(db, productId, variantId) {
  const doc = await db.collection("products").findOne({ _id: productId }, { projection: { stock: 1, variants: 1 } });
  if (!doc) return null;
  if (variantId) {
    const v = (doc.variants || []).find((x) => String(x._id) === String(variantId));
    return v ? v.stock : null;
  }
  return doc.stock;
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 32 — ADMIN REFUND FLOW (REAL HTTP API)");
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
  const User = mongoose.models.User_REFUND || mongoose.model("User_REFUND", UserSchema);
  const Supplier = mongoose.models.Supplier_REFUND || mongoose.model("Supplier_REFUND", SupplierSchema);
  const Category = mongoose.models.Category_REFUND || mongoose.model("Category_REFUND", CategorySchema);
  const Product = mongoose.models.Product_REFUND || mongoose.model("Product_REFUND", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^RefundTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "Refund Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Refund Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "RefundTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  // Simple products (stock 10) — "reserved" by paid orders later via direct $set
  const prodSimple1 = await Product.create({ name: PREFIX + "simple-1", slug: PREFIX + "simple-1", description: "refund test", category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodSimple2 = await Product.create({ name: PREFIX + "simple-2", slug: PREFIX + "simple-2", description: "refund test", category: catDoc._id, supplier: suppDoc._id, price: 20000, supplierPrice: 8000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodPending = await Product.create({ name: PREFIX + "pending", slug: PREFIX + "pending", description: "refund test", category: catDoc._id, supplier: suppDoc._id, price: 15000, supplierPrice: 6000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  // Variant product: red (stock 10), blue (stock 5)
  const vRed = new mongoose.Types.ObjectId();
  const vBlue = new mongoose.Types.ObjectId();
  const prodVariant = await Product.create({
    name: PREFIX + "variant", slug: PREFIX + "variant", description: "refund test",
    category: catDoc._id, supplier: suppDoc._id, price: 12000, supplierPrice: 6000,
    stock: 15, stockVersion: 0, hasVariants: true, isActive: true,
    variants: [
      { _id: vRed, sku: PREFIX + "-RED", attributes: [{ attributeId: new mongoose.Types.ObjectId(), name: "رنگ", value: "قرمز" }], price: 12000, supplierPrice: 6000, stock: 10, stockVersion: 0, images: [], isActive: true },
      { _id: vBlue, sku: PREFIX + "-BLUE", attributes: [{ attributeId: new mongoose.Types.ObjectId(), name: "رنگ", value: "آبی" }], price: 12000, supplierPrice: 6000, stock: 5, stockVersion: 0, images: [], isActive: true },
    ],
  });

  let adminJar = null;
  let customerJar = null;
  let supplierJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier login", async () => {
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: unauthenticated refund → 401 ---
  await testAsync("Unauthenticated refund -> 401", async () => {
    const res = await http("POST", "/api/admin/orders/refund", null, { orderId: new mongoose.Types.ObjectId().toString(), reason: "test" });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: customer cannot refund → 403 ---
  await testAsync("Customer cannot refund -> 403", async () => {
    const res = await http("POST", "/api/admin/orders/refund", customerJar, { orderId: new mongoose.Types.ObjectId().toString(), reason: "test" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: supplier cannot refund → 403 ---
  await testAsync("Supplier cannot refund -> 403", async () => {
    const res = await http("POST", "/api/admin/orders/refund", supplierJar, { orderId: new mongoose.Types.ObjectId().toString(), reason: "test" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4+5+6: admin refunds PAID order → 200, metadata saved, stock restored once ---
  let refundedOrderId = null;
  await testAsync("Admin refunds paid order -> 200 + refunded + stock restored once", async () => {
    // Simulate a checkout that reserved qty 2: stock 10 -> 8, order paid + stockRestored=false
    await db.collection("products").updateOne({ _id: prodSimple1._id }, { $set: { stock: 8, stockVersion: 1 } });
    refundedOrderId = await makePaidOrder(db, { customer, product: prodSimple1, qty: 2 });

    const before = await getStock(db, prodSimple1._id);
    assert(before === 8, "expected reserved stock 8, got " + before);

    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId: refundedOrderId, reason: "کالای معیوب" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.payment.status === "refunded", "payment.status must be refunded, got " + res.data.payment.status);

    // Metadata
    assert(res.data.refund && res.data.refund.reason === "کالای معیوب", "refund.reason missing/wrong");
    assert(!!res.data.refund.refundedAt, "refundedAt missing");
    assert(!!res.data.refund.refundedBy, "refundedBy missing");
    console.log("\n      reason=" + res.data.refund.reason + " refundedAt=" + !!res.data.refund.refundedAt);

    // Stock restored exactly once: 8 -> 10
    const after = await getStock(db, prodSimple1._id);
    assert(after === 10, "stock must be restored to 10, got " + after);
    console.log("\n      stock 8->" + after);
  });

  // --- TEST 7: pending order cannot refund → 400 ---
  await testAsync("Pending (unpaid) order cannot refund -> 400", async () => {
    const inserted = await db.collection("orders").insertOne({
      customer: customer._id,
      items: [{ product: prodPending._id, supplier: new mongoose.Types.ObjectId(), variantId: null, name: prodPending.name, price: prodPending.price, supplierPrice: prodPending.supplierPrice, quantity: 1 }],
      totalAmount: prodPending.price,
      shippingAddress: { fullName: "T", phone: customer.phone, address: "Tehran", postalCode: "" },
      payment: { status: "pending", method: "zarinpal", authority: "PEND_REF_" + Date.now(), refId: "", cardPan: "", paidAt: null },
      status: "pending_payment",
      stockRestored: false,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "test" }],
    });
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId: inserted.insertedId.toString(), reason: "test" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
  });

  // --- TEST 8: refunded order cannot refund twice; stock NOT increased again ---
  await testAsync("Refunded order cannot refund twice -> 400, no double restore", async () => {
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId: refundedOrderId, reason: "دوباره" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const after = await getStock(db, prodSimple1._id);
    assert(after === 10, "stock must stay 10 after second refund, got " + after);
    console.log("\n      stock still " + after);
  });

  // --- TEST 9: variant order refund restores variant stock + summary ---
  await testAsync("Variant refund restores variant stock + summary correctly", async () => {
    // Simulate checkout reserved qty 2 from RED variant: red 10->8, summary 15->13
    await db.collection("products").updateOne(
      { _id: prodVariant._id, "variants._id": vRed },
      { $set: { "variants.$.stock": 8, "variants.$.stockVersion": 1, stock: 13 } }
    );
    const orderId = await makePaidOrder(db, { customer, product: prodVariant, qty: 2, variantId: vRed });

    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "رنگ اشتباه" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const redAfter = await getStock(db, prodVariant._id, vRed);
    assert(redAfter === 10, "red variant stock must be restored to 10, got " + redAfter);
    const blueAfter = await getStock(db, prodVariant._id, vBlue);
    assert(blueAfter === 5, "blue variant stock unchanged, got " + blueAfter);
    const doc = await db.collection("products").findOne({ _id: prodVariant._id }, { projection: { stock: 1 } });
    assert(doc.stock === 15, "summary stock must be 15, got " + doc.stock);
    console.log("\n      red 8->" + redAfter + " blue " + blueAfter + " summary " + doc.stock);
  });

  // --- TEST 10: simple product refund works (separate fixture) ---
  await testAsync("Simple product refund works", async () => {
    await db.collection("products").updateOne({ _id: prodSimple2._id }, { $set: { stock: 6, stockVersion: 1 } });
    const orderId = await makePaidOrder(db, { customer, product: prodSimple2, qty: 4 });
    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "انصراف مشتری" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const after = await getStock(db, prodSimple2._id);
    assert(after === 10, "simple product stock must be restored to 10, got " + after);
    console.log("\n      stock 6->" + after);
  });

  // --- TEST 11: refund event pushed to statusHistory with reason ---
  await testAsync("Refund history saved (statusHistory contains refunded event)", async () => {
    const doc = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(refundedOrderId) });
    assert(doc && Array.isArray(doc.statusHistory), "statusHistory missing");
    const refundEvent = doc.statusHistory.find((h) => h.status === "refunded");
    assert(!!refundEvent, "no refunded event in statusHistory");
    assert(String(refundEvent.note || "").includes("کالای معیوب"), "refund reason not in history note: " + refundEvent.note);
    console.log("\n      statusHistory entries=" + doc.statusHistory.length + " note=\"" + refundEvent.note + "\"");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
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
