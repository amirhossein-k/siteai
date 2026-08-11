/**
 * Session 77 — Product Discounts / Sale Pricing Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1.  Admin creates a product with an ACTIVE percent discount → 201, stored
 *   2.  Admin creates a product with an ACTIVE fixed discount → 201
 *   3.  Admin creates future / expired / disabled / out-of-stock / inactive
 *       discounted products (all stored, none publicly "active")
 *   4.  Invalid discount values → 400 (percent >90, percent 0, fixed >= price,
 *       inverted date range)
 *   5.  Admin updates a discount (PUT) — new value persisted
 *   6.  Supplier POST with a discount payload → discount NEVER persisted (server strips)
 *   7.  Public list: effectivePrice + ACTIVE-only discount summary; LEAK SCAN —
 *       the raw stored config (isActive etc.) never appears on public shapes
 *   8.  Public detail: effectivePrice + summary; future/expired config not leaked
 *   9.  discounted=true: only currently-active, in-stock, active products
 *       (future/expired/disabled/out-of-stock/inactive excluded)
 *  10.  Checkout: active discount, client sends the effective price → 201;
 *       OrderItem snapshots price (paid unit), originalPrice, discountAmount
 *  11.  Checkout: client sends the stale ORIGINAL price → 409 (no order)
 *  12.  Checkout: client sends a manipulated discounted price → 409 (no order)
 *  13.  Product discount + coupon: coupon applies to the DISCOUNTED subtotal
 *  14.  Discount expiration never changes an existing order (immutable snapshot)
 *  15.  Homepage: discounted-products section seeded + present in /api/homepage
 *
 * Requires: dev server on http://localhost:3000, real DB.
 * Usage: node scripts/verify-product-discounts.js
 *
 * IMPORTANT: cleans up its own PREFIX'd fixtures. Must run AFTER
 * verify-coupon-eligibility in the sequential regression (shared DB).
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
const PREFIX = "disco_" + Date.now() + "_";
const PASS = "disco-test-123";
const CUSTOMER_PHONE = "09157778822";

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

/** Deep scan for a forbidden key across the whole response object graph. */
function deepHasKey(node, key) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => deepHasKey(n, key));
  if (Object.prototype.hasOwnProperty.call(node, key)) return true;
  return Object.values(node).some((v) => deepHasKey(v, key));
}

// --- Minimal fixture schemas (products are created through the REAL admin API) ---
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

async function run() {
  console.log("================================================================");
  console.log("  SESSION 77 — PRODUCT DISCOUNTS / SALE PRICING (REAL HTTP API)");
  console.log("================================================================");

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
  const User = mongoose.models.User_DISCO || mongoose.model("User_DISCO", UserSchema);
  const Supplier = mongoose.models.Supplier_DISCO || mongoose.model("Supplier_DISCO", SupplierSchema);
  const Category = mongoose.models.Category_DISCO || mongoose.model("Category_DISCO", CategorySchema);

  // --- Idempotency sweep (self-cleaning) ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: CUSTOMER_PHONE });
  await Supplier.deleteMany({ businessName: { $regex: "^DiscoTest" } });

  // --- Admin + supplier logins (admin credentials are the seeded dev admin) ---
  const adminJar = await login("09120000000", "admin123456");
  assert(adminJar.header().length > 0, "admin login failed");
  const adminMe = await http("GET", "/api/auth/session", adminJar);
  assert((adminMe.data?.user?.role) === "admin", "admin session role mismatch");

  // --- Fixtures: supplier + category + customer ---
  const suppUser = await User.create({ name: "DiscoTest Supplier", phone: "09157778811", passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "DiscoTest Supplier Co", contactPhone: "09157778811", isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const customer = await User.create({ name: "Disco Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });
  const categoryId = String(catDoc._id);
  const supplierId = String(suppDoc._id);

  // Helper: create a product via the REAL admin API and return its id + doc.
  async function adminCreate(slug, extra) {
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: PREFIX + slug,
      slug: PREFIX + slug,
      description: "discount fixture",
      images: [],
      category: categoryId,
      supplier: supplierId,
      supplierPrice: 400000,
      price: 1000000,
      stock: 10,
      hasVariants: false,
      variants: [],
      isActive: true,
      ...extra,
    });
    return res;
  }
  // ================= TESTS =================

  let activePctId, checkoutId, couponId, supplierProdId;

  await testAsync("admin creates a product with an active percent discount", async () => {
    const res = await adminCreate("active-pct", { price: 1000000, discount: { type: "percent", value: 20, startsAt: null, endsAt: null, isActive: true } });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    assert(res.data.discount && res.data.discount.type === "percent" && res.data.discount.value === 20, "discount not stored");
    activePctId = res.data._id;
  });

  await testAsync("admin creates a product with an active fixed discount", async () => {
    const res = await adminCreate("active-fixed", { price: 1000000, discount: { type: "fixed", value: 150000, startsAt: null, endsAt: null, isActive: true } });
    assert(res.status === 201, "expected 201, got " + res.status);
  });

  await testAsync("admin creates future / expired / disabled / windowed / out-of-stock / inactive discounted products", async () => {
    const now = Date.now();
    const future = await adminCreate("future", { price: 500000, discount: { type: "percent", value: 10, startsAt: new Date(now + 3600000), endsAt: null, isActive: true } });
    assert(future.status === 201, "future " + future.status);
    const expired = await adminCreate("expired", { price: 500000, discount: { type: "percent", value: 10, startsAt: null, endsAt: new Date(now - 3600000), isActive: true } });
    assert(expired.status === 201, "expired " + expired.status);
    const disabled = await adminCreate("disabled", { price: 500000, discount: { type: "percent", value: 10, startsAt: null, endsAt: null, isActive: false } });
    assert(disabled.status === 201, "disabled " + disabled.status);
    const windowed = await adminCreate("windowed", { price: 1200000, discount: { type: "percent", value: 25, startsAt: new Date(now - 3600000), endsAt: new Date(now + 3600000), isActive: true } });
    assert(windowed.status === 201, "windowed " + windowed.status);
    const outstock = await adminCreate("outstock", { price: 500000, stock: 0, discount: { type: "percent", value: 10, startsAt: null, endsAt: null, isActive: true } });
    assert(outstock.status === 201, "outstock " + outstock.status);
    const inactive = await adminCreate("inactive", { price: 500000, isActive: false, discount: { type: "percent", value: 10, startsAt: null, endsAt: null, isActive: true } });
    assert(inactive.status === 201, "inactive " + inactive.status);
  });

  await testAsync("invalid discount values are rejected with 400", async () => {
    const cases = [
      { price: 1000000, discount: { type: "percent", value: 95, isActive: true } },
      { price: 1000000, discount: { type: "percent", value: 0, isActive: true } },
      { price: 1000000, discount: { type: "fixed", value: 1000000, isActive: true } },
      { price: 1000000, discount: { type: "fixed", value: 0, isActive: true } },
      { price: 1000000, discount: { type: "percent", value: 10, startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now()), isActive: true } },
      { price: 1000000, discount: { type: "bogus", value: 10, isActive: true } },
    ];
    for (const c of cases) {
      const res = await adminCreate("invalid-" + Math.random().toString(36).slice(2, 8), c);
      assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
    }
  });

  await testAsync("admin updates a discount via PUT", async () => {
    const res = await http("PUT", "/api/admin/products?id=" + activePctId, adminJar, {
      name: PREFIX + "active-pct", slug: PREFIX + "active-pct", description: "discount fixture",
      images: [], category: categoryId, supplier: supplierId, supplierPrice: 400000,
      price: 1000000, stock: 10, hasVariants: false, variants: [], isActive: true,
      discount: { type: "percent", value: 25, startsAt: null, endsAt: null, isActive: true },
    });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.discount.value === 25, "discount not updated");
  });

  await testAsync("supplier POST with a discount payload NEVER persists it", async () => {
    const suppJar = await login("09157778811", PASS);
    const res = await http("POST", "/api/supplier/products", suppJar, {
      name: PREFIX + "supplier-strip", slug: PREFIX + "supplier-strip", description: "discount fixture",
      images: [], category: categoryId, supplierPrice: 300000, price: 600000, stock: 5,
      hasVariants: false, variants: [], isActive: true,
      discount: { type: "percent", value: 10, startsAt: null, endsAt: null, isActive: true },
    });
    assert(res.status === 201, "supplier create failed " + res.status + " " + JSON.stringify(res.data));
    supplierProdId = res.data._id;
    const doc = await db.collection("products").findOne({ _id: new mongoose.Types.ObjectId(supplierProdId) });
    assert(doc && !("discount" in doc), "supplier-written discount persisted!");
  });

  await testAsync("public list returns effectivePrice + active-only discount; no config leak", async () => {
    const res = await http("GET", "/api/products?limit=50", null);
    assert(res.status === 200, "list failed " + res.status);
    const bySlug = {};
    for (const p of res.data.data) bySlug[p.slug] = p;
    const a = bySlug[PREFIX + "active-pct"];
    const b = bySlug[PREFIX + "active-fixed"];
    assert(a, "active-pct not in list");
    assert(a.price === 1000000, "original price must stay 1000000, got " + a.price);
    assert(a.effectivePrice === 750000, "25% of 1M should be 750000, got " + a.effectivePrice);
    assert(a.discount && a.discount.type === "percent" && a.discount.percent === 25 && a.discount.amount === 250000, "bad discount summary");
    assert(b && b.effectivePrice === 850000, "fixed discount math wrong");
    assert(b.discount.percent === 15, "fixed discount computed percent should be 15");
    // LEAK SCAN — raw stored config keys never appear on public shapes
    for (const p of [a, b]) {
      assert(!deepHasKey(p.discount, "isActive"), "discount.isActive leaked into public payload!");
    }
    // non-discounted products untouched: effectivePrice === price, discount null
    const inactive = bySlug[PREFIX + "inactive"];
    assert(inactive === undefined, "inactive product leaked into public list");
  });

  await testAsync("public detail does not leak future/expired discount configuration", async () => {
    for (const slug of ["future", "expired", "disabled"]) {
      const res = await http("GET", "/api/products?slug=" + encodeURIComponent(PREFIX + slug), null);
      assert(res.status === 200, slug + " detail " + res.status);
      assert(res.data.effectivePrice === res.data.price, slug + " effectivePrice must equal price");
      assert(res.data.discount === null, slug + " discount must be null (no leak)");
    }
    const w = await http("GET", "/api/products?slug=" + encodeURIComponent(PREFIX + "windowed"), null);
    assert(w.data.effectivePrice === 900000, "windowed effective wrong: " + w.data.effectivePrice);
    assert(w.data.discount.percent === 25, "windowed discount missing");
  });

  await testAsync("discounted=true returns ONLY currently-active in-stock active products", async () => {
    const res = await http("GET", "/api/products?discounted=true&limit=50", null);
    assert(res.status === 200, "discounted filter failed " + res.status);
    const slugs = res.data.data.map((p) => p.slug);
    assert(slugs.includes(PREFIX + "active-pct"), "active-pct missing");
    assert(slugs.includes(PREFIX + "active-fixed"), "active-fixed missing");
    assert(slugs.includes(PREFIX + "windowed"), "windowed missing");
    for (const excluded of ["future", "expired", "disabled", "outstock", "inactive"]) {
      assert(!slugs.includes(PREFIX + excluded), excluded + " must NOT be in discounted=true");
    }
    // Every returned row carries active-only discount metadata + effectivePrice.
    for (const p of res.data.data) {
      assert(typeof p.effectivePrice === "number", "effectivePrice missing");
      assert(p.discount !== null, "discount summary missing on discounted=true row");
    }
  });

  // ---------- Checkout ----------
  await testAsync("admin creates the checkout + coupon fixtures with active discounts", async () => {
    const k = await adminCreate("checkout", { price: 1000000, discount: { type: "percent", value: 20, startsAt: null, endsAt: null, isActive: true } });
    assert(k.status === 201, "checkout fixture " + k.status);
    checkoutId = k.data._id;
    const j = await adminCreate("coupon", { price: 2000000, discount: { type: "percent", value: 25, startsAt: null, endsAt: null, isActive: true } });
    assert(j.status === 201, "coupon fixture " + j.status);
    couponId = j.data._id;
    const cp = await http("POST", "/api/admin/coupons", adminJar, {
      code: PREFIX + "C10", type: "percent", value: 10, minSubtotal: 0, maxDiscount: 0,
      startsAt: null, endsAt: null, isActive: true, isPublic: false, usageLimit: 100, perUserLimit: 10,
    });
    assert(cp.status === 201, "coupon create " + cp.status + " " + JSON.stringify(cp.data));
  });

  const custJar = await login(CUSTOMER_PHONE, PASS);
  const ship = { fullName: "Disco Buyer", phone: CUSTOMER_PHONE, address: "Tehran, Disco St", postalCode: "1234567890" };

  await testAsync("checkout uses the server-authoritative discounted price and snapshots it", async () => {
    const res = await http("POST", "/api/checkout", custJar, {
      items: [{ id: checkoutId, quantity: 1, price: 800000, name: PREFIX + "checkout" }],
      shippingAddress: ship, paymentMethod: "manual",
    });
    assert(res.status === 201, "checkout " + res.status + " " + JSON.stringify(res.data));
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order, "order missing in DB");
    assert(order.totalAmount === 800000, "order total must be the discounted price, got " + order.totalAmount);
    const item = order.items[0];
    assert(item.price === 800000, "item.price must be the effective unit price, got " + item.price);
    assert(item.originalPrice === 1000000, "item.originalPrice must snapshot the base price");
    assert(item.discountAmount === 200000, "item.discountAmount must snapshot the unit reduction, got " + item.discountAmount);
    assert(order.subtotalAmount === 800000, "subtotal must be discounted before any coupon");
  });

  await testAsync("checkout with the stale ORIGINAL price → 409 and NO order", async () => {
    const before = await db.collection("orders").countDocuments({ "items.name": { $regex: "^" + PREFIX } });
    const res = await http("POST", "/api/checkout", custJar, {
      items: [{ id: checkoutId, quantity: 1, price: 1000000, name: PREFIX + "checkout" }],
      shippingAddress: ship, paymentMethod: "manual",
    });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
    const after = await db.collection("orders").countDocuments({ "items.name": { $regex: "^" + PREFIX } });
    assert(after === before, "a 409 must never create an order");
  });

  await testAsync("checkout with a manipulated discounted price → 409 and NO order", async () => {
    const before = await db.collection("orders").countDocuments({ "items.name": { $regex: "^" + PREFIX } });
    const res = await http("POST", "/api/checkout", custJar, {
      items: [{ id: checkoutId, quantity: 1, price: 799999, name: PREFIX + "checkout" }],
      shippingAddress: ship, paymentMethod: "manual",
    });
    assert(res.status === 409, "expected 409, got " + res.status + " " + JSON.stringify(res.data));
    const after = await db.collection("orders").countDocuments({ "items.name": { $regex: "^" + PREFIX } });
    assert(after === before, "a 409 must never create an order");
  });

  await testAsync("product discount + coupon: coupon applies to the DISCOUNTED subtotal", async () => {
    const res = await http("POST", "/api/checkout", custJar, {
      items: [{ id: couponId, quantity: 1, price: 1500000, name: PREFIX + "coupon" }],
      shippingAddress: ship, paymentMethod: "manual", couponCode: PREFIX + "C10",
    });
    assert(res.status === 201, "checkout " + res.status + " " + JSON.stringify(res.data));
    const order = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(res.data.orderId) });
    assert(order.subtotalAmount === 1500000, "subtotal must be the discounted subtotal, got " + order.subtotalAmount);
    assert(order.discount && order.discount.amount === 150000, "coupon must compute off the DISCOUNTED subtotal (10% of 1.5M), got " + JSON.stringify(order.discount));
    assert(order.totalAmount === 1350000, "payable = discounted subtotal − coupon, got " + order.totalAmount);
  });

  await testAsync("discount expiration never changes an existing order (immutable snapshot)", async () => {
    const before = await db.collection("orders").findOne({ "items.name": PREFIX + "checkout", totalAmount: 800000 });
    assert(before, "checkout order not found");
    // Expire the discount via the admin API.
    const res = await http("PUT", "/api/admin/products?id=" + checkoutId, adminJar, {
      name: PREFIX + "checkout", slug: PREFIX + "checkout", description: "discount fixture",
      images: [], category: categoryId, supplier: supplierId, supplierPrice: 400000,
      price: 1000000, stock: 10, hasVariants: false, variants: [], isActive: true,
      discount: { type: "percent", value: 20, startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000), isActive: true },
    });
    assert(res.status === 200, "expire update " + res.status);
    const after = await db.collection("orders").findOne({ _id: before._id });
    assert(after.totalAmount === 800000, "order total must stay 800000 after expiration");
    assert(after.items[0].price === 800000 && after.items[0].originalPrice === 1000000 && after.items[0].discountAmount === 200000, "order item snapshot changed!");
  });

  await testAsync("homepage composition includes the discounted-products section", async () => {
    const seed = await http("GET", "/api/admin/homepage/sections", adminJar);
    assert(seed.status === 200, "admin sections GET failed " + seed.status);
    const comp = await http("GET", "/api/homepage", null);
    assert(comp.status === 200, "homepage composition failed");
    const components = comp.data.sections.map((s) => s.component);
    assert(components.includes("discounted-products"), "discounted-products section missing from homepage composition: " + components.join(","));
  });

  // --- Cleanup ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("orders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("supplierorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await db.collection("coupons").deleteMany({ code: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, "09157778811"] } });
  await Supplier.deleteMany({ businessName: { $regex: "^DiscoTest" } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });

  await mongoose.disconnect();

  console.log("\n================================================================");
  console.log("  RESULTS: " + passed + " passed, " + failed + " failed, " + total + " total");
  console.log("================================================================");
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
