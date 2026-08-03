/**
 * Session 44 — Coupon Marketing Surface Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Public endpoint works WITHOUT auth → 200 (marketing surface is public)
 *   2. Admin create with isPublic:true → 201 + isPublic persisted
 *   3. Public list returns ONLY isPublic coupons; private coupons NEVER exposed
 *   4. PUBLIC LIST LEAK SCAN — deep scan of the raw JSON: no
 *      usageLimit/perUserLimit/usedCount/startsAt/isActive/isPublic keys
 *   5. Inactive public coupon hidden from the public list (still valid rules)
 *   6. Out-of-window public coupons hidden (not-started + expired)
 *   7. Pagination shape on the public endpoint
 *   8. Admin toggles isPublic on/off → reflected in the public list
 *   9. Checkout with a PUBLIC coupon still works via validate → claim (the
 *      picker pre-fills the code; the untouched flow applies it)
 *  10. Private coupon still VALID in checkout (validate/claim unchanged) but
 *      never listed publicly
 *
 * Requires: dev server on http://localhost:3000, real DB.
 * Usage: node scripts/verify-coupons-marketing.js
 *
 * IMPORTANT: this suite wipes the SHARED `couponusages` and `ratelimits`
 * collections wholesale (deleteMany({})) — it MUST run as the FINAL suite in
 * the sequential regression (scripts/run-regression.js) so it never clobbers
 * a suite that depends on those collections.
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
const PREFIX = "cmark_" + Date.now() + "_";
const PASS = "cmark-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157772251";

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

/** Recursively collect every key in a parsed JSON value (leak scan). */
function collectKeys(node, into) {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, into);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 44 — COUPON MARKETING SURFACE (REAL HTTP API)");
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
  const User = mongoose.models.User_CMARK || mongoose.model("User_CMARK", UserSchema);
  const Supplier = mongoose.models.Supplier_CMARK || mongoose.model("Supplier_CMARK", SupplierSchema);
  const Category = mongoose.models.Category_CMARK || mongoose.model("Category_CMARK", CategorySchema);
  const Product = mongoose.models.Product_CMARK || mongoose.model("Product_CMARK", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("couponusages").deleteMany({});
  await db.collection("orders").deleteMany({ "discount.code": { $regex: "^" + PREFIX } });
  await db.collection("ratelimits").deleteMany({});
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^CMarkTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "CMark Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "CMark Supplier", phone: "09157772252", passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "CMarkTest Supplier Co", contactPhone: "09157772252", isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });
  const prod1 = await Product.create({ name: PREFIX + "prod-1", slug: PREFIX + "prod-1", description: "cmark test", images: ["https://example.com/c1.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 100000, supplierPrice: 50000, stock: 20, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  let adminJar = null, customerJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: public endpoint, no auth → 200 ---
  await testAsync("Public coupons endpoint works WITHOUT auth -> 200", async () => {
    const res = await http("GET", "/api/coupons/public?page=1&limit=10", null);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(typeof res.data.total === "number", "pagination total missing");
    assert(Array.isArray(res.data.data), "data must be an array");
  });

  // --- TEST 2: admin create with isPublic:true ---
  const publicCode = PREFIX.toUpperCase() + "PUB10";
  let publicCouponId = null;
  await testAsync("Admin creates coupon with isPublic:true -> 201 + persisted", async () => {
    const res = await http("POST", "/api/admin/coupons", adminJar, {
      code: publicCode, type: "percent", value: 10, maxDiscount: 50000, isPublic: true,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.isPublic === true, "isPublic must persist true");
    publicCouponId = res.data._id;
  });

  // --- TEST 3: private coupons never exposed ---
  let privateCode = null;
  await testAsync("Private coupons NEVER appear in the public list", async () => {
    const res = await http("POST", "/api/admin/coupons", adminJar, {
      code: PREFIX.toUpperCase() + "PRIV1", type: "fixed", value: 20000, isPublic: false,
    });
    assert(res.status === 201, "private setup create failed");
    privateCode = res.data.code;
    const pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    const codes = pub.data.data.map((c) => c.code);
    assert(codes.includes(publicCode), "public coupon missing from list");
    assert(!codes.includes(privateCode), "private coupon must NOT be listed");
    console.log("\n      private " + privateCode + " hidden");
  });

  // --- TEST 4: PUBLIC LIST LEAK SCAN ---
  await testAsync("LEAK SCAN — no usageLimit/perUserLimit/usedCount/startsAt/isActive/isPublic in raw JSON", async () => {
    const pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    const keys = new Set();
    collectKeys(pub.data, keys);
    for (const leak of ["usageLimit", "perUserLimit", "usedCount", "startsAt", "isActive", "isPublic", "updatedAt"]) {
      assert(!keys.has(leak), "LEAK: '" + leak + "' exposed in public list");
    }
    assert(keys.has("code") && keys.has("value") && keys.has("maxDiscount") && keys.has("minSubtotal") && keys.has("endsAt"), "marketing fields missing");
    console.log("\n      clean projection: " + [...keys].sort().join(", "));
  });

  // --- TEST 5: inactive public coupon hidden ---
  await testAsync("Inactive public coupon hidden from the list", async () => {
    const res = await http("POST", "/api/admin/coupons", adminJar, {
      code: PREFIX.toUpperCase() + "INACT", type: "percent", value: 5, isPublic: true, isActive: false,
    });
    assert(res.status === 201, "inactive setup failed");
    const pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    assert(!pub.data.data.some((c) => c.code === res.data.code), "inactive public coupon listed");
  });

  // --- TEST 6: out-of-window public coupons hidden ---
  await testAsync("Not-started + expired public coupons hidden", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const notStarted = await http("POST", "/api/admin/coupons", adminJar, { code: PREFIX.toUpperCase() + "FUT", type: "fixed", value: 1000, isPublic: true, startsAt: future });
    const expired = await http("POST", "/api/admin/coupons", adminJar, { code: PREFIX.toUpperCase() + "EXP", type: "fixed", value: 1000, isPublic: true, endsAt: past });
    const pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    const codes = pub.data.data.map((c) => c.code);
    assert(!codes.includes(notStarted.data.code), "not-started coupon listed");
    assert(!codes.includes(expired.data.code), "expired coupon listed");
    assert(codes.includes(publicCode), "in-window public coupon must still be listed");
  });

  // --- TEST 7: pagination shape ---
  await testAsync("Public endpoint pagination shape (page/limit/total/totalPages)", async () => {
    const res = await http("GET", "/api/coupons/public?page=1&limit=1", null);
    assert(typeof res.data.page === "number" && typeof res.data.totalPages === "number", "pagination fields missing");
    assert(res.data.data.length === 1, "limit=1 must return 1 row");
    assert(typeof res.data.hasNextPage === "boolean", "hasNextPage missing");
  });

  // --- TEST 8: admin toggles isPublic off/on ---
  await testAsync("Admin toggles isPublic off -> hidden; on -> listed", async () => {
    let upd = await http("PUT", "/api/admin/coupons/" + publicCouponId, adminJar, { isPublic: false });
    assert(upd.status === 200 && upd.data.isPublic === false, "toggle off failed");
    let pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    assert(!pub.data.data.some((c) => c.code === publicCode), "coupon still listed after isPublic=false");
    upd = await http("PUT", "/api/admin/coupons/" + publicCouponId, adminJar, { isPublic: true });
    assert(upd.status === 200 && upd.data.isPublic === true, "toggle on failed");
    pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    assert(pub.data.data.some((c) => c.code === publicCode), "coupon missing after isPublic=true");
  });

  // --- TEST 9: checkout with a PUBLIC coupon (validate → claim untouched) ---
  await testAsync("Checkout with a public coupon -> 201 + discount (validate/claim flow intact)", async () => {
    // validate first (what the checkout page does when the picker pre-fills)
    const v = await http("POST", "/api/coupons/validate", customerJar, { code: publicCode });
    assert(v.status === 200 && v.data.valid === true, "public coupon validate failed");
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [{ id: prod1._id.toString(), quantity: 1, price: 100000, name: prod1.name }],
      shippingAddress: { fullName: "تست", phone: "09120000000", address: "تهران", postalCode: "1234567890" },
      paymentMethod: "manual",
      couponCode: publicCode,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.discount && order.discount.code === publicCode, "discount not applied");
    assert(order.discount.amount === 10000, "10% of 100000 = 10000, got " + order.discount.amount);
    assert(order.totalAmount === 90000, "payable must be 90000, got " + order.totalAmount);
  });

  // --- TEST 10: private coupon still VALID in checkout but never public ---
  await testAsync("Private coupon still works in checkout (validate/claim unchanged) but is never listed", async () => {
    const v = await http("POST", "/api/coupons/validate", customerJar, { code: privateCode });
    assert(v.status === 200 && v.data.valid === true, "private coupon validate failed");
    const res = await http("POST", "/api/checkout", customerJar, {
      items: [{ id: prod1._id.toString(), quantity: 1, price: 100000, name: prod1.name }],
      shippingAddress: { fullName: "تست", phone: "09120000000", address: "تهران", postalCode: "1234567890" },
      paymentMethod: "manual",
      couponCode: privateCode,
    });
    assert(res.status === 201, "private coupon checkout failed: " + JSON.stringify(res.data).slice(0, 120));
    const pub = await http("GET", "/api/coupons/public?page=1&limit=100", null);
    assert(!pub.data.data.some((c) => c.code === privateCode), "private coupon listed publicly");
    console.log("\n      private checkout OK, still hidden");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await db.collection("couponusages").deleteMany({});
  await db.collection("orders").deleteMany({ "discount.code": { $regex: "^" + PREFIX } });
  await db.collection("ratelimits").deleteMany({});
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
