/**
 * Session 42 — Supplier Storefront Pages Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Dev server reachable
 *   2. Unauthenticated GET /api/suppliers -> 200 (public listing, paginated)
 *   3. Unauthenticated GET /api/suppliers/[id] -> 200 (public detail)
 *   4. PROJECTION LEAK SCAN — raw JSON deep scan: NEITHER list nor detail may
 *      contain any of: user, contactPhone, bankAccount, telegramChatId,
 *      balance, pendingReserve. Also the detail key-set must be exactly the
 *      whitelist (_id, businessName, logo, description, productCount).
 *   5. Inactive supplier excluded from list; detail -> 404
 *   6. Malformed /api/suppliers/not-an-id -> 404 (not 500)
 *   7. productCount semantics: counts ONLY active + in-stock products
 *      (matches storefront visibility rules)
 *   8. GET /api/products?supplier=<id> returns ONLY that supplier's products;
 *      unrelated suppliers excluded; malformed supplier -> 404
 *   9. Products response still includes supplier businessName + additive _id
 *   10. Supplier settings PUT: supplier updates OWN logo/description
 *       (trimmed + length-capped), telegramChatId behavior unchanged,
 *       non-supplier -> 403, another supplier's profile untouched
 *   11. Cleanup (fixtures removed)
 *
 * Usage: node scripts/verify-suppliers.js
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
const PREFIX = "sup42_" + Date.now() + "_";
const PASS = "anl-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157774103";
const SUPPLIER_A_PHONE = "09157774104";
const SUPPLIER_B_PHONE = "09157774106";
const SUPPLIER_C_PHONE = "09157774105";

// NEVER-expose fields (Session 42 security invariant).
const FORBIDDEN_KEYS = [
  "user",
  "contactPhone",
  "bankAccount",
  "telegramChatId",
  "balance",
  "pendingReserve",
];

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

/**
 * Deep-scan a parsed JSON value for any forbidden key (recursive).
 * Returns the first offending key path, or null.
 */
function findForbiddenKey(value, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(k)) return k;
    const nested = findForbiddenKey(v, seen);
    if (nested) return nested;
  }
  return null;
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, logo: String, description: String, balance: Number, pendingReserve: Number, isActive: Boolean },
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
  console.log("  SESSION 42 — SUPPLIER STOREFRONT PAGES (REAL HTTP API)");
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
  const User = mongoose.models.User_SUP42 || mongoose.model("User_SUP42", UserSchema);
  const Supplier = mongoose.models.Supplier_SUP42 || mongoose.model("Supplier_SUP42", SupplierSchema);
  const Category = mongoose.models.Category_SUP42 || mongoose.model("Category_SUP42", CategorySchema);
  const Product = mongoose.models.Product_SUP42 || mongoose.model("Product_SUP42", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^SUP42Test" } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, SUPPLIER_A_PHONE, SUPPLIER_B_PHONE, SUPPLIER_C_PHONE] } });

  // --- Users MUST exist before login ---
  const customer = await User.create({ name: "SUP42 Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppAUser = await User.create({ name: "SUP42 SupplierA", phone: SUPPLIER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppBUser = await User.create({ name: "SUP42 SupplierB", phone: SUPPLIER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppCUser = await User.create({ name: "SUP42 SupplierC", phone: SUPPLIER_C_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });

  // --- Suppliers: A (active, sensitive fields SET to prove they never leak),
  // B (inactive -> excluded/404), C (active, second supplier for isolation) ---
  const suppA = await Supplier.create({
    user: suppAUser._id,
    businessName: "SUP42Test Store A",
    contactPhone: "09120001111",
    logo: "",
    description: "",
    balance: 987654321,
    pendingReserve: 123456,
    isActive: true,
  });
  const suppB = await Supplier.create({
    user: suppBUser._id,
    businessName: "SUP42Test Store B (inactive)",
    contactPhone: "09120002222",
    logo: "",
    description: "",
    balance: 555,
    pendingReserve: 11,
    isActive: false,
  });
  const suppC = await Supplier.create({
    user: suppCUser._id,
    businessName: "SUP42Test Store C",
    contactPhone: "09120003333",
    logo: "",
    description: "",
    balance: 777,
    pendingReserve: 22,
    isActive: true,
  });
  await User.findByIdAndUpdate(suppAUser._id, { $set: { supplier: suppA._id } });
  await User.findByIdAndUpdate(suppCUser._id, { $set: { supplier: suppC._id } });

  const cat = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  // A's products: one visible (counts), one zero-stock (excluded from count),
  // one inactive (excluded).
  const aVisible = await Product.create({
    name: PREFIX + "A Visible", slug: PREFIX + "a-visible", category: cat._id,
    supplier: suppA._id, supplierPrice: 1000, price: 5000, stock: 10,
    stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });
  await Product.create({
    name: PREFIX + "A ZeroStock", slug: PREFIX + "a-zero", category: cat._id,
    supplier: suppA._id, supplierPrice: 1000, price: 5000, stock: 0,
    stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });
  await Product.create({
    name: PREFIX + "A Inactive", slug: PREFIX + "a-inactive", category: cat._id,
    supplier: suppA._id, supplierPrice: 1000, price: 5000, stock: 10,
    stockVersion: 0, hasVariants: false, variants: [], isActive: false,
  });
  // B's product (should NEVER appear in listings — B is inactive).
  await Product.create({
    name: PREFIX + "B Hidden", slug: PREFIX + "b-hidden", category: cat._id,
    supplier: suppB._id, supplierPrice: 1000, price: 5000, stock: 10,
    stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });
  // C's product (must not appear in A's filter results).
  await Product.create({
    name: PREFIX + "C Only", slug: PREFIX + "c-only", category: cat._id,
    supplier: suppC._id, supplierPrice: 1000, price: 5000, stock: 10,
    stockVersion: 0, hasVariants: false, variants: [], isActive: true,
  });

  let adminJar = null;
  let custJar = null;
  let suppAJar = null;
  let suppCJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    custJar = await login(CUSTOMER_PHONE, PASS);
    assert(custJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier A login", async () => {
    suppAJar = await login(SUPPLIER_A_PHONE, PASS);
    assert(suppAJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier C login", async () => {
    suppCJar = await login(SUPPLIER_C_PHONE, PASS);
    assert(suppCJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: public listing ---
  await testAsync("Unauthenticated GET /api/suppliers -> 200, paginated, active only", async () => {
    const res = await http("GET", "/api/suppliers");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data.data), "data must be an array");
    assert(typeof res.data.total === "number", "total missing");
    const names = res.data.data.map((s) => s.businessName);
    assert(names.includes("SUP42Test Store A"), "Store A missing from list");
    assert(names.includes("SUP42Test Store C"), "Store C missing from list");
    assert(!names.some((n) => n.includes("inactive")), "inactive supplier leaked into list");
  });

  // --- TEST 2: public detail ---
  await testAsync("Unauthenticated GET /api/suppliers/[id] -> 200 with whitelist shape", async () => {
    const res = await http("GET", "/api/suppliers/" + suppA._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data._id === String(suppA._id), "id mismatch");
    assert(res.data.businessName === "SUP42Test Store A", "businessName mismatch");
    const keys = Object.keys(res.data).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(["_id", "businessName", "description", "logo", "productCount"]),
      "detail key-set must be exactly the whitelist, got " + keys.join(",")
    );
  });

  // --- TEST 3: PROJECTION LEAK SCAN (the security core) ---
  await testAsync("PROJECTION LEAK SCAN: list + detail never expose sensitive fields", async () => {
    const listRes = await http("GET", "/api/suppliers");
    const detailRes = await http("GET", "/api/suppliers/" + suppA._id);
    assert(findForbiddenKey(listRes.data) === null, "LEAK in list: " + findForbiddenKey(listRes.data));
    assert(findForbiddenKey(detailRes.data) === null, "LEAK in detail: " + findForbiddenKey(detailRes.data));
  });

  // --- TEST 4: inactive supplier excluded + 404 on detail ---
  await testAsync("Inactive supplier: excluded from list, detail -> 404", async () => {
    const listRes = await http("GET", "/api/suppliers");
    const names = listRes.data.data.map((s) => s.businessName);
    assert(!names.some((n) => n.includes("inactive")), "inactive supplier present");
    const detailRes = await http("GET", "/api/suppliers/" + suppB._id);
    assert(detailRes.status === 404, "expected 404 for inactive, got " + detailRes.status);
  });

  // --- TEST 5: malformed id -> 404 ---
  await testAsync("Malformed id -> 404 (not 500)", async () => {
    const res = await http("GET", "/api/suppliers/not-an-id");
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  // --- TEST 6: productCount semantics ---
  await testAsync("productCount counts only active + in-stock products", async () => {
    const res = await http("GET", "/api/suppliers/" + suppA._id);
    assert(res.data.productCount === 1, "Store A must have exactly 1 visible product, got " + res.data.productCount);
    const listRes = await http("GET", "/api/suppliers");
    const aRow = listRes.data.data.find((s) => s._id === String(suppA._id));
    assert(aRow && aRow.productCount === 1, "list productCount mismatch for Store A");
  });

  // --- TEST 7: supplier filter on products ---
  await testAsync("GET /api/products?supplier=<A> -> only A's products (visible ones)", async () => {
    const res = await http("GET", "/api/products?supplier=" + suppA._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    const names = res.data.data.map((p) => p.name);
    assert(names.includes(PREFIX + "A Visible"), "A Visible missing");
    assert(!names.includes(PREFIX + "A ZeroStock"), "zero-stock leaked into filter results");
    assert(!names.includes(PREFIX + "A Inactive"), "inactive leaked into filter results");
    assert(!names.includes(PREFIX + "C Only"), "another supplier's product leaked into A's filter");
    assert(!names.includes(PREFIX + "B Hidden"), "inactive supplier's product leaked");
    // supplier info now includes _id + businessName (additive)
    const aProd = res.data.data.find((p) => p.name === PREFIX + "A Visible");
    assert(aProd && typeof aProd.supplier === "object", "supplier not populated as object");
    assert(aProd.supplier._id === String(suppA._id), "supplier._id missing");
    assert(aProd.supplier.businessName === "SUP42Test Store A", "supplier.businessName missing");
  });

  await testAsync("Malformed supplier filter -> 404", async () => {
    const res = await http("GET", "/api/products?supplier=bad-id");
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  // --- TEST 8: products endpoint leak scan too ---
  await testAsync("PROJECTION LEAK SCAN: product list with supplier populate is clean", async () => {
    const res = await http("GET", "/api/products?supplier=" + suppA._id);
    assert(findForbiddenKey(res.data) === null, "LEAK in products: " + findForbiddenKey(res.data));
  });

  // --- TEST 9: settings PUT — supplier updates own public profile ---
  await testAsync("Supplier A updates own logo/description (trimmed + capped)", async () => {
    const longDesc = "x".repeat(600);
    const res = await http("PUT", "/api/supplier/settings", suppAJar, {
      logo: "  https://cdn.example.com/logo.png  ",
      description: longDesc,
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.logo === "https://cdn.example.com/logo.png", "logo not trimmed: " + res.data.logo);
    assert(res.data.description.length === 500, "description must be capped at 500, got " + res.data.description.length);
  });

  await testAsync("Public API now reflects updated profile", async () => {
    const res = await http("GET", "/api/suppliers/" + suppA._id);
    assert(res.data.logo === "https://cdn.example.com/logo.png", "public logo not updated");
    assert(res.data.description.length === 500, "public description not updated");
    // Still no leak with profile data set
    assert(findForbiddenKey(res.data) === null, "LEAK after profile update: " + findForbiddenKey(res.data));
  });

  await testAsync("telegramChatId behavior unchanged (PUT still works)", async () => {
    const res = await http("PUT", "/api/supplier/settings", suppAJar, { telegramChatId: " 123456789 " });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.telegramChatId === "123456789", "telegramChatId not trimmed");
  });

  await testAsync("Customer PUT /api/supplier/settings -> 403", async () => {
    const res = await http("PUT", "/api/supplier/settings", custJar, { logo: "https://x/y.png" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  await testAsync("Another supplier's profile untouched (isolation)", async () => {
    // Supplier C changes ONLY its own profile
    await http("PUT", "/api/supplier/settings", suppCJar, { logo: "https://cdn.example.com/c-logo.png" });
    const aRes = await http("GET", "/api/suppliers/" + suppA._id);
    assert(aRes.data.logo === "https://cdn.example.com/logo.png", "Store A logo changed by Supplier C!");
    const cRes = await http("GET", "/api/suppliers/" + suppC._id);
    assert(cRes.data.logo === "https://cdn.example.com/c-logo.png", "Store C logo not updated");
  });

  await testAsync("Empty PUT body -> 400", async () => {
    const res = await http("PUT", "/api/supplier/settings", suppAJar, {});
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 10: public pages sanity (listing still paginated) ---
  await testAsync("Listing pagination shape intact", async () => {
    const res = await http("GET", "/api/suppliers?page=1&limit=1");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.data.length === 1, "limit=1 must return 1 row");
    assert(res.data.total >= 2, "total must be >= 2 active suppliers");
    assert(res.data.totalPages >= 2, "totalPages must be >= 2");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: { $in: [suppA._id, suppB._id, suppC._id] } });
  await User.deleteMany({ _id: { $in: [customer._id, suppAUser._id, suppBUser._id, suppCUser._id] } });
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
