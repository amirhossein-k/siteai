/**
 * Session 45 — Supplier Telegram Alerts (Payouts + New Reviews) Verification
 * (real HTTP API)
 *
 * Uses two independent suppliers + one customer so each flow has clean state:
 *   Supplier A — payout approve flow → payout_approved notification
 *   Supplier B — payout reject flow → payout_rejected notification
 *   Customer  — reviews a product of Supplier A's → new_review notification
 *
 * In-app notifications are the assertable source of truth (real Telegram
 * delivery needs a bot token + chat ID, which CI never has — the 
 * verify-notifications precedent). The fixtures DO set a bogus telegramChatId,
 * so the telegram callback is wired and fires, its failure is swallowed
 * (fail-silent), and sentToTelegram stays false.
 *
 * Tests:
 *   1. Unauthenticated admin payout approve → 401
 *   2. Supplier cannot approve (admin API) → 403
 *   3. Supplier A requests payout → reserve incremented, balance unchanged
 *   4. Admin approves A → 200; A gets in-app payout_approved (category payout,
 *      link /supplier/wallet, notificationKey payout_<txn>_approved)
 *   5. Re-approving A → 400 (atomic claim); payout_approved count stays 1
 *   6. Supplier B requests payout; admin rejects WITHOUT reason → 400
 *   7. Admin rejects B WITH reason → 200; B gets in-app payout_rejected
 *      (message includes the reason)
 *   8. Telegram fail-silent: payout_approved carries sentToTelegram=false
 *      (callback fired against a bogus chatId, failed, never failed the op)
 *   9. Cross-user isolation: customer's inbox has NO payout notification
 *  10. Customer reviews Supplier A's product (delivered order) → 201; A gets
 *      in-app new_review (category system, link /supplier/reviews)
 *  11. Duplicate review (same order-item) → 409; new_review count stays 1
 *  12. Cross-supplier isolation: B's inbox has no new_review from A's product
 *
 * Usage: node scripts/verify-telegram-alerts.js
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
const PREFIX = "tgalert_" + Date.now() + "_";
const PASS = "tgalert-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_A_PHONE = "09174441001";
const SUPPLIER_B_PHONE = "09174441002";
const CUSTOMER_PHONE = "09174441003";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

/** Poll until fn() returns truthy or timeout (for fire-and-forget emissions). */
async function waitFor(fn, timeoutMs = 5000, intervalMs = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

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
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    businessName: String,
    contactPhone: String,
    bankAccount: { cardNumber: String, iban: String, ownerName: String },
    balance: Number,
    pendingReserve: Number,
    telegramChatId: String,
    isActive: Boolean,
  },
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

/** Delivered + paid order granting review eligibility (verify-reviews shape). */
async function makeDeliveredOrder(db, { customer, product, qty = 1 }) {
  const res = await db.collection("orders").insertOne({
    customer: customer._id,
    items: [{
      product: product._id,
      supplier: new mongoose.Types.ObjectId(String(product.supplier)),
      variantId: null, sku: "", variantLabel: "", image: product.images?.[0] || "",
      name: product.name,
      price: product.price,
      supplierPrice: product.supplierPrice,
      quantity: qty,
    }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "TgAlert Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "TGPAID_" + Date.now(), refId: "TGREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
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
  console.log("  SESSION 45 — SUPPLIER TELEGRAM ALERTS (REAL HTTP API)");
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
  const User = mongoose.models.User_TGALERT || mongoose.model("User_TGALERT", UserSchema);
  const Supplier = mongoose.models.Supplier_TGALERT || mongoose.model("Supplier_TGALERT", SupplierSchema);
  const Category = mongoose.models.Category_TGALERT || mongoose.model("Category_TGALERT", CategorySchema);
  const Product = mongoose.models.Product_TGALERT || mongoose.model("Product_TGALERT", ProductSchema);

  // --- Idempotency sweep ---
  // Notifications are created by notifyOrderEvent() with metadata: {} — they
  // carry no run marker, so clean up by fixture recipient ids (found via the
  // fixture phone numbers) before deleting the users themselves.
  const staleUsers = await User.find({ phone: { $in: [SUPPLIER_A_PHONE, SUPPLIER_B_PHONE, CUSTOMER_PHONE] } }).select("_id").lean();
  const staleUserIds = staleUsers.map((u) => u._id);
  if (staleUserIds.length > 0) {
    await db.collection("notifications").deleteMany({ recipient: { $in: staleUserIds } });
  }
  await db.collection("transactions").deleteMany({ note: { $regex: "^" + PREFIX } });
  await db.collection("reviews").deleteMany({ "itemSnapshot.name": { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_A_PHONE, SUPPLIER_B_PHONE, CUSTOMER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^TgAlertTest" } });

  // --- Fixtures ---
  const mkSupplier = async (name, phone) => {
    const user = await User.create({ name, phone, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
    const doc = await Supplier.create({
      user: user._id,
      businessName: "TgAlertTest " + name,
      contactPhone: phone,
      bankAccount: { cardNumber: "6037991234567890", iban: "IR123456789012345678901234", ownerName: name },
      balance: 100000,
      pendingReserve: 0,
      // Bogus chatId: wires the telegram callback so the fail-silent path is
      // exercised, but real delivery can never succeed in CI → sentToTelegram
      // stays false (the in-app record is the assertable source of truth).
      telegramChatId: "tg-test-" + PREFIX + phone.slice(-4),
      isActive: true,
    });
    await User.findByIdAndUpdate(user._id, { $set: { supplier: doc._id } });
    return { user, doc };
  };

  const supplierA = await mkSupplier("Supplier A", SUPPLIER_A_PHONE);
  const supplierB = await mkSupplier("Supplier B", SUPPLIER_B_PHONE);
  const customer = await User.create({ name: "TgAlert Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });

  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });
  const prodA = await Product.create({ name: PREFIX + "prod-a", slug: PREFIX + "prod-a", description: "tgalert product A", images: ["https://example.com/a.jpg"], category: catDoc._id, supplier: supplierA.doc._id, price: 20000, supplierPrice: 9000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const orderA = await makeDeliveredOrder(db, { customer, product: prodA, qty: 1 });

  let adminJar = null;
  let aJar = null;
  let bJar = null;
  let customerJar = null;

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

  // --- TEST 1: unauthenticated approve → 401 ---
  await testAsync("Unauthenticated admin payout approve -> 401", async () => {
    const res = await http("POST", "/api/admin/payouts", null, { transactionId: "000000000000000000000000", action: "approve" });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: supplier cannot approve → 403 ---
  await testAsync("Supplier cannot approve payout (admin API) -> 403", async () => {
    const res = await http("POST", "/api/admin/payouts", aJar, { transactionId: "000000000000000000000000", action: "approve" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: request payout A → reserve incremented, balance unchanged ---
  let txnA = null;
  await testAsync("Supplier A requests payout -> reserve incremented, balance UNCHANGED", async () => {
    const res = await http("POST", "/api/supplier/wallet", aJar, { amount: 40000, note: PREFIX + "req-a" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.pendingReserve === 40000, "pendingReserve must be 40000, got " + res.data.pendingReserve);
    assert(res.data.availableBalance === 60000, "availableBalance must be 60000, got " + res.data.availableBalance);
    const tx = await db.collection("transactions").findOne({ note: PREFIX + "req-a" });
    assert(tx && tx.status === "pending", "request must be pending");
    txnA = String(tx._id);
    console.log("\n      txnA=" + txnA);
  });

  // --- TEST 4: admin approve → 200 + supplier A gets payout_approved ---
  await testAsync("Admin approves -> 200; supplier A gets payout_approved in-app", async () => {
    const res = await http("POST", "/api/admin/payouts", adminJar, { transactionId: txnA, action: "approve" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "approved", "status must be approved");

    const notif = await waitFor(async () => {
      const list = await http("GET", "/api/notifications?limit=50", aJar);
      if (list.status !== 200) return null;
      const found = (list.data.data || []).find(
        (n) => n.type === "payout_approved" && n.notificationKey === "payout_" + txnA + "_approved"
      );
      return found || null;
    });
    assert(notif, "payout_approved notification not found for supplier A");
    assert(notif.category === "payout", "category must be payout, got " + notif.category);
    assert(notif.link === "/supplier/wallet", "link must be /supplier/wallet, got " + notif.link);
    assert(typeof notif.message === "string" && notif.message.length > 0, "message missing");
    console.log("\n      notif: " + notif.type + " | " + notif.message);
  });

  // --- TEST 5: re-approve → 400; payout_approved count stays 1 ---
  await testAsync("Re-approving A -> 400 (atomic claim); payout_approved count stays 1", async () => {
    const res = await http("POST", "/api/admin/payouts", adminJar, { transactionId: txnA, action: "approve" });
    assert(res.status === 400, "expected 400, got " + res.status);
    const count = await db.collection("notifications").countDocuments({
      type: "payout_approved",
      notificationKey: "payout_" + txnA + "_approved",
    });
    assert(count === 1, "expected 1 payout_approved in DB, got " + count);
    console.log("\n      db count=" + count);
  });

  // --- TEST 6: reject WITHOUT reason → 400 ---
  let txnB = null;
  await testAsync("Supplier B requests payout; admin reject WITHOUT reason -> 400", async () => {
    const req = await http("POST", "/api/supplier/wallet", bJar, { amount: 25000, note: PREFIX + "req-b" });
    assert(req.status === 200, "request failed: " + req.status);
    const tx = await db.collection("transactions").findOne({ note: PREFIX + "req-b" });
    txnB = String(tx._id);
    const res = await http("POST", "/api/admin/payouts", adminJar, { transactionId: txnB, action: "reject" });
    assert(res.status === 400, "expected 400 (reason required), got " + res.status);
    console.log("\n      txnB=" + txnB);
  });

  // --- TEST 7: reject WITH reason → 200 + supplier B gets payout_rejected ---
  await testAsync("Admin rejects B WITH reason -> 200; supplier B gets payout_rejected", async () => {
    const res = await http("POST", "/api/admin/payouts", adminJar, { transactionId: txnB, action: "reject", reason: "مدارک ناقص" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "rejected", "status must be rejected");

    const notif = await waitFor(async () => {
      const list = await http("GET", "/api/notifications?limit=50", bJar);
      if (list.status !== 200) return null;
      const found = (list.data.data || []).find(
        (n) => n.type === "payout_rejected" && n.notificationKey === "payout_" + txnB + "_rejected"
      );
      return found || null;
    });
    assert(notif, "payout_rejected notification not found for supplier B");
    assert(notif.category === "payout", "category must be payout, got " + notif.category);
    assert(notif.link === "/supplier/wallet", "link must be /supplier/wallet, got " + notif.link);
    assert(notif.message.includes("مدارک ناقص"), "rejection reason missing from message: " + notif.message);
    console.log("\n      notif: " + notif.type + " | " + notif.message);
  });

  // --- TEST 8: Telegram fail-silent — sentToTelegram stays false, op succeeded ---
  await testAsync("Telegram fail-silent: payout_approved has sentToTelegram=false (callback failed, op succeeded)", async () => {
    const doc = await db.collection("notifications").findOne({ notificationKey: "payout_" + txnA + "_approved" });
    assert(doc, "payout_approved doc missing");
    assert(doc.sentToTelegram === false, "sentToTelegram must be false (bogus chatId), got " + doc.sentToTelegram);
    const supp = await db.collection("suppliers").findOne({ _id: supplierA.doc._id });
    assert(supp.balance === 60000 && supp.pendingReserve === 0, "payout must have committed despite telegram failure");
    console.log("\n      sentToTelegram=" + doc.sentToTelegram + " balance=" + supp.balance + " reserve=" + supp.pendingReserve);
  });

  // --- TEST 9: cross-user isolation — customer sees no payout notification ---
  await testAsync("Cross-user isolation: customer inbox has NO payout notification", async () => {
    const list = await http("GET", "/api/notifications?limit=50", customerJar);
    assert(list.status === 200, "expected 200, got " + list.status);
    const payouts = (list.data.data || []).filter((n) => n.category === "payout");
    assert(payouts.length === 0, "customer must not see payout notifications, got " + payouts.length);
  });

  // --- TEST 10: customer reviews supplier A's product → 201 + A gets new_review ---
  await testAsync("Customer reviews A's product -> 201; A gets new_review in-app", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prodA._id.toString(), orderId: orderA, rating: 5, text: "محصول عالی بود" });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const reviewId = res.data._id;

    const notif = await waitFor(async () => {
      const list = await http("GET", "/api/notifications?limit=50", aJar);
      if (list.status !== 200) return null;
      const found = (list.data.data || []).find(
        (n) => n.type === "new_review" && n.notificationKey === "new_review_" + reviewId
      );
      return found || null;
    });
    assert(notif, "new_review notification not found for supplier A");
    assert(notif.category === "system", "category must be system, got " + notif.category);
    assert(notif.link === "/supplier/reviews", "link must be /supplier/reviews, got " + notif.link);
    assert(notif.message.includes(prodA.name), "message must mention product: " + notif.message);
    console.log("\n      notif: " + notif.type + " | " + notif.message);
  });

  // --- TEST 11: duplicate review → 409; new_review count stays 1 ---
  await testAsync("Duplicate review (same order-item) -> 409; new_review count stays 1", async () => {
    const res = await http("POST", "/api/reviews", customerJar, { productId: prodA._id.toString(), orderId: orderA, rating: 4, text: "دوباره" });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
    const count = await db.collection("notifications").countDocuments({
      type: "new_review",
      recipient: supplierA.user._id,
    });
    assert(count === 1, "expected 1 new_review for supplier A in DB, got " + count);
    console.log("\n      db count=" + count);
  });

  // --- TEST 12: cross-supplier isolation — B has no new_review from A's product ---
  await testAsync("Cross-supplier isolation: B's inbox has NO new_review", async () => {
    const list = await http("GET", "/api/notifications?limit=50", bJar);
    assert(list.status === 200, "expected 200, got " + list.status);
    const newReviews = (list.data.data || []).filter((n) => n.type === "new_review");
    assert(newReviews.length === 0, "supplier B must not see A's new_review, got " + newReviews.length);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("transactions").deleteMany({ note: { $regex: "^" + PREFIX } });
  // Notifications carry no run marker (notifyOrderEvent always writes
  // metadata: {}) — delete by fixture recipient ids before removing the users.
  await db.collection("notifications").deleteMany({
    recipient: { $in: [supplierA.user._id, supplierB.user._id, customer._id] },
  });
  await db.collection("reviews").deleteMany({ "itemSnapshot.name": { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: { $in: [supplierA.doc._id, supplierB.doc._id] } });
  await User.deleteMany({ _id: { $in: [supplierA.user._id, supplierB.user._id, customer._id] } });
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
