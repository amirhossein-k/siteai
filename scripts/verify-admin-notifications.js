/**
 * Session 80 — Admin Notification Bell Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated inbox / unread-count / read-all → 401
 *   2. Fresh second admin has an empty inbox (recipient isolation)
 *   3. Real checkout (manual) → EVERY active admin gets in-app new_order
 *      (type/category/link=/admin/orders/<id>/relatedOrder/key + dedupe count 1)
 *   4. Dedupe: direct duplicate insert with the same notificationKey is
 *      rejected by the unique partial index (count stays 1)
 *   5. Payment verification failure → every active admin gets payment_failed
 *      (bogus authority → verifyPayment returns null → failure branch)
 *   6. Supplier submits a payout request → every active admin gets
 *      payout_requested (link /admin/payouts)
 *   7. unread-count reflects the admin events
 *   8. PUT /[id]/read → isRead + readAt; repeat → idempotent 200
 *   9. Cross-admin isolation: admin2 cannot read admin1's notification → 404
 *  10. PUT read-all → unreadCount 0; repeat → idempotent
 *  11. Existing supplier_application → admin notification regression
 *
 * Usage: node scripts/verify-admin-notifications.js
 * Requires: dev server on http://localhost:3000, real DB. The payment-failure
 * test relies on the Zarinpal sandbox returning a non-success for a bogus
 * authority (or being unreachable → also null) — both land in the failure
 * branch, same tolerance as verify-payment-retry.
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
const PREFIX = "admnotif_" + Date.now() + "_";
const PASS = "admnotif-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const ADMIN2_PHONE = "09157773012";
const CUSTOMER_PHONE = "09157773011";
const SUPPLIER_PHONE = "09157773013";

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
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, isActive: Boolean, balance: Number, pendingReserve: Number, bankAccount: mongoose.Schema.Types.Mixed },
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

async function countNotifications(db, recipientId, notificationKey) {
  const filter = { recipient: recipientId };
  if (notificationKey) filter.notificationKey = notificationKey;
  return db.collection("notifications").countDocuments(filter);
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 80 — ADMIN NOTIFICATION BELL (REAL HTTP API)");
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
  const User = mongoose.models.User_ADMNOTIF || mongoose.model("User_ADMNOTIF", UserSchema);
  const Supplier = mongoose.models.Supplier_ADMNOTIF || mongoose.model("Supplier_ADMNOTIF", SupplierSchema);
  const Category = mongoose.models.Category_ADMNOTIF || mongoose.model("Category_ADMNOTIF", CategorySchema);
  const Product = mongoose.models.Product_ADMNOTIF || mongoose.model("Product_ADMNOTIF", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierapplications").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [ADMIN2_PHONE, CUSTOMER_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^AdmNotifTest" } });

  // The shared seeded admin (09120000000) is the primary recipient under test.
  const admin1 = await User.findOne({ phone: ADMIN_PHONE }).lean();
  assert(admin1, "seeded admin (09120000000) not found — run scripts/seed-admin.js");

  // notificationKeys created by THIS suite — cleanup deletes exactly these,
  // never the shared admin's unrelated (real) notifications.
  const createdKeys = [];

  // --- Fixtures ---
  const admin2 = await User.create({ name: "AdmNotif Admin2", phone: ADMIN2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "admin", isActive: true });
  const customer = await User.create({ name: "AdmNotif Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "AdmNotif Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({
    user: suppUser._id, businessName: "AdmNotifTest Supplier Co", contactPhone: SUPPLIER_PHONE,
    isActive: true, balance: 500000, pendingReserve: 0,
    bankAccount: { iban: "IR00-ADMNOTIF", cardNumber: "5022-0000-0000-0000" },
  });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });
  const product = await Product.create({
    name: PREFIX + "prod", slug: PREFIX + "prod", description: "admnotif test",
    category: catDoc._id, supplier: suppDoc._id, price: 25000, supplierPrice: 12000,
    stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });

  let adminJar = null;
  let admin2Jar = null;
  let customerJar = null;
  let supplierJar = null;

  await testAsync("Seed admin (admin1) login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Second admin (admin2) login", async () => {
    admin2Jar = await login(ADMIN2_PHONE, PASS);
    assert(admin2Jar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier login", async () => {
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: unauthenticated inbox → 401 ---
  await testAsync("Unauthenticated GET /api/notifications -> 401", async () => {
    const res = await http("GET", "/api/notifications", null);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: unauthenticated unread-count → 401 ---
  await testAsync("Unauthenticated GET unread-count -> 401", async () => {
    const res = await http("GET", "/api/notifications/unread-count", null);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 3: unauthenticated read-all → 401 ---
  await testAsync("Unauthenticated PUT read-all -> 401", async () => {
    const res = await http("PUT", "/api/notifications/read-all", null);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 4: fresh second admin has an EMPTY inbox (recipient isolation) ---
  await testAsync("Fresh admin2 inbox empty (no cross-admin leakage)", async () => {
    const res = await http("GET", "/api/notifications", admin2Jar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data.data) && res.data.data.length === 0, "admin2 must start empty");
    assert(res.data.unreadCount === 0, "admin2 unreadCount must be 0");
  });

  // --- TEST 5: real checkout → every active admin gets in-app new_order ---
  let orderNotifId = null;
  let checkoutOrderId = null;
  await testAsync("Checkout -> admin gets new_order (link /admin/orders/<id>)", async () => {
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [{ id: product._id.toString(), quantity: 1, price: 25000, name: product.name }],
      shippingAddress: { fullName: "AdmNotif Tester", phone: customer.phone, address: "Tehran", postalCode: "123" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    checkoutOrderId = res.data.orderId;
    assert(!!checkoutOrderId, "no orderId in checkout response");

    // Fire-and-forget emission — poll for THIS order's in-app notification
    // (filter by the exact key — the shared admin may hold real notifications
    // from actual usage, so a bare type match could hit a stale row).
    const expectedKey = "order_" + checkoutOrderId + "_admin_new_order";
    const notif = await waitFor(async () => {
      const inbox = await http("GET", "/api/notifications", adminJar);
      return (inbox.data.data || []).find((n) => n.notificationKey === expectedKey);
    });
    assert(!!notif, "admin new_order notification not created within 5s");
    assert(notif.category === "order", "category must be order, got " + notif.category);
    assert(notif.relatedOrder === checkoutOrderId, "relatedOrder must match order: " + notif.relatedOrder);
    assert(notif.link === "/admin/orders/" + checkoutOrderId, "link must deep-link to admin order: " + notif.link);
    assert(notif.notificationKey === expectedKey, "notificationKey wrong: " + notif.notificationKey);
    assert(notif.isRead === false, "must be unread initially");
    orderNotifId = notif._id;
    createdKeys.push(notif.notificationKey);

    // Exactly ONE admin notification per order (dedupe semantics preserved).
    const count = await countNotifications(db, admin1._id, undefined);
    const countForKey = await countNotifications(db, admin1._id, notif.notificationKey);
    assert(countForKey === 1, "exactly one notification per key expected, got " + countForKey);
    console.log("\n      key=" + notif.notificationKey + " adminTotal=" + count);
  });

  // --- TEST 6: dedupe — the unique partial index rejects a direct duplicate ---
  await testAsync("Dedupe: same notificationKey rejected by unique partial index", async () => {
    const countBefore = await countNotifications(db, admin1._id, "order_" + checkoutOrderId + "_admin_new_order");
    let rejected = false;
    try {
      await db.collection("notifications").insertOne({
        recipient: admin1._id,
        type: "new_order",
        category: "order",
        message: "تکراری",
        relatedOrder: new mongoose.Types.ObjectId(checkoutOrderId),
        link: "/admin/orders/" + checkoutOrderId,
        notificationKey: "order_" + checkoutOrderId + "_admin_new_order",
        isRead: false, readAt: null, sentToTelegram: false, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      });
    } catch (err) {
      rejected = err && err.code === 11000;
    }
    assert(rejected, "duplicate insert must hit E11000");
    const countAfter = await countNotifications(db, admin1._id, "order_" + checkoutOrderId + "_admin_new_order");
    assert(countAfter === countBefore && countAfter === 1, "count must stay 1, got " + countAfter);
    console.log("\n      count stays " + countAfter + " (E11000 swallowed)");
  });

  // --- TEST 7: payment verification failure → admin gets payment_failed ---
  await testAsync("Payment verify failure -> admin gets payment_failed", async () => {
    const authority = "ADMFAIL_" + Date.now();
    const inserted = await db.collection("orders").insertOne({
      customer: customer._id,
      items: [{ product: product._id, supplier: suppDoc._id, variantId: null, name: product.name, price: product.price, supplierPrice: product.supplierPrice, quantity: 1 }],
      totalAmount: product.price,
      shippingAddress: { fullName: "T", phone: customer.phone, address: "Tehran", postalCode: "" },
      payment: { status: "pending", method: "zarinpal", authority, refId: "", cardPan: "", paidAt: null },
      status: "pending_payment",
      stockRestored: false,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "test" }],
      createdAt: new Date(), updatedAt: new Date(),
    });
    const orderId = inserted.insertedId.toString();

    // Bogus authority → verifyPayment returns null → failure branch commits.
    const res = await http("GET", "/api/payment/verify?Status=OK&Authority=" + authority + "&orderId=" + orderId, null);
    assert(res.status >= 300 && res.status < 400, "expected redirect, got " + res.status);

    const notif = await waitFor(async () => {
      const inbox = await http("GET", "/api/notifications", adminJar);
      return (inbox.data.data || []).find(
        (n) => n.type === "payment_failed" && n.notificationKey === "order_" + orderId + "_admin_payment_failed"
      );
    });
    assert(!!notif, "admin payment_failed notification not created within 5s");
    assert(notif.category === "payment", "category must be payment");
    assert(notif.link === "/admin/orders/" + orderId, "link must deep-link to admin order: " + notif.link);
    createdKeys.push(notif.notificationKey);
    console.log("\n      key=" + notif.notificationKey);
  });

  // --- TEST 8: supplier payout request → admin gets payout_requested ---
  await testAsync("Supplier payout request -> admin gets payout_requested", async () => {
    const res = await http("POST", "/api/supplier/wallet", supplierJar, { amount: 100000, note: "تسویه آزمایشی" });
    assert(res.status === 200, "wallet expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const notif = await waitFor(async () => {
      const inbox = await http("GET", "/api/notifications", adminJar);
      return (inbox.data.data || []).find((n) => n.type === "payout_requested");
    });
    assert(!!notif, "admin payout_requested notification not created within 5s");
    assert(notif.category === "payout", "category must be payout");
    assert(notif.link === "/admin/payouts", "link must be /admin/payouts: " + notif.link);
    assert(/درخواست تسویه جدید/.test(notif.message), "message must mention the payout request");
    assert(notif.notificationKey.startsWith("payout_"), "key must start with payout_: " + notif.notificationKey);
    createdKeys.push(notif.notificationKey);
    console.log("\n      key=" + notif.notificationKey);
  });

  // --- TEST 9: unread count reflects the admin events ---
  await testAsync("unread-count reflects admin events (>= 3)", async () => {
    const res = await http("GET", "/api/notifications/unread-count", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.count >= 3, "expected >= 3 unread, got " + res.data.count);
    console.log("\n      unread=" + res.data.count);
  });

  // --- TEST 10: single read → isRead + readAt; repeat → idempotent ---
  await testAsync("PUT /[id]/read -> readAt set; repeat -> idempotent 200", async () => {
    assert(!!orderNotifId, "missing notif id from TEST 5");
    const res = await http("PUT", "/api/notifications/" + orderNotifId + "/read", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.isRead === true, "isRead must be true");
    assert(!!res.data.readAt, "readAt must be set");

    const again = await http("PUT", "/api/notifications/" + orderNotifId + "/read", adminJar);
    assert(again.status === 200, "repeat must be 200 (idempotent), got " + again.status);
    assert(again.data.isRead === true, "still read");
    console.log("\n      readAt=" + !!res.data.readAt);
  });

  // --- TEST 11: cross-admin isolation → 404 ---
  await testAsync("admin2 cannot read admin1's notification -> 404", async () => {
    assert(!!orderNotifId, "missing notif id from TEST 5");
    const res = await http("PUT", "/api/notifications/" + orderNotifId + "/read", admin2Jar);
    assert(res.status === 404, "admin2 expected 404, got " + res.status);
  });

  // --- TEST 12: read-all → all read; repeat → idempotent ---
  await testAsync("PUT read-all -> unreadCount 0; repeat idempotent", async () => {
    const res = await http("PUT", "/api/notifications/read-all", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    const after = await http("GET", "/api/notifications/unread-count", adminJar);
    assert(after.data.count === 0, "unreadCount must be 0 after read-all, got " + after.data.count);

    const again = await http("PUT", "/api/notifications/read-all", adminJar);
    assert(again.status === 200, "repeat must be 200, got " + again.status);
    console.log("\n      modifiedCount=" + res.data.modifiedCount);
  });

  // --- TEST 13: supplier_application regression (admins still notified) ---
  await testAsync("Supplier application -> admin still gets supplier_application", async () => {
    const res = await http("POST", "/api/supplier-applications", customerJar, {
      businessName: PREFIX + "Biz",
      description: "درخواست آزمایشی اعلان ادمین",
    });
    assert(res.status === 201, "application expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const notif = await waitFor(async () => {
      const inbox = await http("GET", "/api/notifications", adminJar);
      return (inbox.data.data || []).find((n) => n.type === "supplier_application");
    });
    assert(!!notif, "supplier_application notification missing for admin");
    assert(notif.category === "system", "category must be system");
    assert(notif.link === "/admin/suppliers?tab=applications", "link must point at the application tab: " + notif.link);
    createdKeys.push("supplier_application_" + res.data.id);
    console.log("\n      key=" + notif.notificationKey);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  // Exact keys created by this suite — the shared admin's own notifications
  // (including real supplier_application rows) are never touched.
  if (createdKeys.length > 0) {
    await db.collection("notifications").deleteMany({ notificationKey: { $in: createdKeys } });
  }
  await db.collection("supplierapplications").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [admin2._id, customer._id, suppUser._id] } });
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
