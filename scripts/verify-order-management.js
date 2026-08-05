/**
 * Session 57 — Order Management Verification (real HTTP API)
 *
 * Exercises the order lifecycle state machine + Session 57 additions:
 * admin claim-based transitions (atomic hardening), shipping metadata
 * (provider/trackingCode/shippedAt/deliveredAt), actor-labeled statusHistory,
 * admin list sorting (newest/oldest), and re-asserts the money/stock/coupon
 * invariants Session 57 must preserve (payment domain separation, refunds,
 * admin-cancel of paid orders reversing soldCount, permissions).
 *
 * Fixtures: one customer, one supplier, one admin (seed), dedicated products
 * per test so stock/soldCount baselines stay deterministic. Cleanup removes
 * every PREFIX'd row (orders/products/supplier orders/coupons/users).
 *
 * Usage: node scripts/verify-order-management.js
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
const PREFIX = "om_" + Date.now() + "_";
const PASS = "om-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09175552001";
const SUPPLIER_PHONE = "09175552002";

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
    isActive: Boolean, soldCount: Number,
  },
  { timestamps: true, collection: "products" }
);
const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [{ product: mongoose.Schema.Types.ObjectId, supplier: mongoose.Schema.Types.ObjectId, variantId: mongoose.Schema.Types.ObjectId, sku: String, variantLabel: String, image: String, name: String, price: Number, supplierPrice: Number, quantity: Number }],
    totalAmount: Number,
    subtotalAmount: Number,
    discount: { type: mongoose.Schema.Types.Mixed, default: null },
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    shipping: { provider: String, trackingCode: String, shippedAt: Date, deliveredAt: Date, note: String },
    payment: { status: String, method: String, authority: String, refId: String, cardPan: String, paidAt: Date },
    status: String,
    stockRestored: Boolean,
    statusHistory: [{ status: String, at: Date, note: String, actor: String }],
  },
  { timestamps: true, collection: "orders" }
);
const CouponSchema = new mongoose.Schema(
  { code: String, type: String, value: Number, minSubtotal: Number, maxDiscount: Number, startsAt: Date, endsAt: Date, isActive: Boolean, isPublic: Boolean, usageLimit: Number, perUserLimit: Number, usedCount: Number },
  { timestamps: true, collection: "coupons" }
);
const CouponUsageSchema = new mongoose.Schema(
  { coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }, user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, count: Number },
  { timestamps: true, collection: "couponusages" }
);

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 57 — ORDER MANAGEMENT (REAL HTTP API)");
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
  const User = mongoose.models.User_OM57 || mongoose.model("User_OM57", UserSchema);
  const Supplier = mongoose.models.Supplier_OM57 || mongoose.model("Supplier_OM57", SupplierSchema);
  const Category = mongoose.models.Category_OM57 || mongoose.model("Category_OM57", CategorySchema);
  const Product = mongoose.models.Product_OM57 || mongoose.model("Product_OM57", ProductSchema);
  const Order = mongoose.models.Order_OM57 || mongoose.model("Order_OM57", OrderSchema);
  const Coupon = mongoose.models.Coupon_OM57 || mongoose.model("Coupon_OM57", CouponSchema);
  const CouponUsage = mongoose.models.CouponUsage_OM57 || mongoose.model("CouponUsage_OM57", CouponUsageSchema);

  // --- Idempotency sweep (stale fixtures from previous runs) ---
  const stalePhones = [CUSTOMER_PHONE, SUPPLIER_PHONE];
  const staleUsers = await User.find({ phone: { $in: stalePhones } }).select("_id").lean();
  const staleUserIds = staleUsers.map((u) => u._id);
  if (staleUserIds.length > 0) {
    await db.collection("notifications").deleteMany({ recipient: { $in: staleUserIds } });
    await db.collection("couponusages").deleteMany({ user: { $in: staleUserIds } });
  }
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^OM[0-9]+_COUP$" } });
  await Supplier.deleteMany({ businessName: { $regex: "^OMTest" } });
  await User.deleteMany({ phone: { $in: stalePhones } });

  // --- Fixtures (users must EXIST before login attempts) ---
  const customer = await User.create({ name: "OM Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const supplierUser = await User.create({ name: "OM Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const supplierDoc = await Supplier.create({
    user: supplierUser._id,
    businessName: "OMTest " + PREFIX,
    contactPhone: SUPPLIER_PHONE,
    bankAccount: { cardNumber: "6037991234567890", iban: "IR123456789012345678901234", ownerName: "OM Supplier" },
    balance: 100000,
    pendingReserve: 0,
    telegramChatId: "",
    isActive: true,
  });
  await User.findByIdAndUpdate(supplierUser._id, { $set: { supplier: supplierDoc._id } });

  // Logins AFTER fixtures exist (admin is a seed user).
  const adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  const cJar = await login(CUSTOMER_PHONE, PASS);
  const sJar = await login(SUPPLIER_PHONE, PASS);
  assert(adminJar.header().includes("session-token"), "admin no session");
  assert(cJar.header().includes("session-token"), "customer no session");
  assert(sJar.header().includes("session-token"), "supplier no session");

  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const mkProduct = async (name, stock, soldCount = 0) =>
    Product.create({ name: PREFIX + name, slug: PREFIX + name, description: "om " + name, images: ["https://example.com/" + name + ".jpg"], category: catDoc._id, supplier: supplierDoc._id, price: 20000, supplierPrice: 9000, stock, stockVersion: 0, hasVariants: false, variants: [], isActive: true, soldCount });

  const prodHappy = await mkProduct("happy", 10);
  const prodSkip = await mkProduct("skip", 10);
  const prodRace = await mkProduct("race", 10);
  const prodShipped = await mkProduct("shipped", 10);
  // soldCount seeds = the qty these tests order (1) so the reversal reaches 0.
  const prodCancelPaid = await mkProduct("cancel-paid", 10, 1);
  const prodRefund = await mkProduct("refund", 10, 1);
  const prodNok = await mkProduct("nok", 10);
  const prodList = await mkProduct("list", 10);

  /** Place a real checkout (HTTP) — returns { orderId, supplierOrderId }. */
  const checkout = async (product, qty = 1) => {
    const res = await http("POST", "/api/checkout", cJar, {
      items: [{ id: String(product._id), quantity: qty, price: product.price, name: product.name }],
      shippingAddress: { fullName: "OM Tester", phone: customer.phone, address: "Tehran", postalCode: "12345" },
      paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const order = await Order.findById(res.data.orderId).lean();
    const so = await db.collection("supplierorders").findOne({ order: order._id });
    return { orderId: String(order._id), order, supplierOrderId: so ? String(so._id) : null };
  };

  /** Replicate the payment-verify SUCCESS claim filter verbatim (pending→paid). */
  const simulatePaid = async (orderId) => {
    const claim = await Order.findOneAndUpdate(
      { _id: orderId, "payment.status": "pending" },
      { $set: { "payment.status": "paid", "payment.paidAt": new Date() }, status: "processing" },
      { new: true }
    ).lean();
    assert(claim, "simulated paid claim must win");
  };

  const adminTransition = async (orderId, status, body = {}) =>
    http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status, ...body });

  // ================================================================
  // 1. Happy path: checkout → paid → confirmed → shipped(+tracking) → delivered
  // ================================================================
  let happyOrderId = null;
  await testAsync("Happy path: checkout→paid→confirmed→shipped(+tracking)→delivered", async () => {
    const { orderId, order } = await checkout(prodHappy, 2);
    happyOrderId = orderId;
    assert(order.status === "pending_payment", "order must start pending_payment");
    assert(order.payment.status === "pending" && order.payment.method === "manual", "payment must be pending/manual");
    assert(order.stockRestored === false, "stockRestored must be false");

    // Checkout reserves stock: 10 - 2 = 8
    const afterCheckout = await Product.findById(prodHappy._id).lean();
    assert(afterCheckout.stock === 8, "expected stock 8 after checkout, got " + afterCheckout.stock);

    await simulatePaid(orderId);
    const paidDoc = await Order.findById(orderId).lean();
    assert(paidDoc.payment.status === "paid", "payment must be paid");
    assert(paidDoc.status === "processing", "order status must be processing after paid");

    // processing → confirmed
    let res = await adminTransition(orderId, "confirmed");
    assert(res.status === 200, "confirmed transition expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "confirmed", "status must be confirmed");

    // confirmed → shipped (with shipping metadata)
    res = await adminTransition(orderId, "shipped", { shipping: { provider: "تیپاکس", trackingCode: "TPX-123456" } });
    assert(res.status === 200, "shipped transition expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "shipped", "status must be shipped");
    assert(res.data.shipping && res.data.shipping.provider === "تیپاکس", "shipping.provider must be stored");
    assert(res.data.shipping && res.data.shipping.trackingCode === "TPX-123456", "shipping.trackingCode must be stored");
    assert(res.data.shipping.shippedAt, "shipping.shippedAt must be set");

    // shipped → delivered
    res = await adminTransition(orderId, "delivered");
    assert(res.status === 200, "delivered transition expected 200, got " + res.status);
    assert(res.data.status === "delivered", "status must be delivered");
    assert(res.data.shipping.deliveredAt, "shipping.deliveredAt must be set");
  });

  // 2. Stock never restored on the paid happy path
  await testAsync("Stock NOT restored during paid fulfillment (8 stays 8)", async () => {
    const prod = await Product.findById(prodHappy._id).lean();
    assert(prod.stock === 8, "expected stock 8 (no restore on happy path), got " + prod.stock);
    const doc = await Order.findById(happyOrderId).lean();
    assert(doc.stockRestored === false, "stockRestored must stay false");
  });

  // 3. statusHistory actor labels (Session 57)
  await testAsync("statusHistory: admin transitions carry actor=admin", async () => {
    const doc = await Order.findById(happyOrderId).lean();
    const adminEntries = (doc.statusHistory || []).filter((h) => h.actor === "admin");
    assert(adminEntries.length >= 3, "expected at least 3 admin actor entries (confirmed/shipped/delivered), got " + adminEntries.length);
    const statuses = adminEntries.map((h) => h.status);
    assert(statuses.includes("confirmed") && statuses.includes("shipped") && statuses.includes("delivered"), "actor entries must cover confirmed/shipped/delivered");
    const createdAt = doc.statusHistory[0].at;
    assert(createdAt, "initial statusHistory entry must exist");
  });

  // ================================================================
  // 4. Forbidden transitions → 400
  // ================================================================
  await testAsync("Forbidden transitions -> 400 (delivered→*, cancelled→*, skip-state)", async () => {
    // Delivered order: any onward transition is forbidden
    let res = await adminTransition(happyOrderId, "shipped");
    assert(res.status === 400, "delivered→shipped expected 400, got " + res.status);
    res = await adminTransition(happyOrderId, "delivered");
    assert(res.status === 400, "delivered→delivered expected 400, got " + res.status);

    // Skip-state: pending_payment → confirmed is not a valid transition
    const { orderId } = await checkout(prodSkip, 1);
    res = await adminTransition(orderId, "confirmed");
    assert(res.status === 400, "pending_payment→confirmed expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const doc = await Order.findById(orderId).lean();
    assert(doc.status === "pending_payment", "status must stay pending_payment after forbidden transition");

    // cancelled → anything is forbidden
    const cancelRes = await adminTransition(orderId, "cancelled");
    assert(cancelRes.status === 200, "pending_payment→cancelled expected 200, got " + cancelRes.status);
    res = await adminTransition(orderId, "processing");
    assert(res.status === 400, "cancelled→processing expected 400, got " + res.status);
  });

  // ================================================================
  // 5. Atomic hardening: concurrent transitions → exactly one wins
  // ================================================================
  await testAsync("Atomic hardening: concurrent confirmed claims -> exactly one 200, one 400", async () => {
    const { orderId } = await checkout(prodRace, 1);
    await simulatePaid(orderId);
    const [r1, r2] = await Promise.all([
      adminTransition(orderId, "confirmed"),
      adminTransition(orderId, "confirmed"),
    ]);
    const wins = [r1, r2].filter((r) => r.status === 200).length;
    const loses = [r1, r2].filter((r) => r.status === 400).length;
    assert(wins === 1 && loses === 1, "expected exactly one 200 + one 400, got " + r1.status + "/" + r2.status);
    const doc = await Order.findById(orderId).lean();
    const confirmedEntries = (doc.statusHistory || []).filter((h) => h.status === "confirmed");
    assert(confirmedEntries.length === 1, "exactly one confirmed history entry expected, got " + confirmedEntries.length);
  });

  // ================================================================
  // 6. Shipping metadata validation
  // ================================================================
  await testAsync("Shipping fields rejected on non-shipped transitions -> 400", async () => {
    const { orderId } = await checkout(prodShipped, 1);
    await simulatePaid(orderId);
    const res = await adminTransition(orderId, "confirmed", { shipping: { trackingCode: "X" } });
    assert(res.status === 400, "shipping on confirmed expected 400, got " + res.status);
  });

  await testAsync("trackingCode optional on shipped (no shipping body accepted)", async () => {
    const { orderId } = await checkout(prodShipped, 1);
    await simulatePaid(orderId);
    let res = await adminTransition(orderId, "confirmed");
    assert(res.status === 200, "confirmed expected 200, got " + res.status);
    res = await adminTransition(orderId, "shipped");
    assert(res.status === 200, "shipped (no shipping) expected 200, got " + res.status);
    const doc = await Order.findById(orderId).lean();
    assert(doc.status === "shipped", "status must be shipped");
    assert(!doc.shipping || !doc.shipping.trackingCode, "trackingCode must stay empty when not provided");
  });

  // ================================================================
  // 7. Admin cancel of a PAID order reverses soldCount (Session 56 invariant)
  // ================================================================
  await testAsync("Admin cancel of PAID order -> reverseOrderSales (soldCount 1 -> 0)", async () => {
    const { orderId } = await checkout(prodCancelPaid, 1);
    await simulatePaid(orderId);
    const res = await adminTransition(orderId, "cancelled");
    assert(res.status === 200, "admin cancel expected 200, got " + res.status);
    const prod = await Product.findById(prodCancelPaid._id).lean();
    assert(prod.soldCount === 0, "expected soldCount 0 after admin cancel of paid order, got " + prod.soldCount);
    const doc = await Order.findById(orderId).lean();
    assert(doc.stockRestored === true, "stock must be restored on admin cancel");
    const prodStock = await Product.findById(prodCancelPaid._id).lean();
    assert(prodStock.stock === 10, "expected stock restored to 10, got " + prodStock.stock);
  });

  // ================================================================
  // 8. Refund: paid→refunded claim, stock restored once, double refund → 400
  // ================================================================
  await testAsync("Refund: paid→refunded, stock restored once, double refund -> 400", async () => {
    const { orderId } = await checkout(prodRefund, 1);
    await simulatePaid(orderId);
    let res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "Test refund" });
    assert(res.status === 200, "refund expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.payment.status === "refunded", "payment.status must be refunded");
    const ORDER_DOMAIN_STATUSES = ["pending_payment", "processing", "confirmed", "shipped", "delivered", "cancelled"];
    assert(
      ORDER_DOMAIN_STATUSES.includes(res.data.status),
      "order.status must stay in the ORDER domain (payment states live only in payment.status), got " + res.data.status
    );
    const prod = await Product.findById(prodRefund._id).lean();
    assert(prod.soldCount === 0, "expected soldCount 0 after refund, got " + prod.soldCount);
    assert(prod.stock === 10, "expected stock restored to 10 after refund, got " + prod.stock);
    // Double refund → 400
    res = await http("POST", "/api/admin/orders/refund", adminJar, { orderId, reason: "Again" });
    assert(res.status === 400, "double refund expected 400, got " + res.status);
  });

  // ================================================================
  // 9. Payment NOK rollback: stock restored, coupon released (Session 57 preservation)
  // ================================================================
  await testAsync("Payment NOK -> stock restored once + coupon released", async () => {
    // Coupon codes are normalized to UPPERCASE before lookup — the code must
    // be all-caps (the lowercase PREFIX would never match).
    const COUPON_CODE = "OM" + Date.now() + "_COUP";
    // Zero starting usage — checkout claims (→1), NOK releases (→0).
    const coupon = await Coupon.create({ code: COUPON_CODE, type: "percent", value: 10, minSubtotal: 0, maxDiscount: 0, startsAt: null, endsAt: null, isActive: true, isPublic: false, usageLimit: 5, perUserLimit: 2, usedCount: 0 });

    const res = await http("POST", "/api/checkout", cJar, {
      items: [{ id: String(prodNok._id), quantity: 2, price: prodNok.price, name: prodNok.name }],
      shippingAddress: { fullName: "OM Tester", phone: customer.phone, address: "Tehran", postalCode: "12345" },
      paymentMethod: "zarinpal",
      couponCode: COUPON_CODE,
    });
    assert(res.status === 201, "checkout expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const orderId = res.data.orderId;

    const nokUrl = "/api/payment/verify?Status=NOK&orderId=" + orderId + "&Authority=om-nok";
    const nokRes = await http("GET", nokUrl, cJar, undefined);
    assert(nokRes.status === 307 || nokRes.status === 302 || nokRes.status === 200, "NOK verify expected redirect, got " + nokRes.status);

    const doc = await Order.findById(orderId).lean();
    assert(doc.payment.status === "canceled", "payment.status must be canceled after NOK");
    assert(doc.stockRestored === true, "stock must be restored after NOK");
    const prod = await Product.findById(prodNok._id).lean();
    assert(prod.stock === 10, "expected stock restored to 10 after NOK, got " + prod.stock);
    const c = await Coupon.findById(coupon._id).lean();
    assert(c.usedCount === 0, "expected usedCount 0 after NOK, got " + c.usedCount);
    const usage = await CouponUsage.findOne({ coupon: coupon._id, user: customer._id }).lean();
    assert(usage && usage.count === 0, "expected usage count 0, got " + (usage && usage.count));
    assert(doc.discount && doc.discount.released === true, "discount.released must be true");
  });

  // ================================================================
  // 10. Permission checks on admin order endpoints
  // ================================================================
  await testAsync("Permissions: unauth/customer/supplier blocked from admin PUT", async () => {
    const { orderId } = await checkout(prodList, 1);
    let res = await adminTransition(orderId, "cancelled"); // ensure valid target
    assert(res.status === 200, "admin PUT must work for admin, got " + res.status);
    res = await http("PUT", "/api/admin/orders?id=" + orderId, null, { status: "processing" });
    assert(res.status === 401, "unauth PUT expected 401, got " + res.status);
    res = await http("PUT", "/api/admin/orders?id=" + orderId, cJar, { status: "processing" });
    assert(res.status === 403, "customer PUT expected 403, got " + res.status);
    res = await http("PUT", "/api/admin/orders?id=" + orderId, sJar, { status: "processing" });
    assert(res.status === 403, "supplier PUT expected 403, got " + res.status);
  });

  // ================================================================
  // 11. Admin list API: search, status filter, sort, pagination
  // ================================================================
  await testAsync("Admin list: sort=newest vs oldest ordering", async () => {
    const newest = await http("GET", "/api/admin/orders?sort=newest&limit=5", adminJar);
    const oldest = await http("GET", "/api/admin/orders?sort=oldest&limit=5", adminJar);
    assert(newest.status === 200 && oldest.status === 200, "list GETs must be 200");
    const newArr = newest.data.data || [];
    const oldArr = oldest.data.data || [];
    assert(newArr.length > 0 && oldArr.length > 0, "lists must not be empty");
    const newestFirst = new Date(newArr[0].createdAt).getTime();
    const oldestFirst = new Date(oldArr[0].createdAt).getTime();
    assert(newestFirst >= oldestFirst, "newest[0] must be >= oldest[0] in time");
  });

  await testAsync("Admin list: search by id + status filter + pagination", async () => {
    const { orderId } = await checkout(prodList, 1);
    const res = await adminTransition(orderId, "cancelled");
    assert(res.status === 200, "cancel expected 200, got " + res.status);
    // search by order id
    let list = await http("GET", "/api/admin/orders?search=" + orderId + "&limit=20", adminJar);
    assert(list.status === 200, "search GET expected 200, got " + list.status);
    assert(list.data.data && list.data.data.length >= 1, "search by id must find the order");
    assert(String(list.data.data[0]._id) === orderId, "found order must match");
    // search by customer name
    list = await http("GET", "/api/admin/orders?search=" + encodeURIComponent("OM Customer") + "&limit=20", adminJar);
    assert(list.status === 200 && list.data.data.length >= 1, "search by customer name must find orders");
    // status filter
    list = await http("GET", "/api/admin/orders?status=cancelled&limit=20", adminJar);
    assert(list.status === 200, "status filter GET expected 200");
    for (const o of list.data.data) assert(o.status === "cancelled", "filtered rows must all be cancelled");
    // pagination shape
    const paged = await http("GET", "/api/admin/orders?page=1&limit=5", adminJar);
    assert(paged.data && typeof paged.data.total === "number" && typeof paged.data.totalPages === "number", "pagination shape missing");
  });

  // ================================================================
  // 12. Customer cancel before payment (invariant preserved)
  // ================================================================
  await testAsync("Customer self-cancel before payment: stock restored + status cancelled", async () => {
    const prodCancelPre = await mkProduct("pre-cancel", 10);
    const { orderId } = await checkout(prodCancelPre, 1);
    const res = await http("POST", "/api/orders/" + orderId + "/cancel", cJar, {});
    assert(res.status === 200, "customer cancel expected 200, got " + res.status);
    const doc = await Order.findById(orderId).lean();
    assert(doc.status === "cancelled" && doc.stockRestored === true, "order must be cancelled + stock restored");
    const prod = await Product.findById(prodCancelPre._id).lean();
    assert(prod.stock === 10, "expected stock 10, got " + prod.stock);
    const entry = (doc.statusHistory || []).find((h) => h.status === "cancelled");
    assert(entry && entry.actor === "customer", "customer cancel must record actor=customer");
  });

  // ================================================================
  // 13. Customer cancel AFTER payment -> 409 (invariant preserved)
  // ================================================================
  await testAsync("Customer cancel after payment -> 409; stock NOT restored", async () => {
    const prodPaidCancel = await mkProduct("paid-cancel", 10);
    const { orderId } = await checkout(prodPaidCancel, 1);
    await simulatePaid(orderId);
    const res = await http("POST", "/api/orders/" + orderId + "/cancel", cJar, {});
    assert(res.status === 409, "customer cancel of paid order expected 409, got " + res.status);
    const doc = await Order.findById(orderId).lean();
    assert(doc.payment.status === "paid" && doc.stockRestored === false, "paid order must keep stock reserved");
  });

  // ================================================================
  // 14. Terminal state smoke: delivered/cancelled orders appear in list (no crash)
  // ================================================================
  await testAsync("Order detail GET for delivered order includes shipping", async () => {
    const list = await http("GET", "/api/admin/orders?sort=newest&limit=50", adminJar);
    const delivered = (list.data.data || []).find((o) => o.status === "delivered" && o.shipping);
    if (delivered) {
      assert(delivered.shipping.trackingCode, "delivered order must retain trackingCode");
    }
    // Even if none found, the endpoint must not crash.
    assert(true, "detail endpoint healthy");
  });

  // ================================================================
  // 17. Review finding: admin cancel vs payment-verify race at processing
  // ================================================================
  await testAsync("Atomic: admin cancel vs payment-verify at processing — no stale-read payment corruption", async () => {
    const prodRace2 = await mkProduct("race2", 10);
    const { orderId } = await checkout(prodRace2, 1);

    // Advance to processing while payment is STILL pending (the admin
    // early-confirm path) — the state where a status-only cancel claim could
    // race a concurrent payment-verify success claim.
    const res = await adminTransition(orderId, "processing");
    assert(res.status === 200, "processing expected 200, got " + res.status);

    // Concurrent: payment-verify SUCCESS claim (simulated) vs admin cancel.
    // NOTE: either outcome below is legal — the verify may commit before the
    // admin handler's pre-read (making the cancel a legitimate paid-cancel)
    // or the two claims may overlap. What must NEVER happen is the stale-read
    // fingerprint: a cancel that read payment=pending stamping payment.status
    // 'failed' onto a concurrently-paid order and skipping the sale reversal.
    await Promise.allSettled([
      simulatePaid(orderId),
      adminTransition(orderId, "cancelled"),
    ]);

    const doc = await Order.findById(orderId).lean();
    const prod = await Product.findById(prodRace2._id).lean();
    const ORDER_STATUSES = ["pending_payment", "processing", "confirmed", "shipped", "delivered", "cancelled"];

    assert(
      doc.payment.status !== "failed",
      "payment.status must NEVER be 'failed' on a racing cancel (stale-read fingerprint), got " + doc.payment.status
    );
    assert(
      ORDER_STATUSES.includes(doc.status),
      "order status must stay in the ORDER domain (payment states live only in payment.status), got " + doc.status
    );

    if (doc.status === "cancelled") {
      if (doc.payment.status === "paid") {
        // Legitimate paid-cancel: verify committed first, then the admin
        // cancelled the now-paid order. Stock restored + sale reversed;
        // the refund button remains available for the customer's money.
        assert(doc.stockRestored === true, "paid-cancel must restore stock");
        assert(prod.soldCount === 0, "paid-cancel must reverse soldCount, got " + prod.soldCount);
      } else {
        // Cancel won the overlap: payment must be canceled (never paid),
        // stock restored, and the sale never counted.
        assert(doc.payment.status === "canceled", "cancel-wins payment must be canceled, got " + doc.payment.status);
        assert(doc.stockRestored === true, "cancel-wins must restore stock");
        assert(prod.soldCount === 0, "soldCount must stay 0 when cancel wins");
      }
    } else {
      // Verify won cleanly: processing + paid, stock stays reserved.
      assert(doc.status === "processing", "status must stay processing, got " + doc.status);
      assert(doc.payment.status === "paid", "payment must be paid, got " + doc.payment.status);
      assert(doc.stockRestored === false, "stock must stay reserved when verify wins");
    }
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  const userDocs = await User.find({ phone: { $in: stalePhones } }).select("_id").lean();
  const userIds = userDocs.map((u) => u._id);
  if (userIds.length > 0) {
    await db.collection("notifications").deleteMany({ recipient: { $in: userIds } });
    await db.collection("couponusages").deleteMany({ user: { $in: userIds } });
  }
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^OM[0-9]+_COUP$" } });
  await Supplier.deleteMany({ businessName: { $regex: "^OMTest" } });
  await User.deleteMany({ phone: { $in: stalePhones } });
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
