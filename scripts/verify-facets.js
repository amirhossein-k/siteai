/**
 * Session 47 — Storefront Faceted Filtering (Brand + Tag) Verification
 * (real HTTP API)
 *
 * Fixtures (direct DB inserts — API routes use the real models):
 *   brands:  brandA (active), brandB (inactive), brandC (deleted ref target)
 *   tags:    tagX (active), tagY (inactive)
 *   categories: cat1, cat2 (active)
 *   suppliers: supp1 (active)
 *   products (all active + in-stock unless noted):
 *     p1 brandA+tagX cat1 supp1
 *     p2 brandA+tagX cat2 supp1
 *     p3 brandA+tagY cat1 supp1
 *     p4 brandB+tagX cat1 supp1   (inactive brand — still filterable by ref)
 *     p5 brandA+tagX cat1 supp1 zero-stock (never visible)
 *     p6 brandA+tagX cat1 supp1 inactive (never visible)
 *
 * Tests (22):
 *   1.  GET /api/brands -> 200, active-only, whitelist keyset (_id,name,slug)
 *   2.  GET /api/tags -> 200, active-only, whitelist keyset (_id,name,slug)
 *   3.  PROjection leak scan: brand/tag responses never expose internal fields
 *   4.  brand=brandA -> only A's visible products (p1,p2,p3; NOT p4 brandB,
 *       NOT p5 zero-stock, NOT p6 inactive)
 *   5.  tag=tagX -> p1,p2,p4 (not p3 tagY, not p5, not p6)
 *   6.  brand=brandA&tag=tagX -> p1,p2 only
 *   7.  brand=brandA&category=cat1 -> p1,p3 (not p2 cat2)
 *   8.  brand=brandA&search=<p1-name> -> p1 only
 *   9.  brand=brandA&supplier=supp1 -> p1,p2,p3 (all supp1)
 *  10.  brand=brandA&minPrice/maxPrice -> price-filtered subset
 *  11.  tag=tagX&search=<p4-name> -> p4 only
 *  12.  tag=tagX&category=cat1 -> p1,p4
 *  13.  Empty result (brand with no products) -> 200, total 0
 *  14.  Malformed brand id -> 404
 *  15.  Malformed tag id -> 404
 *  16.  Valid-but-nonexistent brand id -> 200 empty (not 404)
 *  17.  Valid-but-nonexistent tag id -> 200 empty
 *  18.  Inactive brand ref (brandB) still filters its products (identity on ref)
 *  19.  Inactive tag ref (tagY) still filters its products
 *  20.  Pagination preserved under filters (page/limit/totalPages)
 *  21.  Sorting preserved under filters (sort=price_asc)
 *  22.  Detail endpoints (?id= / ?slug=) unaffected by filter params
 *
 * Non-test steps: dev-server reachability check + fixture cleanup.
 *
 * Usage: node scripts/verify-facets.js
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
const PREFIX = "facet47_" + Date.now() + "_";

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
  console.log("  SESSION 47 — STOREFRONT FACETED FILTERING (REAL HTTP API)");
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
  const Brand = mongoose.models.Brand_F47 || mongoose.model("Brand_F47", BrandSchema);
  const Tag = mongoose.models.Tag_F47 || mongoose.model("Tag_F47", TagSchema);
  const Category = mongoose.models.Category_F47 || mongoose.model("Category_F47", CategorySchema);
  const Supplier = mongoose.models.Supplier_F47 || mongoose.model("Supplier_F47", SupplierSchema);
  const Product = mongoose.models.Product_F47 || mongoose.model("Product_F47", ProductSchema);

  // --- Idempotency sweep (rerun-safe) ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("tags").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });

  // --- Fixtures ---
  const brandA = await Brand.create({ name: PREFIX + "BrandA", slug: PREFIX + "brand-a", isActive: true });
  const brandB = await Brand.create({ name: PREFIX + "BrandB", slug: PREFIX + "brand-b", isActive: false });
  const brandGone = await Brand.create({ name: PREFIX + "BrandGone", slug: PREFIX + "brand-gone", isActive: true });
  const tagX = await Tag.create({ name: PREFIX + "TagX", slug: PREFIX + "tag-x", isActive: true });
  const tagY = await Tag.create({ name: PREFIX + "TagY", slug: PREFIX + "tag-y", isActive: false });
  const cat1 = await Category.create({ name: PREFIX + "Cat1", slug: PREFIX + "cat-1", isActive: true });
  const cat2 = await Category.create({ name: PREFIX + "Cat2", slug: PREFIX + "cat-2", isActive: true });
  const supp1 = await Supplier.create({ businessName: PREFIX + "Supp1", logo: "", isActive: true });

  const mk = (n, o) => Product.create({
    name: PREFIX + n, slug: PREFIX + n.toLowerCase().replace(/\s/g, "-"),
    description: "desc " + n, images: [],
    category: o.cat, supplier: supp1._id,
    supplierPrice: 1000, price: o.price, stock: o.stock === undefined ? 10 : o.stock,
    stockVersion: 0, hasVariants: false, variants: [], isActive: o.active === undefined ? true : o.active,
    ...(o.brand ? { brand: o.brand } : {}),
    ...(o.tags ? { tags: o.tags } : {}),
  });

  const p1 = await mk("P1", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 10000 });
  const p2 = await mk("P2", { brand: brandA._id, tags: [tagX._id], cat: cat2._id, price: 20000 });
  const p3 = await mk("P3", { brand: brandA._id, tags: [tagY._id], cat: cat1._id, price: 30000 });
  const p4 = await mk("P4", { brand: brandB._id, tags: [tagX._id], cat: cat1._id, price: 40000 });
  const p5 = await mk("P5", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 50000, stock: 0 });
  const p6 = await mk("P6", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 60000, active: false });
  // brandGone is deleted AFTER tests that need it, to test valid-but-gone ref.
  await Brand.deleteOne({ _id: brandGone._id });

  await testAsync("GET /api/brands -> 200, active-only, whitelist keyset", async () => {
    const res = await http("GET", "/api/brands");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "brands must be an array");
    const bNames = res.data.map((b) => b.name);
    assert(bNames.includes(PREFIX + "BrandA"), "BrandA missing");
    assert(!bNames.includes(PREFIX + "BrandB"), "inactive brand leaked");
    for (const b of res.data) {
      const keys = Object.keys(b).sort();
      assert(JSON.stringify(keys) === JSON.stringify(["_id", "name", "slug"]),
        "brand keyset must be exactly _id,name,slug, got " + keys.join(","));
    }
  });

  await testAsync("GET /api/tags -> 200, active-only, whitelist keyset", async () => {
    const res = await http("GET", "/api/tags");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "tags must be an array");
    const tNames = res.data.map((t) => t.name);
    assert(tNames.includes(PREFIX + "TagX"), "TagX missing");
    assert(!tNames.includes(PREFIX + "TagY"), "inactive tag leaked");
    for (const t of res.data) {
      const keys = Object.keys(t).sort();
      assert(JSON.stringify(keys) === JSON.stringify(["_id", "name", "slug"]),
        "tag keyset must be exactly _id,name,slug, got " + keys.join(","));
    }
  });

  await testAsync("PROJECTION LEAK SCAN: brand/tag facets expose only whitelist fields", async () => {
    const FORBIDDEN = ["description", "logo", "website", "isActive", "createdAt", "updatedAt", "__v", "timestamps"];
    const scan = (v, seen = new Set()) => {
      if (!v || typeof v !== "object") return null;
      if (seen.has(v)) return null;
      seen.add(v);
      for (const [k, val] of Object.entries(v)) {
        if (FORBIDDEN.includes(k)) return k;
        const nested = scan(val, seen);
        if (nested) return nested;
      }
      return null;
    };
    const bRes = await http("GET", "/api/brands");
    const tRes = await http("GET", "/api/tags");
    assert(scan(bRes.data) === null, "brand LEAK: " + scan(bRes.data));
    assert(scan(tRes.data) === null, "tag LEAK: " + scan(tRes.data));
  });

  await testAsync("brand=brandA -> only A's visible products", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    const n = names(res.data);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P2") && contains(res.data, PREFIX + "P3"),
      "missing brandA products: " + n.join(","));
    assert(!n.includes(PREFIX + "P4"), "brandB product leaked: " + n.join(","));
    assert(!n.includes(PREFIX + "P5"), "zero-stock leaked: " + n.join(","));
    assert(!n.includes(PREFIX + "P6"), "inactive leaked: " + n.join(","));
    assert(res.data.total === 3, "expected total 3, got " + res.data.total);
  });

  await testAsync("tag=tagX -> p1,p2,p4", async () => {
    const res = await http("GET", "/api/products?tag=" + tagX._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P2") && contains(res.data, PREFIX + "P4"),
      "missing tagX products");
    assert(!names(res.data).includes(PREFIX + "P3"), "tagY product leaked");
    assert(res.data.total === 3, "expected total 3, got " + res.data.total);
  });

  await testAsync("brand=brandA&tag=tagX -> p1,p2 only", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&tag=" + tagX._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P2"), "missing combined match");
    assert(!names(res.data).includes(PREFIX + "P3") && !names(res.data).includes(PREFIX + "P4"),
      "combined filter leaked");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("brand=brandA&category=cat1 -> p1,p3 (not p2 cat2)", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&category=" + cat1._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P3"), "missing cat1 match");
    assert(!names(res.data).includes(PREFIX + "P2"), "cat2 product leaked");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("brand=brandA&search=<p1-name> -> p1 only", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&search=" + encodeURIComponent(PREFIX + "P1"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1"), "p1 missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("brand=brandA&supplier=supp1 -> all A products (supplier filter additive)", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&supplier=" + supp1._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 3, "expected total 3, got " + res.data.total);
  });

  await testAsync("brand=brandA&minPrice/maxPrice -> price-filtered subset", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&minPrice=20000&maxPrice=30000");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P2") && contains(res.data, PREFIX + "P3"), "price window mismatch");
    assert(!names(res.data).includes(PREFIX + "P1"), "p1 (10000) outside window leaked");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("tag=tagX&search=<p4-name> -> p4 only", async () => {
    const res = await http("GET", "/api/products?tag=" + tagX._id + "&search=" + encodeURIComponent(PREFIX + "P4"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P4"), "p4 missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("tag=tagX&category=cat1 -> p1,p4", async () => {
    const res = await http("GET", "/api/products?tag=" + tagX._id + "&category=" + cat1._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P4"), "missing cat1 tagX match");
    assert(!names(res.data).includes(PREFIX + "P2"), "p2 (cat2) leaked");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("Empty result (valid brand, no products) -> 200 total 0", async () => {
    // brandGone was deleted — no products reference it
    const res = await http("GET", "/api/products?brand=" + brandGone._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 0, "expected total 0, got " + res.data.total);
    assert(Array.isArray(res.data.data) && res.data.data.length === 0, "data must be empty");
  });

  await testAsync("Malformed brand id -> 404", async () => {
    const res = await http("GET", "/api/products?brand=not-an-id");
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  await testAsync("Malformed tag id -> 404", async () => {
    const res = await http("GET", "/api/products?tag=not-an-id");
    assert(res.status === 404, "expected 404, got " + res.status);
  });

  await testAsync("Valid-but-nonexistent brand id -> 200 empty (not 404)", async () => {
    const res = await http("GET", "/api/products?brand=" + new mongoose.Types.ObjectId());
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 0, "expected total 0, got " + res.data.total);
  });

  await testAsync("Valid-but-nonexistent tag id -> 200 empty", async () => {
    const res = await http("GET", "/api/products?tag=" + new mongoose.Types.ObjectId());
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 0, "expected total 0, got " + res.data.total);
  });

  await testAsync("Inactive brand ref (brandB) still filters its products (identity on ref)", async () => {
    const res = await http("GET", "/api/products?brand=" + brandB._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P4"), "p4 (brandB) missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("Inactive tag ref (tagY) still filters its products", async () => {
    const res = await http("GET", "/api/products?tag=" + tagY._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P3"), "p3 (tagY) missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("Pagination preserved under filters", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&limit=2&page=1");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.data.length === 2, "limit=2 must return 2 rows");
    assert(res.data.total === 3, "total must stay 3, got " + res.data.total);
    assert(res.data.totalPages === 2, "totalPages must be 2, got " + res.data.totalPages);
    const res2 = await http("GET", "/api/products?brand=" + brandA._id + "&limit=2&page=2");
    assert(res2.data.data.length === 1, "page 2 must return 1 row");
  });

  await testAsync("Sorting preserved under filters (price_asc)", async () => {
    const res = await http("GET", "/api/products?brand=" + brandA._id + "&sort=price_asc");
    assert(res.status === 200, "expected 200, got " + res.status);
    const prices = (res.data.data || []).map((p) => p.price);
    assert(prices.length === 3, "expected 3 rows");
    assert(prices[0] === 10000 && prices[1] === 20000 && prices[2] === 30000,
      "price_asc order wrong: " + prices.join(","));
  });

  await testAsync("Detail endpoints (?id= / ?slug=) unaffected by filter params", async () => {
    const byId = await http("GET", "/api/products?id=" + p1._id + "&brand=" + brandB._id + "&tag=" + tagY._id);
    assert(byId.status === 200, "id detail expected 200, got " + byId.status);
    assert(byId.data._id === String(p1._id), "id detail wrong product");
    const bySlug = await http("GET", "/api/products?slug=" + encodeURIComponent(p1.slug) + "&brand=" + brandB._id);
    assert(bySlug.status === 200, "slug detail expected 200, got " + bySlug.status);
    assert(bySlug.data._id === String(p1._id), "slug detail wrong product");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Brand.deleteMany({ _id: { $in: [brandA._id, brandB._id, brandGone._id] } });
  await Tag.deleteMany({ _id: { $in: [tagX._id, tagY._id] } });
  await Category.deleteMany({ _id: { $in: [cat1._id, cat2._id] } });
  await Supplier.deleteMany({ _id: supp1._id });
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
