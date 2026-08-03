/**
 * Session 36 — Core Customer Notifications Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated GET /api/notifications → 401
 *   2. Unauthenticated GET /api/notifications/unread-count → 401
 *   3. Unauthenticated PUT /api/notifications/read-all → 401
 *   4. Fresh customer inbox is empty (data [], unreadCount 0)
 *   5. Admin confirms an order → customer gets order_confirmed (event wiring)
 *   6. Dedupe: pre-seeded notificationKey blocks a duplicate (count stays 1)
 *   7. PUT /[id]/read → isRead + readAt; repeat → idempotent 200
 *   8. PUT read-all → all read + unreadCount 0; repeat → idempotent
 *   9. Cross-user isolation: other customer / supplier → 404 on foreign id
 *  10. Pagination + category filter + unreadOnly filter shapes
 *  11. Real checkout (manual) → supplier gets in-app new_order (no telegram
 *      chat id required — in-app is the source of truth)
 *  12. Supplier confirms own order → supplier gets order_confirmed
 *  13. Admin refund → customer gets order_refunded + stock restored once
 *  14. Payment NOK (user cancels at gateway) → customer gets payment_cancelled
 *      + stock restored once
 *
 * Usage: node scripts/verify-notifications.js
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
const PREFIX = "notif_" + Date.now() + "_";
const PASS = "notif-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_A_PHONE = "09157773001";
const CUSTOMER_B_PHONE = "09157773002";
const SUPPLIER_PHONE = "09157773003";

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

async function makeProcessingOrder(db, { customer, product, qty }) {
  return db.collection("orders").insertOne({
    customer: customer._id,
    items: [{ product: product._id, supplier: new mongoose.Types.ObjectId(), variantId: null, name: product.name, price: product.price, supplierPrice: product.supplierPrice, quantity: qty }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "Notif Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: "paid", method: "zarinpal", authority: "NOTIFPAID_" + Date.now(), refId: "NOTIFREF_" + Date.now(), cardPan: "1234", paidAt: new Date() },
    status: "processing",
    stockRestored: false,
    statusHistory: [{ status: "processing", at: new Date(), note: "paid" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function getStock(db, productId) {
  const doc = await db.collection("products").findOne({ _id: productId }, { projection: { stock: 1 } });
  return doc ? doc.stock : null;
}

async function countNotifications(db, recipientId, notificationKey) {
  const filter = { recipient: recipientId };
  if (notificationKey) filter.notificationKey = notificationKey;
  return db.collection("notifications").countDocuments(filter);
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 36 — CORE CUSTOMER NOTIFICATIONS (REAL HTTP API)");
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
  const User = mongoose.models.User_NOTIF || mongoose.model("User_NOTIF", UserSchema);
  const Supplier = mongoose.models.Supplier_NOTIF || mongoose.model("Supplier_NOTIF", SupplierSchema);
  const Category = mongoose.models.Category_NOTIF || mongoose.model("Category_NOTIF", CategorySchema);
  const Product = mongoose.models.Product_NOTIF || mongoose.model("Product_NOTIF", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_A_PHONE, CUSTOMER_B_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^NotifTest" } });

  // --- Fixtures ---
  const customerA = await User.create({ name: "Notif Customer A", phone: CUSTOMER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customerB = await User.create({ name: "Notif Customer B", phone: CUSTOMER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Notif Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  // NOTE: no telegramChatId — in-app must still be created (source of truth)
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "NotifTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const makeProduct = (slugSuffix, stock, price = 10000) =>
    Product.create({
      name: PREFIX + slugSuffix, slug: PREFIX + slugSuffix, description: "notif test",
      category: catDoc._id, supplier: suppDoc._id, price, supplierPrice: price / 2,
      stock, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
    });

  const prodConfirm = await makeProduct("prod-confirm", 10);
  const prodDedupe = await makeProduct("prod-dedupe", 10);
  const prodCheckout = await makeProduct("prod-checkout", 10, 25000);
  const prodRefund = await makeProduct("prod-refund", 10);
  const prodNok = await makeProduct("prod-nok", 10);

  let adminJar = null;
  let aJar = null;
  let bJar = null;
  let supplierJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer A login", async () => {
    aJar = await login(CUSTOMER_A_PHONE, PASS);
    assert(aJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer B login", async () => {
    bJar = await login(CUSTOMER_B_PHONE, PASS);
    assert(bJar.header().includes("session-token"), "no session cookie");
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

  // --- TEST 4: fresh customer inbox is empty ---
  await testAsync("Fresh inbox empty (data [], unreadCount 0)", async () => {
    const res = await http("GET", "/api/notifications", aJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data.data) && res.data.data.length === 0, "expected empty data");
    assert(res.data.unreadCount === 0, "expected unreadCount 0, got " + res.data.unreadCount);
  });

  // --- TEST 5: admin confirms order → customer gets order_confirmed ---
  let confirmedNotifId = null;
  await testAsync("Admin confirm -> customer gets order_confirmed notification", async () => {
    const inserted = await makeProcessingOrder(db, { customer: customerA, product: prodConfirm, qty: 1 });
    const orderId = inserted.insertedId.toString();

    const res = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status: "confirmed" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const inbox = await http("GET", "/api/notifications", aJar);
    assert(inbox.status === 200, "inbox 200 expected");
    const notif = (inbox.data.data || []).find((n) => n.type === "order_confirmed");
    assert(!!notif, "order_confirmed notification missing");
    assert(notif.category === "order", "category must be order");
    assert(notif.link === "/orders/" + orderId, "link must deep-link to order: " + notif.link);
    assert(notif.notificationKey === "order_" + orderId + "_order_confirmed", "notificationKey wrong: " + notif.notificationKey);
    assert(notif.isRead === false, "must be unread initially");
    confirmedNotifId = notif._id;
    console.log("\n      key=" + notif.notificationKey + " unread=" + inbox.data.unreadCount);
  });

  // --- TEST 6: dedupe — pre-seeded key blocks a duplicate ---
  await testAsync("Dedupe: same notificationKey cannot be created twice", async () => {
    const inserted = await makeProcessingOrder(db, { customer: customerA, product: prodDedupe, qty: 1 });
    const orderId = inserted.insertedId.toString();
    const key = "order_" + orderId + "_order_confirmed";

    // Pre-seed the notification the event would create
    await db.collection("notifications").insertOne({
      recipient: customerA._id,
      type: "order_confirmed",
      category: "order",
      message: "پیش‌تولید",
      relatedOrder: new mongoose.Types.ObjectId(orderId),
      link: "/orders/" + orderId,
      notificationKey: key,
      isRead: false,
      readAt: null,
      sentToTelegram: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const before = await countNotifications(db, customerA._id, key);
    assert(before === 1, "expected 1 pre-seeded, got " + before);

    // Trigger the same event via the real API — must be swallowed by E11000
    const res = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status: "confirmed" });
    assert(res.status === 200, "expected 200, got " + res.status);

    const after = await countNotifications(db, customerA._id, key);
    assert(after === 1, "dedupe failed: count must stay 1, got " + after);
    console.log("\n      count stays " + after + " (E11000 swallowed)");
  });

  // --- TEST 7: single read → isRead + readAt; repeat → idempotent ---
  await testAsync("PUT /[id]/read -> readAt set; repeat -> idempotent 200", async () => {
    assert(!!confirmedNotifId, "missing notif id from TEST 5");
    const res = await http("PUT", "/api/notifications/" + confirmedNotifId + "/read", aJar);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.isRead === true, "isRead must be true");
    assert(!!res.data.readAt, "readAt must be set");

    const again = await http("PUT", "/api/notifications/" + confirmedNotifId + "/read", aJar);
    assert(again.status === 200, "repeat must be 200 (idempotent), got " + again.status);
    assert(again.data.isRead === true, "still read");
    console.log("\n      readAt=" + !!res.data.readAt);
  });

  // --- TEST 8: read-all → all read; repeat → idempotent ---
  await testAsync("PUT read-all -> unreadCount 0; repeat idempotent", async () => {
    const res = await http("PUT", "/api/notifications/read-all", aJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    const after = await http("GET", "/api/notifications/unread-count", aJar);
    assert(after.data.count === 0, "unreadCount must be 0 after read-all, got " + after.data.count);

    const again = await http("PUT", "/api/notifications/read-all", aJar);
    assert(again.status === 200, "repeat must be 200, got " + again.status);
    console.log("\n      modifiedCount=" + res.data.modifiedCount);
  });

  // --- TEST 9: cross-user isolation → 404 ---
  await testAsync("Other customer / supplier cannot read foreign notification -> 404", async () => {
    assert(!!confirmedNotifId, "missing notif id from TEST 5");
    const resB = await http("PUT", "/api/notifications/" + confirmedNotifId + "/read", bJar);
    assert(resB.status === 404, "customer B expected 404, got " + resB.status);
    const resS = await http("PUT", "/api/notifications/" + confirmedNotifId + "/read", supplierJar);
    assert(resS.status === 404, "supplier expected 404, got " + resS.status);
  });

  // --- TEST 10: pagination + filters ---
  await testAsync("Pagination + category + unreadOnly filters", async () => {
    // Seed 3 payment-category notifications (2 unread) for customer A
    const baseKey = "fixture_" + Date.now();
    for (let i = 0; i < 3; i++) {
      await db.collection("notifications").insertOne({
        recipient: customerA._id,
        type: "payment_paid",
        category: "payment",
        message: "پرداخت آزمایشی " + i,
        relatedOrder: null,
        link: "",
        notificationKey: baseKey + "_" + i,
        isRead: i === 0, // first one read, others unread
        readAt: i === 0 ? new Date() : null,
        sentToTelegram: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const paged = await http("GET", "/api/notifications?page=1&limit=2", aJar);
    assert(paged.status === 200, "expected 200, got " + paged.status);
    assert(paged.data.data.length === 2, "limit=2 -> expected 2 items, got " + paged.data.data.length);
    assert(paged.data.total >= 3, "total must include seeded, got " + paged.data.total);
    assert(paged.data.hasNextPage === true, "hasNextPage must be true");

    const cat = await http("GET", "/api/notifications?category=payment", aJar);
    assert((cat.data.data || []).every((n) => n.category === "payment"), "category filter leaked");

    const unread = await http("GET", "/api/notifications?unreadOnly=1", aJar);
    assert((unread.data.data || []).every((n) => n.isRead === false), "unreadOnly leaked read items");
    assert(unread.data.unreadCount >= 2, "unreadCount must reflect unread, got " + unread.data.unreadCount);
    console.log("\n      total=" + paged.data.total + " unread=" + unread.data.unreadCount);
  });

  // --- TEST 11: real checkout (manual) → supplier gets in-app new_order ---
  await testAsync("Checkout -> supplier receives in-app new_order (no telegram needed)", async () => {
    const res = await http("POST", "/api/checkout", aJar, {
      items: [{ id: prodCheckout._id.toString(), quantity: 1, price: 25000, name: prodCheckout.name }],
      shippingAddress: { fullName: "Notif Tester", phone: customerA.phone, address: "Tehran", postalCode: "123" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const orderId = res.data.orderId;
    assert(!!orderId, "no orderId in checkout response");

    // Fire-and-forget emission — poll for the supplier's in-app notification
    const notif = await waitFor(async () => {
      const inbox = await http("GET", "/api/notifications", supplierJar);
      return (inbox.data.data || []).find((n) => n.type === "new_order");
    });
    assert(!!notif, "supplier new_order notification not created within 5s");
    assert(notif.relatedOrder === orderId, "relatedOrder must match order: " + notif.relatedOrder);
    assert(notif.notificationKey === "order_" + orderId + "_new_order", "notificationKey wrong");
    console.log("\n      key=" + notif.notificationKey);
  });

  // --- TEST 12: supplier confirms own order → supplier gets order_confirmed ---
  await testAsync("Supplier status change -> supplier gets order_confirmed in-app", async () => {
    const orderId = (await makeProcessingOrder(db, { customer: customerA, product: prodCheckout, qty: 1 })).insertedId.toString();
    const supplierOrderId = (await db.collection("supplierorders").insertOne({
      order: new mongoose.Types.ObjectId(orderId),
      supplier: suppDoc._id,
      items: [{ product: prodCheckout._id, supplier: suppDoc._id, name: prodCheckout.name, supplierPrice: prodCheckout.supplierPrice, quantity: 1 }],
      amountOwed: prodCheckout.supplierPrice,
      status: "pending",
      isPaidOut: false,
    })).insertedId.toString();

    const res = await http("PUT", "/api/supplier/orders?id=" + supplierOrderId, supplierJar, { status: "confirmed" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const inbox = await http("GET", "/api/notifications", supplierJar);
    const notif = (inbox.data.data || []).find((n) => n.type === "order_confirmed");
    assert(!!notif, "supplier order_confirmed missing");
    assert(notif.notificationKey === "order_" + orderId + "_order_confirmed", "notificationKey wrong: " + notif.notificationKey);
    console.log("\n      key=" + notif.notificationKey);
  });

  // --- TEST 13: refund → customer gets order_refunded + stock restored once ---
  await testAsync("Admin refund -> customer gets order_refunded + stock restored once", async () => {
    // Simulate reservation: stock 10 -> 8
    await db.collection("products").updateOne({ _id: prodRefund._id }, { $set: { stock: 8, stockVersion: 1 } });
    const inserted = await db.collection("orders").insertOne({
      customer: customerA._id,
      items: [{ product: prodRefund._id, supplier: new mongoose.Types.ObjectId(), variantId: null, name: prodRefund.name, price: prodRefund.price, supplierPrice: prodRefund.supplierPrice, quantity: 2 }],
      totalAmount: prodRefund.price * 2,
      shippingAddress: { fullName: "T", phone: customerA.phone, address: "Tehran", postalCode: "" },
      payment: { status: "paid", method: "zarinpal", authority: "REF_" + Date.now(), refId: "REFREF", cardPan: "1234", paidAt: new Date() },
      status: "processing",
      stockRestored: false,
      statusHistory: [{ status: "processing", at: new Date(), note: "paid" }],
    });
    const orderId = inserted.insertedId.toString();

    const res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "کالای معیوب" });
    assert(res.status === 200, "refund expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const inbox = await http("GET", "/api/notifications", aJar);
    const notif = (inbox.data.data || []).find((n) => n.type === "order_refunded" && n.relatedOrder === orderId);
    assert(!!notif, "order_refunded notification missing");
    assert(notif.notificationKey === "order_" + orderId + "_order_refunded", "notificationKey wrong");

    const stock = await getStock(db, prodRefund._id);
    assert(stock === 10, "stock must be restored to 10, got " + stock);
    console.log("\n      key=" + notif.notificationKey + " stock 8->" + stock);
  });

  // --- TEST 14: payment NOK → customer gets payment_cancelled + stock restored ---
  await testAsync("Payment NOK cancel -> customer gets payment_cancelled + stock restored", async () => {
    await db.collection("products").updateOne({ _id: prodNok._id }, { $set: { stock: 8, stockVersion: 1 } });
    const authority = "NOK_AUTH_" + Date.now();
    const inserted = await db.collection("orders").insertOne({
      customer: customerA._id,
      items: [{ product: prodNok._id, supplier: new mongoose.Types.ObjectId(), variantId: null, name: prodNok.name, price: prodNok.price, supplierPrice: prodNok.supplierPrice, quantity: 2 }],
      totalAmount: prodNok.price * 2,
      shippingAddress: { fullName: "T", phone: customerA.phone, address: "Tehran", postalCode: "" },
      payment: { status: "pending", method: "zarinpal", authority, refId: "", cardPan: "", paidAt: null },
      status: "pending_payment",
      stockRestored: false,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "test" }],
    });
    const orderId = inserted.insertedId.toString();

    const res = await http("GET", "/api/payment/verify?Status=NOK&Authority=" + authority + "&orderId=" + orderId, null);
    assert(res.status >= 300 && res.status < 400, "expected redirect, got " + res.status);

    const inbox = await http("GET", "/api/notifications", aJar);
    const notif = (inbox.data.data || []).find((n) => n.type === "payment_cancelled" && n.relatedOrder === orderId);
    assert(!!notif, "payment_cancelled notification missing");
    assert(notif.category === "payment", "category must be payment");

    const stock = await getStock(db, prodNok._id);
    assert(stock === 10, "stock must be restored to 10, got " + stock);
    console.log("\n      key=" + notif.notificationKey + " stock 8->" + stock);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("notifications").deleteMany({
    recipient: { $in: [customerA._id, customerB._id, suppUser._id] },
  });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [customerA._id, customerB._id, suppUser._id] } });
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
