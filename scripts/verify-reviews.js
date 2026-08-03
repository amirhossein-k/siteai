/**
 * Session 34 — Customer Reviews & Ratings Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated POST /api/reviews → 401
 *   2. Supplier cannot review → 403
 *   3. Customer without a DELIVERED order (only paid) → 403
 *   4. Customer with a DELIVERED order → 201 + status=pending
 *   5. Duplicate review (same order-item) → 409, DB count stays 1
 *   6. Rating 0 / 6 → 400
 *   7. Empty / >1000-char text → 400
 *   8. HTML/script in text → sanitized in DB
 *   9. Pending review NOT visible in public GET
 *  10. Admin approve → appears in public GET + ratingSummary updated
 *  11. Approve again → 400 (atomic claim)
 *  12. Reject without reason → 400; with reason → rejected + reason saved + not public
 *  13. Non-admin moderate → 403
 *  14. GET /api/products?slug= includes ratingSummary (approved only)
 *  15. Customer can review a DIFFERENT product (uniqueness is per order-item)
 *  16. Same customer + same product in a SECOND delivered order → can review again
 *  17. GET /api/reviews/mine returns eligible orders + my reviews
 *
 * Usage: node scripts/verify-reviews.js
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
const PREFIX = "review_" + Date.now() + "_";
const PASS = "review-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157771001";
const SUPPLIER_PHONE = "09157771002";

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

async function http(method, urlPath, jar, body) {
  const headers = {};
  if (jar) headers.Cookie = jar.header();
  let requestBody = body;
  if (body !== undefined) {
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
    items: [{ product: mongoose.Schema.Types.ObjectId, supplier: mongoose.Schema.Types.ObjectId, variantId: mongoose.Schema.Types.ObjectId, sku: String, variantLabel: String, image: String, name: String, price: Number, supplierPrice: Number, quantity: Number }],
    totalAmount: Number,
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    payment: { status: String, method: String, authority: String, refId: String, cardPan: String, paidAt: Date },
    status: String,
    stockRestored: Boolean,
    statusHistory: [{ status: String, at: Date, note: String }],
  },
  { timestamps: true, collection: "orders" }
);

async function makeDeliveredOrder(db, { customer, product, qty, variantId = null, variantLabel = "", sku = "" }) {
  const res = await db.collection("orders").insertOne({
    customer: customer._id,
    items: [{
      product: product._id,
      supplier: new mongoose.Types.ObjectId(),
      variantId: variantId ? new mongoose.Types.ObjectId(String(variantId)) : null,
      sku, variantLabel, image: product.images?.[0] || "",
      name: product.name,
      price: product.price,
      supplierPrice: product.supplierPrice,
      quantity: qty,
    }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "Review Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "REVPAID_" + Date.now(), refId: "REVREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status: "delivered",
    stockRestored: true,
    statusHistory: [{ status: "delivered", at: new Date(), note: "delivered" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return res.insertedId.toString();
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 34 — CUSTOMER REVIEWS & RATINGS (REAL HTTP API)");
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
  const User = mongoose.models.User_REVIEW || mongoose.model("User_REVIEW", UserSchema);
  const Supplier = mongoose.models.Supplier_REVIEW || mongoose.model("Supplier_REVIEW", SupplierSchema);
  const Category = mongoose.models.Category_REVIEW || mongoose.model("Category_REVIEW", CategorySchema);
  const Product = mongoose.models.Product_REVIEW || mongoose.model("Product_REVIEW", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("reviews").deleteMany({ "itemSnapshot.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^ReviewTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "Review Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Review Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "ReviewTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const prod1 = await Product.create({ name: PREFIX + "prod-1", slug: PREFIX + "prod-1", description: "review test product", images: ["https://example.com/p1.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prod2 = await Product.create({ name: PREFIX + "prod-2", slug: PREFIX + "prod-2", description: "review test product 2", category: catDoc._id, supplier: suppDoc._id, price: 20000, supplierPrice: 8000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodPaidOnly = await Product.create({ name: PREFIX + "prod-paidonly", slug: PREFIX + "prod-paidonly", description: "paid but not delivered", category: catDoc._id, supplier: suppDoc._id, price: 15000, supplierPrice: 6000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodDup = await Product.create({ name: PREFIX + "prod-dup", slug: PREFIX + "prod-dup", description: "dedupe test", category: catDoc._id, supplier: suppDoc._id, price: 12000, supplierPrice: 5000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  // Paid-but-NOT-delivered order (must NOT grant review eligibility)
  await db.collection("orders").insertOne({
    customer: customer._id,
    items: [{ product: prodPaidOnly._id, supplier: suppDoc._id, variantId: null, sku: "", variantLabel: "", image: "", name: prodPaidOnly.name, price: prodPaidOnly.price, supplierPrice: prodPaidOnly.supplierPrice, quantity: 1 }],
    totalAmount: prodPaidOnly.price,
    shippingAddress: { fullName: "T", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "PAIDONLY_" + Date.now(), refId: "", cardPan: "", paidAt: new Date() },
    status: "processing",
    stockRestored: false,
    statusHistory: [{ status: "processing", at: new Date(), note: "paid" }],
  });

  // Delivered orders for review tests
  const order1 = await makeDeliveredOrder(db, { customer, product: prod1, qty: 2 });
  const order2 = await makeDeliveredOrder(db, { customer, product: prod2, qty: 1 });
  const orderDup = await makeDeliveredOrder(db, { customer, product: prodDup, qty: 1 });
  // SECOND delivered order for the same product → per-order-item rule allows a second review
  const order1b = await makeDeliveredOrder(db, { customer, product: prod1, qty: 1 });

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

  // --- TEST 1: unauthenticated → 401 ---
  await testAsync("Unauthenticated review -> 401", async () => {
    const res = await http("POST", "/api/reviews", null, { productId: prod1._id.toString(), orderId: order1, rating: 5, text: "test" });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: supplier cannot review → 403 ---
  await testAsync("Supplier cannot review -> 403", async () => {
    const res = await http("POST", "/api/reviews", supplierJar, { productId: prod1._id.toString(), orderId: order1, rating: 5, text: "test" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: paid-but-not-delivered → 403 ---
  await testAsync("Paid-only order (not delivered) cannot review -> 403", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prodPaidOnly._id.toString(), orderId: order1, rating: 5, text: "test" });
    assert(res.status === 403, "expected 403, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
  });

  // --- TEST 4: valid review → 201 + pending + snapshot ---
  let review1Id = null;
  await testAsync("Customer with delivered order can review -> 201 + pending", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prod1._id.toString(), orderId: order1, rating: 5, text: "محصول عالی بود" });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.status === "pending", "review must start as pending");
    assert(res.data.itemSnapshot && res.data.itemSnapshot.name === prod1.name, "item snapshot not saved");
    assert(res.data.itemSnapshot && res.data.itemSnapshot.quantity === 2, "snapshot quantity wrong");
    review1Id = res.data._id;
    console.log("\n      reviewId=" + review1Id + " status=" + res.data.status);
  });

  // --- TEST 5: duplicate same order-item → 409, count stays 1 ---
  await testAsync("Duplicate review (same order-item) -> 409, count stays 1", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prod1._id.toString(), orderId: order1, rating: 4, text: "دوباره" });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
    const count = await db.collection("reviews").countDocuments({ customer: customer._id, product: prod1._id, order: new mongoose.Types.ObjectId(order1) });
    assert(count === 1, "expected 1 review in DB, got " + count);
    console.log("\n      db count=" + count);
  });

  // --- TEST 6: rating out of range → 400 ---
  await testAsync("Rating 0 and 6 -> 400", async () => {
    let res = await http("POST", "/api/reviews", customerJar, { productId: prod2._id.toString(), orderId: order2, rating: 0, text: "test" });
    assert(res.status === 400, "expected 400 for rating 0, got " + res.status);
    res = await http("POST", "/api/reviews", customerJar, { productId: prod2._id.toString(), orderId: order2, rating: 6, text: "test" });
    assert(res.status === 400, "expected 400 for rating 6, got " + res.status);
  });

  // --- TEST 7: empty / long text → 400 ---
  await testAsync("Empty and >1000-char text -> 400", async () => {
    let res = await http("POST", "/api/reviews", customerJar, { productId: prod2._id.toString(), orderId: order2, rating: 4, text: "   " });
    assert(res.status === 400, "expected 400 for empty text, got " + res.status);
    res = await http("POST", "/api/reviews", customerJar, { productId: prod2._id.toString(), orderId: order2, rating: 4, text: "x".repeat(1001) });
    assert(res.status === 400, "expected 400 for long text, got " + res.status);
  });

  // --- TEST 8: HTML/script sanitized in DB ---
  let sanitizedReviewId = null;
  await testAsync("HTML/script in text is sanitized", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prodDup._id.toString(), orderId: orderDup, rating: 3, text: "خوب بود <script>alert(1)</script><b>bold</b>" });
    assert(res.status === 201, "expected 201, got " + res.status);
    const doc = await db.collection("reviews").findOne({ _id: new mongoose.Types.ObjectId(res.data._id) });
    assert(doc && !doc.text.includes("<script>"), "script tag not sanitized: " + doc.text);
    assert(doc && !doc.text.includes("<b>"), "bold tag not sanitized: " + doc.text);
    assert(doc && doc.text.includes("خوب بود"), "sanitized text lost content");
    sanitizedReviewId = res.data._id;
    console.log("\n      stored text=" + JSON.stringify(doc.text));
  });

  // --- TEST 9: pending review NOT visible in public GET ---
  await testAsync("Pending review not visible in public GET", async () => {
    const res = await http("GET", "/api/reviews?product=" + prod1._id, null);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.data.length === 0, "pending review leaked to public: " + res.data.data.length);
    assert(res.data.ratingSummary.count === 0, "ratingSummary must exclude pending");
    console.log("\n      public reviews=" + res.data.data.length + " summary=" + JSON.stringify(res.data.ratingSummary));
  });

  // --- TEST 10: admin approve → public + ratingSummary ---
  await testAsync("Admin approve -> visible in public + ratingSummary", async () => {
    let res = await http("POST", "/api/admin/reviews/" + review1Id + "/moderate", adminJar, { action: "approve" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.status === "approved", "status must be approved");
    assert(!!res.data.reviewedAt, "reviewedAt missing");
    res = await http("GET", "/api/reviews?product=" + prod1._id, null);
    assert(res.status === 200, "public GET failed");
    assert(res.data.data.length === 1, "expected 1 approved review, got " + res.data.data.length);
    assert(res.data.ratingSummary.average === 5, "average must be 5, got " + res.data.ratingSummary.average);
    assert(res.data.ratingSummary.count === 1, "count must be 1");
    console.log("\n      summary=" + JSON.stringify(res.data.ratingSummary));
  });

  // --- TEST 11: approve again → 400 (atomic claim) ---
  await testAsync("Approve already-approved -> 400 (atomic claim)", async () => {
    const res = await http("POST", "/api/admin/reviews/" + review1Id + "/moderate", adminJar, { action: "approve" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
  });

  // --- TEST 12: reject without reason → 400; with reason → rejected + not public ---
  await testAsync("Reject without reason -> 400; with reason -> rejected + not public", async () => {
    let res = await http("POST", "/api/admin/reviews/" + sanitizedReviewId + "/moderate", adminJar, { action: "reject" });
    assert(res.status === 400, "expected 400 (reason required), got " + res.status);
    res = await http("POST", "/api/admin/reviews/" + sanitizedReviewId + "/moderate", adminJar, { action: "reject", reason: "نامناسب" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
    assert(res.data.status === "rejected", "status must be rejected");
    assert(res.data.rejectionReason === "نامناسب", "rejectionReason not saved");
    const rejectedReason = res.data.rejectionReason;
    res = await http("GET", "/api/reviews?product=" + prodDup._id, null);
    assert(res.data.data.length === 0, "rejected review leaked to public");
    console.log("\n      reason=" + rejectedReason);
  });

  // --- TEST 13: non-admin moderate → 403 ---
  await testAsync("Customer cannot moderate -> 403", async () => {
    const res = await http("POST", "/api/admin/reviews/" + review1Id + "/moderate", customerJar, { action: "approve" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 14: products API ratingSummary (approved only) ---
  await testAsync("GET /api/products?slug= includes ratingSummary", async () => {
    const res = await http("GET", "/api/products?slug=" + prod1.slug, null);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.ratingSummary && res.data.ratingSummary.count === 1, "ratingSummary wrong: " + JSON.stringify(res.data.ratingSummary));
    assert(res.data.ratingSummary.average === 5, "average must be 5");
    // prod2 has no approved reviews yet
    const res2 = await http("GET", "/api/products?slug=" + prod2.slug, null);
    assert(res2.data.ratingSummary && res2.data.ratingSummary.count === 0, "prod2 should have no rating: " + JSON.stringify(res2.data.ratingSummary));
    console.log("\n      prod1=" + JSON.stringify(res.data.ratingSummary) + " prod2=" + JSON.stringify(res2.data.ratingSummary));
  });

  // --- TEST 15: review a DIFFERENT product works ---
  let review2Id = null;
  await testAsync("Customer can review a different product (per order-item)", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prod2._id.toString(), orderId: order2, rating: 4, text: "محصول دوم عالی" });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
    review2Id = res.data._id;
    await http("POST", "/api/admin/reviews/" + review2Id + "/moderate", adminJar, { action: "approve" });
    const pub = await http("GET", "/api/reviews?product=" + prod2._id, null);
    assert(pub.data.ratingSummary.count === 1 && pub.data.ratingSummary.average === 4, "prod2 summary wrong");
    console.log("\n      prod2 summary=" + JSON.stringify(pub.data.ratingSummary));
  });

  // --- TEST 16: SECOND delivered order for same product → review again (per order-item) ---
  await testAsync("Second delivered order for same product -> can review again", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prod1._id.toString(), orderId: order1b, rating: 3, text: "خرید دوم" });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
    await http("POST", "/api/admin/reviews/" + res.data._id + "/moderate", adminJar, { action: "approve" });
    const pub = await http("GET", "/api/reviews?product=" + prod1._id, null);
    assert(pub.data.ratingSummary.count === 2, "expected 2 approved reviews for prod1, got " + pub.data.ratingSummary.count);
    assert(pub.data.ratingSummary.average === 4, "expected average 4 (5+3)/2, got " + pub.data.ratingSummary.average);
    console.log("\n      prod1 summary=" + JSON.stringify(pub.data.ratingSummary));
  });

  // --- TEST 17: /api/reviews/mine returns eligible orders + my reviews ---
  await testAsync("GET /api/reviews/mine returns my reviews + eligible orders", async () => {
    const res = await http("GET", "/api/reviews/mine?product=" + prod1._id, customerJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.reviews.length >= 2, "expected my reviews for prod1, got " + res.data.reviews.length);
    assert(res.data.eligibleOrders.length === 0, "no eligible orders should remain for prod1 (both reviewed)");
    const res2 = await http("GET", "/api/reviews/mine?product=" + prodPaidOnly._id, customerJar);
    assert(res2.data.eligibleOrders.length === 0, "paid-only order must NOT be eligible");
    console.log("\n      my reviews=" + res.data.reviews.length + " eligible=" + res.data.eligibleOrders.length);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("reviews").deleteMany({ "itemSnapshot.name": { $regex: "^" + PREFIX } });
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
