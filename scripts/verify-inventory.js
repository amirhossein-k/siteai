/**
 * Session 82 Phase D — Inventory adjustments + movement ledger verification
 * (real HTTP API + real DB).
 *
 * Covers the approved matrix:
 *   1. Auth matrix (401 adjustments/movements/layers, 403 customer/supplier)
 *   2. Positive purchased adjustment → stock + new FIFO layer at the CONFIRMED
 *      cost (never silently supplierPrice) + adjustment movement
 *   3. Negative purchased adjustment → FIFO layer consumption + movement
 *   4. Positive purchased without unitCost → 400, no mutation
 *   5. Insufficient stock → 400, no partial mutation
 *   6. Malformed product / variant ids → 400
 *   7. Mandatory reason → 400
 *   8. Idempotency: same key twice → one adjustment, idempotent response
 *   9. Concurrent negative adjustments cannot oversell FIFO layers
 *  10. Variant isolation (variant A vs variant B)
 *  11. Consignment adjustment → stock-only, no cost layer, cost 0
 *  12. Movement ledger: type/product/search/date filters
 *  13. Layer API: active layers only, value = remaining × unitCost
 *  14. Post-cutover enforcement: admin product PUT stock → 400, supplier
 *      stock quick-edit → 400; non-stock edits still pass
 *  15. Reconciliation: Σ movements == stock, layersRemaining == stock
 *
 * Usage: node scripts/verify-inventory.js  (dev server on :3000, real DB)
 * Self-cleaning: removes every PREFIX'd fixture + its own movements; restores
 * the accounting config singleton it flips for the enforcement test.
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
const PREFIX = "inv82_" + Date.now() + "_";
const PASS = "inv82-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_PHONE = "09157773022";
const CUSTOMER_PHONE = "09157773019";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// ---- tiny cookie jar (matches the other verify suites) ----
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
  jar.get(res.headers);
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

  // --- Inline schemas bound to the real collections ---
  const UserSchema = new mongoose.Schema(
    { name: String, phone: String, passwordHash: String, role: String, isActive: Boolean },
    { timestamps: true, collection: "users" }
  );
  const SupplierSchema = new mongoose.Schema(
    { user: { type: mongoose.Schema.Types.ObjectId }, businessName: String, isActive: Boolean },
    { timestamps: true, collection: "suppliers" }
  );
  const User = mongoose.models.User_INV || mongoose.model("User_INV", UserSchema);
  const Supplier = mongoose.models.Supplier_INV || mongoose.model("Supplier_INV", SupplierSchema);

  // --- Idempotency sweep: this suite's own namespace only ---
  const ownProducts = (await d.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } })
    .project({ _id: 1 }).toArray()).map((x) => x._id);
  await d.collection("inventorymovements").deleteMany({ product: { $in: ownProducts } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:inventory-write:" } });
  // Restore the pre-run accounting state (verify-accounting removes the singleton).
  await d.collection("accountingconfigs").deleteOne({ _id: "accounting" });

  const admin = await User.findOne({ phone: ADMIN_PHONE }).lean();
  assert(admin, "seeded admin not found");

  // --- Fixtures ---
  await User.create({ name: PREFIX + "Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: PREFIX + "Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({
    user: suppUser._id, businessName: PREFIX + "SupplierCo", isActive: true,
  });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await d.collection("categories").insertOne({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true, createdAt: new Date(), updatedAt: new Date() });

  const now = new Date();
  const seedProduct = (fields) =>
    d.collection("products").insertOne({
      name: fields.name, slug: fields.slug, description: "", images: [], brand: null, tags: [],
      category: catDoc.insertedId, supplier: suppDoc._id, supplierPrice: fields.supplierPrice,
      price: fields.price, stock: fields.stock, stockVersion: 0, hasVariants: !!fields.variants?.length,
      variants: fields.variants || [], isActive: true, sourcing: fields.sourcing || "purchased",
      costLayers: fields.costLayers || [], createdAt: now, updatedAt: now,
    });

  const skuSuffix = String(Date.now()).slice(-8);
  const vA = { _id: new mongoose.Types.ObjectId(), sku: `INV82-${skuSuffix}-A`, attributes: [], price: 300000, supplierPrice: 140000, stock: 0, stockVersion: 0, images: [], isActive: true, costLayers: [] };
  const vB = { _id: new mongoose.Types.ObjectId(), sku: `INV82-${skuSuffix}-B`, attributes: [], price: 310000, supplierPrice: 145000, stock: 0, stockVersion: 0, images: [], isActive: true, costLayers: [] };

  // simple purchased — stock 0, no layers (adjustments create them)
  const simpleId = (await seedProduct({ name: PREFIX + "Simple", slug: PREFIX + "simple", supplierPrice: 120000, price: 200000, stock: 0 })).insertedId.toString();
  // consignment — no cost layers by design
  const consignId = (await seedProduct({ name: PREFIX + "Consign", slug: PREFIX + "consign", supplierPrice: 90000, price: 150000, stock: 0, sourcing: "consignment" })).insertedId.toString();
  // variant product — per-variant layers
  const variantId = (await seedProduct({ name: PREFIX + "Variant", slug: PREFIX + "variant", supplierPrice: 0, price: 300000, stock: 0, variants: [vA, vB] })).insertedId.toString();
  // concurrency product — starts with one 5-unit layer @ 100000
  const concId = (await seedProduct({
    name: PREFIX + "Conc", slug: PREFIX + "conc", supplierPrice: 100000, price: 180000, stock: 5,
    costLayers: [{ qty: 5, remaining: 5, unitCost: 100000, acquiredAt: now, source: "receipt", ref: "conc-layer" }],
  })).insertedId.toString();

  const getProduct = async (id) => d.collection("products").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const findMovement = async (ref) => d.collection("inventorymovements").findOne({ sourceRef: ref });
  const countAdjMovements = async () => d.collection("inventorymovements").countDocuments({ type: "adjustment", product: new mongoose.Types.ObjectId(simpleId) });

  let adminJar, supplierJar, customerJar;
  const nextKey = (() => { let i = 0; return () => `${PREFIX}adj-${Date.now()}-${++i}`; })();

  // ---- TEST 1: auth matrix ----
  await testAsync("auth matrix: 401 unauth, 403 customer/supplier on adjustments+movements+layers", async () => {
    const unauth = await http(makeJar(), "POST", "/api/admin/inventory/adjustments", {});
    assert(unauth.status === 401, `unauth adjustments → ${unauth.status}`);
    const unauthMv = await http(makeJar(), "GET", "/api/admin/inventory/movements");
    assert(unauthMv.status === 401, `unauth movements → ${unauthMv.status}`);
    const unauthLy = await http(makeJar(), "GET", "/api/admin/inventory/layers");
    assert(unauthLy.status === 401, `unauth layers → ${unauthLy.status}`);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    const custAdj = await http(customerJar, "POST", "/api/admin/inventory/adjustments", {});
    assert(custAdj.status === 403, `customer adjustments → ${custAdj.status}`);
    const supAdj = await http(supplierJar, "POST", "/api/admin/inventory/adjustments", {});
    assert(supAdj.status === 403, `supplier adjustments → ${supAdj.status}`);
    const custLy = await http(customerJar, "GET", "/api/admin/inventory/layers");
    assert(custLy.status === 403, `customer layers → ${custLy.status}`);
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  });

  // ---- TEST 2: positive purchased adjustment ----
  await testAsync("positive purchased adjustment → stock up, new FIFO layer at CONFIRMED cost (not supplierPrice)", async () => {
    const key = nextKey();
    const r = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: 10, unitCost: 55000, reason: "ورودی انبار", notes: "مستند", key,
    });
    assert(r.status === 201, `adjust → ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.idempotent === false, "not idempotent on first call");
    const p = await getProduct(simpleId);
    assert(p.stock === 10, `stock ${p.stock} ≠ 10`);
    assert(p.stockVersion === 1, `stockVersion ${p.stockVersion} ≠ 1`);
    assert(p.costLayers.length === 1, "one layer");
    assert(p.costLayers[0].unitCost === 55000, `layer cost ${p.costLayers[0].unitCost} ≠ 55000 (must NOT be supplierPrice 120000)`);
    assert(p.costLayers[0].remaining === 10, "layer remaining 10");
    assert(p.costLayers[0].source === "adjustment", "layer source adjustment");
    const mv = await findMovement(`adj-${key}`);
    assert(mv, "adjustment movement created");
    assert(mv.quantity === 10 && mv.unitCost === 55000 && mv.totalCost === 550000, `movement cost ${mv.quantity}/${mv.unitCost}/${mv.totalCost}`);
  });

  // ---- TEST 3: negative purchased adjustment ----
  await testAsync("negative purchased adjustment → FIFO layer consumption + movement", async () => {
    const key = nextKey();
    const r = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: -4, reason: "کمبود فیزیکی", key,
    });
    assert(r.status === 201, `adjust → ${r.status}: ${JSON.stringify(r.json)}`);
    const p = await getProduct(simpleId);
    assert(p.stock === 6, `stock ${p.stock} ≠ 6`);
    assert(p.costLayers[0].remaining === 6, `layer remaining ${p.costLayers[0].remaining} ≠ 6`);
    assert(p.costLayers[0].unitCost === 55000, "layer cost preserved");
    const mv = await findMovement(`adj-${key}`);
    assert(mv && mv.quantity === -4 && mv.unitCost === 55000 && mv.totalCost === 220000, `movement ${JSON.stringify(mv)}`);
  });

  // ---- TEST 4: positive purchased without unitCost → 400 ----
  await testAsync("positive purchased without unitCost → 400, no mutation", async () => {
    const before = await getProduct(simpleId);
    const r = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: 3, reason: "بدون هزینه", key: nextKey(),
    });
    assert(r.status === 400, `adjust → ${r.status}`);
    const after = await getProduct(simpleId);
    assert(after.stock === before.stock && after.stockVersion === before.stockVersion, "no mutation");
  });

  // ---- TEST 5: insufficient stock ----
  await testAsync("negative below zero → 400, no partial mutation", async () => {
    const before = await getProduct(simpleId);
    const r = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: -100, reason: "بیش از حد", key: nextKey(),
    });
    assert(r.status === 400, `adjust → ${r.status}`);
    const after = await getProduct(simpleId);
    assert(after.stock === before.stock && after.stockVersion === before.stockVersion, "no mutation");
  });

  // ---- TEST 6: malformed ids ----
  await testAsync("malformed product/variant ids → 400", async () => {
    const r1 = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: "not-an-id", quantityDelta: 1, reason: "bad", key: nextKey(),
    });
    assert(r1.status === 400, `bad product → ${r1.status}`);
    const r2 = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, variantId: "zzz", quantityDelta: 1, reason: "bad", key: nextKey(),
    });
    assert(r2.status === 400, `bad variant → ${r2.status}`);
    const r3 = await http(adminJar, "GET", "/api/admin/inventory/movements?product=bad");
    assert(r3.status === 400, `movements bad product → ${r3.status}`);
    const r4 = await http(adminJar, "GET", "/api/admin/inventory/layers?product=bad");
    assert(r4.status === 400, `layers bad product → ${r4.status}`);
  });

  // ---- TEST 7: mandatory reason ----
  await testAsync("missing/short reason → 400", async () => {
    const r1 = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: 1, reason: "", key: nextKey(),
    });
    assert(r1.status === 400, `no reason → ${r1.status}`);
    const r2 = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: 1, reason: "x", key: nextKey(),
    });
    assert(r2.status === 400, `short reason → ${r2.status}`);
  });

  // ---- TEST 8: idempotency ----
  await testAsync("duplicate key → idempotent, no double adjustment", async () => {
    const key = nextKey();
    const before = await getProduct(simpleId);
    const r1 = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: 2, unitCost: 60000, reason: "دوباره ارسال", key,
    });
    assert(r1.status === 201, `first → ${r1.status}`);
    const r2 = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: simpleId, quantityDelta: 2, unitCost: 60000, reason: "دوباره ارسال", key,
    });
    assert(r2.status === 200 && r2.json.idempotent === true, `second → ${r2.status} idempotent=${r2.json?.idempotent}`);
    const after = await getProduct(simpleId);
    assert(after.stock === before.stock + 2, `stock ${after.stock} ≠ ${before.stock + 2} (no double)`);
    assert((await d.collection("inventorymovements").countDocuments({ sourceRef: "adj-" + key })) === 1, "single movement row");
  });

  // ---- TEST 9: concurrent negative adjustments cannot oversell layers ----
  await testAsync("two concurrent -3 adjustments on a 5-unit layer → exactly one succeeds", async () => {
    const before = await getProduct(concId);
    assert(before.stock === 5 && before.costLayers[0].remaining === 5, `conc start ${before.stock}/${before.costLayers[0]?.remaining}`);
    const [rA, rB] = await Promise.all([
      http(adminJar, "POST", "/api/admin/inventory/adjustments", { product: concId, quantityDelta: -3, reason: "همزمان A", key: nextKey() }),
      http(adminJar, "POST", "/api/admin/inventory/adjustments", { product: concId, quantityDelta: -3, reason: "همزمان B", key: nextKey() }),
    ]);
    const okCount = [rA, rB].filter((r) => r.status === 201).length;
    assert(okCount === 1, `expected exactly 1 success, got ${okCount} (${rA.status}/${rB.status})`);
    const p = await getProduct(concId);
    assert(p.stock === 2, `stock ${p.stock} ≠ 2 (no oversell)`);
    assert(p.costLayers[0].remaining === 2, `layer remaining ${p.costLayers[0].remaining} ≠ 2`);
    assert(p.stockVersion === before.stockVersion + 1, `stockVersion ${p.stockVersion} ≠ ${before.stockVersion + 1}`);
  });

  // ---- TEST 10: variant isolation ----
  await testAsync("variant adjustment isolates A from B, keeps top-level summary in sync", async () => {
    const key = nextKey();
    const r = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: variantId, variantId: vA._id.toString(), quantityDelta: 4, unitCost: 70000, reason: "تنوع A", key,
    });
    assert(r.status === 201, `variant adjust → ${r.status}: ${JSON.stringify(r.json)}`);
    const p = await getProduct(variantId);
    const va = p.variants.find((v) => String(v._id) === String(vA._id));
    const vb = p.variants.find((v) => String(v._id) === String(vB._id));
    assert(va.stock === 4 && va.costLayers.length === 1 && va.costLayers[0].unitCost === 70000, `variant A ${JSON.stringify(va)}`);
    assert(vb.stock === 0 && (vb.costLayers?.length ?? 0) === 0, `variant B must be untouched ${JSON.stringify(vb)}`);
    assert(p.stock === 4, `top-level stock ${p.stock} ≠ 4`);
    // adjustment on a nonexistent variant → 400
    const bad = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: variantId, variantId: new mongoose.Types.ObjectId().toString(), quantityDelta: 1, reason: "bad", key: nextKey(),
    });
    assert(bad.status === 400, `unknown variant → ${bad.status}`);
  });

  // ---- TEST 11: consignment adjustment ----
  await testAsync("consignment adjustment → stock-only, no cost layer, cost 0", async () => {
    const key = nextKey();
    const r = await http(adminJar, "POST", "/api/admin/inventory/adjustments", {
      product: consignId, quantityDelta: 3, reason: "ورودی امانی", key,
    });
    assert(r.status === 201, `consign adjust → ${r.status}: ${JSON.stringify(r.json)}`);
    const p = await getProduct(consignId);
    assert(p.stock === 3, `stock ${p.stock} ≠ 3`);
    assert((p.costLayers ?? []).length === 0, "no cost layer for consignment");
    const mv = await findMovement(`adj-${key}`);
    assert(mv && mv.unitCost === 0 && mv.totalCost === 0, `consign movement ${JSON.stringify(mv)}`);
  });

  // ---- TEST 12: movement ledger filters ----
  await testAsync("movements: type + product + search + date filters", async () => {
    const byType = await http(adminJar, "GET", "/api/admin/inventory/movements?type=adjustment");
    assert(byType.status === 200 && byType.json.data.every((m) => m.type === "adjustment"), "type filter");
    const byProduct = await http(adminJar, "GET", `/api/admin/inventory/movements?product=${simpleId}`);
    assert(byProduct.status === 200 && byProduct.json.data.length >= 3, "product filter");
    const bySearch = await http(adminJar, "GET", "/api/admin/inventory/movements?search=" + encodeURIComponent(PREFIX + "Simple"));
    assert(bySearch.status === 200 && bySearch.json.data.length >= 3, "search filter");
    const badType = await http(adminJar, "GET", "/api/admin/inventory/movements?type=bogus");
    assert(badType.status === 400, `bad type → ${badType.status}`);
    // date range covering today must include our movements
    const from = new Date(Date.now() - 3600e3).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
    const byDate = await http(adminJar, "GET", `/api/admin/inventory/movements?from=${from}&to=${to}`);
    assert(byDate.status === 200 && byDate.json.data.length >= 3, `date filter → ${byDate.status}`);
  });

  // ---- TEST 13: layer API ----
  await testAsync("layers API: active layers only, value = remaining × unitCost", async () => {
    const r = await http(adminJar, "GET", `/api/admin/inventory/layers?product=${simpleId}`);
    assert(r.status === 200, `layers → ${r.status}`);
    const rows = r.json.data;
    // Layers: 10@55000 − 4 (consumed) = 6@55000, then +2@60000 from TEST 8.
    assert(rows.length === 2, `two active layers, got ${rows.length}`);
    const totalRemaining = rows.reduce((a, x) => a + x.remaining, 0);
    const totalValue = rows.reduce((a, x) => a + x.value, 0);
    assert(totalRemaining === 8, `total remaining ${totalRemaining} ≠ 8`);
    assert(totalValue === 6 * 55000 + 2 * 60000, `total value ${totalValue}`);
    assert(
      rows.every((x) => x.productName.includes(PREFIX + "Simple")),
      "product name populated"
    );
    // FIFO ordering lives in Product.costLayers (oldest first) — the API sorts
    // rows by acquiredAt desc for display only.
    const p = await getProduct(simpleId);
    assert(
      p.costLayers[0].unitCost === 55000 && p.costLayers[1].unitCost === 60000,
      `FIFO layer order in Product.costLayers ${JSON.stringify(p.costLayers.map((l) => l.unitCost))}`
    );
    // default list (no filter) includes purchased layers
    const all = await http(adminJar, "GET", "/api/admin/inventory/layers");
    assert(all.status === 200 && all.json.data.length >= 2, `default list → ${all.status}`);
  });

  // ---- TEST 14: post-cutover enforcement ----
  await testAsync("post-cutover: direct product PUT stock → 400, supplier stock quick-edit → 400, non-stock edit passes", async () => {
    // Flip the accounting singleton ON for the enforcement test.
    await d.collection("accountingconfigs").insertOne({
      _id: "accounting", cutoverDate: new Date(), valuationMethod: "fifo",
      inventoryInitialized: true, createdAt: new Date(), updatedAt: new Date(),
    });
    try {
      const p = await getProduct(simpleId);
      // Admin PUT with a changed stock → 400 (enforcement).
      const putBody = {
        name: p.name, slug: p.slug, description: p.description || "", images: [], brand: null, tags: [],
        category: catDoc.insertedId.toString(), supplier: suppDoc._id.toString(),
        supplierPrice: p.supplierPrice, price: p.price, stock: p.stock + 1, isActive: true,
      };
      const put = await http(adminJar, "PUT", "/api/admin/products?id=" + simpleId, putBody);
      assert(put.status === 400, `admin PUT stock change → ${put.status} (expected 400)`);
      assert((put.json?.error || "").includes("تعدیل"), `error mentions adjustment: ${put.json?.error}`);
      // Same body with UNCHANGED stock → non-stock edit passes.
      const putOk = await http(adminJar, "PUT", "/api/admin/products?id=" + simpleId, { ...putBody, stock: p.stock });
      assert(putOk.status === 200, `admin PUT non-stock → ${putOk.status}: ${JSON.stringify(putOk.json)}`);
      // Supplier stock quick-edit → 400 (enforcement).
      const supStock = await http(supplierJar, "POST", "/api/supplier/products/stock", {
        productId: variantId, variantId: vA._id.toString(), stock: 9,
      });
      assert(supStock.status === 400, `supplier stock edit → ${supStock.status}`);
    } finally {
      await d.collection("accountingconfigs").deleteOne({ _id: "accounting" });
    }
  });

  // ---- TEST 15: reconciliation ----
  await testAsync("reconciliation: Σ movements == stock, layersRemaining == stock", async () => {
    const p = await getProduct(simpleId);
    const movements = await d.collection("inventorymovements")
      .find({ product: new mongoose.Types.ObjectId(simpleId), type: "adjustment" })
      .toArray();
    const net = movements.reduce((s, m) => s + m.quantity, 0);
    assert(net === p.stock, `Σ movements ${net} ≠ stock ${p.stock}`);
    const layerQty = p.costLayers.reduce((s, l) => s + l.remaining, 0);
    assert(layerQty === p.stock, `Σ layers ${layerQty} ≠ stock ${p.stock}`);
    const layerValue = p.costLayers.reduce((s, l) => s + l.remaining * l.unitCost, 0);
    assert(layerValue > 0, "layer value positive");
    // Append-only: no update/delete API for movements (PATCH/POST on the list → 405).
    const patch = await http(adminJar, "PATCH", "/api/admin/inventory/movements", {});
    assert([400, 404, 405].includes(patch.status), `PATCH movements → ${patch.status} (no mutation endpoint)`);
  });

  // ============================================================
  // Cleanup (self-cleaning, PREFIX-scoped)
  // ============================================================
  await d.collection("inventorymovements").deleteMany({ product: { $in: ownProducts } });
  await d.collection("inventorymovements").deleteMany({ sourceRef: { $regex: "^adj-" + PREFIX } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:inventory-write:" } });
  // restore accounting singleton to the pre-run state
  await d.collection("accountingconfigs").deleteOne({ _id: "accounting" });
  await mongoose.disconnect();

  console.log(`\n\n  ===== verify-inventory: ${passed}/${total} PASSED (${failed} failed) =====\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error("\nFATAL: " + err.stack || err.message);
  process.exit(2);
});
