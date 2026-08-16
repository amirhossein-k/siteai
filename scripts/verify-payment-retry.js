/**
 * Session 30 — Payment Retry & Abandoned Cleanup Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated retry → 401
 *   2. Customer can retry their OWN failed payment → 200 + paymentUrl + authority
 *   3. New Zarinpal authority generated (differs from old, sandbox "S..." prefix)
 *   4. Retry of a failed order re-reserves stock exactly once (stock decreases by qty)
 *   5. User cannot retry another user's order → 404
 *   6. Paid order cannot be retried → 400
 *   7. Cancelled (cleanup-terminal) order cannot be retried → 400
 *   8. Retry of a still-pending order does NOT change stock (reservation preserved)
 *   9. Abandoned pending_payment (>24h) is auto-cancelled and stock restored exactly once
 *  10. Second cleanup run does nothing (no double restore)
 *
 * Usage: node scripts/verify-payment-retry.js
 * Requires: dev server on http://localhost:3000, real DB, ZARINPAL sandbox reachable.
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
const PREFIX = "retry_" + Date.now() + "_";
const PASS = "retry-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_A_PHONE = "09138880001";
const CUSTOMER_B_PHONE = "09138880002";

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
    // Session 82 Phase C hardening — purchased-FIFO retry fixtures.
    sourcing: String,
    costLayers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, collection: "products" }
);
const OrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [{ product: mongoose.Schema.Types.ObjectId, supplier: mongoose.Schema.Types.ObjectId, variantId: mongoose.Schema.Types.ObjectId, name: String, price: Number, supplierPrice: Number, quantity: Number, fifoUnitCost: Number }],
    totalAmount: Number,
    shippingAddress: { fullName: String, phone: String, address: String, postalCode: String },
    payment: { status: String, method: String, authority: String, refId: String, cardPan: String, paidAt: Date },
    status: String,
    stockRestored: Boolean,
    statusHistory: [{ status: String, at: Date, note: String }],
  },
  { timestamps: true, collection: "orders" }
);

async function makeOrder(db, { customer, product, qty, paymentStatus, orderStatus = "pending_payment", stockRestored = false, authority = "", createdAt, itemFifoUnitCost = null }) {
  return db.collection("orders").insertOne({
    customer: customer._id,
    items: [{
      product: product._id,
      supplier: new mongoose.Types.ObjectId(),
      variantId: null,
      name: product.name,
      price: product.price,
      supplierPrice: product.supplierPrice,
      quantity: qty,
      fifoUnitCost: itemFifoUnitCost,
    }],
    totalAmount: product.price * qty,
    shippingAddress: { fullName: "Retry Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
    payment: { status: paymentStatus, method: "zarinpal", authority, refId: "", cardPan: "", paidAt: null },
    status: orderStatus,
    stockRestored,
    statusHistory: [{ status: "pending_payment", at: new Date(), note: "test" }],
    createdAt: createdAt || new Date(),
    // Cleanup filters on updatedAt (retry bumps it) — keep both timestamps
    // aligned so an "abandoned" fixture is picked up by the 24h sweep.
    updatedAt: createdAt || new Date(),
  });
}

async function getStock(db, productId) {
  const doc = await db.collection("products").findOne({ _id: productId }, { projection: { stock: 1 } });
  return doc ? doc.stock : null;
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 30 — PAYMENT RETRY & ABANDONED CLEANUP (REAL HTTP API)");
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
  const User = mongoose.models.User_RETRY || mongoose.model("User_RETRY", UserSchema);
  const Supplier = mongoose.models.Supplier_RETRY || mongoose.model("Supplier_RETRY", SupplierSchema);
  const Category = mongoose.models.Category_RETRY || mongoose.model("Category_RETRY", CategorySchema);
  const Product = mongoose.models.Product_RETRY || mongoose.model("Product_RETRY", ProductSchema);

  // --- Idempotency sweep ---
  const sweepProductIds = (await db.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } }).project({ _id: 1 }).toArray()).map((x) => x._id);
  if (sweepProductIds.length) {
    await db.collection("inventorymovements").deleteMany({ product: { $in: sweepProductIds } });
  }
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_A_PHONE, CUSTOMER_B_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^RetryTest" } });

  // --- Fixtures ---
  const customerA = await User.create({ name: "Retry Customer A", phone: CUSTOMER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customerB = await User.create({ name: "Retry Customer B", phone: CUSTOMER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Retry Supplier", phone: "09138880003", passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "RetryTest Supplier Co", contactPhone: "09138880003", isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const makeProduct = (slugSuffix, stock) =>
    Product.create({
      name: PREFIX + slugSuffix, slug: PREFIX + slugSuffix, description: "retry test",
      category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000,
      stock, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
    });

  const prodFailed = await makeProduct("prod-failed", 10);   // for retry re-reservation test
  const prodPending = await makeProduct("prod-pending", 10); // for pending no-change test
  const prodAbandoned = await makeProduct("prod-abandoned", 10); // for cleanup test

  let adminJar = null;
  let aJar = null;
  let bJar = null;

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

  // --- TEST 1: unauthenticated retry → 401 ---
  await testAsync("Unauthenticated /api/payment/retry -> 401", async () => {
    const res = await http("POST", "/api/payment/retry", null, { orderId: new mongoose.Types.ObjectId().toString() });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2+3+4: retry own FAILED order → 200, new authority, stock re-reserved ---
  // Simulate a failed payment: stock was restored (stockRestored=true), so product
  // stock is back at full (10). Retry must re-reserve qty and issue a new authority.
  const oldAuthority = "OLD_AUTH_" + Date.now();
  let failedOrderId = null;

  await testAsync("Retry own failed payment -> 200 + paymentUrl", async () => {
    const inserted = await makeOrder(db, {
      customer: customerA, product: prodFailed, qty: 2,
      paymentStatus: "failed", orderStatus: "pending_payment", stockRestored: true, authority: oldAuthority,
    });
    failedOrderId = inserted.insertedId.toString();

    const before = await getStock(db, prodFailed._id);
    assert(before === 10, "expected full stock 10 before retry, got " + before);

    const res = await http("POST", "/api/payment/retry", aJar, { orderId: failedOrderId });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(!!res.data.paymentUrl && res.data.paymentUrl.includes("StartPay"), "no paymentUrl: " + JSON.stringify(res.data).slice(0, 150));
    assert(!!res.data.authority, "no authority returned");

    const after = await getStock(db, prodFailed._id);
    assert(after === 8, "stock must be re-reserved by qty 2 (10 -> 8), got " + after);
    console.log("\n      authority=" + String(res.data.authority).slice(0, 20) + "... stock 10->" + after);
  });

  await testAsync("New authority generated (differs from old, sandbox S...)", async () => {
    const orderDoc = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(failedOrderId) });
    assert(orderDoc && orderDoc.payment, "order missing");
    assert(orderDoc.payment.authority && orderDoc.payment.authority !== oldAuthority, "authority not refreshed");
    assert(String(orderDoc.payment.authority).startsWith("S"), "unexpected authority format: " + orderDoc.payment.authority);
    assert(orderDoc.payment.status === "pending", "payment.status must be pending after retry, got " + orderDoc.payment.status);
    assert(orderDoc.stockRestored === false, "stockRestored must be false after re-reservation");
  });

  // --- TEST 5: another user cannot retry ---
  await testAsync("User B cannot retry User A's order -> 404", async () => {
    const res = await http("POST", "/api/payment/retry", bJar, { orderId: failedOrderId });
    assert(res.status === 404, "expected 404, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
  });

  // --- TEST 6: paid order cannot retry ---
  await testAsync("Paid order cannot be retried -> 400", async () => {
    const inserted = await makeOrder(db, {
      customer: customerA, product: prodFailed, qty: 1,
      paymentStatus: "paid", orderStatus: "processing", stockRestored: true, authority: "PAID_" + Date.now(),
    });
    const res = await http("POST", "/api/payment/retry", aJar, { orderId: inserted.insertedId.toString() });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 7: cancelled (cleanup-terminal) order cannot retry ---
  await testAsync("Cancelled order cannot be retried -> 400", async () => {
    const inserted = await makeOrder(db, {
      customer: customerA, product: prodFailed, qty: 1,
      paymentStatus: "canceled", orderStatus: "cancelled", stockRestored: true, authority: "CAN_" + Date.now(),
    });
    const res = await http("POST", "/api/payment/retry", aJar, { orderId: inserted.insertedId.toString() });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 8: retry of still-pending order does NOT change stock ---
  await testAsync("Retry pending order -> 200, stock UNCHANGED (reservation preserved)", async () => {
    // Simulate a checkout that reserved stock: product stock already decremented (8),
    // order still pending with stockRestored=false.
    await db.collection("products").updateOne({ _id: prodPending._id }, { $set: { stock: 8, stockVersion: 1 } });
    const inserted = await makeOrder(db, {
      customer: customerA, product: prodPending, qty: 2,
      paymentStatus: "pending", orderStatus: "pending_payment", stockRestored: false, authority: "PEND_" + Date.now(),
    });
    const res = await http("POST", "/api/payment/retry", aJar, { orderId: inserted.insertedId.toString() });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const after = await getStock(db, prodPending._id);
    assert(after === 8, "stock must stay 8 for pending retry, got " + after);
    console.log("\n      stock stayed " + after + " (no double reservation)");
  });

  // --- TEST: concurrent retries of the same PENDING order → exactly one wins ---
  await testAsync("Concurrent retries of same pending order -> one 200, one 409", async () => {
    const inserted = await makeOrder(db, {
      customer: customerA, product: prodPending, qty: 2,
      paymentStatus: "pending", orderStatus: "pending_payment", stockRestored: false, authority: "CONC_" + Date.now(),
    });
    const orderId = inserted.insertedId.toString();

    const [r1, r2] = await Promise.all([
      http("POST", "/api/payment/retry", aJar, { orderId }),
      http("POST", "/api/payment/retry", aJar, { orderId }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert(
      statuses[0] === 200 && statuses[1] === 409,
      "expected [200,409], got " + JSON.stringify(statuses)
    );

    // Exactly ONE authority persisted (the winner's), retryToken released.
    const orderDoc = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
    assert(orderDoc && orderDoc.payment, "order missing");
    assert(
      orderDoc.payment.authority && !String(orderDoc.payment.authority).startsWith("CONC_"),
      "authority should be refreshed by the winner"
    );
    assert(
      orderDoc.payment.retryToken === undefined || orderDoc.payment.retryToken === "",
      "retryToken must be released after retry, got " + orderDoc.payment.retryToken
    );

    // Stock unchanged (pending path never touches stock)
    const after = await getStock(db, prodPending._id);
    assert(after === 8, "stock must stay 8 for pending concurrent retries, got " + after);
    console.log("\n      statuses=" + JSON.stringify(statuses) + " stock still " + after);
  });

  // --- TEST 9: abandoned pending_payment (>24h) auto-cancel + restore exactly once ---
  await testAsync("Abandoned pending_payment (>24h) auto-cancelled + stock restored once", async () => {
    // Simulate checkout reservation: stock 10 -> 7 (qty 3), order pending, stockRestored=false
    await db.collection("products").updateOne({ _id: prodAbandoned._id }, { $set: { stock: 7, stockVersion: 1 } });
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
    const inserted = await makeOrder(db, {
      customer: customerA, product: prodAbandoned, qty: 3,
      paymentStatus: "pending", orderStatus: "pending_payment", stockRestored: false, authority: "ABANDON_" + Date.now(),
      createdAt: old,
    });
    const orderId = inserted.insertedId.toString();

    const res = await http("GET", "/api/payment/cleanup", adminJar);
    assert(res.status === 200, "cleanup expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.cleaned >= 1, "expected >=1 cleaned, got " + res.data.cleaned);

    const orderDoc = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
    assert(orderDoc.status === "cancelled", "order should be cancelled, got " + orderDoc.status);
    assert(orderDoc.payment.status === "canceled", "payment.status should be canceled");
    const after = await getStock(db, prodAbandoned._id);
    assert(after === 10, "stock should be restored to 10, got " + after);
    console.log("\n      stock 7->" + after + " (restored exactly once)");
  });

  // --- TEST 10: second cleanup run does nothing ---
  await testAsync("Second cleanup run does nothing (no double restore)", async () => {
    const res = await http("GET", "/api/payment/cleanup", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    const after = await getStock(db, prodAbandoned._id);
    assert(after === 10, "stock must stay 10 after second cleanup, got " + after);
    console.log("\n      stock still " + after);
  });

  // ============================================================
  // Session 82 Phase C hardening — PURCHASED (FIFO) retry regression
  // ============================================================
  const layer = (qty, unitCost) => ({
    qty, remaining: qty, unitCost,
    acquiredAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    source: "receipt", ref: "rc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
  });
  const makePurchasedProduct = async (slugSuffix, stock, layersArr) =>
    Product.create({
      name: PREFIX + slugSuffix, slug: PREFIX + slugSuffix, description: "purchased retry",
      category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000,
      stock, stockVersion: 0, hasVariants: false, variants: [], isActive: true,
      sourcing: "purchased", costLayers: layersArr,
    });
  const getPurchasedLayers = async (productId) => {
    const doc = await db.collection("products").findOne({ _id: productId }, { projection: { costLayers: 1 } });
    return doc ? (doc.costLayers || []) : [];
  };
  const layersRemaining = (layersArr) => layersArr.reduce((s, l) => s + (l.remaining || 0), 0);
  const makeMultiOrder = async (db2, { customer, items, paymentStatus, stockRestored }) =>
    db2.collection("orders").insertOne({
      customer: customer._id,
      items: items.map((it) => ({
        product: it.product._id,
        supplier: new mongoose.Types.ObjectId(),
        variantId: null,
        name: it.product.name,
        price: it.product.price,
        supplierPrice: it.product.supplierPrice,
        quantity: it.qty,
        fifoUnitCost: it.fifoUnitCost ?? null,
      })),
      totalAmount: items.reduce((s, it) => s + it.product.price * it.qty, 0),
      shippingAddress: { fullName: "Retry Tester", phone: customer.phone, address: "Tehran", postalCode: "" },
      payment: { status: paymentStatus, method: "zarinpal", authority: "PURCH_MULTI_" + Date.now(), refId: "", cardPan: "", paidAt: null },
      status: "pending_payment",
      stockRestored,
      statusHistory: [{ status: "pending_payment", at: new Date(), note: "purchased retry fixture" }],
      createdAt: new Date(), updatedAt: new Date(),
    });

  // ---- TEST 11 (A): purchased retry SUCCESS — snapshot + ledger reconcile ----
  await testAsync("purchased retry success: fifoUnitCost refreshed to actual consumed cost + sale movement reconciles", async () => {
    const prod = await makePurchasedProduct("prod-purch-retry", 10, [layer(10, 1000)]);
    // Stale COGS snapshot (999) vs the ACTUAL consumed cost (1000) — the retry
    // must refresh the order item to the real consumption.
    const inserted = await makeOrder(db, {
      customer: customerA, product: prod, qty: 2,
      paymentStatus: "failed", orderStatus: "pending_payment", stockRestored: true,
      authority: "PURCH_OLD_" + Date.now(), itemFifoUnitCost: 999,
    });
    const orderId = inserted.insertedId.toString();
    const beforeLayers = layersRemaining(await getPurchasedLayers(prod._id));
    assert(beforeLayers === 10, `fixture layers ${beforeLayers}`);

    const r = await http("POST", "/api/payment/retry", aJar, { orderId });
    assert(r.status === 200, `retry → ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);

    const after = await getStock(db, prod._id);
    assert(after === 8, `stock 10→8 after retry, got ${after}`);
    assert(layersRemaining(await getPurchasedLayers(prod._id)) === 8, "layers remaining 8 (exactly one consumption)");
    const orderDoc = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
    assert(orderDoc.items[0].fifoUnitCost === 1000, `item fifoUnitCost=${orderDoc.items[0].fifoUnitCost} — must be 1000 (actual consumed), not the stale 999`);
    assert(orderDoc.payment.status === "pending" && orderDoc.stockRestored === false, "payment retried state");
    const mv = await db.collection("inventorymovements").findOne({ sourceRef: { $regex: "^sale-" + orderId + "-" + String(prod._id) + ".*retry-" } });
    assert(!!mv && mv.type === "sale" && mv.quantity === -2 && mv.unitCost === 1000, `retry sale movement ${JSON.stringify(mv)}`);
    const dup = await db.collection("inventorymovements").countDocuments({ sourceRef: { $regex: "^sale-" + orderId + "-" + String(prod._id) + ".*retry-" } });
    assert(dup === 1, `exactly one retry movement, got ${dup}`);
  });

  // ---- TEST 12 (B): purchased retry PARTIAL failure — rollback restores stock AND layers ----
  await testAsync("purchased retry partial reserve failure → rollback restores stock + exact layers", async () => {
    const p1 = await makePurchasedProduct("prod-purch-roll1", 10, [layer(10, 1000)]);
    const p2 = await makePurchasedProduct("prod-purch-roll2", 10, [layer(10, 2000)]);
    const inserted = await makeMultiOrder(db, {
      customer: customerA, stockRestored: true, paymentStatus: "failed",
      items: [
        { product: p1, qty: 2, fifoUnitCost: 1000 },
        { product: p2, qty: 2, fifoUnitCost: 2000 },
      ],
    });
    const orderId = inserted.insertedId.toString();
    // Make the SECOND item's re-reservation fail deterministically.
    await db.collection("products").updateOne({ _id: p2._id }, { $set: { stock: 0 } });

    const r = await http("POST", "/api/payment/retry", aJar, { orderId });
    assert(r.status === 409, `retry → ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);

    // p1 was re-reserved (layers consumed) and must be rolled back EXACTLY.
    const p1after = await db.collection("products").findOne({ _id: p1._id });
    assert(p1after.stock === 10, `p1 stock restored to 10, got ${p1after.stock}`);
    assert(layersRemaining(p1after.costLayers || []) === 10, "p1 layers restored exactly");
    const p2after = await db.collection("products").findOne({ _id: p2._id });
    assert(p2after.stock === 0, `p2 stock untouched (${p2after.stock})`);
    // No retry movement was written for the failed attempt.
    const mvCount = await db.collection("inventorymovements").countDocuments({ sourceRef: { $regex: "retry-" + orderId } });
    assert(mvCount === 0, `no movements from a failed retry (${mvCount})`);
    // payment.status is restored to the pre-retry state; items untouched.
    const od = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
    assert(od.payment.status === "failed", `payment.status=${od.payment.status}`);
    assert(od.items[0].fifoUnitCost === 1000, "item snapshot unchanged on rollback");
  });

  // ---- TEST 13 (C): concurrent purchased retries cannot double-consume ----
  await testAsync("concurrent purchased retries → single reservation, single movement, no double", async () => {
    const prod = await makePurchasedProduct("prod-purch-conc", 10, [layer(10, 3000)]);
    const inserted = await makeOrder(db, {
      customer: customerA, product: prod, qty: 2,
      paymentStatus: "failed", orderStatus: "pending_payment", stockRestored: true,
      authority: "PURCH_CONC_" + Date.now(), itemFifoUnitCost: 3000,
    });
    const orderId = inserted.insertedId.toString();

    const [r1, r2] = await Promise.all([
      http("POST", "/api/payment/retry", aJar, { orderId }),
      http("POST", "/api/payment/retry", aJar, { orderId }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert(statuses[0] === 200, `at least one retry succeeded, got ${JSON.stringify(statuses)}`);

    const after = await getStock(db, prod._id);
    assert(after === 8, `stock exactly 8 (single reservation), got ${after}`);
    assert(layersRemaining(await getPurchasedLayers(prod._id)) === 8, "layers exactly 8 — no double consumption");
    const mvCount = await db.collection("inventorymovements").countDocuments({ sourceRef: { $regex: "^sale-" + orderId + ".*retry-" } });
    assert(mvCount === 1, `exactly one retry movement, got ${mvCount}`);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  const retryProductIds = (await db.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } }).project({ _id: 1 }).toArray()).map((x) => x._id);
  if (retryProductIds.length) {
    await db.collection("inventorymovements").deleteMany({ product: { $in: retryProductIds } });
  }
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
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
