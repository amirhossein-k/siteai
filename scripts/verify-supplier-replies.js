/**
 * Session 37 — Supplier Review Replies Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated GET /api/supplier/reviews → 401
 *   2. Customer GET /api/supplier/reviews → 403
 *   3. Admin POST reply → 403 (only suppliers can reply)
 *   4. Fresh supplier queue → empty paginated shape
 *   5. Supplier reply on approved review → 200 + reply {author,text,at}
 *   6. Reply on pending review → 400
 *   7. Reply on rejected review → 400
 *   8. Cross-supplier reply → 404 (not the reviewer's product)
 *   9. Customer cannot reply → 403
 *  10. Double-reply → 400 (atomic claim, one reply per review)
 *  11. Empty reply text → 400
 *  12. Over-1000-char reply → 400
 *  13. HTML/script reply sanitized in DB
 *  14. Public GET /api/reviews includes the reply (backward compatible)
 *  15. review_replied notification created for the review author
 *  16. Supplier queue status filter + pagination shape
 *
 * Usage: node scripts/verify-supplier-replies.js
 * Requires: dev server on http://localhost:3000, real DB, seeded admin.
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
const PREFIX = "reply_" + Date.now() + "_";
const PASS = "reply-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157774001";
const SUPPLIER_A_PHONE = "09157774002";
const SUPPLIER_B_PHONE = "09157774003";

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
const ReviewSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    itemSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    rating: Number,
    text: String,
    status: String,
    reply: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "reviews" }
);

/** Delivered + paid order fixture (satisfies the verified-purchase gate). */
async function makeDeliveredOrder(db, { customer, product, qty }) {
  return db.collection("orders").insertOne({
    customer: customer._id,
    items: [{ product: product._id, supplier: product.supplier, variantId: null, name: product.name, price: product.price, supplierPrice: product.supplierPrice, quantity: qty }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "Reply Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "REPLYPAID_" + Date.now(), refId: "REPLYREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status: "delivered",
    stockRestored: false,
    statusHistory: [{ status: "delivered", at: new Date(), note: "paid + delivered" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 37 — SUPPLIER REVIEW REPLIES (REAL HTTP API)");
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
  const User = mongoose.models.User_REPLY || mongoose.model("User_REPLY", UserSchema);
  const Supplier = mongoose.models.Supplier_REPLY || mongoose.model("Supplier_REPLY", SupplierSchema);
  const Category = mongoose.models.Category_REPLY || mongoose.model("Category_REPLY", CategorySchema);
  const Product = mongoose.models.Product_REPLY || mongoose.model("Product_REPLY", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("reviews").deleteMany({ "itemSnapshot.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, SUPPLIER_A_PHONE, SUPPLIER_B_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^ReplyTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "Reply Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppAUser = await User.create({ name: "Reply Supplier A", phone: SUPPLIER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppBUser = await User.create({ name: "Reply Supplier B", phone: SUPPLIER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppADoc = await Supplier.create({ user: suppAUser._id, businessName: "ReplyTest Supplier A", contactPhone: SUPPLIER_A_PHONE, isActive: true });
  const suppBDoc = await Supplier.create({ user: suppBUser._id, businessName: "ReplyTest Supplier B", contactPhone: SUPPLIER_B_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppAUser._id, { $set: { supplier: suppADoc._id } });
  await User.findByIdAndUpdate(suppBUser._id, { $set: { supplier: suppBDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const makeProduct = (slugSuffix, supplier, price = 10000) =>
    Product.create({
      name: PREFIX + slugSuffix, slug: PREFIX + slugSuffix, description: "reply test",
      category: catDoc._id, supplier: supplier._id, price, supplierPrice: price / 2,
      stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
    });

  const prodA = await makeProduct("prod-a", suppADoc);
  const prodB = await makeProduct("prod-b", suppBDoc);
  const prodPending = await makeProduct("prod-pending", suppADoc);
  const prodRejected = await makeProduct("prod-rejected", suppADoc);

  let adminJar, aJar, bJar, customerJar;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier A login", async () => {
    aJar = await login(SUPPLIER_A_PHONE, PASS);
    assert(aJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier B login", async () => {
    bJar = await login(SUPPLIER_B_PHONE, PASS);
    assert(bJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: unauth queue → 401 ---
  await testAsync("Unauthenticated GET /api/supplier/reviews -> 401", async () => {
    const res = await http("GET", "/api/supplier/reviews", null);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: customer cannot read the queue → 403 ---
  await testAsync("Customer GET supplier reviews -> 403", async () => {
    const res = await http("GET", "/api/supplier/reviews", customerJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: admin cannot reply → 403 ---
  await testAsync("Admin POST reply -> 403", async () => {
    const res = await http("POST", "/api/supplier/reviews/" + new mongoose.Types.ObjectId() + "/reply", adminJar, { text: "hi" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: fresh supplier queue → empty paginated shape ---
  await testAsync("Fresh supplier A queue -> empty paginated", async () => {
    const res = await http("GET", "/api/supplier/reviews", aJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data.data) && res.data.data.length === 0, "expected empty data");
    assert(typeof res.data.total === "number" && res.data.totalPages >= 0, "pagination shape missing");
  });

  // --- Create the main review through the REAL API (delivered order → POST → admin approve) ---
  let mainReviewId = null;

  await testAsync("Create review via real API (delivered order) + admin approve", async () => {
    const inserted = await makeDeliveredOrder(db, { customer, product: prodA, qty: 1 });
    const orderId = inserted.insertedId.toString();

    const create = await http("POST", "/api/reviews", customerJar, {
      productId: prodA._id.toString(),
      orderId,
      rating: 5,
      text: "محصول عالی بود " + PREFIX,
    });
    assert(create.status === 201, "review create expected 201, got " + create.status + " " + JSON.stringify(create.data).slice(0, 150));
    mainReviewId = create.data._id;
    assert(create.data.supplier === prodA.supplier.toString(), "review.supplier must be denormalized from product");
    assert(create.data.status === "pending", "must start pending");

    const approve = await http("POST", "/api/admin/reviews/" + mainReviewId + "/moderate", adminJar, { action: "approve" });
    assert(approve.status === 200, "approve expected 200, got " + approve.status);
    assert(approve.data.status === "approved", "must be approved");
  });

  // --- TEST 5: supplier A replies to own approved review → 200 ---
  let replyText = "ممنون از خرید شما " + PREFIX;
  await testAsync("Supplier A reply on approved review -> 200 + reply saved", async () => {
    assert(!!mainReviewId, "missing review id");
    const res = await http("POST", "/api/supplier/reviews/" + mainReviewId + "/reply", aJar, { text: replyText });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(!!res.data.reply, "reply must be set on response");
    assert(res.data.reply.text === replyText, "reply text mismatch");
    assert(!!res.data.reply.at, "reply.at must be set");
    assert(!!res.data.reply.author && (res.data.reply.author.name || res.data.reply.author._id), "reply.author missing");
  });

  // --- TEST 10: double reply → 400 (atomic claim) ---
  await testAsync("Double-reply blocked -> 400 (atomic claim)", async () => {
    assert(!!mainReviewId, "missing review id");
    const res = await http("POST", "/api/supplier/reviews/" + mainReviewId + "/reply", aJar, { text: "دوباره" });
    assert(res.status === 400, "expected 400, got " + res.status);
    const dbDoc = await db.collection("reviews").findOne({ _id: new mongoose.Types.ObjectId(mainReviewId) });
    assert(dbDoc.reply && dbDoc.reply.text === replyText, "original reply must be preserved");
  });

  // --- TEST 6: reply on pending review → 400 ---
  await testAsync("Reply on pending review -> 400", async () => {
    const inserted = await makeDeliveredOrder(db, { customer, product: prodPending, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const create = await http("POST", "/api/reviews", customerJar, {
      productId: prodPending._id.toString(),
      orderId,
      rating: 3,
      text: "در انتظار " + PREFIX,
    });
    assert(create.status === 201, "create expected 201, got " + create.status);
    const res = await http("POST", "/api/supplier/reviews/" + create.data._id + "/reply", aJar, { text: "پاسخ" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
  });

  // --- TEST 7: reply on rejected review → 400 ---
  await testAsync("Reply on rejected review -> 400", async () => {
    const inserted = await makeDeliveredOrder(db, { customer, product: prodRejected, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const create = await http("POST", "/api/reviews", customerJar, {
      productId: prodRejected._id.toString(),
      orderId,
      rating: 1,
      text: "رد شده " + PREFIX,
    });
    assert(create.status === 201, "create expected 201, got " + create.status);
    const reject = await http("POST", "/api/admin/reviews/" + create.data._id + "/moderate", adminJar, { action: "reject", reason: "نامناسب" });
    assert(reject.status === 200, "reject expected 200, got " + reject.status);
    const res = await http("POST", "/api/supplier/reviews/" + create.data._id + "/reply", aJar, { text: "پاسخ" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
  });

  // --- TEST 8: cross-supplier reply → 404 ---
  await testAsync("Cross-supplier reply (B on A's product review) -> 404", async () => {
    assert(!!mainReviewId, "missing review id");
    const res = await http("POST", "/api/supplier/reviews/" + mainReviewId + "/reply", bJar, { text: "من مال تو نیستم" });
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  // --- TEST 9: customer cannot reply → 403 ---
  await testAsync("Customer POST reply -> 403", async () => {
    assert(!!mainReviewId, "missing review id");
    const res = await http("POST", "/api/supplier/reviews/" + mainReviewId + "/reply", customerJar, { text: "spam" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 11: empty reply → 400 ---
  await testAsync("Empty reply text -> 400", async () => {
    const inserted = await makeDeliveredOrder(db, { customer, product: prodB, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const create = await http("POST", "/api/reviews", customerJar, {
      productId: prodB._id.toString(),
      orderId,
      rating: 4,
      text: "برای تست خالی " + PREFIX,
    });
    assert(create.status === 201, "create expected 201, got " + create.status);
    const approve = await http("POST", "/api/admin/reviews/" + create.data._id + "/moderate", adminJar, { action: "approve" });
    assert(approve.status === 200, "approve expected 200, got " + approve.status);
    const res = await http("POST", "/api/supplier/reviews/" + create.data._id + "/reply", bJar, { text: "   " });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 12: over-1000 reply → 400 ---
  await testAsync("Over-1000-char reply -> 400", async () => {
    assert(!!mainReviewId, "missing review id");
    const longText = "x".repeat(1001);
    // Need an unreplied approved review for supplier A — create a fresh one
    const inserted = await makeDeliveredOrder(db, { customer, product: prodPending, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const create = await http("POST", "/api/reviews", customerJar, {
      productId: prodPending._id.toString(),
      orderId,
      rating: 5,
      text: "برای طولانی " + PREFIX,
    });
    assert(create.status === 201, "create expected 201, got " + create.status);
    const approve = await http("POST", "/api/admin/reviews/" + create.data._id + "/moderate", adminJar, { action: "approve" });
    assert(approve.status === 200, "approve expected 200, got " + approve.status);
    const res = await http("POST", "/api/supplier/reviews/" + create.data._id + "/reply", aJar, { text: longText });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 13: HTML sanitized in reply ---
  await testAsync("HTML/script reply sanitized in DB", async () => {
    assert(!!mainReviewId, "missing review id");
    // mainReviewId is already replied → use the over-1000 review id (approved, unreplied)
    const inserted = await makeDeliveredOrder(db, { customer, product: prodPending, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const create = await http("POST", "/api/reviews", customerJar, {
      productId: prodPending._id.toString(),
      orderId,
      rating: 5,
      text: "برای سانی‌تایز " + PREFIX,
    });
    assert(create.status === 201, "create expected 201, got " + create.status);
    const approve = await http("POST", "/api/admin/reviews/" + create.data._id + "/moderate", adminJar, { action: "approve" });
    assert(approve.status === 200, "approve expected 200, got " + approve.status);
    const res = await http("POST", "/api/supplier/reviews/" + create.data._id + "/reply", aJar, { text: "<script>alert(1)</script>متن امن" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const dbDoc = await db.collection("reviews").findOne({ _id: new mongoose.Types.ObjectId(create.data._id) });
    assert(!/<script/i.test(dbDoc.reply.text), "script tag must be stripped, got: " + dbDoc.reply.text);
    assert(dbDoc.reply.text.includes("متن امن"), "safe text must be preserved");
  });

  // --- TEST 14: public API includes reply ---
  await testAsync("Public GET /api/reviews includes supplier reply", async () => {
    assert(!!mainReviewId, "missing review id");
    const res = await http("GET", "/api/reviews?product=" + prodA._id.toString(), null);
    assert(res.status === 200, "expected 200, got " + res.status);
    const review = (res.data.data || []).find((r) => r._id === mainReviewId);
    assert(!!review, "approved review must be public");
    assert(review.reply && review.reply.text === replyText, "public reply missing or wrong");
  });

  // --- TEST 15: review_replied notification for the author ---
  await testAsync("review_replied notification created for review author", async () => {
    assert(!!mainReviewId, "missing review id");
    const inbox = await http("GET", "/api/notifications", customerJar);
    const notif = (inbox.data.data || []).find(
      (n) => n.type === "review_replied" && n.notificationKey === "review_" + mainReviewId + "_review_replied"
    );
    assert(!!notif, "review_replied notification missing");
    assert(notif.category === "order", "category must be order");
    assert((notif.link || "").startsWith("/products/"), "link must deep-link to product: " + notif.link);
    console.log("\n      key=" + notif.notificationKey);
  });

  // --- TEST 16: supplier queue status filter + pagination shape ---
  await testAsync("Supplier queue status filter + pagination shape", async () => {
    const all = await http("GET", "/api/supplier/reviews?page=1&limit=10", aJar);
    assert(all.status === 200, "expected 200, got " + all.status);
    assert(all.data.data.some((r) => r._id === mainReviewId), "replied review must appear in supplier A queue");
    const approved = await http("GET", "/api/supplier/reviews?status=approved", aJar);
    assert((approved.data.data || []).every((r) => r.status === "approved"), "status filter leaked");
    assert(approved.data.totalPages >= 1 && typeof approved.data.hasNextPage === "boolean", "pagination shape");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("reviews").deleteMany({ "itemSnapshot.name": { $regex: "^" + PREFIX } });
  await db.collection("notifications").deleteMany({ recipient: customer._id });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: { $in: [suppADoc._id, suppBDoc._id] } });
  await User.deleteMany({ _id: { $in: [customer._id, suppAUser._id, suppBUser._id] } });
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
