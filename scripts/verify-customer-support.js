/**
 * Session 68 — Customer Communication / Order Support Verification
 * (real HTTP API + real MongoDB)
 *
 * Tests:
 *   1.  Seed fixtures + logins (admin, 2 customers, 2 suppliers)
 *   2.  Unauthenticated POST /api/conversations -> 401
 *   3.  Admin POST /api/conversations -> 403 (customer-only)
 *   4.  Customer GET /api/admin/conversations -> 403
 *   5.  Customer creates conversation for OWN paid order -> 201 + supplier notified
 *   6.  Duplicate active conversation for the same supplier-order -> 409
 *   7.  Customer cannot create for ANOTHER customer's order -> 404
 *   8.  Customer cannot create for an UNPAID order -> 400
 *   9.  GET /api/conversations/eligible-orders -> only own PAID orders
 *  10.  Customer reads own conversation -> 200 (customerUnread false at start)
 *  11.  Another customer GET / POST to the conversation -> 404
 *  12.  Customer sends a message -> 200 (status open, staffUnread, supplier notified)
 *  13.  Admin lists conversations (status filter + subject search) -> 200
 *  14.  Admin replies -> 200 (status pending, customerUnread, customer notified)
 *  15.  Unread/read: customer list shows unread, detail GET clears it
 *  16.  Supplier S1 sees ONLY its own conversations (list + detail)
 *  17.  Unrelated supplier S2 detail / reply -> 404 (same message), S2 list empty
 *  18.  Supplier S1 replies -> 200 + customer notified
 *  19.  Invalid status transition (customer open->closed) -> 400
 *  20.  Resolve -> 200 (resolvedAt set) · message auto-reopens -> open
 *      · admin closes -> closed · message on closed -> 400 · reopen -> open
 *  21.  Malformed ids -> 400 (never a CastError 500)
 *  22.  Rate limiting: message spam -> 429
 *  23.  Notification per-message dedupe (each message key -> exactly 1)
 *  24.  Dead supplier ref -> detail GET 200 with supplier=null (the UI
 *       null-safe hardening contract: populate() yields null for a deleted
 *       Supplier doc, and the detail pages must render it gracefully)
 *  25.  Cleanup (fixtures removed)
 *
 * Rate-limit aware: conversation-create is 5/user/15min and conversation-msg
 * is 15/actor/15min. Customer A burns 4 create tokens (create + dup + foreign
 * + unpaid) and ~3 message tokens; the spam test uses the ADMIN actor (16
 * sends) so no customer quota is exhausted for the other assertions. The
 * regression runner clears the conversation limiter keys before each suite.
 *
 * Usage: node scripts/verify-customer-support.js
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
const PREFIX = "csup_" + Date.now() + "_";
const PASS = "support-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
// Unique 11-digit phones (0 + 10 digits).
const CUSTOMER_A_PHONE = "09158882031";
const CUSTOMER_B_PHONE = "09158882032";
const SUPPLIER_S1_PHONE = "09158882041";
const SUPPLIER_S2_PHONE = "09158882042";

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
  const init = { method, headers, redirect: "manual" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, init);
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean, tokenVersion: Number },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);
const ProductSchema = new mongoose.Schema(
  { name: String, slug: String, supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" }, price: Number, stock: Number, isActive: Boolean },
  { timestamps: true, collection: "products" }
);
const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
        name: String,
        price: Number,
        supplierPrice: Number,
        quantity: Number,
      },
    ],
    totalAmount: Number,
    status: String,
    payment: { status: String, method: String },
  },
  { timestamps: true, collection: "orders" }
);
const SupplierOrderSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        name: String,
        supplierPrice: Number,
        quantity: Number,
      },
    ],
    amountOwed: Number,
    status: String,
  },
  { timestamps: true, collection: "supplierorders" }
);
const NotificationSchema = new mongoose.Schema(
  { recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, type: String, category: String, message: String, link: String, notificationKey: String, isRead: Boolean },
  { timestamps: true, collection: "notifications" }
);
const ConversationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    supplierOrder: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierOrder" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    subject: String,
    category: String,
    status: String,
    customerUnread: Boolean,
    staffUnread: Boolean,
    messages: [{ sender: mongoose.Schema.Types.ObjectId, senderRole: String, text: String, createdAt: Date }],
  },
  { timestamps: true, collection: "customerconversations" }
);

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 68 — CUSTOMER COMMUNICATION / ORDER SUPPORT (REAL HTTP API)");
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
  const User = mongoose.models.User_CSUP || mongoose.model("User_CSUP", UserSchema);
  const Supplier = mongoose.models.Supplier_CSUP || mongoose.model("Supplier_CSUP", SupplierSchema);
  const Product = mongoose.models.Product_CSUP || mongoose.model("Product_CSUP", ProductSchema);
  const Order = mongoose.models.Order_CSUP || mongoose.model("Order_CSUP", OrderSchema);
  const SupplierOrder = mongoose.models.SupplierOrder_CSUP || mongoose.model("SupplierOrder_CSUP", SupplierOrderSchema);
  const Notification = mongoose.models.Notification_CSUP || mongoose.model("Notification_CSUP", NotificationSchema);
  const Conversation = mongoose.models.Conversation_CSUP || mongoose.model("Conversation_CSUP", ConversationSchema);

  // --- Idempotency sweep (re-runs must be clean) ---
  const fixturePhones = [
    CUSTOMER_A_PHONE,
    CUSTOMER_B_PHONE,
    SUPPLIER_S1_PHONE,
    SUPPLIER_S2_PHONE,
  ];
  await User.deleteMany({ phone: { $in: fixturePhones } });
  const fixtureUsers = await User.find({ phone: { $in: fixturePhones } }).select("_id").lean();
  const fixtureUserIds = fixtureUsers.map((u) => u._id);
  if (fixtureUserIds.length > 0) {
    await Supplier.deleteMany({ user: { $in: fixtureUserIds } });
    await Conversation.deleteMany({ customer: { $in: fixtureUserIds } });
    await Notification.deleteMany({ recipient: { $in: fixtureUserIds } });
  }

  // Self-cleaning rate limits: the conversation limiter TTL docs persist 15
  // minutes, so a re-run within that window would inherit the previous run's
  // exhausted buckets (esp. the admin spam test's 16 sends) and false-429.
  // The regression runner clears these keys before each suite too, but the
  // suite must be hermetic standalone as well.
  await mongoose.connection.db
    .collection("ratelimits")
    .deleteMany({
      _id: { $regex: "^rl:(conversation-create|conversation-msg):" },
    });

  // --- Fixtures ---
  const customerA = await User.create({
    name: "CSUP Customer A",
    phone: CUSTOMER_A_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "customer",
    isActive: true,
    tokenVersion: 0,
  });
  const customerB = await User.create({
    name: "CSUP Customer B",
    phone: CUSTOMER_B_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "customer",
    isActive: true,
    tokenVersion: 0,
  });
  const supplier1User = await User.create({
    name: "CSUP Supplier 1",
    phone: SUPPLIER_S1_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "supplier",
    isActive: true,
    tokenVersion: 0,
  });
  const supplier2User = await User.create({
    name: "CSUP Supplier 2",
    phone: SUPPLIER_S2_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "supplier",
    isActive: true,
    tokenVersion: 0,
  });
  const supplier1 = await Supplier.create({
    user: supplier1User._id,
    businessName: "فروشنده یک " + PREFIX,
    contactPhone: SUPPLIER_S1_PHONE,
    isActive: true,
  });
  const supplier2 = await Supplier.create({
    user: supplier2User._id,
    businessName: "فروشنده دو " + PREFIX,
    contactPhone: SUPPLIER_S2_PHONE,
    isActive: true,
  });
  const product1 = await Product.create({
    name: "محصول پشتیبانی " + PREFIX,
    slug: PREFIX + "support-product",
    supplier: supplier1._id,
    price: 200000,
    stock: 10,
    isActive: true,
  });
  const orderA = await Order.create({
    customer: customerA._id,
    items: [
      {
        product: product1._id,
        supplier: supplier1._id,
        name: product1.name,
        price: 200000,
        supplierPrice: 150000,
        quantity: 1,
      },
    ],
    totalAmount: 200000,
    status: "processing",
    payment: { status: "paid", method: "zarinpal" },
  });
  const orderAUnpaid = await Order.create({
    customer: customerA._id,
    items: [
      {
        product: product1._id,
        supplier: supplier1._id,
        name: product1.name,
        price: 200000,
        supplierPrice: 150000,
        quantity: 1,
      },
    ],
    totalAmount: 200000,
    status: "pending_payment",
    payment: { status: "pending", method: "zarinpal" },
  });
  const orderB = await Order.create({
    customer: customerB._id,
    items: [
      {
        product: product1._id,
        supplier: supplier1._id,
        name: product1.name,
        price: 200000,
        supplierPrice: 150000,
        quantity: 1,
      },
    ],
    totalAmount: 200000,
    status: "processing",
    payment: { status: "paid", method: "zarinpal" },
  });
  const supplierOrder1 = await SupplierOrder.create({
    order: orderA._id,
    supplier: supplier1._id,
    items: [
      {
        product: product1._id,
        name: product1.name,
        supplierPrice: 150000,
        quantity: 1,
      },
    ],
    amountOwed: 150000,
    status: "confirmed",
  });

  let adminJar = null, jarA = null, jarB = null, jarS1 = null, jarS2 = null;

  await testAsync("Seed logins (admin, A, B, S1, S2)", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    jarA = await login(CUSTOMER_A_PHONE, PASS);
    jarB = await login(CUSTOMER_B_PHONE, PASS);
    jarS1 = await login(SUPPLIER_S1_PHONE, PASS);
    jarS2 = await login(SUPPLIER_S2_PHONE, PASS);
    assert(adminJar.header().includes("session-token"), "admin session missing");
    assert(jarS2.header().includes("session-token"), "S2 session missing");
  });

  // --- TEST 2: unauth -> 401 ---
  await testAsync("Unauthenticated POST /api/conversations -> 401", async () => {
    const res = await http("POST", "/api/conversations", null, {
      orderId: String(orderA._id),
      supplierOrderId: String(supplierOrder1._id),
      subject: "X",
      message: "سلام",
    });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 3: admin -> 403 ---
  await testAsync("Admin POST /api/conversations -> 403 (customer only)", async () => {
    const res = await http("POST", "/api/conversations", adminJar, {
      orderId: String(orderA._id),
      supplierOrderId: String(supplierOrder1._id),
      subject: "X",
      message: "سلام",
    });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: customer -> admin endpoint 403 ---
  await testAsync("Customer GET /api/admin/conversations -> 403", async () => {
    const res = await http("GET", "/api/admin/conversations", jarA);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 5: create for own paid order -> 201 + supplier notified ---
  let convId = null;
  await testAsync("Customer creates conversation for own paid order -> 201 + supplier notified", async () => {
    const res = await http("POST", "/api/conversations", jarA, {
      orderId: String(orderA._id),
      supplierOrderId: String(supplierOrder1._id),
      productId: String(product1._id),
      category: "delivery",
      subject: "پیگیری ارسال " + PREFIX,
      message: "سلام، وضعیت ارسال سفارشم چطور است؟",
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 160));
    assert(res.data.status === "open", "must be open");
    assert(res.data.staffUnread === true, "opening message is from the customer → staffUnread");
    assert(String(res.data.supplier) === String(supplier1._id), "supplier must come from the SupplierOrder");
    convId = res.data._id;

    // Supplier S1's user must be notified (support_message, per-message key).
    const notif = await Notification.findOne({
      recipient: supplier1User._id,
      notificationKey: "conversation_" + convId + "_" + res.data.messages[0]._id,
    }).lean();
    assert(notif, "supplier must be notified of the new conversation");
    assert(notif.type === "support_message", "wrong notification type");
    assert(notif.category === "support", "wrong category");
  });

  // --- TEST 6: duplicate active conversation -> 409 ---
  await testAsync("Duplicate active conversation for the same supplier-order -> 409", async () => {
    const res = await http("POST", "/api/conversations", jarA, {
      orderId: String(orderA._id),
      supplierOrderId: String(supplierOrder1._id),
      subject: "تکرار " + PREFIX,
      message: "پیام تکراری",
    });
    assert(res.status === 409, "expected 409, got " + res.status);
  });

  // --- TEST 7: foreign order -> 404 ---
  await testAsync("Customer cannot create for ANOTHER customer's order -> 404", async () => {
    const res = await http("POST", "/api/conversations", jarA, {
      orderId: String(orderB._id),
      supplierOrderId: String(supplierOrder1._id),
      subject: "خارجی " + PREFIX,
      message: "سلام",
    });
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  // --- TEST 8: unpaid order -> 400 ---
  await testAsync("Customer cannot create for an UNPAID order -> 400", async () => {
    const res = await http("POST", "/api/conversations", jarA, {
      orderId: String(orderAUnpaid._id),
      supplierOrderId: String(supplierOrder1._id),
      subject: "پرداخت نشده " + PREFIX,
      message: "سلام",
    });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 9: eligible-orders -> only own PAID orders ---
  await testAsync("GET /api/conversations/eligible-orders -> only own paid orders", async () => {
    const res = await http("GET", "/api/conversations/eligible-orders", jarA);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "must be an array");
    assert(
      res.data.some((r) => r.orderId === String(orderA._id)),
      "paid order must be eligible"
    );
    assert(
      !res.data.some((r) => r.orderId === String(orderAUnpaid._id)),
      "unpaid order must NOT be eligible"
    );
    assert(
      !res.data.some((r) => r.orderId === String(orderB._id)),
      "foreign order must NOT be listed"
    );
    const row = res.data.find((r) => r.orderId === String(orderA._id));
    assert(
      row.suppliers.some((s) => s.supplierOrderId === String(supplierOrder1._id) && s.businessName.includes("فروشنده یک")),
      "supplier-orders must be grouped under the order"
    );
  });

  // --- TEST 10: read own conversation (detail route — ?id= hits the LIST
  // route which returns an array, not a single conversation) ---
  await testAsync("Customer reads own conversation -> 200", async () => {
    const res = await http("GET", "/api/conversations/" + convId, jarA);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.customerUnread === false, "customerUnread must be false at start");
  });

  // --- TEST 11: another customer -> 404 (GET, POST and the status PATCH all
  // return the same-404 — no ownership surface is left uncovered) ---
  await testAsync("Another customer GET / POST / PATCH to the conversation -> 404", async () => {
    const get = await http("GET", "/api/conversations/" + convId, jarB);
    assert(get.status === 404, "GET expected 404, got " + get.status);
    const post = await http("POST", "/api/conversations/" + convId + "/messages", jarB, { text: "سلام" });
    assert(post.status === 404, "POST expected 404, got " + post.status);
    const patch = await http("PATCH", "/api/conversations/" + convId + "/status", jarB, { status: "resolved" });
    assert(patch.status === 404, "PATCH status expected 404, got " + patch.status);
  });

  // --- TEST 12: customer sends a message ---
  let msgAId = null;
  await testAsync("Customer sends a message -> 200 (open, staffUnread, supplier notified)", async () => {
    const res = await http("POST", "/api/conversations/" + convId + "/messages", jarA, {
      text: "میتوانید کد رهگیری بفرستید؟",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 160));
    assert(res.data.status === "open", "customer message must keep status open");
    assert(res.data.staffUnread === true, "staffUnread must be true after a customer message");
    const last = res.data.messages[res.data.messages.length - 1];
    msgAId = last._id;

    const notif = await Notification.findOne({
      recipient: supplier1User._id,
      notificationKey: "conversation_" + convId + "_" + msgAId,
    }).lean();
    assert(notif, "supplier must be notified of the follow-up message");
  });

  // --- TEST 13: admin lists (status + search) ---
  await testAsync("Admin lists conversations (status filter + subject search)", async () => {
    const all = await http("GET", "/api/admin/conversations", adminJar);
    assert(all.status === 200, "expected 200, got " + all.status);
    assert(all.data.data.some((r) => r._id === convId), "conversation must be in the admin queue");

    const openOnly = await http("GET", "/api/admin/conversations?status=open", adminJar);
    assert(
      openOnly.data.data.some((r) => r._id === convId),
      "conversation is open → must appear in the open filter"
    );

    const search = await http("GET", "/api/admin/conversations?search=" + encodeURIComponent(PREFIX), adminJar);
    assert(
      search.data.data.some((r) => r._id === convId),
      "subject search must find the conversation"
    );
  });

  // --- TEST 14: admin replies ---
  let msgAdminId = null;
  await testAsync("Admin replies -> 200 (pending, customerUnread, customer notified)", async () => {
    const res = await http("POST", "/api/admin/conversations/" + convId + "/messages", adminJar, {
      text: "در حال بررسی هستیم.",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 160));
    assert(res.data.status === "pending", "staff message must move status to pending");
    assert(res.data.customerUnread === true, "customerUnread must be true after a staff reply");
    const last = res.data.messages[res.data.messages.length - 1];
    msgAdminId = last._id;

    const notif = await Notification.findOne({
      recipient: customerA._id,
      notificationKey: "conversation_" + convId + "_" + msgAdminId,
    }).lean();
    assert(notif, "customer must be notified of the admin reply");
    assert(notif.message.includes("گفتگوی سفارش"), "templated message expected");
  });

  // --- TEST 15: unread flip on detail GET ---
  await testAsync("Unread/read: customer list shows unread, detail GET clears it", async () => {
    const list = await http("GET", "/api/conversations?status=pending", jarA);
    const row = list.data.data.find((r) => r._id === convId);
    assert(row && row.customerUnread === true, "list must show customerUnread=true");

    const detail = await http("GET", "/api/conversations/" + convId, jarA);
    assert(detail.status === 200, "expected 200, got " + detail.status);
    assert(detail.data.customerUnread === false, "detail GET must clear customerUnread");
  });

  // --- TEST 16: supplier S1 sees own conversation ---
  await testAsync("Supplier S1 sees its own conversation (list + detail)", async () => {
    const list = await http("GET", "/api/supplier/conversations", jarS1);
    assert(list.status === 200, "expected 200, got " + list.status);
    assert(list.data.data.some((r) => r._id === convId), "S1 must see its own conversation");

    const detail = await http("GET", "/api/supplier/conversations/" + convId, jarS1);
    assert(detail.status === 200, "detail expected 200, got " + detail.status);
    assert(
      typeof detail.data.customer === "object" && detail.data.customer.phone === CUSTOMER_A_PHONE,
      "S1 detail must populate the customer"
    );
  });

  // --- TEST 17: unrelated supplier S2 denied ---
  await testAsync("Unrelated supplier S2 detail / reply -> 404; S2 list has no foreign rows", async () => {
    const detail = await http("GET", "/api/supplier/conversations/" + convId, jarS2);
    assert(detail.status === 404, "detail expected 404, got " + detail.status);
    const reply = await http("POST", "/api/supplier/conversations/" + convId + "/messages", jarS2, {
      text: "حمله",
    });
    assert(reply.status === 404, "reply expected 404, got " + reply.status);

    const list = await http("GET", "/api/supplier/conversations", jarS2);
    assert(
      !list.data.data.some((r) => r._id === convId),
      "S2 list must never contain S1's conversation"
    );
  });

  // --- TEST 18: supplier S1 replies ---
  await testAsync("Supplier S1 replies -> 200 + customer notified", async () => {
    const res = await http("POST", "/api/supplier/conversations/" + convId + "/messages", jarS1, {
      text: "بسته شما امروز ارسال شد.",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 160));
    assert(res.data.status === "pending", "staff message must keep status pending");
    const last = res.data.messages[res.data.messages.length - 1];
    const notif = await Notification.findOne({
      recipient: customerA._id,
      notificationKey: "conversation_" + convId + "_" + last._id,
    }).lean();
    assert(notif, "customer must be notified of the supplier reply");
  });

  // --- TEST 19: invalid transition ---
  await testAsync("Invalid customer transition (pending -> closed) -> 400", async () => {
    const res = await http("PATCH", "/api/conversations/" + convId + "/status", jarA, { status: "closed" });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 20: resolve / auto-reopen / close / closed-message / reopen ---
  await testAsync("Resolve -> 200; message auto-reopens; admin closes; closed-message -> 400; reopen -> 200", async () => {
    const resolved = await http("PATCH", "/api/conversations/" + convId + "/status", jarA, { status: "resolved" });
    assert(resolved.status === 200, "resolve expected 200, got " + resolved.status);
    assert(resolved.data.status === "resolved", "must be resolved");
    assert(resolved.data.resolvedAt, "resolvedAt must be set");

    // Customer messaging a resolved conversation auto-reopens to open.
    const reopened = await http("POST", "/api/conversations/" + convId + "/messages", jarA, {
      text: "یک سوال دیگر داشتم",
    });
    assert(reopened.status === 200, "message on resolved expected 200, got " + reopened.status);
    assert(reopened.data.status === "open", "must auto-reopen to open");

    // Admin closes.
    const closed = await http("PATCH", "/api/admin/conversations/" + convId + "/status", adminJar, { status: "closed" });
    assert(closed.status === 200, "admin close expected 200, got " + closed.status);
    assert(closed.data.status === "closed", "must be closed");
    assert(closed.data.closedAt, "closedAt must be set");

    // Any message on a closed conversation is rejected.
    const msgClosed = await http("POST", "/api/conversations/" + convId + "/messages", jarA, { text: "پیام روی بسته" });
    assert(msgClosed.status === 400, "message on closed expected 400, got " + msgClosed.status);
    const adminMsgClosed = await http("POST", "/api/admin/conversations/" + convId + "/messages", adminJar, { text: "پاسخ" });
    assert(adminMsgClosed.status === 400, "admin message on closed expected 400, got " + adminMsgClosed.status);

    // Customer reopens.
    const reopen = await http("PATCH", "/api/conversations/" + convId + "/status", jarA, { status: "open" });
    assert(reopen.status === 200, "reopen expected 200, got " + reopen.status);
    assert(reopen.data.status === "open", "must be open after reopen");
  });

  // --- TEST 21: malformed ids ---
  await testAsync("Malformed ids -> 400 (never a CastError 500)", async () => {
    const a = await http("GET", "/api/conversations/not-an-id", jarA);
    assert(a.status === 400, "GET expected 400, got " + a.status);
    const b = await http("POST", "/api/conversations/not-an-id/messages", jarA, { text: "سلام" });
    assert(b.status === 400, "POST messages expected 400, got " + b.status);
    const c = await http("PATCH", "/api/conversations/not-an-id/status", jarA, { status: "resolved" });
    assert(c.status === 400, "PATCH status expected 400, got " + c.status);
    const d = await http("POST", "/api/conversations", jarA, { orderId: "bad", supplierOrderId: "bad", subject: "x", message: "y" });
    assert(d.status === 400, "POST create expected 400, got " + d.status);
    const e = await http("GET", "/api/admin/conversations/not-an-id", adminJar);
    assert(e.status === 400, "admin GET expected 400, got " + e.status);
    const f = await http("GET", "/api/supplier/conversations/not-an-id", jarS1);
    assert(f.status === 400, "supplier GET expected 400, got " + f.status);
  });

  // --- TEST 22: rate limiting (admin spam -> 429 on the 16th) ---
  await testAsync("Rate limiting: message spam -> 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 16; i++) {
      const res = await http("POST", "/api/admin/conversations/" + convId + "/messages", adminJar, {
        text: "پیام خودکار " + i,
      });
      lastStatus = res.status;
    }
    assert(lastStatus === 429, "the 16th admin message must be 429, got " + lastStatus);
  });

  // --- TEST 23: per-message notification dedupe ---
  await testAsync("Notification per-message dedupe (each message key -> exactly 1)", async () => {
    const countKey = async (recipient, key) =>
      Notification.countDocuments({ recipient, notificationKey: key });

    const aCount = await countKey(customerA._id, "conversation_" + convId + "_" + msgAdminId);
    assert(aCount === 1, "admin reply notification must be exactly 1, got " + aCount);

    const sCount = await countKey(supplier1User._id, "conversation_" + convId + "_" + msgAId);
    assert(sCount === 1, "customer message notification must be exactly 1, got " + sCount);
  });

  // --- TEST 24: dead supplier ref (populate -> null) must render-safe ---
  // A conversation whose `supplier` ref points at a Supplier doc that no
  // longer exists (e.g. test-seed teardown deleted it) must NOT crash the
  // detail pages: the detail GET must return 200 with supplier=null and the
  // frontend null-safe helpers (src/lib/conversation-relations.ts) must be
  // what renders it. The ghost supplierOrder id avoids the unique partial
  // index {supplierOrder} where active (the fixture conversation for
  // supplierOrder1 is still open/pending at this point).
  await testAsync("Dead supplier ref -> customer + admin detail GET 200 with supplier null", async () => {
    const ghostSupplierId = new mongoose.Types.ObjectId();
    const ghostConv = await Conversation.create({
      customer: customerA._id,
      order: orderA._id, // live order — must still populate normally
      supplierOrder: new mongoose.Types.ObjectId(),
      supplier: ghostSupplierId, // no Supplier document has this _id
      subject: "فروشنده حذف‌شده " + PREFIX,
      category: "general",
      status: "open",
      customerUnread: false,
      staffUnread: true,
      messages: [
        { sender: customerA._id, senderRole: "customer", text: "سلام", createdAt: new Date() },
      ],
    });
    const ghostId = String(ghostConv._id);

    // Customer detail: 200 + supplier null + live order still populated.
    const cust = await http("GET", "/api/conversations/" + ghostId, jarA);
    assert(cust.status === 200, "customer detail expected 200, got " + cust.status);
    assert(
      cust.data.supplier === null,
      "supplier must be null for a dead ref, got " + JSON.stringify(cust.data.supplier)
    );
    assert(
      cust.data.order && typeof cust.data.order === "object" && cust.data.order._id === String(orderA._id),
      "live order ref must still populate"
    );

    // Admin detail: same contract.
    const adm = await http("GET", "/api/admin/conversations/" + ghostId, adminJar);
    assert(adm.status === 200, "admin detail expected 200, got " + adm.status);
    assert(
      adm.data.supplier === null,
      "admin detail supplier must be null, got " + JSON.stringify(adm.data.supplier)
    );

    // Self-contained cleanup (the fixture sweep also covers this customer).
    await Conversation.deleteMany({ _id: ghostConv._id });
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await Conversation.deleteMany({ customer: customerA._id });
  await Notification.deleteMany({ notificationKey: { $regex: "^conversation_" } });
  await SupplierOrder.deleteMany({ _id: supplierOrder1._id });
  await Order.deleteMany({ _id: { $in: [orderA._id, orderAUnpaid._id, orderB._id] } });
  await Product.deleteMany({ _id: product1._id });
  await Supplier.deleteMany({ _id: { $in: [supplier1._id, supplier2._id] } });
  await User.deleteMany({ _id: { $in: [customerA._id, customerB._id, supplier1User._id, supplier2User._id] } });
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
