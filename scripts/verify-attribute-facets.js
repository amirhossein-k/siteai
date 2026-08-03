/**
 * Session 47 extension — Attribute Facets Verification (real HTTP API)
 *
 * Validates the Session 47 extensibility claim: nested attributes[<slug>]=<value>
 * filtering on /api/products and the aggregation facet-counts endpoint
 * /api/attributes/facets — with ZERO changes to the products data flow.
 *
 * Fixtures (direct DB inserts — API routes use the real models):
 *   attributes: attrColor (active), attrSize (active), attrOld (inactive)
 *   brands: brandA, brandB (active) | tags: tagX, tagY (active)
 *   categories: cat1, cat2 (active) | suppliers: supp1 (active)
 *   products (active + in-stock unless noted):
 *     p1  color=red   size=M   brandA cat1 tagX
 *     p2  color=red   size=L   brandA cat1 tagX
 *     p3  color=blue  size=S   brandA cat2 tagX
 *     p4  color=blue  size=M   brandB cat1 tagY
 *     p5  color=green size=M   brandA cat2 tagX
 *     p6  NO VARIANTS (simple product) — never matches attribute filters
 *     p7  color=red size=M zero-stock (never visible)
 *     p8  color=red size=M inactive (never visible)
 *     p9  color=red size=S AND size=M (two variants, same value) — counts once
 *     p10 color=old value=x (inactive attribute ref — still filterable)
 *
 * Tests (24):
 *   1.   GET /api/attributes/facets -> 200, active-only, whitelist keyset
 *   2.   Facet counts match the visible catalog (color red=3/blue=2/green=1,
 *        size M=3/S=2/L=1) with distinct-product counting (p9 counts once)
 *   3.   Projection leak scan: no internal fields in facets/values
 *   4.   Inactive attribute never surfaced in facets
 *   5.   Single attribute filter: color=red -> p1,p2,p9 (3)
 *   6.   Single attribute filter: size=S -> p3,p9 (2)
 *   7.   Two attributes AND: color=red&size=M -> p1,p9 (2)
 *   8.   Attribute + brand: color=blue&brand=brandB -> p4
 *   9.   Attribute + category: color=red&category=cat1 -> p1,p2,p9
 *  10.   Attribute + search: color=red&search=<p2-name> -> p2
 *  11.   Attribute + supplier: color=red&supplier=supp1 -> p1,p2,p9
 *  12.   Attribute + price: color=red&minPrice/maxPrice -> windowed subset
 *  13.   Attribute + tag: color=blue&tag=tagY -> p4
 *  14.   Unknown attribute slug -> 200 empty (valid-but-nonexistent rule)
 *  15.   Simple products never match attribute filters (p6 absent)
 *  16.   Inactive attribute ref still filters (p10 via attributes[old]=x)
 *  17.   Facet counts narrow with a brand filter (sticky context)
 *  18.   Facet counts narrow with a category filter
 *  19.   Facet counts unaffected by sort/page params (stable keys)
 *  20.   Sticky self-exclusion: selecting color=red keeps size facets visible
 *  21.   Sticky self-exclusion: selecting size keeps color counts accurate
 *  22.   Pagination preserved under attribute filters (limit/page/totalPages)
 *  23.   Sorting preserved under attribute filters (sort=price_asc)
 *  24.   Detail endpoints (?id= / ?slug=) unaffected by attribute params
 *
 * Non-test steps: dev-server reachability check + fixture cleanup.
 *
 * Usage: node scripts/verify-attribute-facets.js
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
const PREFIX = "afacet_" + Date.now() + "_";

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
  console.log("  SESSION 47 EXTENSION — ATTRIBUTE FACETS (REAL HTTP API)");
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
  const Brand = mongoose.models.Brand_AF || mongoose.model("Brand_AF", BrandSchema);
  const Tag = mongoose.models.Tag_AF || mongoose.model("Tag_AF", TagSchema);
  const Category = mongoose.models.Category_AF || mongoose.model("Category_AF", CategorySchema);
  const Supplier = mongoose.models.Supplier_AF || mongoose.model("Supplier_AF", SupplierSchema);
  const Attribute = mongoose.models.Attribute_AF || mongoose.model("Attribute_AF", AttributeSchema);
  const Product = mongoose.models.Product_AF || mongoose.model("Product_AF", ProductSchema);

  // --- Idempotency sweep (rerun-safe) ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("attributes").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("tags").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });

  // --- Fixtures ---
  const attrColor = await Attribute.create({
    name: PREFIX + "Color", slug: PREFIX + "color", type: "color",
    values: ["red", "blue", "green"], isActive: true,
  });
  const attrSize = await Attribute.create({
    name: PREFIX + "Size", slug: PREFIX + "size", type: "size",
    values: ["S", "M", "L"], isActive: true,
  });
  const attrOld = await Attribute.create({
    name: PREFIX + "Old", slug: PREFIX + "old", type: "text",
    values: ["x"], isActive: false,
  });
  const brandA = await Brand.create({ name: PREFIX + "BrandA", slug: PREFIX + "brand-a", isActive: true });
  const brandB = await Brand.create({ name: PREFIX + "BrandB", slug: PREFIX + "brand-b", isActive: true });
  const tagX = await Tag.create({ name: PREFIX + "TagX", slug: PREFIX + "tag-x", isActive: true });
  const tagY = await Tag.create({ name: PREFIX + "TagY", slug: PREFIX + "tag-y", isActive: true });
  const cat1 = await Category.create({ name: PREFIX + "Cat1", slug: PREFIX + "cat-1", isActive: true });
  const cat2 = await Category.create({ name: PREFIX + "Cat2", slug: PREFIX + "cat-2", isActive: true });
  const supp1 = await Supplier.create({ businessName: PREFIX + "Supp1", logo: "", isActive: true });

  // variant builder: { sku, attributes: [{attributeId, name, value}], price, stock, isActive }
  const variant = (sku, attrs, price) => ({
    sku, attributes: attrs, price, supplierPrice: Math.floor(price / 2),
    stock: 10, stockVersion: 0, images: [], isActive: true,
  });
  const cv = (attr, value) => ({ attributeId: attr._id, name: attr.name, value });

  const mk = (n, o) => Product.create({
    name: PREFIX + n, slug: PREFIX + n.toLowerCase().replace(/\s/g, "-"),
    description: "desc " + n, images: [],
    brand: o.brand, tags: o.tags, category: o.cat, supplier: supp1._id,
    supplierPrice: 1000, price: o.price, stock: o.stock === undefined ? 10 : o.stock,
    stockVersion: 0, hasVariants: o.variants.length > 0, variants: o.variants,
    isActive: o.active === undefined ? true : o.active,
  });

  const vColor = (c) => cv(attrColor, c);
  const vSize = (s) => cv(attrSize, s);

  const p1 = await mk("P1", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 10000,
    variants: [variant("S1", [vColor("red"), vSize("M")], 10000)] });
  const p2 = await mk("P2", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 20000,
    variants: [variant("S2", [vColor("red"), vSize("L")], 20000)] });
  const p3 = await mk("P3", { brand: brandA._id, tags: [tagX._id], cat: cat2._id, price: 30000,
    variants: [variant("S3", [vColor("blue"), vSize("S")], 30000)] });
  const p4 = await mk("P4", { brand: brandB._id, tags: [tagY._id], cat: cat1._id, price: 40000,
    variants: [variant("S4", [vColor("blue"), vSize("M")], 40000)] });
  const p5 = await mk("P5", { brand: brandA._id, tags: [tagX._id], cat: cat2._id, price: 50000,
    variants: [variant("S5", [vColor("green"), vSize("M")], 50000)] });
  const p6 = await mk("P6", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 60000, variants: [] });
  const p7 = await mk("P7", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 70000, stock: 0,
    variants: [variant("S7", [vColor("red"), vSize("M")], 70000)] });
  const p8 = await mk("P8", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 80000, active: false,
    variants: [variant("S8", [vColor("red"), vSize("M")], 80000)] });
  const p9 = await mk("P9", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 90000,
    variants: [
      variant("S9a", [vColor("red"), vSize("S")], 90000),
      variant("S9b", [vColor("red"), vSize("M")], 90000),
    ] });
  const p10 = await mk("P10", { brand: brandA._id, tags: [tagX._id], cat: cat1._id, price: 100000,
    variants: [variant("S10", [cv(attrOld, "x")], 100000)] });

  const attrParam = (slug, value) =>
    encodeURIComponent("attributes[" + slug + "]") + "=" + encodeURIComponent(value);

  // Visible catalog: p1..p6, p9, p10 (p7 zero-stock, p8 inactive hidden)
  // color: red -> p1,p2,p9 (3) | blue -> p3,p4 (2) | green -> p5 (1)
  // size:  M -> p1,p4,p5,p9 (4) | S -> p3,p9 (2) | L -> p2 (1)

  await testAsync("GET /api/attributes/facets -> 200, active-only, whitelist keyset", async () => {
    const res = await http("GET", "/api/attributes/facets");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data.facets), "facets must be an array");
    const slugs = res.data.facets.map((f) => f.slug);
    assert(slugs.includes(PREFIX + "color") && slugs.includes(PREFIX + "size"),
      "active facets missing: " + slugs.join(","));
    assert(!slugs.includes(PREFIX + "old"), "inactive attribute leaked into facets");
    for (const f of res.data.facets) {
      const keys = Object.keys(f).sort();
      assert(JSON.stringify(keys) === JSON.stringify(["name", "slug", "type", "values"]),
        "facet keyset must be name,slug,type,values, got " + keys.join(","));
      for (const v of f.values) {
        const vKeys = Object.keys(v).sort();
        assert(JSON.stringify(vKeys) === JSON.stringify(["count", "value"]),
          "value keyset must be count,value, got " + vKeys.join(","));
      }
    }
  });

  await testAsync("Facet counts match visible catalog (distinct-product counting)", async () => {
    const res = await http("GET", "/api/attributes/facets");
    const color = res.data.facets.find((f) => f.slug === PREFIX + "color");
    const size = res.data.facets.find((f) => f.slug === PREFIX + "size");
    const count = (facet, value) => facet.values.find((v) => v.value === value)?.count;
    assert(count(color, "red") === 3, "color red expected 3, got " + count(color, "red"));
    assert(count(color, "blue") === 2, "color blue expected 2, got " + count(color, "blue"));
    assert(count(color, "green") === 1, "color green expected 1, got " + count(color, "green"));
    assert(count(size, "M") === 4, "size M expected 4 (p1,p4,p5,p9), got " + count(size, "M"));
    assert(count(size, "S") === 2, "size S expected 2 (p3,p9), got " + count(size, "S"));
    assert(count(size, "L") === 1, "size L expected 1, got " + count(size, "L"));
  });

  await testAsync("PROJECTION LEAK SCAN: facets expose only whitelist fields", async () => {
    const FORBIDDEN = ["_id", "isActive", "createdAt", "updatedAt", "__v", "attributeId",
      "productIds", "products", "supplier", "brand", "category"];
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
    const res = await http("GET", "/api/attributes/facets");
    assert(scan(res.data) === null, "facets LEAK: " + scan(res.data));
  });

  await testAsync("Inactive attribute never surfaced in facets", async () => {
    const res = await http("GET", "/api/attributes/facets");
    const slugs = res.data.facets.map((f) => f.slug);
    assert(!slugs.includes(PREFIX + "old"), "inactive attribute present: " + slugs.join(","));
  });

  await testAsync("Single attribute filter: color=red -> p1,p2,p9 (3)", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P2") && contains(res.data, PREFIX + "P9"),
      "missing red products: " + names(res.data).join(","));
    assert(!names(res.data).includes(PREFIX + "P3"), "blue product leaked");
    assert(res.data.total === 3, "expected total 3, got " + res.data.total);
  });

  await testAsync("Single attribute filter: size=S -> p3,p9 (2)", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "size", "S"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P3") && contains(res.data, PREFIX + "P9"), "missing size-S products");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("Two attributes AND: color=red&size=M -> p1,p9 (2)", async () => {
    const res = await http("GET", "/api/products?" +
      attrParam(PREFIX + "color", "red") + "&" + attrParam(PREFIX + "size", "M"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P9"), "missing AND match");
    assert(!names(res.data).includes(PREFIX + "P2"), "p2 (L) leaked");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("Attribute + brand: color=blue&brand=brandB -> p4", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "blue") + "&brand=" + brandB._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P4"), "p4 missing");
    assert(!names(res.data).includes(PREFIX + "P3"), "p3 (brandA) leaked");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("Attribute + category: color=red&category=cat1 -> p1,p2,p9", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") + "&category=" + cat1._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P1") && contains(res.data, PREFIX + "P2") && contains(res.data, PREFIX + "P9"),
      "missing cat1 red products");
    assert(res.data.total === 3, "expected total 3, got " + res.data.total);
  });

  await testAsync("Attribute + search: color=red&search=<p2-name> -> p2", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") +
      "&search=" + encodeURIComponent(PREFIX + "P2"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P2"), "p2 missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("Attribute + supplier: color=red&supplier=supp1 -> p1,p2,p9", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") + "&supplier=" + supp1._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 3, "expected total 3, got " + res.data.total);
  });

  await testAsync("Attribute + price: color=red&minPrice=15000&maxPrice=95000 -> p2,p9", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") +
      "&minPrice=15000&maxPrice=95000");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P2") && contains(res.data, PREFIX + "P9"), "price window mismatch");
    assert(!names(res.data).includes(PREFIX + "P1"), "p1 (10000) outside window leaked");
    assert(res.data.total === 2, "expected total 2, got " + res.data.total);
  });

  await testAsync("Attribute + tag: color=blue&tag=tagY -> p4", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "blue") + "&tag=" + tagY._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P4"), "p4 missing");
    assert(!names(res.data).includes(PREFIX + "P3"), "p3 (tagX) leaked");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("Unknown attribute slug -> 200 empty (valid-but-nonexistent rule)", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "nope", "x"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.total === 0, "expected total 0, got " + res.data.total);
    const facets = await http("GET", "/api/attributes/facets?" + attrParam(PREFIX + "nope", "x"));
    assert(facets.status === 200, "facets expected 200, got " + facets.status);
    assert(Array.isArray(facets.data.facets) && facets.data.facets.length === 0,
      "facets must be empty for unknown slug");
  });

  await testAsync("Simple products never match attribute filters (p6 absent)", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(!names(res.data).includes(PREFIX + "P6"), "simple product p6 matched attribute filter");
    const all = await http("GET", "/api/products?brand=" + brandA._id);
    assert(contains(all.data, PREFIX + "P6"), "p6 (simple) must still appear without attribute filter");
  });

  await testAsync("Inactive attribute ref still filters (attributes[old]=x -> p10)", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "old", "x"));
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(contains(res.data, PREFIX + "P10"), "p10 missing");
    assert(res.data.total === 1, "expected total 1, got " + res.data.total);
  });

  await testAsync("Facet counts narrow with a brand filter (sticky context)", async () => {
    const res = await http("GET", "/api/attributes/facets?brand=" + brandB._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    const color = res.data.facets.find((f) => f.slug === PREFIX + "color");
    const count = (v) => color.values.find((x) => x.value === v)?.count;
    assert(count("blue") === 1, "blue expected 1 (p4), got " + count("blue"));
    assert(count("red") === undefined, "red must be absent under brandB");
  });

  await testAsync("Facet counts narrow with a category filter", async () => {
    const res = await http("GET", "/api/attributes/facets?category=" + cat2._id);
    assert(res.status === 200, "expected 200, got " + res.status);
    const color = res.data.facets.find((f) => f.slug === PREFIX + "color");
    const size = res.data.facets.find((f) => f.slug === PREFIX + "size");
    const c = (v) => color.values.find((x) => x.value === v)?.count;
    const s = (v) => size.values.find((x) => x.value === v)?.count;
    assert(c("blue") === 1 && c("green") === 1, "cat2 colors wrong");
    assert(c("red") === undefined, "red absent under cat2");
    assert(s("S") === 1 && s("M") === 1, "cat2 sizes wrong");
    assert(s("L") === undefined, "L absent under cat2");
  });

  await testAsync("Facet counts unaffected by sort/page params (stable keys)", async () => {
    const base = await http("GET", "/api/attributes/facets?" + attrParam(PREFIX + "color", "red"));
    const withParams = await http("GET", "/api/attributes/facets?" +
      attrParam(PREFIX + "color", "red") + "&sort=price_asc&page=2&limit=2");
    assert(base.status === 200 && withParams.status === 200, "expected 200s");
    const bColor = base.data.facets.find((f) => f.slug === PREFIX + "color");
    const wColor = withParams.data.facets.find((f) => f.slug === PREFIX + "color");
    const bSize = base.data.facets.find((f) => f.slug === PREFIX + "size");
    const wSize = withParams.data.facets.find((f) => f.slug === PREFIX + "size");
    assert(JSON.stringify(bColor.values) === JSON.stringify(wColor.values), "color counts changed with sort/page");
    assert(JSON.stringify(bSize.values) === JSON.stringify(wSize.values), "size counts changed with sort/page");
  });

  await testAsync("STICKY: selecting color=red keeps size facets visible", async () => {
    const res = await http("GET", "/api/attributes/facets?" + attrParam(PREFIX + "color", "red"));
    assert(res.status === 200, "expected 200, got " + res.status);
    const size = res.data.facets.find((f) => f.slug === PREFIX + "size");
    const s = (v) => size.values.find((x) => x.value === v)?.count;
    assert(s("M") === 2, "size M expected 2 (p1,p9) with red selected, got " + s("M"));
    assert(s("L") === 1, "size L expected 1 (p2), got " + s("L"));
    assert(s("S") === 1, "size S expected 1 (p9), got " + s("S"));
  });

  await testAsync("STICKY: selecting size=M keeps color counts accurate (no self-exclusion)", async () => {
    const res = await http("GET", "/api/attributes/facets?" + attrParam(PREFIX + "size", "M"));
    assert(res.status === 200, "expected 200, got " + res.status);
    const color = res.data.facets.find((f) => f.slug === PREFIX + "color");
    const c = (v) => color.values.find((x) => x.value === v)?.count;
    // With size=M context (p1,p4,p5,p9): red=p1,p9(2), blue=p4(1), green=p5(1)
    assert(c("red") === 2, "red expected 2 (p1,p9), got " + c("red"));
    assert(c("blue") === 1, "blue expected 1 (p4), got " + c("blue"));
    assert(c("green") === 1, "green expected 1 (p5), got " + c("green"));
  });

  await testAsync("Pagination preserved under attribute filters", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") + "&limit=2&page=1");
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.data.length === 2, "limit=2 must return 2 rows");
    assert(res.data.total === 3, "total must stay 3, got " + res.data.total);
    assert(res.data.totalPages === 2, "totalPages must be 2, got " + res.data.totalPages);
    const res2 = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") + "&limit=2&page=2");
    assert(res2.data.data.length === 1, "page 2 must return 1 row");
  });

  await testAsync("Sorting preserved under attribute filters (price_asc)", async () => {
    const res = await http("GET", "/api/products?" + attrParam(PREFIX + "color", "red") + "&sort=price_asc");
    assert(res.status === 200, "expected 200, got " + res.status);
    const prices = (res.data.data || []).map((p) => p.price);
    assert(prices.length === 3, "expected 3 rows");
    assert(prices[0] === 10000 && prices[1] === 20000 && prices[2] === 90000,
      "price_asc order wrong: " + prices.join(","));
  });

  await testAsync("Detail endpoints (?id= / ?slug=) unaffected by attribute params", async () => {
    const byId = await http("GET", "/api/products?id=" + p3._id + "&" + attrParam(PREFIX + "color", "red"));
    assert(byId.status === 200, "id detail expected 200, got " + byId.status);
    assert(byId.data._id === String(p3._id), "id detail wrong product");
    const bySlug = await http("GET", "/api/products?slug=" + encodeURIComponent(p3.slug) +
      "&" + attrParam(PREFIX + "color", "red"));
    assert(bySlug.status === 200, "slug detail expected 200, got " + bySlug.status);
    assert(bySlug.data._id === String(p3._id), "slug detail wrong product");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Attribute.deleteMany({ _id: { $in: [attrColor._id, attrSize._id, attrOld._id] } });
  await Brand.deleteMany({ _id: { $in: [brandA._id, brandB._id] } });
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
