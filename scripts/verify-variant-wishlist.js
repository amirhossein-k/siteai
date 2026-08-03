/**
 * Session 43 — Variant-Level Wishlist Verification (real HTTP API)
 *
 * Tests (against the real running Next.js API + real MongoDB):
 *   1. Unauthenticated POST /api/wishlist (with variantId) → 401
 *   2. Supplier POST (with variantId) → 403
 *   3. Customer adds a VARIANT-level row (productId + variantId) → 201 added:true
 *   4. GET /api/wishlist returns variantId + variantSnapshot { sku, label }
 *   5. Duplicate add (same product + same variant) → 200 { added:false } and
 *      the unique { user, product, variantId } index keeps ONE row
 *   6. Coexistence: product-level row (variantId null) + variant-level row for
 *      the SAME product both exist (new unique index semantics)
 *   7. Invalid variantId format → 400
 *   8. variantId belonging to ANOTHER product → 400; simple product + variantId
 *      → 400 (no silent default-variant fallback on the write path)
 *   9. Inactive variant → 400
 *  10. GET list field contract: variant row exposes variantId + snapshot;
 *      product-level row exposes variantId:null + snapshot:null
 *  11. /api/wishlist/ids: deduped product ids (one id per product) + count =
 *      TOTAL rows (product-level + variant rows)
 *  12. DELETE with variantId → removes exactly that variant row; the
 *      product-level row for the same product survives
 *  13. DELETE without variantId → removes ALL rows for the product
 *  14. Resolver regression (Session 38): a variant-level row resolves to the
 *      SAVED variant (B), even though variant A is the first active in-stock —
 *      proves variant preference during wishlist → cart
 *  15. Resolver regression: a product-level row on a variant product falls back
 *      to the first active in-stock variant (A)
 *  16. Cross-user isolation: user B cannot see or remove user A's variant rows
 *
 * Requires: dev server on http://localhost:3000, real DB, and the Session 43
 * index migration ALREADY applied (scripts/migrate-wishlist-index.js) — the
 * old { user, product } unique index would block coexistence (test 6).
 *
 * Usage: node scripts/verify-variant-wishlist.js
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
const PREFIX = "varwl_" + Date.now() + "_";
const PASS = "varwl-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PHONE = "09157772201";
const CUSTOMER2_PHONE = "09157772202";
const SUPPLIER_PHONE = "09157772203";

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
  console.log("  SESSION 43 — VARIANT-LEVEL WISHLIST (REAL HTTP API)");
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
  const User = mongoose.models.User_VARWL || mongoose.model("User_VARWL", UserSchema);
  const Supplier = mongoose.models.Supplier_VARWL || mongoose.model("Supplier_VARWL", SupplierSchema);
  const Category = mongoose.models.Category_VARWL || mongoose.model("Category_VARWL", CategorySchema);
  const Product = mongoose.models.Product_VARWL || mongoose.model("Product_VARWL", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("wishlists").deleteMany({});
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:(wishlist|wishlist-cart):" } });
  await User.deleteMany({ phone: { $in: [CUSTOMER_PHONE, CUSTOMER2_PHONE, SUPPLIER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^VarWlTest" } });

  // --- Fixtures ---
  const customer = await User.create({ name: "VarWl Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const customer2 = await User.create({ name: "VarWl Customer 2", phone: CUSTOMER2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: "VarWl Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "VarWlTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });

  // Variant product — A (active, stock 5), B (active, stock 2), C (INACTIVE)
  const vidA = new mongoose.Types.ObjectId();
  const vidB = new mongoose.Types.ObjectId();
  const vidC = new mongoose.Types.ObjectId();
  const prodVar = await Product.create({
    name: PREFIX + "variant", slug: PREFIX + "variant", description: "t",
    images: ["https://example.com/v.jpg"], category: catDoc._id, supplier: suppDoc._id,
    price: 50000, supplierPrice: 25000, stock: 7, stockVersion: 0,
    hasVariants: true,
    variants: [
      { _id: vidA, sku: PREFIX + "SKU-A", attributes: [{ name: "رنگ", value: "قرمز" }], price: 51000, supplierPrice: 25000, stock: 5, stockVersion: 0, images: [], isActive: true },
      { _id: vidB, sku: PREFIX + "SKU-B", attributes: [{ name: "رنگ", value: "آبی" }], price: 52000, supplierPrice: 26000, stock: 2, stockVersion: 0, images: [], isActive: true },
      { _id: vidC, sku: PREFIX + "SKU-C", attributes: [{ name: "رنگ", value: "سبز" }], price: 53000, supplierPrice: 26000, stock: 9, stockVersion: 0, images: [], isActive: false },
    ],
    isActive: true,
  });
  // Simple product (no variants) — foreign-variant + variantId-on-simple tests
  const prodSimple = await Product.create({
    name: PREFIX + "simple", slug: PREFIX + "simple", description: "t",
    images: [], category: catDoc._id, supplier: suppDoc._id,
    price: 10000, supplierPrice: 5000, stock: 10, stockVersion: 0,
    hasVariants: false, variants: [], isActive: true,
  });

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
  await testAsync("Unauthenticated POST (with variantId) -> 401", async () => {
    const res = await http("POST", "/api/wishlist", null, { productId: prodVar._id.toString(), variantId: vidA.toString() });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 2: supplier → 403 ---
  await testAsync("Supplier POST (with variantId) -> 403", async () => {
    const res = await http("POST", "/api/wishlist", supplierJar, { productId: prodVar._id.toString(), variantId: vidA.toString() });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 3: variant-level add → 201 + added:true + in ids ---
  await testAsync("Customer adds variant-level row -> 201 + added:true + in ids", async () => {
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidB.toString() });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.added === true, "added must be true");
    const ids = await http("GET", "/api/wishlist/ids", customerJar);
    assert(ids.data.ids.includes(prodVar._id.toString()), "product not in ids");
    assert(ids.data.count === 1, "count must be 1, got " + ids.data.count);
    console.log("\n      variant B saved");
  });

  // --- TEST 4: GET returns variantId + variantSnapshot ---
  await testAsync("GET /api/wishlist returns variantId + variantSnapshot {sku,label}", async () => {
    const res = await http("GET", "/api/wishlist?page=1&limit=10", customerJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.data.length === 1, "expected 1 row, got " + res.data.data.length);
    const row = res.data.data[0];
    assert(row.variantId === vidB.toString(), "variantId must be B, got " + row.variantId);
    assert(!!row.variantSnapshot, "variantSnapshot missing");
    assert(row.variantSnapshot.sku === PREFIX + "SKU-B", "sku mismatch: " + JSON.stringify(row.variantSnapshot));
    assert(row.variantSnapshot.label && row.variantSnapshot.label.includes("آبی"), "label mismatch: " + JSON.stringify(row.variantSnapshot));
    assert(row.product && row.product.name === prodVar.name, "product not populated");
    console.log("\n      snapshot: " + JSON.stringify(row.variantSnapshot));
  });

  // --- TEST 5: duplicate (same product+variant) → 200 added:false + 1 row ---
  await testAsync("Duplicate add (same product+variant) -> 200 {added:false} + 1 row", async () => {
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidB.toString() });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.added === false, "added must be false on duplicate");
    const dbCount = await db.collection("wishlists").countDocuments({ user: customer._id, product: prodVar._id, variantId: vidB });
    assert(dbCount === 1, "expected 1 row for (user,product,variantB), got " + dbCount);
    console.log("\n      db rows for (prod, variantB)=" + dbCount);
  });

  // --- TEST 6: coexistence — product-level row + variant row for same product ---
  await testAsync("Coexistence: product-level row + variant row for the SAME product", async () => {
    // Product-level add (no variantId) for the SAME product already holding a variant row
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString() });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.added === true, "product-level add must succeed (coexistence)");
    const dbCount = await db.collection("wishlists").countDocuments({ user: customer._id, product: prodVar._id });
    assert(dbCount === 2, "expected 2 rows for the product (product-level + variant), got " + dbCount);
    console.log("\n      both rows coexist (2 rows for one product)");
  });

  // --- TEST 7: invalid variantId format → 400 ---
  await testAsync("Invalid variantId format -> 400", async () => {
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: "not-an-id" });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 8: foreign variantId → 400; variantId on simple product → 400 ---
  await testAsync("Foreign variantId (another product's) -> 400; simple product + variantId -> 400", async () => {
    // vidA belongs to prodVar but is passed for prodSimple — foreign/not-a-variant
    let res = await http("POST", "/api/wishlist", customerJar, { productId: prodSimple._id.toString(), variantId: vidA.toString() });
    assert(res.status === 400, "variantId on simple product must be 400, got " + res.status);
    // A variant ObjectId that belongs to NO product at all
    const ghostVariant = new mongoose.Types.ObjectId();
    res = await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: ghostVariant.toString() });
    assert(res.status === 400, "unknown variantId must be 400, got " + res.status);
    console.log("\n      foreign/unknown variant rejected");
  });

  // --- TEST 9: inactive variant → 400 ---
  await testAsync("Inactive variant (C) -> 400", async () => {
    const res = await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidC.toString() });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- TEST 10: GET list field contract (variant vs product-level rows) ---
  await testAsync("GET list: variant row exposes variantId+snapshot; product-level row null+null", async () => {
    const res = await http("GET", "/api/wishlist?page=1&limit=10", customerJar);
    const variantRow = res.data.data.find((r) => r.variantId === vidB.toString());
    const productRow = res.data.data.find((r) => r.variantId === null);
    assert(!!variantRow && !!productRow, "expected both a variant row and a product-level row");
    assert(variantRow.variantSnapshot && variantRow.variantSnapshot.sku === PREFIX + "SKU-B", "variant snapshot missing on variant row");
    assert(productRow.variantSnapshot === null, "product-level row snapshot must be null");
    assert(res.data.total === 2, "total must be 2, got " + res.data.total);
    console.log("\n      variant row + product-level row both present");
  });

  // --- TEST 11: ids endpoint — deduped + count = total rows ---
  await testAsync("ids: deduped product ids (one per product) + count = total rows", async () => {
    const res = await http("GET", "/api/wishlist/ids", customerJar);
    assert(res.data.ids.length === 1, "ids must dedupe to 1 product, got " + res.data.ids.length);
    assert(res.data.ids[0] === prodVar._id.toString(), "wrong product id");
    assert(res.data.count === 2, "count must be 2 (product-level + variant rows), got " + res.data.count);
    console.log("\n      ids=[" + res.data.ids[0] + "] count=2");
  });

  // --- TEST 12: DELETE with variantId removes ONLY that variant row ---
  await testAsync("DELETE with variantId -> removes exactly that variant row (product-level survives)", async () => {
    const res = await http("DELETE", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidB.toString() });
    assert(res.status === 200 && res.data.removed === true, "expected removed:true, got " + JSON.stringify(res.data));
    const rows = await db.collection("wishlists").countDocuments({ user: customer._id, product: prodVar._id });
    assert(rows === 1, "expected 1 row left (product-level), got " + rows);
    const remaining = await db.collection("wishlists").findOne({ user: customer._id, product: prodVar._id });
    assert(remaining.variantId === null, "remaining row must be product-level (variantId null)");
    console.log("\n      variant row removed; product-level row kept");
  });

  // --- TEST 13: DELETE without variantId removes ALL rows for the product ---
  await testAsync("DELETE without variantId -> removes ALL rows for the product", async () => {
    // Re-add the variant row, then remove the whole product (product-card heart semantics)
    await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidA.toString() });
    let dbCount = await db.collection("wishlists").countDocuments({ user: customer._id, product: prodVar._id });
    assert(dbCount === 2, "expected 2 rows before remove-all, got " + dbCount);
    const res = await http("DELETE", "/api/wishlist", customerJar, { productId: prodVar._id.toString() });
    assert(res.status === 200 && res.data.removed === true, "expected removed:true, got " + JSON.stringify(res.data));
    dbCount = await db.collection("wishlists").countDocuments({ user: customer._id, product: prodVar._id });
    assert(dbCount === 0, "expected 0 rows after remove-all, got " + dbCount);
    const ids = await http("GET", "/api/wishlist/ids", customerJar);
    assert(!ids.data.ids.includes(prodVar._id.toString()), "product must be gone from ids");
    console.log("\n      all rows removed (remove-all semantics)");
  });

  // --- TEST 14: resolver regression — variant-level row → SAVED variant (B) ---
  await testAsync("Resolver prefers the SAVED variant (B) over the first in-stock (A)", async () => {
    // Seed: only a variant-level row for variant B. A is active + in stock, so
    // the resolver MUST pick B purely because of the saved row.variantId.
    await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidB.toString() });
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    assert(res.status === 200, "expected 200, got " + res.status);
    const item = res.data.added.find((i) => i.id === prodVar._id.toString());
    assert(!!item, "variant product missing from added");
    assert(item.variantId === vidB.toString(), "expected variant B (saved), got " + item.variantId);
    assert(item.sku === PREFIX + "SKU-B", "sku mismatch");
    assert(item.variantLabel && item.variantLabel.includes("آبی"), "label mismatch");
    assert(item.price === 52000, "variant B price must be 52000, got " + item.price);
    console.log("\n      resolved saved variant B (price 52000)");
  });

  // --- TEST 15: resolver regression — product-level row → first active in-stock (A) ---
  await testAsync("Resolver fallback: product-level row -> first active in-stock variant (A)", async () => {
    // Replace the wishlist: remove variant B row, add a product-level row only.
    await http("DELETE", "/api/wishlist", customerJar, { productId: prodVar._id.toString(), variantId: vidB.toString() });
    await http("POST", "/api/wishlist", customerJar, { productId: prodVar._id.toString() });
    const res = await http("POST", "/api/wishlist/add-to-cart", customerJar, {});
    const item = res.data.added.find((i) => i.id === prodVar._id.toString());
    assert(!!item, "variant product missing from added");
    assert(item.variantId === vidA.toString(), "expected fallback variant A, got " + item.variantId);
    assert(item.price === 51000, "variant A price must be 51000, got " + item.price);
    console.log("\n      product-level row resolved to first active variant A");
  });

  // --- TEST 16: cross-user isolation ---
  await testAsync("Cross-user isolation: user B cannot see/remove user A's variant rows", async () => {
    // A currently has: product-level row for prodVar (from TEST 15)
    const idsB = await http("GET", "/api/wishlist/ids", customer2Jar);
    assert(idsB.data.count === 0, "user B count must be 0, got " + idsB.data.count);
    const listB = await http("GET", "/api/wishlist?page=1&limit=10", customer2Jar);
    assert(listB.data.total === 0, "user B list must be empty");
    const del = await http("DELETE", "/api/wishlist", customer2Jar, { productId: prodVar._id.toString(), variantId: vidA.toString() });
    assert(del.data.removed === false, "user B must not remove user A's row");
    const stillThere = await db.collection("wishlists").countDocuments({ user: customer._id, product: prodVar._id });
    assert(stillThere === 1, "user A's row must survive, got " + stillThere);
    console.log("\n      isolation ok");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("wishlists").deleteMany({});
  await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:(wishlist|wishlist-cart):" } });
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
