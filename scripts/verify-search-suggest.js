/**
 * Session 49 — Search Suggestions / Autocomplete Verification (real HTTP API)
 *
 * Validates:
 *   - public endpoint accessible without auth
 *   - short query (< 2 chars) returns empty array
 *   - matching product names returned (prefix match)
 *   - matching brand names returned (prefix match)
 *   - brand names appear AFTER product names in the merged list
 *   - deduped (same name from both product and brand appears once)
 *   - max 10 suggestions
 *   - inactive products/brands excluded
 *   - response shape { suggestions: string[] }
 *   - no server error on special characters
 *
 * Fixtures (direct DB inserts — API routes use the real models):
 *   products:
 *     p1 "sug49_…پیراهن"      (active)
 *     p2 "sug49_…پیراهن مردانه" (active)
 *     p3 "sug49_…کت"          (active)
 *     p4 "sug49_…کفش"         (active, inactive after creation)
 *   brands:
 *     b1 "sug49_…پیراهن برتر"  (active)
 *     b2 "sug49_…کت برتر"      (active)
 *
 * Tests (10):
 *   1.  No auth required — public endpoint returns 200
 *   2.  Empty/short query returns empty suggestions
 *   3.  Prefix match returns matching product names
 *   4.  Inactive product excluded from results
 *   5.  Brand names included in results
 *   6.  Brand names come after product names (order)
 *   7.  Duplicate name deduped (product and brand share a name)
 *   8.  Max 10 suggestions cap
 *   9.  Response shape { suggestions: string[] }
 *  10.  Special characters don't cause a 500
 *
 * Usage: node scripts/verify-search-suggest.js
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

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "sug49_" + Date.now() + "_";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

async function http(method, urlPath) {
  const res = await fetch(BASE + urlPath, { method });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// --- Minimal fixture schemas ---
const BrandSchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "brands" }
);
const ProductSchema = new mongoose.Schema(
  {
    name: String, slug: { type: String, unique: true }, description: String,
    images: [String],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierPrice: Number, price: Number, stock: Number, stockVersion: Number,
    hasVariants: Boolean, variants: { type: [mongoose.Schema.Types.Mixed], default: [] },
    isActive: Boolean,
  },
  { timestamps: true, collection: "products" }
);

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 49 — SEARCH SUGGESTIONS / AUTOCOMPLETE (REAL HTTP API)");
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
  const Brand = mongoose.models.Brand_S49 || mongoose.model("Brand_S49", BrandSchema);
  const Product = mongoose.models.Product_S49 || mongoose.model("Product_S49", ProductSchema);

  // --- Idempotency sweep ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });

  // --- Fixtures ---
  // Categories + suppliers are needed as required refs for the Product model.
  const Category = mongoose.models.Category_S49 || mongoose.model("Category_S49",
    new mongoose.Schema({ name: String, slug: String, isActive: Boolean },
      { timestamps: true, collection: "categories" }));
  const Supplier = mongoose.models.Supplier_S49 || mongoose.model("Supplier_S49",
    new mongoose.Schema({ businessName: String, isActive: Boolean },
      { timestamps: true, collection: "suppliers" }));

  const cat = await Category.create({ name: PREFIX + "cat", slug: PREFIX + "cat", isActive: true });
  const supp = await Supplier.create({ businessName: PREFIX + "supp", isActive: true });

  // Product names
  const P1_NAME = PREFIX + "پیراهن";
  const P2_NAME = PREFIX + "پیراهن مردانه";
  const P3_NAME = PREFIX + "کت";
  const P4_NAME = PREFIX + "کفش";  // will be deactivated
  // Brand names (one matching the search prefix "پیرا", one matching "کت")
  const B1_NAME = PREFIX + "پیراهن برتر";
  const B2_NAME = PREFIX + "کت برتر";

  const b1 = await Brand.create({ name: B1_NAME, slug: PREFIX + "b1", isActive: true });
  const b2 = await Brand.create({ name: B2_NAME, slug: PREFIX + "b2", isActive: true });

  const p1 = await Product.create({
    name: P1_NAME, slug: PREFIX + "p1", description: "", images: [],
    category: cat._id, supplier: supp._id,
    supplierPrice: 1000, price: 10000, stock: 10, stockVersion: 0,
    isActive: true,
  });
  const p2 = await Product.create({
    name: P2_NAME, slug: PREFIX + "p2", description: "", images: [],
    category: cat._id, supplier: supp._id,
    supplierPrice: 1000, price: 20000, stock: 10, stockVersion: 0,
    isActive: true,
  });
  const p3 = await Product.create({
    name: P3_NAME, slug: PREFIX + "p3", description: "", images: [],
    category: cat._id, supplier: supp._id,
    supplierPrice: 1000, price: 30000, stock: 10, stockVersion: 0,
    isActive: true,
  });
  const p4 = await Product.create({
    name: P4_NAME, slug: PREFIX + "p4", description: "", images: [],
    category: cat._id, supplier: supp._id,
    supplierPrice: 1000, price: 40000, stock: 10, stockVersion: 0,
    isActive: false,  // inactive — should never appear in suggestions
  });

  const enc = encodeURIComponent;

  await testAsync("PUBLIC endpoint — no auth required (200)", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "پ")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
  });

  await testAsync("EMPTY / short query returns empty suggestions", async () => {
    const empty = await http("GET", "/api/search/suggest?q=");
    assert(empty.status === 200, "empty query expected 200, got " + empty.status);
    assert(Array.isArray(empty.data.suggestions), "suggestions must be an array");
    assert(empty.data.suggestions.length === 0, "empty query should return 0 suggestions");
    const single = await http("GET", `/api/search/suggest?q=${enc("a")}`);
    assert(Array.isArray(single.data.suggestions), "single char must be array");
    assert(single.data.suggestions.length === 0, "single char must return 0");
  });

  await testAsync("PREFIX match — matching product names returned", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "پیراه")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.suggestions.includes(P1_NAME), "پیراهن must be in suggestions");
    assert(res.data.suggestions.includes(P2_NAME), "پیراهن مردانه must be in suggestions");
    // Should NOT include کت or کفش
    assert(!res.data.suggestions.includes(P3_NAME), "کت should NOT match پیراه prefix");
    assert(!res.data.suggestions.includes(P4_NAME), "کفش (inactive) should NOT be in suggestions");
  });

  await testAsync("INACTIVE product excluded", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "کف")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(!res.data.suggestions.includes(P4_NAME), "inactive product must NOT appear");
  });

  await testAsync("BRAND names included in results", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "پیراه")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.suggestions.includes(B1_NAME), "brand پیراهن برتر must be in suggestions");
  });

  await testAsync("ORDER — product names before brand names", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "پیراه")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    const p1Idx = res.data.suggestions.indexOf(P1_NAME);
    const p2Idx = res.data.suggestions.indexOf(P2_NAME);
    const b1Idx = res.data.suggestions.indexOf(B1_NAME);
    assert(p1Idx !== -1 && p2Idx !== -1 && b1Idx !== -1, "all expected names must be present");
    assert(p1Idx < b1Idx, "product name must come before brand name");
    assert(p2Idx < b1Idx, "product name must come before brand name");
  });

  await testAsync("DEDUP — same name in product + brand appears once", async () => {
    // Create an active brand with the same name as product p1
    const dupBrand = await Brand.create({
      name: P1_NAME, slug: PREFIX + "dup", isActive: true,
    });
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "پیراه")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    const count = res.data.suggestions.filter((s) => s === P1_NAME).length;
    assert(count === 1, "duplicate name must appear only once, got " + count);
    // Clean up
    await Brand.deleteOne({ _id: dupBrand._id });
  });

  await testAsync("LIMIT — max 10 suggestions", async () => {
    // Create 10+ active products with the same prefix
    const extraIds = [];
    for (let i = 0; i < 12; i++) {
      const p = await Product.create({
        name: PREFIX + "کت-" + i, slug: PREFIX + "p-extra-" + i,
        description: "", images: [],
        category: cat._id, supplier: supp._id,
        supplierPrice: 1000, price: 10000, stock: 10, stockVersion: 0,
        isActive: true,
      });
      extraIds.push(p._id);
    }
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "کت")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.suggestions.length <= 10,
      "must return at most 10 suggestions, got " + res.data.suggestions.length);
    // Cleanup extra products
    await db.collection("products").deleteMany({ _id: { $in: extraIds } });
  });

  await testAsync("RESPONSE shape — { suggestions: string[] }", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + "پ")}`);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(typeof res.data === "object" && res.data !== null, "response must be object");
    assert(Array.isArray(res.data.suggestions), "suggestions must be array");
    if (res.data.suggestions.length > 0) {
      for (const s of res.data.suggestions) {
        assert(typeof s === "string", "each suggestion must be string, got " + typeof s);
      }
    }
  });

  await testAsync("SPECIAL CHARACTERS — no 500", async () => {
    const res = await http("GET", `/api/search/suggest?q=${enc(PREFIX + ".*+?^${}()|[]\\\\")}`);
    assert(res.status === 200, "special chars expected 200, got " + res.status);
    assert(Array.isArray(res.data.suggestions), "must be array, not 500");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
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