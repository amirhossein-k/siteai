/**
 * Session 39 — Discounts & Coupons Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Server reachable + seed logins
 *   2. Admin coupons authz: unauth 401, customer/supplier 403
 *   3. Create percent coupon → 201, code uppercased
 *   4. Create fixed coupon → 201
 *   5. Invalid create: bad code / value 0 / percent>100 / bad type → 400
 *   6. Duplicate code → 409
 *   7. PUT update (value, isActive) → 200; duplicate code on update → 409; 404
 *   8. DELETE → 200; DELETE again → 404
 *   9. Validate endpoint: valid → rules; invalid/inactive/not-started/expired → 400
 *  10. Validate rate limit → 429 (10/15min)
 *  11. Checkout WITHOUT coupon → unchanged (no discount, total = subtotal)
 *  12. Checkout with percent coupon → subtotalAmount + discount.amount + payable
 *  13. Checkout with fixed coupon → min(value, subtotal)
 *  14. Fixed coupon larger than subtotal → discount clamped, total = 0 (never negative)
 *  15. minSubtotal not met → 400, no order, coupon NOT claimed
 *  16. Invalid coupon code in checkout → 400
 *  17. Variant product checkout with coupon → subtotal includes variant price
 *  18. Stale client price + valid coupon → 409 (revalidation still fires first)
 *  19. usageLimit exhausted → second checkout 400; usedCount stays 1
 *  20. perUserLimit exhausted → same user 400; other user OK
 *  21. Concurrent same-coupon checkouts (usageLimit=1) → exactly one 201 + one 400
 *  22. Release on payment NOK (verify?Status=NOK) → counters restored, released=true
 *  23. Release on admin cancel → counters restored
 *  24. Release on 24h cleanup (backdated order) → counters restored; cleanup idempotent
 *
 * Usage: node scripts/verify-coupons.js
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
const PREFIX = "coupon_" + Date.now() + "_";
const PASS = "coupon-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157772004";
const CUSTOMER2_PHONE = "09157772005";
const SUPPLIER_PHONE = "09157772006";

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

// --- Real helpers under test (inlined mirror of src/lib/coupons.ts math) ---
function computeDiscount(coupon, subtotal) {
  let discount;
  if (coupon.type === "percent") {
    discount = Math.floor((subtotal * coupon.value) / 100);
    if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  } else {
    discount = coupon.value;
  }
  return Math.max(0, Math.min(discount, subtotal));
}

async function createCoupon(adminJar, data) {
  return http("POST", "/api/admin/coupons", adminJar, data);
}

async function getCoupon(couponId) {
  return mongoose.connection.db
    .collection("coupons")
    .findOne({ _id: new mongoose.Types.ObjectId(couponId) });
}

async function getUsage(couponId, userId) {
  return mongoose.connection.db
    .collection("couponusages")
    .findOne({ coupon: new mongoose.Types.ObjectId(couponId), user: new mongoose.Types.ObjectId(userId) });
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 39 — DISCOUNTS & COUPONS (REAL HTTP API)");
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
  const User = mongoose.models.User_COUPON || mongoose.model("User_COUPON", UserSchema);
  const Supplier = mongoose.models.Supplier_COUPON || mongoose.model("Supplier_COUPON", SupplierSchema);
  const Category = mongoose.models.Category_COUPON || mongoose.model("Category_COUPON", CategorySchema);
  const Product = mongoose.models.Product_COUPON || mongoose.model("Product_COUPON", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("couponusages").deleteMany({});
  await db.collection("orders").deleteMany({ "discount.code": { $regex: "^" + PREFIX } });
  await db.collection("ratelimits").deleteMany({});
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, CUSTOMER2_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^CouponTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "Coupon Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customer2 = await User.create({ name: "Coupon Customer 2", phone: CUSTOMER2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Coupon Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "CouponTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const prod1 = await Product.create({ name: PREFIX + "prod-1", slug: PREFIX + "prod-1", description: "coupon test", images: ["https://example.com/c1.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 100000, supplierPrice: 50000, stock: 20, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prod2 = await Product.create({ name: PREFIX + "prod-2", slug: PREFIX + "prod-2", description: "coupon test", category: catDoc._id, supplier: suppDoc._id, price: 50000, supplierPrice: 20000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // NOTE: the fixture schema stores variants as Mixed, so Mongo does NOT
  // auto-generate a subdoc _id — we must provide one explicitly (the real
  // Product model's variant subdoc has { _id: true }).
  const prodVarId = new mongoose.Types.ObjectId();
  const prodVar = await Product.create({
    name: PREFIX + "prod-var", slug: PREFIX + "prod-var", description: "coupon variant test",
    category: catDoc._id, supplier: suppDoc._id, price: 30000, supplierPrice: 10000, stock: 10, stockVersion: 0,
    hasVariants: true,
    variants: [{
      _id: prodVarId,
      sku: PREFIX + "SKU1", attributes: [{ attributeId: new mongoose.Types.ObjectId(), name: "سایز", value: "M" }],
      price: 30000, supplierPrice: 10000, stock: 10, stockVersion: 0, images: [], isActive: true,
    }],
    isActive: true,
  });

  let adminJar = null, customerJar = null, customer2Jar = null, supplierJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Second customer login", async () => {
    customer2Jar = await login(CUSTOMER2_PHONE, PASS);
    assert(customer2Jar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier login", async () => {
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
  });

  // Track created coupons + orders for cleanup
  const createdCoupons = [];
  const createdOrders = [];

  // --- TEST 2: admin coupons authz ---
  await testAsync("Admin coupons authz: unauth 401; customer/supplier 403", async () => {
    let res = await http("GET", "/api/admin/coupons", null);
    assert(res.status === 401, "expected 401, got " + res.status);
    res = await http("GET", "/api/admin/coupons", customerJar);
    assert(res.status === 403, "expected 403, got " + res.status);
    res = await http("POST", "/api/admin/coupons", supplierJar, { code: "X1", type: "percent", value: 10 });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: create percent coupon (code uppercased) ---
  let percentCouponId = null;
  let percentCouponCode = null;
  await testAsync("Create percent coupon -> 201 + code uppercased", async () => {
    const res = await createCoupon(adminJar, { code: PREFIX + "off10", type: "percent", value: 10, maxDiscount: 50000 });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.code === (PREFIX + "off10").toUpperCase(), "code must be uppercased");
    assert(res.data.type === "percent" && res.data.value === 10, "type/value wrong");
    assert(res.data.usedCount === 0, "usedCount must start at 0");
    percentCouponId = res.data._id;
    percentCouponCode = res.data.code;
    createdCoupons.push(percentCouponId);
  });

  // --- TEST 4: create fixed coupon ---
  let fixedCouponId = null;
  let fixedCouponCode = null;
  await testAsync("Create fixed coupon -> 201", async () => {
    const res = await createCoupon(adminJar, { code: PREFIX + "off20k", type: "fixed", value: 20000 });
    assert(res.status === 201, "expected 201, got " + res.status);
    assert(res.data.type === "fixed" && res.data.value === 20000, "type/value wrong");
    fixedCouponId = res.data._id;
    fixedCouponCode = res.data.code;
    createdCoupons.push(fixedCouponId);
  });

  // --- TEST 5: invalid creates ---
  await testAsync("Invalid create -> 400 (bad code / value 0 / percent>100 / bad type)", async () => {
    let res = await createCoupon(adminJar, { code: "AB", type: "percent", value: 10 });
    assert(res.status === 400, "short code: expected 400, got " + res.status);
    res = await createCoupon(adminJar, { code: PREFIX + "badval", type: "percent", value: 0 });
    assert(res.status === 400, "zero value: expected 400, got " + res.status);
    res = await createCoupon(adminJar, { code: PREFIX + "badpct", type: "percent", value: 150 });
    assert(res.status === 400, "percent>100: expected 400, got " + res.status);
    res = await createCoupon(adminJar, { code: PREFIX + "badtype", type: "free", value: 100 });
    assert(res.status === 400, "bad type: expected 400, got " + res.status);
  });

  // --- TEST 6: duplicate code ---
  await testAsync("Duplicate coupon code -> 409", async () => {
    const res = await createCoupon(adminJar, { code: percentCouponCode, type: "percent", value: 5 });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
  });

  // --- TEST 7: PUT update + duplicate-on-update + 404 ---
  await testAsync("PUT update -> 200; duplicate code update -> 409; missing id -> 404", async () => {
    let res = await http("PUT", "/api/admin/coupons/" + percentCouponId, adminJar, { value: 15, isActive: false });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.value === 15 && res.data.isActive === false, "update not applied");
    // restore for later checkout tests
    await http("PUT", "/api/admin/coupons/" + percentCouponId, adminJar, { value: 10, isActive: true });
    res = await http("PUT", "/api/admin/coupons/" + fixedCouponId, adminJar, { code: percentCouponCode });
    assert(res.status === 409, "duplicate code update: expected 409, got " + res.status);
    const ghost = new mongoose.Types.ObjectId().toString();
    res = await http("PUT", "/api/admin/coupons/" + ghost, adminJar, { value: 5 });
    assert(res.status === 404, "missing coupon: expected 404, got " + res.status);
  });

  // --- TEST 8: DELETE + double delete ---
  await testAsync("DELETE -> 200; DELETE again -> 404", async () => {
    const res = await createCoupon(adminJar, { code: PREFIX + "todelete", type: "fixed", value: 1000 });
    assert(res.status === 201, "setup create failed");
    let del = await http("DELETE", "/api/admin/coupons/" + res.data._id, adminJar);
    assert(del.status === 200, "expected 200, got " + del.status);
    del = await http("DELETE", "/api/admin/coupons/" + res.data._id, adminJar);
    assert(del.status === 404, "double delete: expected 404, got " + del.status);
  });

  // --- TEST 9: validate endpoint ---
  await testAsync("Validate endpoint: valid -> rules; invalid/inactive/not-started/expired -> 400", async () => {
    // active percent coupon
    let res = await http("POST", "/api/coupons/validate", customerJar, { code: percentCouponCode });
    assert(res.status === 200 && res.data.valid === true, "valid coupon rejected: " + JSON.stringify(res.data));
    assert(res.data.type === "percent" && res.data.value === 10, "rules wrong");
    assert(res.data.maxDiscount === 50000, "maxDiscount rule missing");
    // invalid code
    res = await http("POST", "/api/coupons/validate", customerJar, { code: "NOPE999" });
    assert(res.status === 400, "invalid code: expected 400, got " + res.status);
    // inactive coupon
    const inact = await createCoupon(adminJar, { code: PREFIX + "inact", type: "fixed", value: 5000, isActive: false });
    res = await http("POST", "/api/coupons/validate", customerJar, { code: inact.data.code });
    assert(res.status === 400, "inactive: expected 400, got " + res.status);
    // not-started
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const notStarted = await createCoupon(adminJar, { code: PREFIX + "future", type: "fixed", value: 5000, startsAt: future });
    res = await http("POST", "/api/coupons/validate", customerJar, { code: notStarted.data.code });
    assert(res.status === 400, "not-started: expected 400, got " + res.status);
    // expired
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const expired = await createCoupon(adminJar, { code: PREFIX + "expired", type: "fixed", value: 5000, endsAt: past });
    res = await http("POST", "/api/coupons/validate", customerJar, { code: expired.data.code });
    assert(res.status === 400, "expired: expected 400, got " + res.status);
    createdCoupons.push(inact.data._id, notStarted.data._id, expired.data._id);
  });

  // --- TEST 10: validate rate limit (customer2, 11 rapid calls) ---
  await testAsync("Validate rate limit -> 429 on 11th call", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await http("POST", "/api/coupons/validate", customer2Jar, { code: "XYZ" + i });
      lastStatus = res.status;
    }
    assert(lastStatus === 429, "expected 429, got " + lastStatus);
  });

  // --- Checkout helper (manual payment) ---
  async function checkout(jar, items, couponCode) {
    const body = {
      items,
      shippingAddress: { fullName: "تست", phone: "09120000000", address: "تهران", postalCode: "1234567890" },
      paymentMethod: "manual",
    };
    if (couponCode) body.couponCode = couponCode;
    return http("POST", "/api/checkout", jar, body);
  }

  const item1 = { id: prod1._id.toString(), quantity: 1, price: 100000, name: prod1.name };

  // --- TEST 11: checkout without coupon ---
  await testAsync("Checkout without coupon -> unchanged (no discount)", async () => {
    const res = await checkout(customerJar, [item1]);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(!!res.data.orderId, "no orderId");
    createdOrders.push(res.data.orderId);
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.totalAmount === 100000, "total must equal subtotal, got " + order.totalAmount);
    assert(order.subtotalAmount === 100000, "subtotalAmount missing");
    assert(order.discount === null || !order.discount.couponId, "no coupon should be attached");
  });

  // --- TEST 12: percent coupon checkout ---
  await testAsync("Percent coupon checkout -> subtotal + discount + payable", async () => {
    const res = await checkout(customerJar, [item1], percentCouponCode);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    createdOrders.push(res.data.orderId);
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.subtotalAmount === 100000, "subtotal wrong: " + order.subtotalAmount);
    assert(order.discount && order.discount.code === percentCouponCode, "discount missing");
    assert(order.discount.amount === 10000, "10% of 100000 = 10000, got " + order.discount.amount);
    assert(order.totalAmount === 90000, "payable must be 90000, got " + order.totalAmount);
    assert(order.discount.released === false, "released must be false at creation");
    // counters
    const coupon = await getCoupon(percentCouponId);
    assert(coupon.usedCount === 1, "usedCount must be 1, got " + coupon.usedCount);
    const usage = await getUsage(percentCouponId, customer._id);
    assert(usage && usage.count === 1, "per-user count must be 1");
  });

  // --- TEST 13: fixed coupon checkout ---
  await testAsync("Fixed coupon checkout -> discount = min(value, subtotal)", async () => {
    const res = await checkout(customerJar, [item1], fixedCouponCode);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    createdOrders.push(res.data.orderId);
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.discount.amount === 20000, "fixed 20000 off, got " + order.discount.amount);
    assert(order.totalAmount === 80000, "payable must be 80000, got " + order.totalAmount);
  });

  // --- TEST 14: fixed coupon larger than subtotal → never negative ---
  await testAsync("Fixed coupon > subtotal -> clamped, total = 0 (never negative)", async () => {
    const big = await createCoupon(adminJar, { code: PREFIX + "big", type: "fixed", value: 999999 });
    createdCoupons.push(big.data._id);
    const res = await checkout(customerJar, [{ ...item1, id: prod2._id.toString(), price: 50000, name: prod2.name }], big.data.code);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    createdOrders.push(res.data.orderId);
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.discount.amount === 50000, "discount clamped to subtotal, got " + order.discount.amount);
    assert(order.totalAmount === 0, "total must be 0, got " + order.totalAmount);
  });

  // --- TEST 15: minSubtotal not met ---
  await testAsync("minSubtotal not met -> 400, no order, coupon NOT claimed", async () => {
    const minC = await createCoupon(adminJar, { code: PREFIX + "min", type: "percent", value: 10, minSubtotal: 200000 });
    createdCoupons.push(minC.data._id);
    const before = await getCoupon(minC.data._id);
    const res = await checkout(customerJar, [item1], minC.data.code); // subtotal 100000 < 200000
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
    const after = await getCoupon(minC.data._id);
    assert(after.usedCount === before.usedCount, "coupon must NOT be claimed on 400");
  });

  // --- TEST 16: invalid coupon code in checkout ---
  await testAsync("Invalid coupon code in checkout -> 400", async () => {
    const res = await checkout(customerJar, [item1], "BOGUS999");
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
  });

  // --- TEST 17: variant checkout with coupon ---
  await testAsync("Variant product checkout with coupon -> variant price in subtotal", async () => {
    const res = await checkout(customerJar, [{ id: prodVar._id.toString(), variantId: prodVarId.toString(), quantity: 1, price: 30000, name: prodVar.name }], percentCouponCode);
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    createdOrders.push(res.data.orderId);
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.subtotalAmount === 30000, "variant subtotal wrong: " + order.subtotalAmount);
    assert(order.discount.amount === 3000, "10% of 30000 = 3000, got " + order.discount.amount);
    assert(order.totalAmount === 27000, "payable must be 27000, got " + order.totalAmount);
  });

  // --- TEST 18: stale price + valid coupon → 409 (revalidation first) ---
  await testAsync("Stale client price + valid coupon -> 409 (revalidation first)", async () => {
    const before = await getCoupon(percentCouponId);
    const res = await checkout(customerJar, [{ ...item1, price: 999999 }], percentCouponCode);
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
    const after = await getCoupon(percentCouponId);
    assert(after.usedCount === before.usedCount, "coupon must NOT be claimed on 409");
  });

  // --- TEST 19: usageLimit exhausted ---
  await testAsync("usageLimit exhausted -> second checkout 400; usedCount stays 1", async () => {
    const limC = await createCoupon(adminJar, { code: PREFIX + "lim", type: "percent", value: 10, usageLimit: 1 });
    createdCoupons.push(limC.data._id);
    const r1 = await checkout(customerJar, [item1], limC.data.code);
    assert(r1.status === 201, "first use must succeed, got " + r1.status + " " + JSON.stringify(r1.data));
    createdOrders.push(r1.data.orderId);
    const r2 = await checkout(customer2Jar, [item1], limC.data.code); // different user, global limit hit
    assert(r2.status === 400, "second use must fail, got " + r2.status + " " + JSON.stringify(r2.data));
    const after = await getCoupon(limC.data._id);
    assert(after.usedCount === 1, "usedCount must stay 1, got " + after.usedCount);
  });

  // --- TEST 20: perUserLimit exhausted ---
  await testAsync("perUserLimit exhausted -> same user 400; other user OK", async () => {
    const puC = await createCoupon(adminJar, { code: PREFIX + "pu", type: "percent", value: 10, perUserLimit: 1 });
    createdCoupons.push(puC.data._id);
    const r1 = await checkout(customerJar, [item1], puC.data.code);
    assert(r1.status === 201, "first user use must succeed, got " + r1.status + " " + JSON.stringify(r1.data));
    createdOrders.push(r1.data.orderId);
    const r2 = await checkout(customerJar, [item1], puC.data.code);
    assert(r2.status === 400, "same-user reuse must fail, got " + r2.status + " " + JSON.stringify(r2.data));
    const r3 = await checkout(customer2Jar, [item1], puC.data.code);
    assert(r3.status === 201, "other user must succeed, got " + r3.status + " " + JSON.stringify(r3.data));
    createdOrders.push(r3.data.orderId);
    const after = await getCoupon(puC.data._id);
    assert(after.usedCount === 2, "usedCount must be 2 (two different users), got " + after.usedCount);
  });

  // --- TEST 21: concurrent same-coupon checkouts (usageLimit=1) ---
  await testAsync("Concurrent same-coupon checkouts -> exactly one 201 + one 400", async () => {
    const concC = await createCoupon(adminJar, { code: PREFIX + "conc", type: "percent", value: 10, usageLimit: 1 });
    createdCoupons.push(concC.data._id);
    // Use DIFFERENT products for the two concurrent checkouts so the only
    // contention point is the coupon claim (same-product reservations would
    // collide on the stockVersion optimistic lock first → loser gets a 409
    // from stock, which is unrelated to the coupon).
    const [ra, rb] = await Promise.all([
      checkout(customerJar, [item1], concC.data.code),
      checkout(customer2Jar, [{ ...item1, id: prod2._id.toString(), price: 50000, name: prod2.name }], concC.data.code),
    ]);
    const statuses = [ra.status, rb.status].sort();
    assert(statuses[0] === 201 && statuses[1] === 400,
      "expected one 201 + one 400, got " + JSON.stringify([ra.status, rb.status]));
    if (ra.status === 201) createdOrders.push(ra.data.orderId);
    if (rb.status === 201) createdOrders.push(rb.data.orderId);
    const after = await getCoupon(concC.data._id);
    assert(after.usedCount === 1, "usedCount must be exactly 1, got " + after.usedCount);
  });

  // --- TEST 22: release on payment NOK ---
  await testAsync("Release on payment NOK -> counters restored + discount.released", async () => {
    const nokC = await createCoupon(adminJar, { code: PREFIX + "nok", type: "percent", value: 10 });
    createdCoupons.push(nokC.data._id);
    const res = await checkout(customerJar, [item1], nokC.data.code);
    assert(res.status === 201, "checkout must succeed, got " + res.status + " " + JSON.stringify(res.data));
    const orderId = res.data.orderId;
    createdOrders.push(orderId);
    const before = await getCoupon(nokC.data._id);
    assert(before.usedCount === 1, "claim must be registered");
    // Simulate the Zarinpal callback cancelling the payment (NOK branch)
    const nokRes = await http("GET", "/api/payment/verify?Authority=testnok&Status=NOK&orderId=" + orderId, null);
    // Next.js NextResponse.redirect defaults to 307 (temporary redirect)
    assert(nokRes.status === 307 || nokRes.status === 302, "verify NOK must redirect (3xx), got " + nokRes.status);
    const after = await getCoupon(nokC.data._id);
    assert(after.usedCount === 0, "usedCount must return to 0, got " + after.usedCount);
    const usage = await getUsage(nokC.data._id, customer._id);
    assert(usage === null || usage.count === 0, "per-user count must be 0/null after release");
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
    assert(order.discount.released === true, "discount.released must be true");
  });

  // --- TEST 23: release on admin cancel ---
  await testAsync("Release on admin cancel -> counters restored", async () => {
    const admC = await createCoupon(adminJar, { code: PREFIX + "adm", type: "percent", value: 10 });
    createdCoupons.push(admC.data._id);
    const res = await checkout(customerJar, [item1], admC.data.code);
    assert(res.status === 201, "checkout must succeed, got " + res.status + " " + JSON.stringify(res.data));
    const orderId = res.data.orderId;
    createdOrders.push(orderId);
    const before = await getCoupon(admC.data._id);
    assert(before.usedCount === 1, "claim must be registered");
    // Admin cancels the order (pending_payment → cancelled is a valid transition)
    const putRes = await http("PUT", "/api/admin/orders?id=" + orderId, adminJar, { status: "cancelled", note: "test cancel" });
    assert(putRes.status === 200, "admin cancel must succeed, got " + putRes.status + " " + JSON.stringify(putRes.data).slice(0, 150));
    const after = await getCoupon(admC.data._id);
    assert(after.usedCount === 0, "usedCount must return to 0, got " + after.usedCount);
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
    assert(order.discount.released === true, "discount.released must be true");
  });

  // --- TEST 24: release on 24h cleanup (idempotent) ---
  await testAsync("Release on 24h cleanup -> counters restored; cleanup idempotent", async () => {
    const clnC = await createCoupon(adminJar, { code: PREFIX + "cln", type: "percent", value: 10 });
    createdCoupons.push(clnC.data._id);
    const res = await checkout(customerJar, [item1], clnC.data.code);
    assert(res.status === 201, "checkout must succeed, got " + res.status + " " + JSON.stringify(res.data));
    const orderId = res.data.orderId;
    createdOrders.push(orderId);
    const before = await getCoupon(clnC.data._id);
    assert(before.usedCount === 1, "claim must be registered");
    // Backdate the order beyond the 24h window, then run cleanup
    await db.collection("orders").updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      { $set: { updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
    );
    const clean = await http("GET", "/api/payment/cleanup", adminJar);
    assert(clean.status === 200 && clean.data.cleaned === 1, "cleanup must cancel 1 order, got " + JSON.stringify(clean.data));
    const after = await getCoupon(clnC.data._id);
    assert(after.usedCount === 0, "usedCount must return to 0, got " + after.usedCount);
    // Idempotency: a second cleanup run must not touch anything (claim already released)
    const clean2 = await http("GET", "/api/payment/cleanup", adminJar);
    assert(clean2.status === 200 && clean2.data.cleaned === 0, "second cleanup must be a no-op, got " + JSON.stringify(clean2.data));
    const after2 = await getCoupon(clnC.data._id);
    assert(after2.usedCount === 0, "usedCount must stay 0, got " + after2.usedCount);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("couponusages").deleteMany({});
  await db.collection("orders").deleteMany({ _id: { $in: createdOrders.map((id) => new mongoose.Types.ObjectId(id)) } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: suppDoc._id });
  await User.deleteMany({ _id: { $in: [customer._id, customer2._id, suppUser._id] } });
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
