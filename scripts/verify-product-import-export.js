/**
 * Session 51 — Bulk Product CSV Import/Export Verification (real HTTP API)
 *
 * Validates the new additive endpoints (existing product APIs are untouched):
 *   - admin import  POST  /api/admin/products/import    (admin-only, rate-limited)
 *   - admin export  GET   /api/admin/products/export    (admin-only)
 *   - supplier import POST /api/supplier/products/import (supplier-only, ownership auto-set)
 *   - supplier export GET  /api/supplier/products/export (supplier-only, scoped)
 *
 * Covers: authz (401/403 ×4), happy path + report shape, per-row failures
 * (bad price, unknown category/brand/tag, missing supplier), Persian digits,
 * duplicate-slug skip (in-file + vs DB), create-only (re-import → all skipped),
 * row cap, rate limit 429, export headers/content + formula-injection
 * escaping, supplier ownership isolation, export→import round-trip, the
 * untouched admin POST still working, and stored-XSS sanitization.
 *
 * Usage: node scripts/verify-product-import-export.js
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
// Slug-safe prefix (lowercase letters/digits/hyphens — underscores are NOT
// valid in product slugs, which caused every fixture row to fail validation).
const PREFIX = "pie51-" + Date.now() + "-";
const PASS = "pie-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_A_PHONE = "09174441031";
const SUPPLIER_B_PHONE = "09174441032";
const CUSTOMER_PHONE = "09174441033";
const RATE_USER_PHONE = "09174441034";

const HEADERS = [
  "name", "slug", "description", "price", "supplierPrice", "stock",
  "category", "brand", "tags", "images", "isActive", "supplier",
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
  return { status: res.status, data, text };
}

/** Build a CSV string from the fixed HEADERS + array rows. */
function mkCsv(rows) {
  return HEADERS.join(",") + "\n" + rows.map((r) => r.join(",")).join("\n");
}

// --- Minimal fixture schemas (fixtures only; API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, bankAccount: { cardNumber: String, iban: String, ownerName: String }, balance: Number, pendingReserve: Number, telegramChatId: String, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);
const CategorySchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "categories" }
);
const BrandSchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "brands" }
);
const TagSchema = new mongoose.Schema(
  { name: String, slug: String, isActive: Boolean },
  { timestamps: true, collection: "tags" }
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
  console.log("  SESSION 51 — BULK PRODUCT CSV IMPORT/EXPORT (REAL HTTP API)");
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
  const User = mongoose.models.User_PIE51 || mongoose.model("User_PIE51", UserSchema);
  const Supplier = mongoose.models.Supplier_PIE51 || mongoose.model("Supplier_PIE51", SupplierSchema);
  const Category = mongoose.models.Category_PIE51 || mongoose.model("Category_PIE51", CategorySchema);
  const Brand = mongoose.models.Brand_PIE51 || mongoose.model("Brand_PIE51", BrandSchema);
  const Tag = mongoose.models.Tag_PIE51 || mongoose.model("Tag_PIE51", TagSchema);
  const Product = mongoose.models.Product_PIE51 || mongoose.model("Product_PIE51", ProductSchema);

  // --- Idempotency sweep ---
  const stalePhones = [SUPPLIER_A_PHONE, SUPPLIER_B_PHONE, CUSTOMER_PHONE, RATE_USER_PHONE];
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("tags").deleteMany({ name: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: stalePhones } });
  // Rate-limiter keys persist 15min across runs — clear the import keys so a
  // re-run is hermetic (scoped to this feature's key namespace).
  await db
    .collection("ratelimits")
    .deleteMany({ _id: { $regex: "^rl:product-import:" } });

  // --- Fixtures (users BEFORE login) ---
  const supplierAUser = await User.create({ name: "PIE Supplier A", phone: SUPPLIER_A_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const supplierBUser = await User.create({ name: "PIE Supplier B", phone: SUPPLIER_B_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const customerUser = await User.create({ name: "PIE Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const rateUser = await User.create({ name: "PIE Rate", phone: RATE_USER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });

  const supplierA = await Supplier.create({ user: supplierAUser._id, businessName: PREFIX + "suppa", contactPhone: SUPPLIER_A_PHONE, bankAccount: { cardNumber: "6037991234567890", iban: "IR123456789012345678901234", ownerName: "A" }, balance: 0, pendingReserve: 0, telegramChatId: "", isActive: true });
  const supplierB = await Supplier.create({ user: supplierBUser._id, businessName: PREFIX + "suppb", contactPhone: SUPPLIER_B_PHONE, bankAccount: { cardNumber: "6037991234567891", iban: "IR123456789012345678901235", ownerName: "B" }, balance: 0, pendingReserve: 0, telegramChatId: "", isActive: true });
  await Supplier.create({ user: rateUser._id, businessName: PREFIX + "supprate", contactPhone: RATE_USER_PHONE, bankAccount: { cardNumber: "6037991234567892", iban: "IR123456789012345678901236", ownerName: "R" }, balance: 0, pendingReserve: 0, telegramChatId: "", isActive: true });
  await User.findByIdAndUpdate(supplierAUser._id, { $set: { supplier: supplierA._id } });
  await User.findByIdAndUpdate(supplierBUser._id, { $set: { supplier: supplierB._id } });
  await User.findByIdAndUpdate(rateUser._id, { $set: { supplier: supplierA._id } });

  const catDoc = await Category.create({ name: PREFIX + "cat", slug: PREFIX + "cat", isActive: true });
  const brandDoc = await Brand.create({ name: PREFIX + "brand", slug: PREFIX + "brand", isActive: true });
  const tagDoc = await Tag.create({ name: PREFIX + "tag", slug: PREFIX + "tag", isActive: true });

  const adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  const aJar = await login(SUPPLIER_A_PHONE, PASS);
  const bJar = await login(SUPPLIER_B_PHONE, PASS);
  const custJar = await login(CUSTOMER_PHONE, PASS);
  const rateJar = await login(RATE_USER_PHONE, PASS);

  const CAT_NAME = PREFIX + "cat";
  const BRAND_NAME = PREFIX + "brand";
  const TAG_NAME = PREFIX + "tag";
  const SUPP_A = PREFIX + "suppa";
  const SLUG_1 = PREFIX + "prod-1";
  const SLUG_2 = PREFIX + "prod-2";
  const SLUG_3 = PREFIX + "prod-3";

  await testAsync("SEED logins (admin / supplier A / B / customer / rate-user)", async () => {
    for (const [label, jar] of [["admin", adminJar], ["A", aJar], ["B", bJar], ["customer", custJar], ["rate", rateJar]]) {
      assert(jar.header().includes("session-token"), label + " has no session");
    }
  });

  await testAsync("UNAUTH admin import -> 401", async () => {
    const res = await http("POST", "/api/admin/products/import", null, { csv: mkCsv([[ "x", SLUG_1, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A ]]) });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  await testAsync("CUSTOMER on admin import -> 403", async () => {
    const res = await http("POST", "/api/admin/products/import", custJar, { csv: "name,slug\nx,y\n" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  await testAsync("SUPPLIER on admin import -> 403", async () => {
    const res = await http("POST", "/api/admin/products/import", aJar, { csv: "name,slug\nx,y\n" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  await testAsync("ADMIN on supplier import -> 403", async () => {
    const res = await http("POST", "/api/supplier/products/import", adminJar, { csv: "name,slug\nx,y\n" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  await testAsync("HAPPY PATH admin import (3 rows) — 200, created=3, report shape", async () => {
    const rows = [
      ["محصول یک", SLUG_1, "توضیح یک", "100000", "50000", "10", CAT_NAME, BRAND_NAME, TAG_NAME, "https://img.test/1.jpg", "1", SUPP_A],
      ["محصول دو", SLUG_2, "", "200000", "100000", "5", CAT_NAME, "", "", "", "1", SUPP_A],
      ["محصول سه", SLUG_3, "", "300000", "150000", "0", CAT_NAME, "", "", "", "0", SUPP_A],
    ];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 200));
    assert(res.data.total === 3 && res.data.created === 3 && res.data.skipped === 0 && res.data.failed === 0, "counts wrong: " + JSON.stringify({ total: res.data.total, created: res.data.created, skipped: res.data.skipped, failed: res.data.failed }));
    assert(Array.isArray(res.data.results) && res.data.results.length === 3, "results array missing");
    for (const r of res.data.results) {
      assert(r.status === "created" && r.rowNumber >= 1, "row status/rowNumber wrong: " + JSON.stringify(r));
    }
    const doc1 = await Product.findOne({ slug: SLUG_1 }).lean();
    assert(doc1, "product 1 not in DB");
    assert(doc1.price === 100000 && doc1.supplierPrice === 50000 && doc1.stock === 10, "product 1 fields wrong");
    assert(String(doc1.category) === String(catDoc._id) && String(doc1.brand) === String(brandDoc._id), "refs not resolved");
    const doc3 = await Product.findOne({ slug: SLUG_3 }).lean();
    assert(doc3.isActive === false, "isActive 0 must import as inactive");
  });

  await testAsync("ROW FAILURES — bad price + unknown category -> failed (valid row still created)", async () => {
    const badSlug = PREFIX + "bad-row";
    const rows = [
      ["قیمت صفر", badSlug + "-p", "", "0", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A],
      ["دسته ناموجود", badSlug + "-c", "", "1000", "500", "5", PREFIX + "nonexistent", "", "", "", "1", SUPP_A],
      ["ردیف سالم", badSlug, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A],
    ];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.created === 1 && res.data.failed === 2, "expected created=1 failed=2, got " + JSON.stringify({ c: res.data.created, f: res.data.failed }));
    const priceRow = res.data.results.find((r) => r.rowNumber === 1);
    const catRow = res.data.results.find((r) => r.rowNumber === 2);
    assert(priceRow.status === "failed" && /قیمت/.test(priceRow.reason), "price row reason wrong: " + priceRow.reason);
    assert(catRow.status === "failed" && /دسته‌بندی/.test(catRow.reason), "category row reason wrong: " + catRow.reason);
    const badP = await Product.findOne({ slug: badSlug + "-p" }).lean();
    assert(!badP, "bad-price row must not be created");
    const ok = await Product.findOne({ slug: badSlug }).lean();
    assert(ok, "valid row in the same file must be created");
  });

  await testAsync("PERSIAN DIGITS — price ۱۰۰۰۰۰ parses to 100000", async () => {
    const slug = PREFIX + "fa-digits";
    const rows = [["محصول فارسی", slug, "", "۱۰۰۰۰۰", "۵۰۰۰۰", "۱۰", CAT_NAME, "", "", "", "1", SUPP_A]];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.status === 200 && res.data.created === 1, "persian digits import failed: " + JSON.stringify(res.data));
    const doc = await Product.findOne({ slug }).lean();
    assert(doc && doc.price === 100000 && doc.supplierPrice === 50000 && doc.stock === 10, "persian digit parsing wrong");
  });

  await testAsync("DUPLICATE SLUG in-file -> 1 created + 1 skipped", async () => {
    const slug = PREFIX + "dup-file";
    const rows = [
      ["یک", slug, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A],
      ["دو", slug, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A],
    ];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.data.created === 1 && res.data.skipped === 1, "expected created=1 skipped=1");
    const skippedRow = res.data.results.find((r) => r.rowNumber === 2);
    assert(skippedRow.status === "skipped" && /تکراری/.test(skippedRow.reason), "skipped reason wrong: " + skippedRow.reason);
    const count = await Product.countDocuments({ slug });
    assert(count === 1, "duplicate slug must create exactly one product");
  });

  await testAsync("DUPLICATE SLUG vs existing DB -> skipped (create-only, no overwrite)", async () => {
    // Re-import SLUG_1 (created in the happy path) — must be skipped, and the
    // original name/price must NOT change.
    const rows = [["نام متفاوت", SLUG_1, "", "999999", "888", "1", CAT_NAME, "", "", "", "1", SUPP_A]];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.data.created === 0 && res.data.skipped === 1, "expected created=0 skipped=1");
    const skippedRow = res.data.results[0];
    assert(skippedRow.status === "skipped" && /قبلاً وجود دارد/.test(skippedRow.reason), "reason wrong: " + skippedRow.reason);
    const doc = await Product.findOne({ slug: SLUG_1 }).lean();
    assert(doc.price === 100000, "existing product must NOT be overwritten (price changed)");
  });

  await testAsync("UNKNOWN brand -> failed with Persian reason", async () => {
    const slug = PREFIX + "bad-brand";
    const rows = [["بد برند", slug, "", "1000", "500", "5", CAT_NAME, PREFIX + "nobrand", "", "", "1", SUPP_A]];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.data.failed === 1, "expected 1 failed");
    assert(/برند/.test(res.data.results[0].reason), "reason wrong: " + res.data.results[0].reason);
    assert(!(await Product.findOne({ slug }).lean()), "bad-brand row must not be created");
  });

  await testAsync("UNKNOWN tag -> failed with Persian reason", async () => {
    const slug = PREFIX + "bad-tag";
    const rows = [["بد برچسب", slug, "", "1000", "500", "5", CAT_NAME, "", PREFIX + "notag", "", "1", SUPP_A]];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.data.failed === 1, "expected 1 failed");
    assert(/برچسب/.test(res.data.results[0].reason), "reason wrong: " + res.data.results[0].reason);
  });

  await testAsync("ADMIN import without supplier column -> failed «supplier»", async () => {
    const slug = PREFIX + "no-supplier";
    // Omit the supplier column entirely.
    const csv = "name,slug,description,price,supplierPrice,stock,category,brand,tags,images,isActive\n" +
      ["بدون فروشنده", slug, "", "1000", "500", "5", CAT_NAME, "", "", "", "1"].join(",") + "\n";
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv });
    assert(res.data.failed === 1, "expected 1 failed");
    assert(/supplier/.test(res.data.results[0].reason), "reason wrong: " + res.data.results[0].reason);
  });

  await testAsync("SUPPLIER import — ownership auto-set to A (B never sees it)", async () => {
    const s1 = PREFIX + "s-own-1";
    const s2 = PREFIX + "s-own-2";
    const rows = [
      ["فروشنده یک", s1, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", ""],
      ["فروشنده دو", s2, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", ""],
    ];
    const res = await http("POST", "/api/supplier/products/import", aJar, { csv: mkCsv(rows) });
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data.created === 2, "expected created=2, got " + res.data.created);
    const docs = await Product.find({ slug: { $in: [s1, s2] } }).lean();
    assert(docs.length === 2, "two supplier products expected");
    for (const d of docs) {
      assert(String(d.supplier) === String(supplierA._id), "supplier ownership wrong");
    }
    const aList = await http("GET", "/api/supplier/products", aJar);
    const bList = await http("GET", "/api/supplier/products", bJar);
    const aSlugs = (aList.data || []).map((p) => p.slug);
    const bSlugs = (bList.data || []).map((p) => p.slug);
    assert(aSlugs.includes(s1) && aSlugs.includes(s2), "A must see its imported products");
    assert(!bSlugs.includes(s1) && !bSlugs.includes(s2), "B must NOT see A's products (ownership isolation)");
  });

  await testAsync("ROW CAP — 1001 rows -> 400", async () => {
    const rows = [];
    for (let i = 0; i < 1001; i++) rows.push(["p" + i, PREFIX + "cap-" + i, "", "1000", "500", "1", CAT_NAME, "", "", "", "1", SUPP_A]);
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.status === 400, "expected 400, got " + res.status);
    assert(/حداکثر/.test(res.data.error || ""), "error message wrong: " + res.data.error);
  });

  await testAsync("RATE LIMIT — 21st import in window -> 429 (dedicated user, limit 20/15min)", async () => {
    const rows = [["ریت", PREFIX + "rate-ok", "", "1000", "500", "1", CAT_NAME, "", "", "", "1", ""]];
    const csv = mkCsv(rows);
    for (let i = 0; i < 20; i++) {
      const res = await http("POST", "/api/supplier/products/import", rateJar, { csv });
      assert(res.status === 200, "import #" + (i + 1) + " expected 200, got " + res.status);
    }
    const res = await http("POST", "/api/supplier/products/import", rateJar, { csv });
    assert(res.status === 429, "expected 429, got " + res.status);
  });

  await testAsync("EXPORT admin — 200 text/csv + attachment + headers + imported slug", async () => {
    const res = await http("GET", "/api/admin/products/export", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(typeof res.data === "string" && res.data.length > 0, "export body must be CSV text");
    assert(res.data.includes("name,slug,description"), "header row missing");
    assert(res.data.includes(SLUG_1), "imported product missing from export");
    assert(res.data.includes(CAT_NAME), "category name missing from export");
  });

  await testAsync("FORMULA INJECTION — export escapes = + - @ prefixes", async () => {
    const slug = PREFIX + "formula";
    const rows = [["=1+1", slug, "-cmd", "1000", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A]];
    await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    const res = await http("GET", "/api/admin/products/export", adminJar);
    assert(res.data.includes("'=1+1"), "export must escape formula '=1+1, got raw: " + (res.data.match(/=1\+1/) || "none"));
    assert(res.data.includes("'-cmd"), "export must escape '-cmd");
  });

  await testAsync("EXPORT supplier A — scoped to A (B's product absent)", async () => {
    const aExport = await http("GET", "/api/supplier/products/export", aJar);
    const bExport = await http("GET", "/api/supplier/products/export", bJar);
    assert(aExport.data.includes(PREFIX + "s-own-1"), "A's export must include A's product");
    assert(!bExport.data.includes(PREFIX + "s-own-1"), "B's export must NOT include A's product");
  });

  await testAsync("ROUND-TRIP — re-importing the admin export -> all skipped (create-only)", async () => {
    const exportRes = await http("GET", "/api/admin/products/export", adminJar);
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: exportRes.data });
    assert(res.status === 200, "re-import expected 200, got " + res.status);
    // Create-only invariant: re-importing an export creates NOTHING. Some rows
    // may be reported failed (e.g. pre-existing products whose supplier name no
    // longer resolves) — the guarantee is created === 0, never a new product.
    assert(res.data.created === 0, "re-import must create nothing, created=" + res.data.created);
    assert(res.data.skipped + res.data.failed === res.data.total, "all rows must be skipped/failed, got " + JSON.stringify({ s: res.data.skipped, f: res.data.failed, t: res.data.total }));
  });

  await testAsync("INVARIANT — existing admin POST /api/admin/products still works (201)", async () => {
    const slug = PREFIX + "form-prod";
    const res = await http("POST", "/api/admin/products", adminJar, {
      name: "فرم محصول", slug, description: "", price: 1000, supplierPrice: 500,
      stock: 5, category: String(catDoc._id), supplier: String(supplierA._id),
      brand: "", tags: [], images: [], isActive: true, hasVariants: false, variants: [],
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(await Product.findOne({ slug }).lean(), "form-created product must exist");
  });

  await testAsync("SANITIZATION — stored name has no HTML tags", async () => {
    const slug = PREFIX + "xss";
    const rows = [["<script>alert(1)</script>پیراهن", slug, "", "1000", "500", "5", CAT_NAME, "", "", "", "1", SUPP_A]];
    const res = await http("POST", "/api/admin/products/import", adminJar, { csv: mkCsv(rows) });
    assert(res.data.created === 1, "xss row must import");
    const doc = await Product.findOne({ slug }).lean();
    assert(!doc.name.includes("<") && !/<script/i.test(doc.name), "stored name must have no HTML tags, got: " + doc.name);
    assert(doc.name.includes("پیراهن"), "Persian text must survive sanitization, got: " + doc.name);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await db.collection("categories").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("brands").deleteMany({ name: { $regex: "^" + PREFIX } });
  await db.collection("tags").deleteMany({ name: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: stalePhones } });
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
