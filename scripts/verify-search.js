/**
 * Session 48 — Storefront Search Quality Upgrade Verification (real HTTP API)
 *
 * Validates:
 *   - expanded search coverage (name, description, variant attribute values,
 *     brand name, tag name, category name) with regex kept as the primitive
 *   - weighted relevance ranking (exact name > prefix > substring >
 *     brand/tag/category > attribute value > description) via aggregation
 *   - explicit sort overrides relevance; pagination preserved
 *   - Persian substring behavior ("پیراه" matches "پیراهن")
 *   - regex special-char safety (escapeRegex) and backward compatibility
 *     (no search param behaves exactly as before)
 *
 * Fixtures (direct DB inserts — API routes use the real models):
 *   brands: brandS "…سامسونگ" (active), brandGone (deleted)
 *   tags:   tagPhone "…موبایل" (active)
 *   cats:   cat1 "…لوازم جانبی", cat2 "…پوشاک" (active)
 *   attr:   attrColor (active, slug …rang)
 *   supplier: supp1 (active)
 *   products (all active + in-stock):
 *     pExact  "…پیراهن"          cat2 price 40000  (exact match target)
 *     pPrefix "…پیراهن مردانه"   cat2 price 10000  (prefix match)
 *     pSubstr "شیک …پیراهن"      cat2 price 30000  (substring match — the full
 *            term incl. PREFIX must appear CONTIGUOUSLY mid-name, hence the
 *            leading "شیک "; a name like …زیرپیراهن would never contain the
 *            contiguous term …پیراهن)
 *     pDesc   "…لباس شیک" (desc contains …پیراهن) cat2 price 20000
 *     pBrand  "…گوشی هوشمند" brandS cat2          (brand-name search)
 *     pTag    "…قاب گوشی" tags[tagPhone] cat2      (tag-name search)
 *     pCat    "…کابل شارژ"       cat1              (category-name search)
 *     pAttr   "…کیف" variant attribute value …قرمز (attribute-value search)
 *     pDot/pWild  "…نسخه.پرو" vs "…نسخهXپرو"        (regex escaping)
 *
 * Tests (17):
 *   1.  Exact name search -> exact match first (relevance order)
 *   2.  Partial Persian substring still matches ("پیراه" -> "پیراهن")
 *   3.  Brand name search surfaces its products ("سامس" -> سامسونگ)
 *   4.  Tag name search surfaces its products
 *   5.  Category name search surfaces its products
 *   6.  Attribute value search surfaces products with matching variants
 *   7.  Combined: search + brand
 *   8.  Combined: search + tag
 *   9.  Combined: search + category
 *  10.  Combined: search + attribute selection
 *  11.  Search + explicit sort (price_asc) overrides relevance
 *  12.  Search + pagination: totals, slicing, stable ordering
 *  13.  Name match outranks description-only match (positional)
 *  14.  Empty search result -> 200, total 0
 *  15.  Regex special chars escaped (literal dot, no over-match) + no 500
 *  16.  Backward compat: no search behaves exactly as before (shape/newest)
 *  17.  Detail endpoints (?id= / ?slug=) unaffected by search param
 *
 * Non-test steps: dev-server reachability check + fixture cleanup.
 *
 * Usage: node scripts/verify-search.js
 * Requires: dev server on http://localhost:3000, real DB.
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

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "srch48_" + Date.now() + "_";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

async function http(method, urlPath, body) {
  const headers = {};
  const init = { method, headers, redirect: "manual" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, init);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

const names = (paged) => (paged?.data || []).map((p) => p.name);
const contains = (paged, name) => names(paged).includes(name);

// --- Minimal fixture schemas (API routes use the real models) ---
const BrandSchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "brands" }
);
const TagSchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "tags" }
);
const CategorySchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "categories" }
);
const SupplierSchema = new mongoose.Schema(
  { businessName: String, logo: String, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);
const AttributeSchema = new mongoose.Schema(
  { name: String, slug: String, type: String, values: [String], isActive: Boolean },
  { timestamps: true, collection: "attributes" }
);
const ProductSchema = new mongoose.Schema(
  {
    name: String, slug: { type: String, unique: true }, description: String,
    images: [String],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
    tags: { type: [mongoose.Schema.Types.ObjectId], ref: "Tag", default: [] },
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
  console.log("  SESSION 48 — STOREFRONT SEARCH QUALITY UPGRADE (REAL HTTP API)");
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
  const Brand = mongoose.models.Brand_S48 || mongoose.model("Brand_S48", BrandSchema);
  const Tag = mongoose.models.Tag_S48 || mongoose.model("Tag_S48", TagSchema);
  const Category = mongoose.models.Category_S48 || mongoose.model("Category_S48", CategorySchema);
  const Supplier = mongoose.models.Supplier_S48 || mongoose.model("Supplier_S48", SupplierSchema);
  const Attribute = mongoose.models.Attribute_S48 || mongoose.model("Attribute_S48", AttributeSchema);
  const Product = mongoose.models.Product_S48 || mongoose.model("Product_S48", ProductSchema);

  // --- Idempotency sweep (rerun-safe) ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("tags").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await db.collection("attributes").deleteMany({ name: { $regex: "^" + PREFIX } });

  // --- Fixtures ---
  const brandS = await Brand.create({ name: PREFIX + "سامسونگ", slug: PREFIX + "samsung", isActive: true });
  const brandGone = await Brand.create({ name: PREFIX + "برندحذف", slug: PREFIX + "gone", isActive: true });
  const tagPhone = await Tag.create({ name: PREFIX + "موبایل", slug: PREFIX + "mobile", isActive: true });
  const cat1 = await Category.create({ name: PREFIX + "لوازم جانبی", slug: PREFIX + "accessories", isActive: true });
  const cat2 = await Category.create({ name: PREFIX + "پوشاک", slug: PREFIX + "clothing", isActive: true });
  const supp1 = await Supplier.create({ businessName: PREFIX + "Supp1", logo: "", isActive: true });
  const attrColor = await Attribute.create({
    name: PREFIX + "رنگ", slug: PREFIX + "rang", type: "color",
    values: [PREFIX + "قرمز", PREFIX + "آبی"], isActive: true,
  });

  // Unique ASCII slug per fixture — Persian names can't derive a unique slug
  // (they'd all collapse to the same one and hit the unique slug index).
  let prodN = 0;
  const mk = (n, o) => Product.create({
    // o.fullName overrides the automatic PREFIX + n name (needed for the
    // substring fixture, whose full search term must appear MID-name).
    name: o.fullName !== undefined ? o.fullName : PREFIX + n,
    slug: PREFIX + "prod-" + (++prodN),
    description: o.description === undefined ? ("desc " + n) : o.description,
    images: [],
    category: o.cat, supplier: supp1._id,
    supplierPrice: 1000, price: o.price, stock: 10,
    stockVersion: 0, hasVariants: !!o.variants, variants: o.variants || [],
    isActive: true,
    ...(o.brand ? { brand: o.brand } : {}),
    ...(o.tags ? { tags: o.tags } : {}),
  });

  // Ranking fixture names. NOTE: the search term carries the ASCII PREFIX, so
  // the term must appear CONTIGUOUSLY in the matching name — for the substring
  // fixture that means the term sits mid-name ("شیک " before PREFIX+پیراهن), a
  // name like PREFIX+زیرپیراهن would never match the term PREFIX+پیراهن.
  const EXACT_NAME = PREFIX + "پیراهن";
  const PREFIX_NAME = PREFIX + "پیراهن مردانه";
  const SUBSTR_NAME = "شیک " + PREFIX + "پیراهن";
  const DESC_NAME = PREFIX + "لباس شیک";

  const pExact = await mk("پیراهن", { cat: cat2._id, price: 40000 });
  const pPrefix = await mk("پیراهن مردانه", { cat: cat2._id, price: 10000 });
  const pSubstr = await mk("", { fullName: SUBSTR_NAME, cat: cat2._id, price: 30000 });
  const pDesc = await mk("لباس شیک", {
    cat: cat2._id, price: 20000,
    description: "یک " + PREFIX + "پیراهن زیبا",
  });
  // NOTE: name must NOT contain the tag-search term "موبایل" (test 4 searches
  // that term and would otherwise match this product via name-substring too).
  const pBrand = await mk("گوشی هوشمند", { brand: brandS._id, cat: cat2._id, price: 50000 });
  const pTag = await mk("قاب گوشی", { tags: [tagPhone._id], cat: cat2._id, price: 60000 });
  const pCat = await mk("کابل شارژ", { cat: cat1._id, price: 70000 });
  const pAttr = await mk("کیف", {
    cat: cat2._id, price: 80000,
    variants: [{
      sku: PREFIX + "SKU-1",
      attributes: [{ attributeId: attrColor._id, name: PREFIX + "رنگ", value: PREFIX + "قرمز" }],
      price: 80000, supplierPrice: 1000, stock: 5, isActive: true,
    }],
  });
  const pDot = await mk("نسخه.پرو", { cat: cat2._id, price: 90000 });
  const pWild = await mk("نسخهXپرو", { cat: cat2._id, price: 95000 });
  await Brand.deleteOne({ _id: brandGone._id });

  // Search term used by the ranking tests (matches pExact/pPrefix/pSubstr/pDesc).
  const T1 = PREFIX + "پیراهن";
  const enc = encodeURIComponent;

  await testAsync("EXACT name search -> exact match first (relevance order)", async () => {
    const res = await http("GET", "/api/products?search=" + enc(T1));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 4, "expected total 4, got " + res.data.total);
    const n = names(res.data);
    assert(n[0] === EXACT_NAME, "exact match must be first, got: " + n.join(","));
    assert(
      n.indexOf(PREFIX_NAME) === 1 &&
      n.indexOf(SUBSTR_NAME) === 2 &&
      n.indexOf(DESC_NAME) === 3,
      "relevance order wrong (prefix>substring>description): " + n.join(",")
    );
  });

  await testAsync("PARTIAL Persian substring still matches (پیراه -> پیراهن)", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "پیراه"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, EXACT_NAME), "پیراهن missing for partial 'پیراه'");
    assert(contains(res.data, PREFIX_NAME), "پیراهن مردانه missing");
    assert(contains(res.data, SUBSTR_NAME), "substring product missing");
    assert(res.data.total >= 4, "expected >=4 matches, got " + res.data.total);
  });

  await testAsync("BRAND name search surfaces its products (سامس -> سامسونگ)", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "سامس"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "گوشی هوشمند"), "brand-matched product missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
    // Populate preserved on the ranked path: brand is an object, not a string.
    const item = res.data.data.find((p) => p.name === PREFIX + "گوشی هوشمند");
    assert(item && item.brand && typeof item.brand === "object" && item.brand.name === PREFIX + "سامسونگ",
      "brand must be populated (object) on the ranked path");
  });

  await testAsync("TAG name search surfaces its products", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "موبایل"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "قاب گوشی"), "tag-matched product missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("CATEGORY name search surfaces its products", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "لوازم"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "کابل شارژ"), "category-matched product missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("ATTRIBUTE value search surfaces matching variants", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "قرمز"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "کیف"), "attribute-value-matched product missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("COMBINED: search + brand", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "سامس") + "&brand=" + brandS._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "گوشی هوشمند"), "search+brand match missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("COMBINED: search + tag", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "قاب") + "&tag=" + tagPhone._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "قاب گوشی"), "search+tag match missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("COMBINED: search + category", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "کابل") + "&category=" + cat1._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "کابل شارژ"), "search+category match missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("COMBINED: search + attribute selection", async () => {
    const url = "/api/products?search=" + enc(PREFIX + "کیف") +
      "&" + enc("attributes[" + PREFIX + "rang]") + "=" + enc(PREFIX + "قرمز");
    const res = await http("GET", url);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "کیف"), "search+attribute match missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("SEARCH + explicit sort (price_asc) overrides relevance", async () => {
    const res = await http("GET", "/api/products?search=" + enc(T1) + "&sort=price_asc");
    assert(res.status === 200, "expected 200, got " + res.status);
    const prices = (res.data.data || []).map((p) => p.price);
    assert(prices.length === 4, "expected 4 rows, got " + prices.length);
    assert(JSON.stringify(prices) === JSON.stringify([10000, 20000, 30000, 40000]),
      "price_asc must override relevance, got: " + prices.join(","));
  });

  await testAsync("SEARCH + pagination: totals, slicing, stable ordering", async () => {
    const page1a = await http("GET", "/api/products?search=" + enc(T1) + "&limit=2&page=1");
    assert(page1a.status === 200, "expected 200, got " + page1a.status);
    assert(page1a.data.total === 4, "total must be 4, got " + page1a.data.total);
    assert(page1a.data.data.length === 2, "page 1 must have 2 rows");
    assert(page1a.data.totalPages === 2, "totalPages must be 2, got " + page1a.data.totalPages);
    assert(page1a.data.hasNextPage === true, "hasNextPage must be true");
    assert(page1a.data.data[0].name === PREFIX + "پیراهن", "page1 first must be exact match");

    const page1b = await http("GET", "/api/products?search=" + enc(T1) + "&limit=2&page=1");
    // names() expects the paginated BODY (page1a.data), not the {status,data} wrapper.
    assert(JSON.stringify(names(page1a.data)) === JSON.stringify(names(page1b.data)),
      "page 1 ordering must be stable across requests");

    const page2 = await http("GET", "/api/products?search=" + enc(T1) + "&limit=2&page=2");
    assert(page2.data.data.length === 2, "page 2 must have 2 rows");
    const all = names(page1a.data).concat(names(page2.data));
    assert(all.length === 4 && new Set(all).size === 4, "no overlap between pages");
    assert(all[2] === SUBSTR_NAME && all[3] === DESC_NAME,
      "page 2 must continue the ranked order, got: " + all.join(","));
  });

  await testAsync("NAME match outranks description-only match (positional)", async () => {
    const res = await http("GET", "/api/products?search=" + enc(T1));
    const n = names(res.data);
    const nameIdx = Math.min(
      n.indexOf(EXACT_NAME),
      n.indexOf(PREFIX_NAME),
      n.indexOf(SUBSTR_NAME)
    );
    assert(nameIdx !== -1 && n.indexOf(DESC_NAME) > nameIdx,
      "any name match must rank above description-only match, got: " + n.join(","));
  });

  await testAsync("EMPTY search result -> 200, total 0", async () => {
    const res = await http("GET", "/api/products?search=" + enc(PREFIX + "چیزی_یافت_نشد"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 0, "expected total 0, got " + res.data.total);
    assert(Array.isArray(res.data.data) && res.data.data.length === 0, "data must be empty");
  });

  await testAsync("REGEX special chars escaped (literal dot) + no 500 on wild input", async () => {
    // A literal "." must match only pDot, never pWild (escapeRegex).
    const dot = await http("GET", "/api/products?search=" + enc(PREFIX + "نسخه.پرو"));
    assert(dot.status === 200, "dot search expected 200, got " + dot.status);
    assert(contains(dot.data, PREFIX + "نسخه.پرو"), "literal-dot product missing");
    assert(!contains(dot.data, PREFIX + "نسخهXپرو"), "unescaped dot over-matched pWild!");
    assert(dot.data.total === 1, "expected total 1, got " + dot.data.total);
    // A search made of pure regex metacharacters must not error (500).
    const wild = await http("GET", "/api/products?search=" + enc(PREFIX + ".*+?^${}()|[]\\"));
    assert(wild.status === 200, "wild special-char search expected 200, got " + wild.status);
    assert(wild.data.total === 0, "expected total 0 for metachar-only search");
  });

  await testAsync("BACKWARD COMPAT: no search behaves exactly as before", async () => {
    const res = await http("GET", "/api/products");
    assert(res.status === 200, "expected 200, got " + res.status);
    // Response shape (pagination contract) unchanged.
    const keys = Object.keys(res.data).sort();
    assert(JSON.stringify(keys) === JSON.stringify(
      ["data", "hasNextPage", "hasPreviousPage", "limit", "page", "total", "totalPages"]),
      "pagination keyset changed: " + keys.join(","));
    // All fixture products (active + in-stock) present, newest first (createdAt desc).
    assert(contains(res.data, PREFIX + "پیراهن") && contains(res.data, PREFIX + "نسخهXپرو"),
      "fixture products missing from unfiltered list");
    const items = res.data.data || [];
    const times = items.map((p) => new Date(p.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      assert(times[i - 1] >= times[i], "default sort must be newest first (createdAt desc)");
    }
    // No `score` field leaks into the response shape (ranked path strips it).
    const ranked = await http("GET", "/api/products?search=" + enc(T1));
    for (const p of (ranked.data.data || [])) {
      assert(!("score" in p), "ranked response leaked score field");
    }
  });

  await testAsync("DETAIL endpoints (?id= / ?slug=) unaffected by search param", async () => {
    const byId = await http("GET", "/api/products?id=" + pExact._id + "&search=" + enc(T1));
    assert(byId.status === 200, "id detail expected 200, got " + byId.status);
    assert(byId.data._id === String(pExact._id), "id detail wrong product");
    const bySlug = await http("GET", "/api/products?slug=" + enc(pExact.slug) + "&search=" + enc(T1));
    assert(bySlug.status === 200, "slug detail expected 200, got " + bySlug.status);
    assert(bySlug.data._id === String(pExact._id), "slug detail wrong product");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Brand.deleteMany({ _id: { $in: [brandS._id, brandGone._id] } });
  await Tag.deleteMany({ _id: tagPhone._id });
  await Category.deleteMany({ _id: { $in: [cat1._id, cat2._id] } });
  await Supplier.deleteMany({ _id: supp1._id });
  await Attribute.deleteMany({ _id: attrColor._id });
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
