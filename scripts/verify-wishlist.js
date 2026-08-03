/**
 * Session 35 — Wishlist Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated GET /api/wishlist/ids → 401
 *   2. Unauthenticated POST → 401; supplier POST → 403
 *   3. Customer adds a product → 201 + { added: true } + appears in ids
 *   4. Duplicate add → 200 { added: false } + DB count stays 1 (unique index)
 *   5. Invalid productId → 400; nonexistent product → 404
 *   6. Remove → { removed: true } + gone from ids/list; remove-not-present → { removed: false }
 *   7. Cross-user isolation — user B cannot see or remove user A's items
 *   8. GET /api/wishlist pagination shape (page/limit/total/totalPages/hasNextPage)
 *   9. Deleted product → kept as row with product:null + productId (unavailable placeholder)
 *  10. Inactive product → still listed with isActive:false (not silently removed)
 *  11. /api/wishlist/ids returns { ids, count } — count matches DB
 *
 * Usage: node scripts/verify-wishlist.js
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
const PREFIX = "wishlist_" + Date.now() + "_";
const PASS = "wishlist-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157772001";
const CUSTOMER2_PHONE = "09157772002";
const SUPPLIER_PHONE = "09157772003";

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

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 35 — WISHLIST (REAL HTTP API)");
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
  const User = mongoose.models.User_WISHLIST || mongoose.model("User_WISHLIST", UserSchema);
  const Supplier = mongoose.models.Supplier_WISHLIST || mongoose.model("Supplier_WISHLIST", SupplierSchema);
  const Category = mongoose.models.Category_WISHLIST || mongoose.model("Category_WISHLIST", CategorySchema);
  const Product = mongoose.models.Product_WISHLIST || mongoose.model("Product_WISHLIST", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("wishlists").deleteMany({});
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, CUSTOMER2_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^WishTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "Wish Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customer2 = await User.create({ name: "Wish Customer 2", phone: CUSTOMER2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "Wish Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "WishTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  const prod1 = await Product.create({ name: PREFIX + "prod-1", slug: PREFIX + "prod-1", description: "wishlist test", images: ["https://example.com/w1.jpg"], category: catDoc._id, supplier: suppDoc._id, price: 10000, supplierPrice: 5000, stock: 10, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prod2 = await Product.create({ name: PREFIX + "prod-2", slug: PREFIX + "prod-2", description: "wishlist test", category: catDoc._id, supplier: suppDoc._id, price: 20000, supplierPrice: 8000, stock: 5, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  // Created ACTIVE; TEST 13 deactivates it AFTER it's wishlisted (a product
  // can only be added while active — deactivation must keep it listed).
  const prodInactive = await Product.create({ name: PREFIX + "prod-inactive", slug: PREFIX + "prod-inactive", description: "wishlist test", category: catDoc._id, supplier: suppDoc._id, price: 30000, supplierPrice: 12000, stock: 3, stockVersion: 0, hasVariants: false, variants: [], isActive: true });
  const prodToDelete = await Product.create({ name: PREFIX + "prod-delete", slug: PREFIX + "prod-delete", description: "wishlist test", category: catDoc._id, supplier: suppDoc._id, price: 40000, supplierPrice: 16000, stock: 7, stockVersion: 0, hasVariants: false, variants: [], isActive: true });

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
  await testAsync("Unauthenticated GET /api/wishlist/ids -> 401", async () => {
    const res = await http("GET", "/api/wishlist/ids", null);
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: unauth POST 401, supplier POST 403 ---
  await testAsync("Unauth POST -> 401; supplier POST -> 403", async () => {
    let res = await http("POST", "/api/wishlist", null, { productId: prod1._id.toString() });
    assert(res.status === 401, "expected 401, got " + res.status);
    res = await http("POST", "/api/wishlist", supplierJar, { productId: prod1._id.toString() });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: add → 201 + added:true + appears in ids ---
  await testAsync("Customer adds product -> 201 + added:true + in ids", async () => {
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prod1._id.toString() });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 100));
    assert(res.data.added === true, "added must be true");
    const ids = await http("GET", "/api/wishlist/ids", customerJar);
    assert(ids.data.ids.includes(prod1._id.toString()), "prod1 not in ids");
    assert(ids.data.count === 1, "count must be 1, got " + ids.data.count);
  });

  // --- TEST 4: duplicate add → 200 added:false + DB count stays 1 ---
  await testAsync("Duplicate add -> 200 { added:false } + db count stays 1", async () => {
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prod1._id.toString() });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.added === false, "added must be false on duplicate");
    const dbCount = await db.collection("wishlists").countDocuments({ user: customer._id, product: prod1._id });
    assert(dbCount === 1, "expected 1 row in DB, got " + dbCount);
    console.log("\n      db count=" + dbCount);
  });

  // --- TEST 5: invalid productId 400; nonexistent 404 ---
  await testAsync("Invalid productId -> 400; nonexistent product -> 404", async () => {
    let res = await http("POST", "/api/wishlist", customerJar, { productId: "not-an-id" });
    assert(res.status === 400, "expected 400, got " + res.status);
    res = await http("POST", "/api/wishlist", customerJar, { productId: new mongoose.Types.ObjectId().toString() });
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  // --- TEST 6: remove → removed:true + gone; remove-not-present → removed:false ---
  await testAsync("Remove -> removed:true + gone; remove-not-present -> removed:false", async () => {
    let res = await http("DELETE", "/api/wishlist", customerJar, { productId: prod1._id.toString() });
    assert(res.status === 200 && res.data.removed === true, "expected removed:true, got " + JSON.stringify(res.data));
    let ids = await http("GET", "/api/wishlist/ids", customerJar);
    assert(!ids.data.ids.includes(prod1._id.toString()), "prod1 still in ids");
    res = await http("DELETE", "/api/wishlist", customerJar, { productId: prod1._id.toString() });
    assert(res.status === 200 && res.data.removed === false, "expected removed:false, got " + JSON.stringify(res.data));
    console.log("\n      removed then no-op");
  });

  // --- TEST 7: cross-user isolation ---
  await testAsync("Cross-user isolation (user B cannot see/remove A's items)", async () => {
    await http("POST", "/api/wishlist", customerJar, { productId: prod2._id.toString() });
    const idsB = await http("GET", "/api/wishlist/ids", customer2Jar);
    assert(!idsB.data.ids.includes(prod2._id.toString()), "user B saw user A's item");
    assert(idsB.data.count === 0, "user B count must be 0");
    const res = await http("DELETE", "/api/wishlist", customer2Jar, { productId: prod2._id.toString() });
    assert(res.data.removed === false, "user B must not remove A's item");
    const idsA = await http("GET", "/api/wishlist/ids", customerJar);
    assert(idsA.data.ids.includes(prod2._id.toString()), "user A still has item after B's attempt");
    console.log("\n      isolation ok");
  });

  // --- TEST 8: pagination shape + list fields ---
  await testAsync("GET /api/wishlist pagination shape + populated fields", async () => {
    const res = await http("GET", "/api/wishlist?page=1&limit=10", customerJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(typeof res.data.total === "number" && typeof res.data.totalPages === "number", "pagination fields missing");
    assert(typeof res.data.hasNextPage === "boolean", "hasNextPage missing");
    assert(res.data.data.length === 1, "expected 1 item, got " + res.data.data.length);
    assert(res.data.data[0].product && res.data.data[0].product.name === prod2.name, "product not populated");
    assert(res.data.data[0].productId === prod2._id.toString(), "productId missing/wrong");
    console.log("\n      page=" + res.data.page + " total=" + res.data.total);
  });

  // --- TEST 9: deleted product → kept as row with product:null + productId ---
  await testAsync("Deleted product kept as unavailable placeholder (product:null)", async () => {
    await http("POST", "/api/wishlist", customerJar, { productId: prodToDelete._id.toString() });
    await db.collection("products").deleteOne({ _id: prodToDelete._id });
    const res = await http("GET", "/api/wishlist?page=1&limit=10", customerJar);
    const row = res.data.data.find((r) => r.productId === prodToDelete._id.toString());
    assert(!!row, "deleted-product row missing from wishlist");
    assert(row.product === null, "deleted product must be null, got " + JSON.stringify(row.product));
    assert(!!row.productId, "productId must survive deletion for removal");
    console.log("\n      placeholder row kept, productId=" + row.productId);
  });

  // --- TEST 10: inactive product → still listed with isActive:false ---
  await testAsync("Inactive product stays listed with isActive:false (deactivated AFTER add)", async () => {
    let res = await http("POST", "/api/wishlist", customerJar, { productId: prodInactive._id.toString() });
    assert(res.status === 201, "add while active must succeed, got " + res.status);
    // Now deactivate the product in the DB (as an admin would)
    await db.collection("products").updateOne(
      { _id: prodInactive._id },
      { $set: { isActive: false } }
    );
    res = await http("GET", "/api/wishlist?page=1&limit=10", customerJar);
    const row = res.data.data.find((r) => r.productId === prodInactive._id.toString());
    assert(!!row && row.product && row.product.isActive === false, "deactivated product must stay listed with isActive:false");
    console.log("\n      inactive product still present (isActive=false)");
  });

  // --- TEST 11: ids returns { ids, count } matching DB ---
  await testAsync("GET /api/wishlist/ids returns { ids, count } matching DB", async () => {
    const res = await http("GET", "/api/wishlist/ids", customerJar);
    const dbCount = await db.collection("wishlists").countDocuments({ user: customer._id });
    assert(res.data.count === dbCount, "count must match DB (" + res.data.count + " vs " + dbCount + ")");
    assert(res.data.ids.length === dbCount, "ids length must match DB");
    console.log("\n      count=" + res.data.count + " ids=" + res.data.ids.length);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("wishlists").deleteMany({});
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
