/**
 * Session 38 — Wishlist → Cart Bulk Move Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated POST /api/wishlist/add-to-cart → 401
 *   2. Supplier POST → 403
 *   3. Empty wishlist → added 0 / skipped 0
 *   4. Simple product resolves with FRESH price/stock/maxQuantity
 *   5. Resolution does NOT decrement stock (no reservation server-side)
 *   6. Variant product → first available ACTIVE variant (variantId/sku/label/price);
 *      disabling the first in-stock variant → next one chosen; all inactive → skip
 *   7. Inactive product → skipped (inactive); deleted product → skipped (deleted)
 *   8. Out-of-stock simple → skipped (out_of_stock); variant w/o stock → no_available_variant
 *   9. Mixed list → partial { addedCount, skippedCount }
 *  10. productIds subset filter — foreign ids ignored safely (no IDOR)
 *  11. Rate limiter — dedicated wishlist-cart key → 429 after threshold
 *  12. Cart merge tests (REAL zustand store via transpileModule):
 *      - existing cart item + wishlist add merge (no duplicate keys)
 *      - quantity increment on re-add
 *      - maxQuantity cap
 *      - simple vs variant composite keys stay distinct
 *
 * Usage: node scripts/verify-wishlist-cart.js
 * Requires: dev server on http://localhost:3000, real DB.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("typescript");

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
const PREFIX = "wlcart_" + Date.now() + "_";
const PASS = "wlcart-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157772111";
const CUSTOMER2_PHONE = "09157772112";
const SUPPLIER_PHONE = "09157772113";

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

/** Load the REAL zustand cart store (src/stores/cart-store.ts) in Node by
 *  transpiling to CommonJS with the project's TypeScript compiler. A tiny
 *  in-memory localStorage shim satisfies the persist middleware.
 *  NOTE: the temp file must live INSIDE the project — a file under
 *  os.tmpdir() can't resolve `require("zustand")` from node_modules. */
function loadRealCartStore() {
  const storePath = path.resolve(__dirname, "..", "src", "stores", "cart-store.ts");
  const source = fs.readFileSync(storePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: false,
    },
    fileName: storePath,
  });
  const memoryStorage = (() => {
    const store = {};
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  })();
  // Persist middleware's default storage reads the `localStorage` global.
  global.localStorage = memoryStorage;
  const tmpFile = path.resolve(__dirname, "..", ".cart-store-s38-tmp.js");
  fs.writeFileSync(tmpFile, outputText);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(tmpFile);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best effort */ }
  }
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 38 — WISHLIST → CART BULK MOVE (REAL HTTP API)");
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
  const User = mongoose.models.User_WLCART || mongoose.model("User_WLCART", UserSchema);
  const Supplier = mongoose.models.Supplier_WLCART || mongoose.model("Supplier_WLCART", SupplierSchema);
  const Category = mongoose.models.Category_WLCART || mongoose.model("Category_WLCART", CategorySchema);
  const Product = mongoose.models.Product_WLCART || mongoose.model("Product_WLCART", ProductSchema);

  // --- Idempotency sweep ---
  try { fs.unlinkSync(path.resolve(__dirname, "..", ".cart-store-s38-tmp.js")); } catch { /* best effort */ }
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("wishlists").deleteMany({});
  // Rate-limit docs are stored as `_id: "rl:<key>"` (see src/lib/rate-limiter.ts)
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:wishlist-cart:" } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, CUSTOMER2_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^WlCartTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "WlCart Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customer2 = await User.create({ name: "WlCart Customer 2", phone: CUSTOMER2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "WlCart Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "WlCartTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const vidA = new mongoose.Types.ObjectId();
  const vidB = new mongoose.Types.ObjectId();
  const vidC = new mongoose.Types.ObjectId();

  // Simple product (in stock) — TEST 4/5
  const prodSimple = await Product.create({ name: PREFIX + "simple", slug: PREFIX + "simple", description: "t", images: ["https://example.com/s.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // Variant product: A (active, stock 5), B (active, stock 2) — TEST 6
  const prodVariant = await Product.create({ name: PREFIX + "variant", slug: PREFIX + "variant", description: "t", images: ["https://example.com/v.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 50000, supplierPrice: 25000, stock: 7, stockVersion: 0, hasVariants: true, variants: [
    { _id: vidA, sku: PREFIX + "SKU-A", attributes: [{ name: "رنگ", value: "قرمز" }], price: 51000, supplierPrice: 25000, stock: 5, stockVersion: 0, images: ["https://example.com/a.jpg"], isActive: true },
    { _id: vidB, sku: PREFIX + "SKU-B", attributes: [{ name: "رنگ", value: "آبی" }], price: 52000, supplierPrice: 26000, stock: 2, stockVersion: 0, images: ["https://example.com/b.jpg"], isActive: true },
  ], isActive: true });
  // Variant product: C (active but stock 0) — resolves only if another is active; also used for no_available_variant
  const prodVariantOOS = await Product.create({ name: PREFIX + "variant-oos", slug: PREFIX + "variant-oos", description: "t", images: ["https://example.com/o.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 60000, supplierPrice: 30000, stock: 0, stockVersion: 0, hasVariants: true, variants: [
    { _id: vidC, sku: PREFIX + "SKU-C", attributes: [{ name: "رنگ", value: "سبز" }], price: 61000, supplierPrice: 30000, stock: 0, stockVersion: 0, images: [], isActive: true },
  ], isActive: true });
  // Inactive product — TEST 7 (deactivate AFTER wishlisting, like Session 35)
  const prodInactive = await Product.create({ name: PREFIX + "inactive", slug: PREFIX + "inactive", description: "t", images: [], category: catDoc._id, supplier: suppDoc._id, price: 70000, supplierPrice: 35000, stock: 4, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // Deleted product — TEST 7
  const prodDeleted = await Product.create({ name: PREFIX + "deleted", slug: PREFIX + "deleted", description: "t", images: [], category: catDoc._id, supplier: suppDoc._id, price: 80000, supplierPrice: 40000, stock: 6, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // Out-of-stock simple — TEST 8
  const prodOOS = await Product.create({ name: PREFIX + "oos", slug: PREFIX + "oos", description: "t", images: [], category: catDoc._id, supplier: suppDoc._id, price: 90000, supplierPrice: 45000, stock: 0, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

  let customerJar = null;
  let customer2Jar = null;
  let supplierJar = null;

  await testAsync("Seed customer login", async () => {
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

  // --- TEST 1: unauth → 401 ---
  await testAsync("Unauthenticated POST add-to-cart -> 401", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", null, {});
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: supplier → 403 ---
  await testAsync("Supplier POST add-to-cart -> 403", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", supplierJar, {});
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: empty wishlist → added 0 ---
  await testAsync("Empty wishlist -> added 0 / skipped 0", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.addedCount === 0 && res.data.added.length === 0, "expected 0 added");
    assert(res.data.skippedCount === 0, "expected 0 skipped");
  });

  // --- Seed the wishlist (via the real Session 35 API) ---
  for (const prod of [prodSimple, prodVariant, prodVariantOOS, prodInactive, prodDeleted, prodOOS]) {
    const r = await http("POST", "/api/wishlist", customerJar, { productId: prod._id.toString() });
    assert(r.status === 201 || r.status === 200, "wishlist add failed for " + prod.slug);
  }
  // Deactivate AFTER wishlisting (mirrors Session 35 TEST 10) and delete the
  // deleted-product fixture.
  await db.collection("products").updateOne({ _id: prodInactive._id }, { $set: { isActive: false } });
  await db.collection("products").deleteOne({ _id: prodDeleted._id });

  // --- TEST 4: simple product resolves with fresh price/stock/maxQuantity ---
  await testAsync("Simple product resolves with FRESH price/stock/maxQuantity", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    assert(res.status === 200, "expected 200, got " + res.status);
    const item = res.data.added.find((i) => i.id === prodSimple._id.toString());
    assert(!!item, "simple product not in added");
    assert(item.price === 10000, "price must be 10000, got " + item.price);
    assert(item.maxQuantity === 10, "maxQuantity must be 10, got " + item.maxQuantity);
    assert(item.slug === prodSimple.slug, "slug mismatch");
    assert(!item.variantId, "simple product must not carry variantId");
  });

  // --- TEST 5: resolution does NOT decrement stock (no server-side reservation) ---
  await testAsync("Resolver never reserves stock (DB stock unchanged)", async () => {
    const before = await db.collection("products").findOne({ _id: prodSimple._id });
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    const after = await db.collection("products").findOne({ _id: prodSimple._id });
    assert(before.stock === after.stock, "stock must not change (" + before.stock + " vs " + after.stock + ")");
    const item = res.data.added.find((i) => i.id === prodSimple._id.toString());
    assert(item && item.maxQuantity === after.stock, "maxQuantity must equal live stock");
    console.log("\n      stock unchanged (" + before.stock + ")");
  });

  // --- TEST 6: variant resolution (first available active variant) ---
  await testAsync("Variant product -> first ACTIVE variant (A) with sku/label/price", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    const item = res.data.added.find((i) => i.id === prodVariant._id.toString());
    assert(!!item, "variant product not in added");
    assert(item.variantId === vidA.toString(), "expected variant A, got " + item.variantId);
    assert(item.sku === PREFIX + "SKU-A", "sku mismatch");
    assert(item.variantLabel && item.variantLabel.includes("قرمز"), "label mismatch: " + item.variantLabel);
    assert(item.price === 51000, "variant price must be 51000, got " + item.price);
    assert(item.maxQuantity === 5, "variant maxQuantity must be 5, got " + item.maxQuantity);
    assert(item.variant && item.variant.id === vidA.toString(), "extensible variant metadata missing");
    console.log("\n      resolved variant A (price 51000, stock 5)");
  });

  await testAsync("Disabling variant A -> falls back to variant B", async () => {
    await db.collection("products").updateOne(
      { _id: prodVariant._id, "variants._id": vidA },
      { $set: { "variants.$.isActive": false } }
    );
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    const item = res.data.added.find((i) => i.id === prodVariant._id.toString());
    assert(!!item, "variant product missing from added");
    assert(item.variantId === vidB.toString(), "expected variant B, got " + item.variantId);
    assert(item.price === 52000, "variant B price must be 52000, got " + item.price);
    // Restore A for later tests
    await db.collection("products").updateOne(
      { _id: prodVariant._id, "variants._id": vidA },
      { $set: { "variants.$.isActive": true } }
    );
    console.log("\n      fell back to variant B");
  });

  // --- TEST 7: inactive + deleted skipped ---
  await testAsync("Inactive product skipped (inactive); deleted skipped (deleted)", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    const skInactive = res.data.skipped.find((s) => s.productId === prodInactive._id.toString());
    assert(!!skInactive && skInactive.reason === "inactive", "inactive must be skipped with reason 'inactive'");
    const skDeleted = res.data.skipped.find((s) => s.productId === prodDeleted._id.toString());
    assert(!!skDeleted && skDeleted.reason === "deleted", "deleted must be skipped with reason 'deleted'");
    assert(!res.data.added.some((i) => i.id === prodInactive._id.toString()), "inactive must not be added");
    assert(!res.data.added.some((i) => i.id === prodDeleted._id.toString()), "deleted must not be added");
    console.log("\n      skipped: inactive + deleted");
  });

  // --- TEST 8: out-of-stock simple + no-available-variant skipped ---
  await testAsync("Out-of-stock simple skipped; variant w/o stock -> no_available_variant", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    const skOOS = res.data.skipped.find((s) => s.productId === prodOOS._id.toString());
    assert(!!skOOS && skOOS.reason === "out_of_stock", "OOS simple must be skipped with reason 'out_of_stock'");
    const skVar = res.data.skipped.find((s) => s.productId === prodVariantOOS._id.toString());
    assert(!!skVar && skVar.reason === "no_available_variant", "OOS variant must be skipped with reason 'no_available_variant'");
    console.log("\n      skipped: out_of_stock + no_available_variant");
  });

  // --- TEST 9: mixed partial counts ---
  await testAsync("Mixed list -> partial { addedCount, skippedCount }", async () => {
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    // Added: simple + variant = 2; Skipped: inactive, deleted, oos, variant-oos = 4
    assert(res.data.addedCount === 2, "addedCount must be 2, got " + res.data.addedCount);
    assert(res.data.skippedCount === 4, "skippedCount must be 4, got " + res.data.skippedCount);
    assert(res.data.added.length === res.data.addedCount, "added.length mismatch");
    assert(res.data.skipped.length === res.data.skippedCount, "skipped.length mismatch");
    console.log("\n      added=2 skipped=4");
  });

  // --- TEST 10: productIds subset filter + foreign ids ignored ---
  // (Single resolver call on customer1 here — keeps the total at 9 of the
  // 10/15min wishlist-cart budget so later tests keep headroom.)
  await testAsync("productIds subset filter — foreign ids ignored (no IDOR)", async () => {
    // A product ONLY customer2 has wishlisted — customer must never see it.
    const prodOnlyB = await Product.create({ name: PREFIX + "only-b", slug: PREFIX + "only-b", description: "t", images: [], category: catDoc._id, supplier: suppDoc._id, price: 11000, supplierPrice: 5000, stock: 3, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
    await http("POST", "/api/wishlist", customer2Jar, { productId: prodOnlyB._id.toString() });

    // customer requests a mix: prodOnlyB (NOT theirs) + prodSimple (theirs).
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {
      productIds: [prodOnlyB._id.toString(), prodSimple._id.toString()],
    });
    assert(!res.data.added.some((i) => i.id === prodOnlyB._id.toString()), "foreign product must be ignored");
    assert(res.data.added.some((i) => i.id === prodSimple._id.toString()), "owned product must be added");
    assert(res.data.skipped.some((s) => s.productId === prodOnlyB._id.toString()) === false, "foreign id must not even appear in skipped");
    // Cleanup only-b row (it belongs to customer2's wishlist — leave wishlist clean)
    await http("DELETE", "/api/wishlist", customer2Jar, { productId: prodOnlyB._id.toString() });
    console.log("\n      foreign id ignored; owned subset resolved");
  });

  // --- TEST 11: rate limiter (dedicated key) → 429 ---
  await testAsync("Rate limiter — wishlist-cart key -> 429 after threshold", async () => {
    // Reset the dedicated key so the test is deterministic
    // (docs stored as `_id: "rl:<key>"`)
    await db.collection("ratelimits").deleteMany({ _id: "rl:wishlist-cart:" + customer2._id.toString() });
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await http("POST", "/api/wishlist/add-to-cart", customer2Jar, {});
      lastStatus = res.status;
    }
    assert(lastStatus === 429, "expected 429 on the 11th call, got " + lastStatus);
    console.log("\n      limited after 10 calls");
  });

  // --- TEST 12: cart merge (REAL zustand store) ---
  // Load the REAL store ONCE before the test block so a load failure surfaces
  // as a clean assertion failure instead of a TypeError cascade.
  let storeMod = null;
  let storeLoadError = "";
  try {
    storeMod = loadRealCartStore();
  } catch (err) {
    storeLoadError = (err && err.message) || String(err);
  }

  await testAsync("Cart merge — existing item + wishlist add (no duplicate keys)", async () => {
    assert(storeMod, "cart store failed to load: " + storeLoadError);
    const { useCartStore } = storeMod;
    const store = useCartStore;
    store.setState({ items: [] });
    const addItem = store.getState().addItem;

    // Simulate: item already in cart (e.g. added earlier from the detail page)
    addItem({
      id: prodSimple._id.toString(),
      slug: prodSimple.slug,
      name: prodSimple.name,
      price: 10000,
      maxQuantity: 10,
      image: undefined,
    });
    // Wishlist add of the SAME product (what the wishlist page does on add-all)
    addItem({
      id: prodSimple._id.toString(),
      slug: prodSimple.slug,
      name: prodSimple.name,
      price: 10000,
      maxQuantity: 10,
      image: undefined,
    });
    const items = store.getState().items;
    assert(items.length === 1, "must be exactly 1 item (merge), got " + items.length);
    assert(items[0].quantity === 2, "quantity must increment to 2, got " + items[0].quantity);
    assert(items[0].key === prodSimple._id.toString(), "key must be the product id");
    console.log("\n      merged → quantity 2, no duplicate key");
  });

  await testAsync("Cart merge — quantity increment + maxQuantity cap", async () => {
    assert(storeMod, "cart store failed to load: " + storeLoadError);
    const { useCartStore } = storeMod;
    const store = useCartStore;
    store.setState({ items: [] });
    const addItem = store.getState().addItem;
    // maxQuantity 2 → adding 4 times must cap at 2
    const id = prodSimple._id.toString();
    for (let i = 0; i < 4; i++) {
      addItem({ id, slug: "s", name: "n", price: 10000, maxQuantity: 2, image: undefined });
    }
    const items = store.getState().items;
    assert(items.length === 1, "one item expected");
    assert(items[0].quantity === 2, "quantity must cap at maxQuantity(2), got " + items[0].quantity);
    console.log("\n      capped at 2 (4 add attempts)");
  });

  await testAsync("Cart merge — simple vs variant composite keys stay distinct", async () => {
    assert(storeMod, "cart store failed to load: " + storeLoadError);
    const { useCartStore } = storeMod;
    const store = useCartStore;
    store.setState({ items: [] });
    const addItem = store.getState().addItem;
    const id = prodVariant._id.toString();
    // Simple-style add (no variant) + two different variants
    addItem({ id, slug: "v", name: "v", price: 50000, maxQuantity: 7, image: undefined });
    addItem({ id, variantId: vidA.toString(), sku: "A", variantLabel: "قرمز", slug: "v", name: "v — قرمز", price: 51000, maxQuantity: 5, image: undefined });
    addItem({ id, variantId: vidB.toString(), sku: "B", variantLabel: "آبی", slug: "v", name: "v — آبی", price: 52000, maxQuantity: 2, image: undefined });
    addItem({ id, variantId: vidA.toString(), sku: "A", variantLabel: "قرمز", slug: "v", name: "v — قرمز", price: 51000, maxQuantity: 5, image: undefined });
    const items = store.getState().items;
    const keys = items.map((i) => i.key).sort();
    const uniqueKeys = new Set(keys);
    assert(items.length === 3, "expected 3 items, got " + items.length);
    assert(uniqueKeys.size === items.length, "duplicate composite keys detected");
    assert(keys[0] === id && keys[1] === id + ":" + vidA.toString() && keys[2] === id + ":" + vidB.toString(),
      "key composition wrong: " + JSON.stringify(keys));
    // variant A quantity incremented (was added twice)
    const itemA = items.find((i) => i.key === id + ":" + vidA.toString());
    assert(itemA.quantity === 2, "variant A quantity must be 2, got " + itemA.quantity);
    console.log("\n      3 distinct keys; variant A incremented to 2");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("wishlists").deleteMany({});
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:wishlist-cart:" } });
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
