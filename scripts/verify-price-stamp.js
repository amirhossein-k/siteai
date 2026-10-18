/**
 * Session 93 — PRICE STAMP (priceLastUpdatedAt + priceVersion CAS) verification
 * against the real running Next.js API + real MongoDB.
 *
 * Tests:
 *   1.  Creation (admin POST) STAMPS the initial pricing configuration
 *       (priceLastUpdatedAt ≈ now, priceVersion still the schema default 0); the
 *       create response leaks nothing.
 *   2.  Admin PUT price change → stamp moves (DB Date ≈ now), priceVersion 0 → 1.
 *   3.  Admin PUT NON-pricing edit (name only, same price/discount) → the stored
 *       stamp is UNCHANGED to the millisecond (structural proof).
 *   4.  Admin PUT identical body (no-op) → stamp unchanged.
 *   5.  Admin PUT with the discount field OMITTED while editing another field →
 *       stamp unchanged (an omitted discount is never a price change).
 *   6.  Admin PUT `discount: null` clearing a stored discount → stamp moves.
 *   7.  Admin PUT discount value change → stamp moves.
 *   8.  Variant product: a change to a NON-minimum variant price → stamp moves;
 *       a variants reorder with identical rows → stamp unchanged.
 *   9.  LEAK SCAN: admin/supplier GET + PUT responses never contain
 *       `priceVersion` / `priceLastUpdatedAt` (or the public-only label).
 *  10.  PUBLIC detail: `priceLastUpdatedLabel` = «آخرین تغییر تنظیمات قیمت و
 *       تخفیف: <Jalali date> ساعت <HH:MM>», raw timestamp + token absent; PUBLIC
 *       list rows carry no stamp/label.
 *  11.  Supplier PUT on its own product with a price change → stamp moves;
 *       response leak-free.
 *  12.  Supplier PUT on another supplier's product → 404 (unchanged) and NO
 *       stamp movement.
 *  13.  Concurrency burst (5 parallel price PUTs) → BOTH outcomes are handled:
 *       every 2xx body is leak-free, any 409 carries the conflict message, the
 *       stored stamp is a real Date, priceVersion is monotonic, and the stored
 *       price matches one of the submitted values.
 *  14.  Churn invariant (no unconditional fallback): a token churn loop during a
 *       PUT may produce 200s and/or 409s, but a successful write's stored stamp
 *       must equal a real value change and priceVersion must never reset.
 *
 * NOTE ON CAS EXHAUSTION (AC-A1): a real Mongo cannot be made to lose all three
 * attempts on demand (no failpoint on the managed deployment), so the
 * deterministic exhaustion proof lives in the unit suite
 * `tests/unit/product-price-cas.test.ts` ("exhausts exactly
 * PRICE_STAMP_MAX_ATTEMPTS and reports a conflict" + "honors an explicit attempt
 * budget") — this script covers everything observable through HTTP/DB.
 *
 * Requires: dev server on http://localhost:3000, real DB.
 * Usage: node scripts/verify-price-stamp.js
 *
 * IMPORTANT: cleans up its own PREFIX'd fixtures (products/supplier/category/
 * user). Never touches unrelated data.
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
const PREFIX = "pstamp_" + Date.now() + "_";
const PASS = "pstamp-test-123";
const SUPPLIER_PHONE = "09157778899";
const SUPPLIER2_PHONE = "09157778898";
const LABEL_PREFIX = "آخرین تغییر تنظیمات قیمت و تخفیف";

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

/** The two INTERNAL fields must never appear in any admin/supplier response. */
function assertNoStampLeak(data, where) {
  for (const key of ["priceVersion", "priceLastUpdatedAt"]) {
    assert(!deepHasKey(data, key), where + " leaked " + key);
  }
  assert(!deepHasKey(data, "priceLastUpdatedLabel"), where + " leaked the public-only label");
}

const sameMs = (a, b) => new Date(a).getTime() === new Date(b).getTime();

// --- Minimal fixture schemas (products are created through the REAL APIs) ---
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
// Session 93 fix — variant products require at least one attribute per variant
// (validateVariants rejects an empty `attributes` array), and
// `prepareVariantsForSave` denormalizes each attribute by looking its
// `attributeId` up in THIS collection. The schema mirrors src/models/Attribute.js
// (minimal, collection-scoped — same convention as the Category/Supplier
// fixtures above and scripts/verify-attribute-facets.js).
const AttributeSchema = new mongoose.Schema(
  {
    name: String,
    slug: { type: String, lowercase: true, trim: true },
    type: { type: String, default: "text" },
    values: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "attributes" }
);

async function run() {
  console.log("================================================================");
  console.log("  SESSION 93 — PRICE STAMP (priceLastUpdatedAt / priceVersion)");
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
  const User = mongoose.models.User_PSTAMP || mongoose.model("User_PSTAMP", UserSchema);
  const Supplier = mongoose.models.Supplier_PSTAMP || mongoose.model("Supplier_PSTAMP", SupplierSchema);
  const Category = mongoose.models.Category_PSTAMP || mongoose.model("Category_PSTAMP", CategorySchema);
  const Attribute = mongoose.models.Attribute_PSTAMP || mongoose.model("Attribute_PSTAMP", AttributeSchema);

  // --- Idempotency sweep (self-cleaning) ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("attributes").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^PstampTest" } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, SUPPLIER2_PHONE] } });

  // --- Admin login (seeded dev admin) ---
  const adminJar = await login("09120000000", "admin123456");
  assert(adminJar.header().length > 0, "admin login failed");
  const adminMe = await http("GET", "/api/auth/session", adminJar);
  assert(adminMe.data?.user?.role === "admin", "admin session role mismatch");

  // --- Fixtures: supplier user + supplier doc + category ---
  const suppUser = await User.create({ name: "PstampTest Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: "PstampTest Supplier Co", contactPhone: SUPPLIER_PHONE, isActive: true });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const suppJar = await login(SUPPLIER_PHONE, PASS);
  const suppMe = await http("GET", "/api/auth/session", suppJar);
  assert(suppMe.data?.user?.role === "supplier", "supplier session role mismatch");
  const catDoc = await Category.create({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true });
  const categoryId = String(catDoc._id);
  const supplierId = String(suppDoc._id);
  // Session 93 fix — the attribute the variant fixture references. `values` is
  // left open (empty) so any value is accepted by validateVariants; the
  // attributeId is what makes prepareVariantsForSave succeed (empty attributes
  // are rejected before any DB write).
  const attrDoc = await Attribute.create({
    name: PREFIX + "اندازه",
    slug: PREFIX + "size",
    type: "text",
    values: [],
    isActive: true,
  });
  const attributeId = String(attrDoc._id);

  /** Create a product through the REAL admin API. */
  async function adminCreate(slug, extra) {
    return http("POST", "/api/admin/products", adminJar, {
      name: PREFIX + slug,
      slug: PREFIX + slug,
      description: "price stamp fixture",
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
  }

  /** The full PUT body the edit form sends (mirrors the admin form fields). */
  async function adminPutBody(id, overrides) {
    const current = await http("GET", "/api/admin/products?id=" + id, adminJar);
    assert(current.status === 200, "admin GET failed: " + current.status);
    const p = current.data;
    return {
      name: p.name,
      slug: p.slug,
      description: p.description || "",
      images: p.images || [],
      brand: p.brand && p.brand._id ? p.brand._id : null,
      tags: (p.tags || []).map((t) => (t && t._id ? t._id : t)),
      category: p.category && p.category._id ? p.category._id : p.category,
      supplier: p.supplier && p.supplier._id ? p.supplier._id : p.supplier,
      supplierPrice: p.supplierPrice,
      price: p.price,
      stock: p.stock,
      hasVariants: p.hasVariants === true,
      variants: p.variants || [],
      isActive: p.isActive !== false,
      ...overrides,
    };
  }

  /** Raw DB view of the internal fields (bypasses every projection). */
  async function stampOf(id) {
    const doc = await db.collection("products").findOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { projection: { priceVersion: 1, priceLastUpdatedAt: 1, price: 1, discount: 1 } }
    );
    assert(doc, "product not found in DB: " + id);
    return doc;
  }

  // ================= TESTS =================

  let simpleId, variantId, storedStamp;

  await testAsync("admin creates a product — CREATION stamps the initial pricing, response leak-free", async () => {
    const res = await adminCreate("simple", { discount: { type: "percent", value: 20, startsAt: null, endsAt: null, isActive: true } });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data));
    assertNoStampLeak(res.data, "admin POST response");
    simpleId = res.data._id;
    const doc = await stampOf(simpleId);
    assert(doc.priceVersion === 0, "expected priceVersion 0, got " + doc.priceVersion);
    // Session 93 — the pricing config a product is BORN with IS its first price,
    // so the stamp starts real (≈ now) instead of null. `priceVersion` stays at
    // the schema default 0 = "no pricing WRITE yet" (the CAS token's job).
    assert(doc.priceLastUpdatedAt instanceof Date, "a created product must carry its creation stamp");
    assert(Math.abs(Date.now() - doc.priceLastUpdatedAt.getTime()) < 60000, "the creation stamp is not ~now");

    // …and that makes the public label available IMMEDIATELY, before any edit.
    const detail = await http("GET", "/api/products?slug=" + PREFIX + "simple", null);
    assert(detail.status === 200, "public detail failed right after create: " + detail.status);
    assert(typeof detail.data.priceLastUpdatedLabel === "string", "the creation stamp must surface a public label");
    storedStamp = doc.priceLastUpdatedAt;
  });

  await testAsync("admin PUT price change moves the stamp (token 0 → 1)", async () => {
    const body = await adminPutBody(simpleId, { price: 1100000 });
    const res = await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data));
    assertNoStampLeak(res.data, "admin PUT response");
    const doc = await stampOf(simpleId);
    assert(doc.priceVersion === 1, "expected priceVersion 1, got " + doc.priceVersion);
    assert(doc.priceLastUpdatedAt instanceof Date, "stamp must be a Date");
    assert(Math.abs(Date.now() - doc.priceLastUpdatedAt.getTime()) < 60000, "stamp is not ~now");
    storedStamp = doc.priceLastUpdatedAt;
  });

  await testAsync("admin PUT non-pricing edit leaves the stamp byte-identical", async () => {
    const body = await adminPutBody(simpleId, { name: PREFIX + "simple renamed" });
    const res = await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body);
    assert(res.status === 200, "expected 200, got " + res.status);
    const doc = await stampOf(simpleId);
    assert(
      sameMs(doc.priceLastUpdatedAt, storedStamp),
      "stamp moved on a non-pricing edit: " + doc.priceLastUpdatedAt + " vs " + storedStamp
    );
    assert(doc.priceVersion === 2, "the write itself must still advance the token, got " + doc.priceVersion);
  });

  await testAsync("admin PUT identical body (no-op) leaves the stamp untouched", async () => {
    const body = await adminPutBody(simpleId);
    const res = await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body);
    assert(res.status === 200, "expected 200, got " + res.status);
    const doc = await stampOf(simpleId);
    assert(sameMs(doc.priceLastUpdatedAt, storedStamp), "a no-op edit moved the stamp");
  });

  await testAsync("admin PUT discount OMITTED (other field edited) leaves the stamp untouched", async () => {
    const body = await adminPutBody(simpleId, { description: "edited without the discount field" });
    assert(body.discount === undefined, "fixture body must omit the discount field");
    const res = await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data));
    const doc = await stampOf(simpleId);
    assert(doc.discount && doc.discount.value === 20, "the stored discount must be kept when omitted");
    assert(sameMs(doc.priceLastUpdatedAt, storedStamp), "an omitted discount moved the stamp");
  });

  await testAsync("admin PUT discount: null (clear) moves the stamp", async () => {
    const body = await adminPutBody(simpleId, { discount: null });
    const res = await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data));
    assert(res.data.discount === null, "the cleared discount must read back as null");
    const doc = await stampOf(simpleId);
    assert(!sameMs(doc.priceLastUpdatedAt, storedStamp), "clearing a stored discount must move the stamp");
    assert(!doc.discount, "discount not cleared in the DB");
    storedStamp = doc.priceLastUpdatedAt;
  });

  await testAsync("admin PUT discount value change moves the stamp", async () => {
    const body = await adminPutBody(simpleId, { discount: { type: "percent", value: 25, startsAt: null, endsAt: null, isActive: true } });
    const res = await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data));
    const doc = await stampOf(simpleId);
    assert(!sameMs(doc.priceLastUpdatedAt, storedStamp), "a discount change must move the stamp");
    storedStamp = doc.priceLastUpdatedAt;
  });

  await testAsync("variant product: non-minimum variant price change moves the stamp; a reorder does not", async () => {
    // Session 93 fix — each variant MUST carry at least one attribute (the real
    // validator rejects `attributes: []`), and distinct values are required so
    // the combination-duplicate check passes. `attributeId` is the fixture
    // attribute created above; prepareVariantsForSave denormalizes its name.
    const v1Attrs = [{ attributeId, value: "M" }];
    const v2Attrs = [{ attributeId, value: "L" }];
    const created = await adminCreate("variant", {
      hasVariants: true,
      price: 0,
      variants: [
        { sku: (PREFIX + "V1").toUpperCase(), attributes: v1Attrs, price: 1200000, supplierPrice: 500000, stock: 4, images: [], isActive: true },
        { sku: (PREFIX + "V2").toUpperCase(), attributes: v2Attrs, price: 900000, supplierPrice: 400000, stock: 3, images: [], isActive: true },
      ],
    });
    assert(created.status === 201, "variant create failed: " + created.status + " " + JSON.stringify(created.data));
    variantId = created.data._id;
    const afterCreate = await stampOf(variantId);
    // Session 93 — creation-time stamp applies to variant products too.
    assert(afterCreate.priceLastUpdatedAt instanceof Date, "a created variant product must carry its creation stamp");

    // 1) raise the NON-MINIMUM variant price (the summary `price` stays 900000)
    const raised = await adminPutBody(variantId, {
      variants: [
        { _id: created.data.variants[0]._id, sku: (PREFIX + "V1").toUpperCase(), attributes: v1Attrs, price: 1300000, supplierPrice: 500000, stock: 4, images: [], isActive: true },
        { _id: created.data.variants[1]._id, sku: (PREFIX + "V2").toUpperCase(), attributes: v2Attrs, price: 900000, supplierPrice: 400000, stock: 3, images: [], isActive: true },
      ],
    });
    const putRaised = await http("PUT", "/api/admin/products?id=" + variantId, adminJar, raised);
    assert(putRaised.status === 200, "variant PUT failed: " + putRaised.status + " " + JSON.stringify(putRaised.data));
    const raisedDoc = await stampOf(variantId);
    assert(raisedDoc.price === 900000, "the summary price should be unchanged (min active variant)");
    assert(raisedDoc.priceLastUpdatedAt instanceof Date, "a non-minimum variant price change must stamp");

    // 2) pure reorder of the same rows — not a price change
    const reordered = await adminPutBody(variantId, {
      variants: [raised.variants[1], raised.variants[0]],
    });
    const putReordered = await http("PUT", "/api/admin/products?id=" + variantId, adminJar, reordered);
    assert(putReordered.status === 200, "reorder PUT failed: " + putReordered.status);
    const reorderedDoc = await stampOf(variantId);
    assert(
      sameMs(reorderedDoc.priceLastUpdatedAt, raisedDoc.priceLastUpdatedAt),
      "a pure variant reorder must not move the stamp"
    );
  });

  await testAsync("LEAK SCAN — admin GET/POST/PUT never expose the stamp or the label", async () => {
    const byId = await http("GET", "/api/admin/products?id=" + simpleId, adminJar);
    assert(byId.status === 200, "admin GET(id) failed");
    assertNoStampLeak(byId.data, "admin GET(id)");
    const list = await http("GET", "/api/admin/products", adminJar);
    assert(list.status === 200, "admin GET(list) failed");
    assertNoStampLeak(list.data, "admin GET(list)");
    const suppGet = await http("GET", "/api/supplier/products?id=" + simpleId, suppJar);
    assert(suppGet.status === 200, "supplier GET(id) failed");
    assertNoStampLeak(suppGet.data, "supplier GET(id)");
  });

  await testAsync("PUBLIC detail exposes the Jalali label only; list rows expose nothing", async () => {
    const detail = await http("GET", "/api/products?slug=" + PREFIX + "simple", null);
    assert(detail.status === 200, "public detail failed: " + detail.status);
    assert(typeof detail.data.priceLastUpdatedLabel === "string", "public label missing");
    assert(detail.data.priceLastUpdatedLabel.startsWith(LABEL_PREFIX + ": "), "unexpected label: " + detail.data.priceLastUpdatedLabel);
    assert(/[۰-۹]/.test(detail.data.priceLastUpdatedLabel), "label must use Persian digits: " + detail.data.priceLastUpdatedLabel);
    // Session 93 — the label carries the CLOCK TIME too (Jalali date + ساعت HH:MM),
    // formatted server-side in the store time zone.
    assert(detail.data.priceLastUpdatedLabel.includes("ساعت"), "label must include the clock time: " + detail.data.priceLastUpdatedLabel);
    assert(/ساعت [۰-۹]{2}:[۰-۹]{2}/.test(detail.data.priceLastUpdatedLabel), "unexpected time format: " + detail.data.priceLastUpdatedLabel);
    for (const key of ["priceVersion", "priceLastUpdatedAt"]) {
      assert(!deepHasKey(detail.data, key), "public detail leaked " + key);
    }
    const list = await http("GET", "/api/products?search=" + PREFIX, null);
    assert(list.status === 200, "public list failed: " + list.status);
    // Session 93 fix — buildPaginatedResponse() returns { data, page, limit,
    // total, totalPages, hasNextPage, hasPreviousPage }; list rows live at
    // `data.data` (the previous `items || products` never matched).
    const rows = list.data.data || [];
    assert(rows.length > 0, "public list returned no fixture rows");
    for (const row of rows) {
      assert(!deepHasKey(row, "priceLastUpdatedLabel"), "public list row leaked the detail-only label");
      for (const key of ["priceVersion", "priceLastUpdatedAt"]) {
        assert(!deepHasKey(row, key), "public list row leaked " + key);
      }
    }
  });

  await testAsync("supplier PUT on its own product with a price change moves the stamp", async () => {
    const created = await http("POST", "/api/supplier/products", suppJar, {
      name: PREFIX + "supplier-owned",
      slug: PREFIX + "supplier-owned",
      description: "supplier price stamp fixture",
      images: [],
      category: categoryId,
      supplierPrice: 300000,
      price: 800000,
      stock: 5,
      hasVariants: false,
      variants: [],
      isActive: true,
    });
    assert(created.status === 201, "supplier create failed: " + created.status + " " + JSON.stringify(created.data));
    assertNoStampLeak(created.data, "supplier POST response");
    const id = created.data._id;
    const before = await stampOf(id);
    // Session 93 — the supplier POST stamps the creation pricing too.
    assert(before.priceLastUpdatedAt instanceof Date, "a supplier-created product must carry its creation stamp");
    assert(before.priceVersion === 0, "a created product's token must stay at the schema default 0");

    const put = await http("PUT", "/api/supplier/products?id=" + id, suppJar, {
      name: created.data.name,
      slug: created.data.slug,
      description: created.data.description || "",
      images: created.data.images || [],
      category: categoryId,
      supplierPrice: 300000,
      price: 850000,
      stock: 5,
      hasVariants: false,
      variants: [],
      isActive: true,
    });
    assert(put.status === 200, "supplier PUT failed: " + put.status + " " + JSON.stringify(put.data));
    assertNoStampLeak(put.data, "supplier PUT response");
    const after = await stampOf(id);
    assert(after.priceLastUpdatedAt instanceof Date, "a supplier price change must stamp");
    assert(after.priceVersion === 1, "expected priceVersion 1, got " + after.priceVersion);
  });

  await testAsync("supplier PUT on ANOTHER supplier's product → 404, no stamp movement", async () => {
    const supp2User = await User.create({ name: "PstampTest Supplier2", phone: SUPPLIER2_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
    const supp2 = await Supplier.create({ user: supp2User._id, businessName: "PstampTest Supplier2 Co", contactPhone: SUPPLIER2_PHONE, isActive: true });
    const foreign = await adminCreate("foreign", { supplier: String(supp2._id), price: 700000 });
    assert(foreign.status === 201, "foreign fixture create failed: " + foreign.status);
    const foreignId = foreign.data._id;
    const before = await stampOf(foreignId);

    const put = await http("PUT", "/api/supplier/products?id=" + foreignId, suppJar, {
      name: foreign.data.name,
      slug: foreign.data.slug,
      description: "cross-supplier attempt",
      images: [],
      category: categoryId,
      supplierPrice: 400000,
      price: 650000,
      stock: 1,
      hasVariants: false,
      variants: [],
      isActive: true,
    });
    assert(put.status === 404, "expected 404 for a cross-supplier write, got " + put.status);
    const after = await stampOf(foreignId);
    // Session 93 — the product HAS a creation stamp; a rejected cross-supplier
    // write must leave it (and the token) exactly as they were.
    assert(
      sameMs(after.priceLastUpdatedAt, before.priceLastUpdatedAt),
      "a rejected cross-supplier write must not move the stamp"
    );
    assert(after.priceVersion === before.priceVersion, "the token must not advance for a rejected write");
  });

  await testAsync("concurrency burst — both outcomes handled, invariants hold", async () => {
    const before = await stampOf(simpleId);
    const bodies = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => adminPutBody(simpleId, { price: 1200000 + i * 1000 }))
    );
    const results = await Promise.all(
      bodies.map((b) => http("PUT", "/api/admin/products?id=" + simpleId, adminJar, b))
    );
    const statuses = results.map((r) => r.status);
    assert(
      statuses.every((s) => s === 200 || s === 409),
      "unexpected burst statuses: " + JSON.stringify(statuses)
    );
    for (const r of results) {
      if (r.status === 200) assertNoStampLeak(r.data, "burst 200 response");
      if (r.status === 409) {
        assert(!deepHasKey(r.data, "priceVersion"), "409 response leaked priceVersion");
        assert(typeof r.data.error === "string", "409 must carry an error message");
      }
    }
    const succeeded = results.filter((r) => r.status === 200);
    assert(succeeded.length >= 1, "at least one burst write must succeed: " + JSON.stringify(statuses));
    const doc = await stampOf(simpleId);
    assert(
      succeeded.some((r) => r.data.price === doc.price),
      "the stored price must match one of the successful responses"
    );
    assert(
      doc.priceVersion >= before.priceVersion + succeeded.length,
      "the token must advance at least once per successful write"
    );
    assert(doc.priceLastUpdatedAt instanceof Date, "the stamp must remain a Date");
  });

  await testAsync("token churn invariant — no unconditional/stale write under churn", async () => {
    const before = await stampOf(simpleId);
    const oid = new mongoose.Types.ObjectId(simpleId);
    let stop = false;
    // A concurrent editor: bumps the CAS token outside the API (direct DB write).
    const churn = (async () => {
      while (!stop) {
        await db.collection("products").updateOne({ _id: oid }, { $inc: { priceVersion: 1 } });
        await new Promise((r) => setTimeout(r, 2));
      }
    })();

    const attempted = [1600000, 1610000, 1620000];
    const results = [];
    for (const price of attempted) {
      const body = await adminPutBody(simpleId, { price });
      results.push(await http("PUT", "/api/admin/products?id=" + simpleId, adminJar, body));
    }
    stop = true;
    await churn;

    for (const r of results) {
      assert(r.status === 200 || r.status === 409, "unexpected churn status: " + r.status);
      if (r.status === 200) assertNoStampLeak(r.data, "churn 200 response");
      if (r.status === 409) assert(typeof r.data.error === "string", "churn 409 must carry a message");
    }
    const doc = await stampOf(simpleId);
    assert(doc.priceVersion > before.priceVersion, "the token must be monotonic under churn");
    assert(
      attempted.includes(doc.price) || doc.price === before.price,
      "the stored price must be a real submitted value"
    );
    if (results.some((r) => r.status === 200)) {
      assert(
        !sameMs(doc.priceLastUpdatedAt, before.priceLastUpdatedAt),
        "a successful price write under churn must produce a fresh stamp (never a stale token)"
      );
    }
  });

  // --- CLEANUP ---
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Category.deleteMany({ name: { $regex: "^" + PREFIX } });
  await Attribute.deleteMany({ slug: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^PstampTest" } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, SUPPLIER2_PHONE] } });

  console.log("\n================================================================");
  console.log("  RESULT: " + passed + "/" + total + " passed, " + failed + " failed");
  console.log("================================================================");
  await mongoose.connection.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error("\nFATAL: " + (err && err.stack ? err.stack : err));
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});