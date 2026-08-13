/**
 * Session 82 Phase A — Accounting cutover + opening-balance initialization
 * verification (real HTTP API + real DB).
 *
 * Seeds deterministic PREFIX'd users/products (simple, variant, zero-stock)
 * and verifies:
 *   1. 401/403 auth matrix on /api/admin/accounting/config + initialize
 *   2. Config GET default shape + PATCH cutover date (invalid date → 400)
 *   3. Config PATCH after initialization → 400 (cutover frozen)
 *   4. Initialize guards: no confirmValuation → 400, empty items → 400,
 *      stock>0 without openingCost → 400, malformed productId → 400
 *   5. Valid init: sourcing consignment→purchased, opening layer created with
 *      the CONFIRMED cost (never silently supplierPrice), opening_balance
 *      movement written, config.inventoryInitialized=true
 *   6. Idempotency: re-init skips already-purchased products, no double layer
 *   7. Variant product: per-variant layers + per-variant movement rows
 *   8. Zero-stock product: converts with NO layer
 *   9. Candidates GET lists only consignment products with suggestedCost
 *
 * Usage: node scripts/verify-accounting.js  (dev server on :3000, real DB)
 * Self-cleaning: removes every PREFIX'd row + its own rate-limit keys.
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
const PREFIX = "acct82_" + Date.now() + "_";
const PASS = "acct82-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_PHONE = "09157773023";
const CUSTOMER_PHONE = "09157773021";

const CUTOVER = new Date(Date.UTC(2026, 7, 1, 0, 0, 0)); // 2026-08-01T00:00Z
const CUTOVER_ISO = CUTOVER.toISOString();

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// ---- tiny cookie jar (matches verify-reports' working NextAuth pattern) ----
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
        cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
      }
    },
    header() { return Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); },
  };
}

async function login(phone, password) {
  const jar = makeJar();
  let res = await fetch(`${BASE}/api/auth/csrf`);
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  const form = new URLSearchParams({ csrfToken, phone, password, json: "true" });
  res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
    body: form.toString(),
    redirect: "manual",
  });
  // Capture the session cookie from the callback response into the jar.
  jar.get(res.headers);
  // Success → 200 (json:true) or 302.
  const ok = res.status === 302 || res.status === 200;
  if (!ok) throw new Error(`login ${phone} → ${res.status}`);
  return jar;
}

async function http(jar, method, url, body) {
  const headers = { "Content-Type": "application/json" };
  if (jar) headers.Cookie = jar.header();
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  const d = mongoose.connection.db;

  // --- Inline schemas bound to the real collections (verify-suite convention) ---
  const UserSchema = new mongoose.Schema(
    { name: String, phone: String, passwordHash: String, role: String, isActive: Boolean },
    { timestamps: true, collection: "users" }
  );
  const SupplierSchema = new mongoose.Schema(
    { user: { type: mongoose.Schema.Types.ObjectId }, businessName: String, isActive: Boolean, balance: Number, pendingReserve: Number },
    { timestamps: true, collection: "suppliers" }
  );
  const User = mongoose.models.User_ACCT || mongoose.model("User_ACCT", UserSchema);
  const Supplier = mongoose.models.Supplier_ACCT || mongoose.model("Supplier_ACCT", SupplierSchema);

  // --- Idempotency sweep: this suite's whole namespace (own fixtures only) ---
  await d.collection("products").deleteMany({
    $or: [{ slug: { $regex: "^acct82_" } }, { "variants.sku": { $regex: "^ACCT82-" } }],
  });
  await d.collection("categories").deleteMany({ slug: { $regex: "^acct82_" } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^acct82_" } });
  await User.deleteMany({
    phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] },
  });
  await d.collection("ratelimits").deleteMany({
    _id: { $regex: "^rl:(accounting-init|accounting-config):" },
  });
  await d.collection("accountingconfigs").deleteMany({ _id: "accounting" });

  const admin = await User.findOne({ phone: ADMIN_PHONE }).lean();
  assert(admin, "seeded admin not found");

  // --- Fixtures ---
  await User.create({ name: PREFIX + "Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: PREFIX + "Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({
    user: suppUser._id, businessName: PREFIX + "SupplierCo", isActive: true, balance: 0, pendingReserve: 0,
  });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await d.collection("categories").insertOne({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true, createdAt: new Date(), updatedAt: new Date() });

  const now = new Date();
  const seedProduct = (fields) =>
    d.collection("products").insertOne({
      name: fields.name, slug: fields.slug, description: "", images: [], brand: null, tags: [],
      category: catDoc.insertedId, supplier: suppDoc._id, supplierPrice: fields.supplierPrice,
      price: fields.price, stock: fields.stock, stockVersion: 0, hasVariants: !!fields.variants?.length,
      variants: fields.variants || [], isActive: true, sourcing: "consignment", costLayers: [],
      createdAt: now, updatedAt: now,
    });

  const skuSuffix = String(Date.now()).slice(-8);
  const v1Id = new mongoose.Types.ObjectId();
  const v2Id = new mongoose.Types.ObjectId();
  const v1 = { _id: v1Id, sku: `ACCT82-${skuSuffix}-V1`, attributes: [], price: 300000, supplierPrice: 140000, stock: 10, stockVersion: 0, images: [], isActive: true, costLayers: [] };
  const v2 = { _id: v2Id, sku: `ACCT82-${skuSuffix}-V2`, attributes: [], price: 320000, supplierPrice: 160000, stock: 5, stockVersion: 0, images: [], isActive: true, costLayers: [] };

  const simpleId = (await seedProduct({ name: PREFIX + "Simple", slug: PREFIX + "simple", supplierPrice: 120000, price: 200000, stock: 100 })).insertedId.toString();
  const zeroId = (await seedProduct({ name: PREFIX + "Zero", slug: PREFIX + "zero", supplierPrice: 50000, price: 90000, stock: 0 })).insertedId.toString();
  const variantId = (await seedProduct({ name: PREFIX + "Variant", slug: PREFIX + "variant", supplierPrice: 0, price: 300000, stock: 15, variants: [v1, v2] })).insertedId.toString();

  const getProduct = async (id) =>
    d.collection("products").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const countMovements = async (ref) =>
    d.collection("inventorymovements").countDocuments({ sourceRef: ref });
  // The init endpoint is rate-limited 3/actor/15min (production budget). The
  // suite needs several SUCCESSFUL init calls, so it clears its own key before
  // each one — same hermetic convention as the other verify suites.
  const clearInitKeys = () =>
    d.collection("ratelimits").deleteMany({
      _id: { $regex: "^rl:accounting-init:" },
    });

  let adminJar, supplierJar, customerJar;

  // ---- TEST 1: auth matrix ----
  await testAsync("auth matrix: 401 unauth, 403 customer, 403 supplier on config+initialize", async () => {
    for (const url of ["/api/admin/accounting/config", "/api/admin/accounting/initialize"]) {
      const unauth = await http(makeJar(), "GET", url);
      assert(unauth.status === 401, `unauth GET ${url} → ${unauth.status}`);
    }
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    const supConfig = await http(supplierJar, "GET", "/api/admin/accounting/config");
    assert(supConfig.status === 403, `supplier config → ${supConfig.status}`);
    const custInit = await http(customerJar, "POST", "/api/admin/accounting/initialize", {});
    assert(custInit.status === 403, `customer initialize → ${custInit.status}`);
    const supPatch = await http(supplierJar, "PATCH", "/api/admin/accounting/config", { cutoverDate: CUTOVER_ISO });
    assert(supPatch.status === 403, `supplier config PATCH → ${supPatch.status}`);
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  });

  // ---- TEST 2: config GET default shape ----
  await testAsync("config GET default shape", async () => {
    const r = await http(adminJar, "GET", "/api/admin/accounting/config");
    assert(r.status === 200, `GET config → ${r.status}`);
    assert(r.json.cutoverDate === null, "cutoverDate defaults to null");
    assert(r.json.valuationMethod === "fifo", "valuationMethod fifo");
    assert(r.json.inventoryInitialized === false, "inventoryInitialized false");
  });

  // ---- TEST 3: config PATCH invalid date → 400 ----
  await testAsync("config PATCH invalid date → 400", async () => {
    const r = await http(adminJar, "PATCH", "/api/admin/accounting/config", { cutoverDate: "not-a-date" });
    assert(r.status === 400, `PATCH invalid → ${r.status}`);
  });

  // ---- TEST 4: config PATCH valid → sets cutover ----
  await testAsync("config PATCH valid cutover date", async () => {
    const r = await http(adminJar, "PATCH", "/api/admin/accounting/config", { cutoverDate: CUTOVER_ISO });
    assert(r.status === 200, `PATCH valid → ${r.status}`);
    assert(r.json.cutoverDate === CUTOVER_ISO, "cutoverDate persisted");
    const g = await http(adminJar, "GET", "/api/admin/accounting/config");
    assert(g.json.cutoverDate === CUTOVER_ISO, "cutoverDate readable after PATCH");
  });

  // ---- TEST 5: initialize guards ----
  await testAsync("initialize without confirmValuation → 400", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      items: [{ productId: simpleId, openingCost: 100000 }],
    });
    assert(r.status === 400, `no confirm → ${r.status}`);
  });

  await testAsync("initialize with empty items → 400", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [],
    });
    assert(r.status === 400, `empty items → ${r.status}`);
  });

  await testAsync("initialize stock>0 without openingCost → 400", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [{ productId: simpleId }],
    });
    assert(r.status === 400, `no cost → ${r.status}`);
  });

  await testAsync("initialize malformed productId → 400", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [{ productId: "not-an-id", openingCost: 1000 }],
    });
    assert(r.status === 400, `malformed → ${r.status}`);
  });

  // ---- TEST 6: valid init (simple product, CONFIRMED cost) ----
  await clearInitKeys();
  await testAsync("valid init: confirmed cost layer + movement + config stamp", async () => {
    // Confirmed cost deliberately DIFFERENT from supplierPrice (120,000) →
    // proves the wizard uses the confirmed value, never silently supplierPrice.
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [{ productId: simpleId, openingCost: 99999, openingDate: CUTOVER_ISO }],
    });
    assert(r.status === 200, `init → ${r.status}`);
    assert(r.json.initialized === true, "initialized true");
    assert(r.json.productsInitialized === 1, `productsInitialized=${r.json.productsInitialized}`);
    assert(r.json.layersCreated === 1, `layersCreated=${r.json.layersCreated}`);
    assert(r.json.totalValue === 99999 * 100, `totalValue=${r.json.totalValue}`);

    const p = await getProduct(simpleId);
    assert(p.sourcing === "purchased", `sourcing=${p.sourcing}`);
    assert(p.costLayers.length === 1, "one layer");
    assert(p.costLayers[0].remaining === 100, "layer remaining 100");
    assert(p.costLayers[0].unitCost === 99999, `layer cost=${p.costLayers[0].unitCost} (confirmed, not 120000)`);
    assert(p.costLayers[0].source === "opening", "layer source opening");
    assert(p.costLayers[0].ref === `opening-${simpleId}`, "layer ref");

    const mv = await countMovements(`opening-${simpleId}`);
    assert(mv === 1, `movements=${mv}`);

    const g = await http(adminJar, "GET", "/api/admin/accounting/config");
    assert(g.json.inventoryInitialized === true, "inventoryInitialized true");
  });

  // ---- TEST 7: idempotency ----
  await testAsync("re-init: already-purchased skipped, no double layer/movement", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [{ productId: simpleId, openingCost: 1 }],
    });
    assert(r.status === 200, `re-init → ${r.status}`);
    assert(r.json.productsInitialized === 0, "no products re-initialized");
    assert(r.json.layersCreated === 0, "no new layers");
    assert(
      r.json.skipped.some((s) => s.productId === simpleId && s.reason === "already-purchased"),
      "skipped with already-purchased reason"
    );
    const p = await getProduct(simpleId);
    assert(p.costLayers.length === 1, "still one layer");
    assert(p.costLayers[0].unitCost === 99999, "layer cost unchanged");
    const mv = await countMovements(`opening-${simpleId}`);
    assert(mv === 1, "still one movement");
  });

  // ---- TEST 8: variant product per-variant layers ----
  await clearInitKeys();
  await testAsync("variant init: per-variant confirmed layers + movements", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [
        { productId: variantId, variantId: String(v1Id), openingCost: 111111 },
        { productId: variantId, variantId: String(v2Id), openingCost: 222222 },
      ],
    });
    assert(r.status === 200, `variant init → ${r.status}`);
    assert(r.json.productsInitialized === 1, "one product");
    assert(r.json.layersCreated === 2, "two variant layers");
    assert(r.json.totalValue === 111111 * 10 + 222222 * 5, `totalValue variant ${r.json.totalValue}`);

    const p = await getProduct(variantId);
    assert(p.sourcing === "purchased", "variant product purchased");
    const found1 = p.variants.find((v) => String(v._id) === String(v1Id));
    const found2 = p.variants.find((v) => String(v._id) === String(v2Id));
    assert(found1.costLayers[0].unitCost === 111111 && found1.costLayers[0].remaining === 10, "v1 layer");
    assert(found2.costLayers[0].unitCost === 222222 && found2.costLayers[0].remaining === 5, "v2 layer");
    const mv1 = await countMovements(`opening-${variantId}-${String(v1Id)}`);
    const mv2 = await countMovements(`opening-${variantId}-${String(v2Id)}`);
    assert(mv1 === 1 && mv2 === 1, "two movements");
  });

  // ---- TEST 9: zero-stock product converts with no layer ----
  await clearInitKeys();
  await testAsync("zero-stock product: converts, no layer, no movement", async () => {
    const r = await http(adminJar, "POST", "/api/admin/accounting/initialize", {
      confirmValuation: true,
      items: [{ productId: zeroId }],
    });
    assert(r.status === 200, `zero init → ${r.status}`);
    const p = await getProduct(zeroId);
    assert(p.sourcing === "purchased", "converted");
    assert((p.costLayers || []).length === 0, "no layer");
    const mv = await countMovements(`opening-${zeroId}`);
    assert(mv === 0, "no movement");
  });

  // ---- TEST 10: candidates list ----
  await testAsync("candidates GET: only consignment, suggestedCost = supplierPrice", async () => {
    const freshId = (await seedProduct({ name: PREFIX + "Fresh", slug: PREFIX + "fresh", supplierPrice: 77777, price: 150000, stock: 7 })).insertedId.toString();
    const r = await http(adminJar, "GET", "/api/admin/accounting/initialize");
    assert(r.status === 200, `candidates → ${r.status}`);
    const exact = r.json.candidates.find((c) => c.productId === freshId);
    assert(exact, "fresh consignment product listed");
    assert(exact.suggestedCost === 77777, "suggestedCost = supplierPrice");
    assert(exact.stock === 7, "candidate stock");
    const already = r.json.candidates.find((c) => c.productId === simpleId);
    assert(!already, "purchased product NOT listed");
  });

  // ---- TEST 11: config PATCH after init → 400 (frozen) ----
  await testAsync("config PATCH after initialization → 400 (cutover frozen)", async () => {
    const r = await http(adminJar, "PATCH", "/api/admin/accounting/config", { cutoverDate: "2026-09-01T00:00:00.000Z" });
    assert(r.status === 400, `PATCH after init → ${r.status}`);
  });

  // ============================================================
  // CLEANUP (scoped to this suite's own PREFIX)
  // ============================================================
  try {
    const prefixProductIds = (await d
      .collection("products")
      .find({ slug: { $regex: "^" + PREFIX } })
      .project({ _id: 1 })
      .toArray()).map((x) => x._id);
    await d.collection("inventorymovements").deleteMany({ product: { $in: prefixProductIds } });
    await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
    await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
    await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
    await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
    await d.collection("accountingconfigs").deleteMany({ _id: "accounting" });
    await d.collection("ratelimits").deleteMany({
      _id: { $regex: "^rl:(accounting-init|accounting-config):" },
    });
    console.log("\n[cleanup] PREFIX'd fixtures removed");
  } catch (err) {
    console.log("\n[cleanup] WARNING: " + err.message);
  }

  await mongoose.disconnect();

  console.log("\n==================================================================");
  console.log(`  Total:   ${total}`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Status:  ${failed === 0 ? "ALL PASSED" : "FAILED"}`);
  console.log("==================================================================\n");
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
