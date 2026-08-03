/**
 * Session 46 — Customer Self-Service Order Cancellation Verification
 * (real HTTP API)
 *
 * Fixtures: customer A (cancels own pending_payment order), customer B (cross-
 * user isolation), one supplier (product ownership), admin (existing seed).
 *
 * Tests (17):
 *   1.  Seed logins (admin, customer A, customer B, supplier)
 *   2.  Unauthenticated cancel → 401
 *   3.  Supplier cancel → 403
 *   4.  Admin cancel → 403
 *   5.  Cross-user cancel (B cancels A's order) → 404
 *   6.  Cancel own pending_payment → 200; status=cancelled, payment.status=canceled
 *   7.  Stock restored EXACTLY ONCE (simple product, DB check)
 *   8.  statusHistory audit: { status:"cancelled", actor:"customer",
 *       note:"customer_cancelled" } — machine-readable, no raw input
 *   9.  order_cancelled notification (key order_<id>_order_cancelled, category
 *       order, link /orders/<id>)
 *  10.  Re-cancel → 409 (atomic claim); notification count stays 1; no double
 *       stock restore
 *  11.  Variant order cancel → variant stock restored exactly once
 *  12.  Coupon released (usedCount 0, CouponUsage count 0, discount.released)
 *  13.  Paid/processing order cancel → 409; stock NOT restored
 *  14.  RACE (verify-wins, deterministic): verify-success claim first → cancel
 *       409; stock untouched; no paid+restored
 *  15.  RACE (cancel-wins, deterministic): cancel 200 → verify-success claim
 *       null (no payment success after a restored order)
 *  16.  RACE (concurrent cancel vs verify-success) → exactly one wins; never
 *       paid+restored; no double restore
 *  17.  RACE (concurrent cancel vs real verify-NOK endpoint) → exactly one
 *       wins; stock restored exactly once (no double restore)
 *
 * Usage: node scripts/verify-order-cancel.js
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
const PREFIX = "oc_" + Date.now() + "_";
const PASS = "oc-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_A_PHONE = "09174441011";
const CUSTOMER_B_PHONE = "09174441012";
const SUPPLIER_PHONE = "09174441013";

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
    subtotalAmount: Number,
    discount: { type: mongoose.Schema.Types.Mixed, default: null },
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
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
  console.log("  SESSION 46 — CUSTOMER SELF-SERVICE ORDER CANCELLATION (REAL HTTP API)");
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
  const User = mongoose.models.User_OC46 || mongoose.model("User_OC46", UserSchema);
  const Supplier = mongoose.models.Supplier_OC46 || mongoose.model("Supplier_OC46", SupplierSchema);
  const Category = mongoose.models.Category_OC46 || mongoose.model("Category_OC46", CategorySchema);
  const Product = mongoose.models.Product_OC46 || mongoose.model("Product_OC46", ProductSchema);
  const Order = mongoose.models.Order_OC46 || mongoose.model("Order_OC46", OrderSchema);
  const Coupon = mongoose.models.Coupon_OC46 || mongoose.model("Coupon_OC46", CouponSchema);
  const CouponUsage = mongoose.models.CouponUsage_OC46 || mongoose.model("CouponUsage_OC46", CouponUsageSchema);

  // --- Idempotency sweep (stale fixtures from previous runs) ---
  const stalePhones = [CUSTOMER_A_PHONE, CUSTOMER_B_PHONE, SUPPLIER_PHONE];
  const staleUsers = await User.find({ phone: { $in: stalePhones } }).select("_id").lean();
  const staleUserIds = staleUsers.map((u) => u._id);
  if (staleUserIds.length > 0) {
    await db.collection("notifications").deleteMany({ recipient: { $in: staleUserIds } });
    await db.collection("couponusages").deleteMany({ user: { $in: staleUserIds } });
  }
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^OCTest" } });
  await User.deleteMany({ phone: { $in: stalePhones } });

  // --- Fixtures (users must EXIST before login attempts) ---
  const customerA = await User.create({ name: "OC Customer A", phone: CUSTOMER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customerB = await User.create({ name: "OC Customer B", phone: CUSTOMER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const supplierUser = await User.create({ name: "OC Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const supplierDoc = await Supplier.create({
    user: supplierUser._id,
    businessName: "OCTest " + PREFIX,
    contactPhone: SUPPLIER_PHONE,
    bankAccount: { cardNumber: "6037991234567890", iban: "IR123456789012345678901234", ownerName: "OC Supplier" },
    balance: 100000,
    pendingReserve: 0,
    telegramChatId: "",
    isActive: true,
  });
  await User.findByIdAndUpdate(supplierUser._id, { $set: { supplier: supplierDoc._id } });

  // Logins AFTER fixtures exist (admin is a seed user; A/B/supplier are fixtures).
  const adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  const aJar = await login(CUSTOMER_A_PHONE, PASS);
  const bJar = await login(CUSTOMER_B_PHONE, PASS);
  const sJar = await login(SUPPLIER_PHONE, PASS);

  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  // Simple product with 10 in stock; variant product with a 5-stock variant.
  const prodSimple = await Product.create({ name: PREFIX + "prod-simple", slug: PREFIX + "prod-simple", description: "oc simple", images: ["https://example.com/s.jpg"], category: catDoc._id, supplier: supplierDoc._id, price: 20000, supplierPrice: 9000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const variantId = new mongoose.Types.ObjectId();
  const prodVariant = await Product.create({ name: PREFIX + "prod-var", slug: PREFIX + "prod-var", description: "oc variant", images: ["https://example.com/v.jpg"], category: catDoc._id, supplier: supplierDoc._id, price: 30000, supplierPrice: 12000, stock: 5, stockVersion: 0, hasVariants: true, variants: [{ _id: variantId, sku: PREFIX + "SKU", attributes: [{ attributeId: null, name: "رنگ", value: "قرمز" }], price: 30000, supplierPrice: 12000, stock: 5, stockVersion: 0, images: [], isActive: true }], isActive: true });

  // Dedicated products so every stock assertion has a deterministic baseline.
  const mkDedicated = async (name, stock) =>
    Product.create({ name: PREFIX + name, slug: PREFIX + name, description: "oc " + name, images: ["https://example.com/" + name + ".jpg"], category: catDoc._id, supplier: supplierDoc._id, price: 20000, supplierPrice: 9000, stock, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodCoupon = await mkDedicated("prod-coupon", 10); // coupon-release test
  const prodRaceA = await mkDedicated("prod-race-a", 10); // verify-wins race
  const prodRaceB = await mkDedicated("prod-race-b", 10); // cancel-wins race
  const prodRaceC = await mkDedicated("prod-race-c", 10); // concurrent race
  const prodRaceD = await mkDedicated("prod-race-d", 10); // cancel vs NOK race

  const mkOrder = async ({ customer, product, qty = 1, variant = null, status = "pending_payment", paymentStatus = "pending", withCoupon = false }) => {
    const couponDoc = withCoupon
      ? await Coupon.create({ code: PREFIX + "COUP", type: "percent", value: 10, minSubtotal: 0, maxDiscount: 0, startsAt: null, endsAt: null, isActive: true, isPublic: false, usageLimit: 5, perUserLimit: 2, usedCount: 1 })
      : null;
    if (withCoupon) {
      await CouponUsage.create({ coupon: couponDoc._id, user: customer._id, count: 1 });
    }
    const unitPrice = variant ? variant.price : product.price;
    const total = unitPrice * qty;
    const doc = await Order.create({
      customer: customer._id,
      items: [{
        product: product._id,
        supplier: supplierDoc._id,
        variantId: variant ? variant._id : null,
        sku: variant ? variant.sku : "",
        variantLabel: variant ? "قرمز" : "",
        image: product.images?.[0] || "",
        name: PREFIX + "item-" + Date.now(),
        price: unitPrice,
        supplierPrice: variant ? variant.supplierPrice : product.supplierPrice,
        quantity: qty,
      }],
      totalAmount: total,
      subtotalAmount: total,
      discount: withCoupon
        ? { code: PREFIX + "COUP", couponId: couponDoc._id, type: "percent", value: 10, amount: Math.floor(total * 0.1), released: false }
        : null,
      shippingAddress: { fullName: "OC Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
      payment: { status: paymentStatus, method: "zarinpal", authority: "", refId: "", cardPan: "", paidAt: null },
      status,
      stockRestored: false,
      statusHistory: [{ status, at: new Date(), note: "created" }],
    });
    return { order: doc, coupon: couponDoc };
  };

  await testAsync("Seed logins (admin/A/B/supplier)", async () => {
    assert(adminJar.header().includes("session-token"), "admin no session");
    assert(aJar.header().includes("session-token"), "A no session");
    assert(bJar.header().includes("session-token"), "B no session");
    assert(sJar.header().includes("session-token"), "supplier no session");
  });

  // --- TEST 1: unauth → 401 ---
  let txn1 = null;
  await testAsync("Unauthenticated cancel -> 401", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodSimple, qty: 2 });
    txn1 = String(order._id);
    const res = await http("POST", "/api/orders/" + txn1 + "/cancel", null, {});
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: supplier → 403 ---
  await testAsync("Supplier cancel -> 403", async () => {
    const res = await http("POST", "/api/orders/" + txn1 + "/cancel", sJar, {});
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: admin → 403 ---
  await testAsync("Admin cancel -> 403", async () => {
    const res = await http("POST", "/api/orders/" + txn1 + "/cancel", adminJar, {});
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: cross-user → 404 ---
  await testAsync("Cross-user cancel (B cancels A's order) -> 404", async () => {
    const res = await http("POST", "/api/orders/" + txn1 + "/cancel", bJar, {});
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  // --- TEST 5: cancel own pending_payment → 200 + state ---
  let simpleOrder = null;
  await testAsync("Cancel own pending_payment -> 200; status=cancelled + payment.status=canceled", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodSimple, qty: 2 });
    simpleOrder = order;
    const res = await http("POST", "/api/orders/" + String(order._id) + "/cancel", aJar, {});
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.status === "cancelled" && res.data.cancelled === true, "response must carry cancelled=true");
    const doc = await Order.findById(order._id).lean();
    assert(doc.status === "cancelled", "order.status must be cancelled");
    assert(doc.payment.status === "canceled", "payment.status must be canceled, got " + doc.payment.status);
    assert(doc.stockRestored === true, "stockRestored must be true");
  });

  // --- TEST 6: stock restored exactly once (simple) ---
  await testAsync("Stock restored EXACTLY ONCE (simple: 10 + 2 = 12)", async () => {
    const prod = await Product.findById(prodSimple._id).lean();
    assert(prod.stock === 12, "expected stock 12, got " + prod.stock);
    assert((prod.stockVersion ?? 0) >= 1, "stockVersion must have incremented");
  });

  // --- TEST 7: statusHistory audit (machine-readable) ---
  await testAsync("statusHistory audit { status:cancelled, actor:customer, note:customer_cancelled }", async () => {
    const doc = await Order.findById(simpleOrder._id).lean();
    const entry = (doc.statusHistory || []).find((h) => h.status === "cancelled");
    assert(entry, "cancelled statusHistory entry missing");
    assert(entry.actor === "customer", "actor must be 'customer', got " + entry.actor);
    assert(entry.note === "customer_cancelled", "note must be machine-readable 'customer_cancelled', got '" + entry.note + "'");
    assert(!entry.customerNote, "no raw customerNote may exist yet");
  });

  // --- TEST 8: order_cancelled notification ---
  await testAsync("order_cancelled notification (key order_<id>_order_cancelled)", async () => {
    const orderId = String(simpleOrder._id);
    const notif = await waitFor(async () => {
      const list = await http("GET", "/api/notifications?limit=50", aJar);
      if (list.status !== 200) return null;
      return (list.data.data || []).find(
        (n) => n.type === "order_cancelled" && n.notificationKey === "order_" + orderId + "_order_cancelled"
      ) || null;
    });
    assert(notif, "order_cancelled notification not found");
    assert(notif.category === "order", "category must be order, got " + notif.category);
    assert(notif.link === "/orders/" + orderId, "link must be /orders/<id>, got " + notif.link);
  });

  // --- TEST 9: re-cancel → 409 + count stays 1 + no double restore ---
  await testAsync("Re-cancel -> 409; notification count stays 1; no double stock restore", async () => {
    const orderId = String(simpleOrder._id);
    const res = await http("POST", "/api/orders/" + orderId + "/cancel", aJar, {});
    assert(res.status === 409, "expected 409, got " + res.status);
    const count = await db.collection("notifications").countDocuments({
      type: "order_cancelled",
      notificationKey: "order_" + orderId + "_order_cancelled",
    });
    assert(count === 1, "expected 1 notification, got " + count);
    const prod = await Product.findById(prodSimple._id).lean();
    assert(prod.stock === 12, "stock must stay 12 after re-cancel, got " + prod.stock);
  });

  // --- TEST 10: variant order cancel → variant stock restored exactly once ---
  await testAsync("Variant order cancel -> variant stock restored exactly once (5 + 1 = 6)", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodVariant, qty: 1, variant: { _id: variantId, price: 30000, supplierPrice: 12000, sku: PREFIX + "SKU" } });
    const res = await http("POST", "/api/orders/" + String(order._id) + "/cancel", aJar, {});
    assert(res.status === 200, "expected 200, got " + res.status);
    const prod = await Product.findById(prodVariant._id).lean();
    const v = (prod.variants || []).find((x) => String(x._id) === String(variantId));
    assert(v && v.stock === 6, "expected variant stock 6, got " + (v && v.stock));
    assert(prod.stock === 6, "top-level summary stock must be 6, got " + prod.stock);
  });

  // --- TEST 11: coupon released ---
  await testAsync("Coupon released after cancel (usedCount 0, usage count 0, discount.released)", async () => {
    const { order, coupon } = await mkOrder({ customer: customerA, product: prodCoupon, qty: 1, withCoupon: true });
    const res = await http("POST", "/api/orders/" + String(order._id) + "/cancel", aJar, {});
    assert(res.status === 200, "expected 200, got " + res.status);
    const c = await Coupon.findById(coupon._id).lean();
    assert(c.usedCount === 0, "expected usedCount 0, got " + c.usedCount);
    const usage = await CouponUsage.findOne({ coupon: coupon._id, user: customerA._id }).lean();
    assert(usage && usage.count === 0, "expected usage count 0, got " + (usage && usage.count));
    const o = await Order.findById(order._id).lean();
    assert(o.discount && o.discount.released === true, "discount.released must be true");
  });

  // --- TEST 12: paid/processing order → 409 + stock NOT restored ---
  await testAsync("Paid/processing order cancel -> 409; stock NOT restored", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodCoupon, qty: 1, status: "processing", paymentStatus: "paid" });
    const res = await http("POST", "/api/orders/" + String(order._id) + "/cancel", aJar, {});
    assert(res.status === 409, "expected 409, got " + res.status);
    const doc = await Order.findById(order._id).lean();
    assert(doc.status === "processing", "status must stay processing");
    assert(doc.stockRestored === false, "stockRestored must stay false (no restore for paid order)");
  });

  // --- TEST 13: RACE verify-wins (deterministic) ---
  await testAsync("RACE verify-wins: verify-success claim first -> cancel 409; stock untouched", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodRaceA, qty: 1 });
    const orderId = String(order._id);
    // Replicate the payment-verify SUCCESS claim filter verbatim (payment.status pending).
    const verifyClaim = await Order.findOneAndUpdate(
      { _id: orderId, "payment.status": "pending" },
      { $set: { "payment.status": "paid", "payment.paidAt": new Date() }, status: "processing" },
      { new: true }
    ).lean();
    assert(verifyClaim, "verify-success claim must win first");
    const res = await http("POST", "/api/orders/" + orderId + "/cancel", aJar, {});
    assert(res.status === 409, "expected 409, got " + res.status);
    const doc = await Order.findById(orderId).lean();
    assert(doc.payment.status === "paid", "must stay paid");
    assert(doc.stockRestored === false, "no paid order may have restored stock");
    const prod = await Product.findById(prodRaceA._id).lean();
    assert(prod.stock === 10, "stock must be untouched (10), got " + prod.stock);
  });

  // --- TEST 14: RACE cancel-wins (deterministic) ---
  await testAsync("RACE cancel-wins: cancel 200 -> verify-success claim null (no paid+restored)", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodRaceB, qty: 1 });
    const orderId = String(order._id);
    const res = await http("POST", "/api/orders/" + orderId + "/cancel", aJar, {});
    assert(res.status === 200, "expected 200, got " + res.status);
    const verifyClaim = await Order.findOneAndUpdate(
      { _id: orderId, "payment.status": "pending" },
      { $set: { "payment.status": "paid", "payment.paidAt": new Date() }, status: "processing" },
      { new: true }
    ).lean();
    assert(!verifyClaim, "verify-success claim must fail after cancel (payment no longer pending)");
    const doc = await Order.findById(orderId).lean();
    assert(doc.payment.status === "canceled", "payment must stay canceled");
    assert(doc.status === "cancelled", "status must stay cancelled");
    const prod = await Product.findById(prodRaceB._id).lean();
    assert(prod.stock === 11, "stock must be restored once (10+1=11), got " + prod.stock);
  });

  // --- TEST 15: RACE concurrent cancel vs verify-success ---
  await testAsync("RACE concurrent: cancel vs verify-success -> exactly ONE wins; never paid+restored", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodRaceC, qty: 1 });
    const orderId = String(order._id);
    const [cancelRes, verifyClaim] = await Promise.all([
      http("POST", "/api/orders/" + orderId + "/cancel", aJar, {}),
      Order.findOneAndUpdate(
        { _id: orderId, "payment.status": "pending" },
        { $set: { "payment.status": "paid", "payment.paidAt": new Date() }, status: "processing" },
        { new: true }
      ).lean(),
    ]);
    const cancelWon = cancelRes.status === 200;
    const verifyWon = !!verifyClaim;
    assert(cancelWon !== verifyWon, "exactly one of cancel/verify must win (cancel=" + cancelRes.status + ", verify=" + !!verifyClaim + ")");
    const doc = await Order.findById(orderId).lean();
    assert(!(doc.payment.status === "paid" && doc.stockRestored === true), "NEVER paid+restored");
    const prod = await Product.findById(prodRaceC._id).lean();
    if (cancelWon) {
      assert(doc.status === "cancelled" && doc.payment.status === "canceled", "cancel winner state wrong");
      assert(prod.stock === 11, "cancel winner must restore stock once (10+1=11), got " + prod.stock);
    } else {
      assert(doc.payment.status === "paid" && doc.stockRestored === false, "verify winner state wrong");
      assert(prod.stock === 10, "verify winner must NOT restore stock (10), got " + prod.stock);
    }
  });

  // --- TEST 16: RACE concurrent cancel vs real verify-NOK endpoint ---
  await testAsync("RACE concurrent: cancel vs verify-NOK -> exactly ONE wins; stock restored exactly once", async () => {
    const { order } = await mkOrder({ customer: customerA, product: prodRaceD, qty: 2 });
    const orderId = String(order._id);
    const nokUrl = "/api/payment/verify?Status=NOK&orderId=" + orderId + "&Authority=noc-race";
    const [cancelRes, nokRes] = await Promise.all([
      http("POST", "/api/orders/" + orderId + "/cancel", aJar, {}),
      http("GET", nokUrl, aJar, undefined),
    ]);
    const doc = await Order.findById(orderId).lean();
    const cancelWon = cancelRes.status === 200 && doc.status === "cancelled";
    const nokWon = doc.payment.status === "canceled" && doc.status !== "cancelled";
    assert(cancelWon !== nokWon, "exactly one of cancel/NOK must claim the order (cancel=" + cancelRes.status + ", nokStatus=" + nokRes.status + ", doc=" + doc.status + "/" + doc.payment.status + ")");
    assert(doc.stockRestored === true, "stock must be restored exactly once (stockRestored true)");
    // Dedicated product: baseline 10, order qty 2 → exactly ONE restore → 12 (never 14).
    const prod = await Product.findById(prodRaceD._id).lean();
    assert(prod.stock === 12, "expected stock 12 (single restore of qty 2), got " + prod.stock);
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
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^OCTest" } });
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
