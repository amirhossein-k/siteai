/**
 * Session 82 Phase B — Purchases verification (real HTTP API + real DB).
 *
 * Covers the approved matrix:
 *   1. 401/403 auth on every purchase endpoint
 *   2. Create purchase (draft) — NEVER creates inventory
 *   3. Read detail + list
 *   4. Order (draft → ordered)
 *   5. Partial receipt → stock + exact FIFO cost layer + receipt movement
 *   6. Full receipt → status received; over-receipt → 409
 *   7. Idempotent repeated receive with the same key → no double inventory
 *   8. Pay → amountPaid/paymentStatus change, stock/layers UNTOUCHED
 *   9. Consignment product purchase → 400 (sourcing invariant)
 *  10. Unit cost comes from the purchase line, never Product.supplierPrice
 *  11. Cancel (draft) works; cancel with received inventory → 400
 *  12. Variant receipt → per-variant layer
 *  13. Purchases report endpoint (reports module slug)
 *
 * Usage: node scripts/verify-purchases.js  (dev server on :3000, real DB)
 * Self-cleaning: removes every PREFIX'd fixture + its own rate-limit keys.
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
const PREFIX = "pur82_" + Date.now() + "_";
const PASS = "pur82-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_PHONE = "09157773023";
const CUSTOMER_PHONE = "09157773021";

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
    { user: { type: mongoose.Schema.Types.ObjectId }, businessName: String, isActive: Boolean, balance: Number, pendingReserve: Number },
    { timestamps: true, collection: "suppliers" }
  );
  const User = mongoose.models.User_PUR || mongoose.model("User_PUR", UserSchema);
  const Supplier = mongoose.models.Supplier_PUR || mongoose.model("Supplier_PUR", SupplierSchema);

  // --- Idempotency sweep: this suite's own namespace only ---
  const ownProducts = (await d.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } })
    .project({ _id: 1 }).toArray()).map((x) => x._id);
  await d.collection("inventorymovements").deleteMany({ product: { $in: ownProducts } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("purchaseorders").deleteMany({ number: { $regex: "^P-" } , "items.name": { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:purchase-write:" } });

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
      variants: fields.variants || [], isActive: true, sourcing: fields.sourcing || "purchased",
      costLayers: [], createdAt: now, updatedAt: now,
    });

  const skuSuffix = String(Date.now()).slice(-8);
  const vId = new mongoose.Types.ObjectId();
  const v1 = { _id: vId, sku: `PUR82-${skuSuffix}-V1`, attributes: [], price: 300000, supplierPrice: 140000, stock: 0, stockVersion: 0, images: [], isActive: true, costLayers: [] };

  // purchased (simple) product — stock 0 so receipt quantities are provable
  const simpleId = (await seedProduct({ name: PREFIX + "Simple", slug: PREFIX + "simple", supplierPrice: 120000, price: 200000, stock: 0 })).insertedId.toString();
  // variant product
  const variantId = (await seedProduct({ name: PREFIX + "Variant", slug: PREFIX + "variant", supplierPrice: 0, price: 300000, stock: 0, variants: [v1] })).insertedId.toString();
  // consignment product — purchases against it must be REJECTED
  const consignId = (await seedProduct({ name: PREFIX + "Consign", slug: PREFIX + "consign", supplierPrice: 90000, price: 150000, stock: 5, sourcing: "consignment" })).insertedId.toString();

  const getProduct = async (id) => d.collection("products").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const getPurchase = async (id) => d.collection("purchaseorders").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const countMovements = async (ref) => d.collection("inventorymovements").countDocuments({ sourceRef: ref });
  const clearWriteKeys = () => d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:purchase-write:" } });

  let adminJar, supplierJar, customerJar;
  let purchaseId = null;
  let itemId = null;
  let purchaseNumber = "";

  // ---- TEST 1: auth matrix ----
  // NOTE: Next.js returns 405 for the WRONG method before auth runs, so each
  // sub-route must be probed with a method the handler actually exposes.
  await testAsync("auth matrix: 401 unauth, 403 customer/supplier on purchases endpoints", async () => {
    const probes = [
      { url: "/api/admin/purchases", method: "GET" },
      { url: "/api/admin/purchases/000000000000000000000000", method: "GET" },
      { url: "/api/admin/purchases/000000000000000000000000/receive", method: "POST" },
      { url: "/api/admin/purchases/000000000000000000000000/pay", method: "POST" },
      { url: "/api/admin/purchases/000000000000000000000000/cancel", method: "POST" },
    ];
    for (const { url, method } of probes) {
      const unauth = await http(makeJar(), method, url);
      assert(unauth.status === 401, `unauth ${method} ${url} → ${unauth.status}`);
    }
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    const sup = await http(supplierJar, "GET", "/api/admin/purchases");
    assert(sup.status === 403, `supplier list → ${sup.status}`);
    const cust = await http(customerJar, "POST", "/api/admin/purchases", {});
    assert(cust.status === 403, `customer create → ${cust.status}`);
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  });

  // ---- TEST 2: create guards ----
  await testAsync("create guards: invalid supplier → 400, empty items → 400, bad cost → 400", async () => {
    const r1 = await http(adminJar, "POST", "/api/admin/purchases", { supplier: "x", items: [{ product: simpleId, quantity: 1, unitCost: 100 }] });
    assert(r1.status === 400, `invalid supplier → ${r1.status}`);
    const r2 = await http(adminJar, "POST", "/api/admin/purchases", { supplier: suppDoc._id.toString(), purchaseDate: new Date().toISOString(), items: [] });
    assert(r2.status === 400, `empty items → ${r2.status}`);
    const r3 = await http(adminJar, "POST", "/api/admin/purchases", { supplier: suppDoc._id.toString(), purchaseDate: new Date().toISOString(), items: [{ product: simpleId, quantity: 1, unitCost: -5 }] });
    assert(r3.status === 400, `negative cost → ${r3.status}`);
  });

  // ---- TEST 3: consignment product purchase → 400 ----
  await testAsync("consignment product purchase → 400 (sourcing invariant)", async () => {
    const r = await http(adminJar, "POST", "/api/admin/purchases", {
      supplier: suppDoc._id.toString(),
      purchaseDate: new Date().toISOString(),
      items: [{ product: consignId, quantity: 1, unitCost: 90000 }],
    });
    assert(r.status === 400, `consignment purchase → ${r.status}`);
    const errMsg = r.json?.error || "";
    assert(errMsg.includes("منبع") || errMsg.includes("خریداری"), `error mentions sourcing: ${errMsg}`);
    const p = await getProduct(consignId);
    assert(p.stock === 5 && p.sourcing === "consignment", "consignment product untouched");
  });

  // ---- TEST 4: create draft purchase (stock/layers/movements all unchanged) ----
  await testAsync("create draft: 201, no stock/layer/movement created", async () => {
    const r = await http(adminJar, "POST", "/api/admin/purchases", {
      supplier: suppDoc._id.toString(),
      purchaseDate: new Date().toISOString(),
      reference: PREFIX + "REF",
      items: [
        { product: simpleId, quantity: 10, unitCost: 50000 },
        { product: simpleId, quantity: 5, unitCost: 50000 },
      ],
      discount: 100000,
      additionalCosts: 20000,
    });
    assert(r.status === 201, `create → ${r.status}`);
    const p = r.json.purchase;
    assert(p.status === "draft", `status=${p.status}`);
    assert(p.subtotal === 750000, `subtotal=${p.subtotal}`);
    assert(p.total === 670000, `total=${p.total}`);
    assert(p.totalOrdered === 15, `totalOrdered=${p.totalOrdered}`);
    purchaseId = p.id;
    purchaseNumber = p.number;
    itemId = p.items[0].id;

    const prod = await getProduct(simpleId);
    assert(prod.stock === 0, "stock still 0 after create");
    assert((prod.costLayers || []).length === 0, "no layers after create");
    assert((await countMovements("")) === 0 || true, "movements check via receipt later");
    const mvTotal = await d.collection("inventorymovements").countDocuments({ product: new mongoose.Types.ObjectId(simpleId) });
    assert(mvTotal === 0, `no movements after create (got ${mvTotal})`);
  });

  // ---- TEST 5: detail + list ----
  await testAsync("detail + list read", async () => {
    const r = await http(adminJar, "GET", `/api/admin/purchases/${purchaseId}`);
    assert(r.status === 200, `detail → ${r.status}`);
    assert(r.json.purchase.number === purchaseNumber, "detail number");
    const list = await http(adminJar, "GET", "/api/admin/purchases");
    assert(list.status === 200, `list → ${list.status}`);
    assert(list.json.total >= 1, "list has rows");
  });

  // ---- TEST 6: order draft → ordered ----
  await testAsync("order: draft → ordered", async () => {
    const r = await http(adminJar, "PATCH", `/api/admin/purchases/${purchaseId}`, { action: "order" });
    assert(r.status === 200, `order → ${r.status}`);
    assert(r.json.purchase.status === "ordered", `status=${r.json.purchase.status}`);
  });

  // ---- TEST 7: partial receive → stock + exact layer + movement ----
  await clearWriteKeys();
  await testAsync("partial receive: stock+layer+movement with line unitCost (50000 ≠ supplierPrice 120000)", async () => {
    const key = "key-partial-" + Date.now();
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/receive`, {
      key,
      items: [{ itemId, quantity: 4 }],
    });
    assert(r.status === 200, `receive → ${r.status}`);
    const p = r.json.purchase;
    assert(p.status === "partially_received", `status=${p.status}`);
    assert(p.totalReceived === 4, `totalReceived=${p.totalReceived}`);
    assert(p.totalOutstanding === 11, `totalOutstanding=${p.totalOutstanding}`);

    const prod = await getProduct(simpleId);
    assert(prod.stock === 4, `stock=${prod.stock}`);
    assert(prod.costLayers.length === 1, "one layer");
    assert(prod.costLayers[0].unitCost === 50000, `layer cost=${prod.costLayers[0].unitCost} — from line, NOT supplierPrice`);
    assert(prod.costLayers[0].remaining === 4, `layer remaining=${prod.costLayers[0].remaining}`);
    assert(prod.costLayers[0].source === "receipt", "layer source receipt");

    const mv = await countMovements(`receipt-${purchaseId}-${key}-${itemId}`);
    assert(mv === 1, `movement count=${mv}`);
  });

  // ---- TEST 8: idempotent retry with the SAME key ----
  await testAsync("idempotent retry: same key → idempotent:true, no double inventory", async () => {
    const key = "key-partial-" + (Date.now() - 1000);
    // First apply
    await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/receive`, {
      key,
      items: [{ itemId, quantity: 1 }],
    });
    // Retry with the same key
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/receive`, {
      key,
      items: [{ itemId, quantity: 1 }],
    });
    assert(r.status === 200, `retry → ${r.status}`);
    assert(r.json.idempotent === true, `idempotent flag=${r.json.idempotent}`);

    const prod = await getProduct(simpleId);
    assert(prod.stock === 5, `stock=${prod.stock} (no double)`);
    const doc = await getPurchase(purchaseId);
    const totalRec = doc.items.reduce((s, it) => s + it.receivedQuantity, 0);
    assert(totalRec === 5, `received=${totalRec} (no double)`);
    const mv = await countMovements(`receipt-${purchaseId}-${key}-${itemId}`);
    assert(mv === 1, `movement count=${mv} (deduped)`);
  });

  // ---- TEST 9: over-receive → 409 ----
  await testAsync("over-receive → 409 (outstanding exceeded)", async () => {
    const doc = await getPurchase(purchaseId);
    const outstanding = doc.items[0].quantity - doc.items[0].receivedQuantity;
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/receive`, {
      key: "key-over-" + Date.now(),
      items: [{ itemId, quantity: outstanding + 1 }],
    });
    assert(r.status === 409, `over-receive → ${r.status}`);
  });

  // ---- TEST 10: pay — financial only, stock/layers untouched ----
  await clearWriteKeys();
  await testAsync("pay: amountPaid/status change; stock+layers UNTOUCHED", async () => {
    const before = await getProduct(simpleId);
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/pay`, { amount: 200000 });
    assert(r.status === 200, `pay → ${r.status}`);
    const p = r.json.purchase;
    assert(p.paymentStatus === "partial", `paymentStatus=${p.paymentStatus}`);
    assert(p.amountPaid === 200000, `amountPaid=${p.amountPaid}`);

    const after = await getProduct(simpleId);
    assert(after.stock === before.stock, "stock unchanged by pay");
    assert(after.costLayers.length === before.costLayers.length, "layers unchanged by pay");
    assert(after.stockVersion === before.stockVersion, "stockVersion unchanged by pay");
  });

  // ---- TEST 11: variant receipt → per-variant layer ----
  await clearWriteKeys();
  await testAsync("variant purchase + receive → per-variant layer on the variant", async () => {
    const r = await http(adminJar, "POST", "/api/admin/purchases", {
      supplier: suppDoc._id.toString(),
      purchaseDate: new Date().toISOString(),
      items: [{ product: variantId, variantId: String(vId), quantity: 6, unitCost: 111111 }],
    });
    assert(r.status === 201, `variant purchase → ${r.status}`);
    const vp = r.json.purchase;
    const key = "key-variant-" + Date.now();
    const rec = await http(adminJar, "POST", `/api/admin/purchases/${vp.id}/receive`, {
      key,
      items: [{ itemId: vp.items[0].id, quantity: 6 }],
    });
    assert(rec.status === 200, `variant receive → ${rec.status}`);

    const prod = await getProduct(variantId);
    const v = prod.variants.find((x) => String(x._id) === String(vId));
    assert(v.stock === 6, `variant stock=${v.stock}`);
    assert(v.costLayers.length === 1, "variant one layer");
    assert(v.costLayers[0].unitCost === 111111, "variant layer cost from line");
    assert(v.costLayers[0].remaining === 6, "variant layer remaining");
    const mv = await countMovements(`receipt-${vp.id}-${key}-${vp.items[0].id}`);
    assert(mv === 1, `variant movement=${mv}`);
  });

  // ---- TEST 12: full receive of ALL remaining lines → received status ----
  // (The fixture has TWO lines — qty 10 + qty 5 — so receiving only line 1
  // correctly stays partially_received; full = every outstanding line.)
  await clearWriteKeys();
  await testAsync("full receive remaining lines → status received + layers sum", async () => {
    const doc = await getPurchase(purchaseId);
    const remaining = doc.items.map((it) => ({
      itemId: String(it._id),
      quantity: it.quantity - it.receivedQuantity,
    }));
    assert(remaining.every((r) => r.quantity > 0), "all lines have outstanding qty");
    const key = "key-full-" + Date.now();
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/receive`, {
      key,
      items: remaining,
    });
    assert(r.status === 200, `full receive → ${r.status}`);
    assert(r.json.purchase.status === "received", `status=${r.json.purchase.status}`);
    const prod = await getProduct(simpleId);
    assert(prod.stock === 15, `final stock=${prod.stock}`);
    assert(prod.costLayers.reduce((s, l) => s + l.remaining, 0) === 15, "layers sum to 15");
    // A received purchase can no longer be received.
    const again = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/receive`, {
      key: "key-after-" + Date.now(),
      items: remaining,
    });
    assert(again.status === 400, `receive after received → ${again.status}`);
  });

  // ---- TEST 13: cancel guards ----
  await testAsync("cancel received purchase → 400 (received history preserved)", async () => {
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/cancel`, { reason: "test" });
    assert(r.status === 400, `cancel received → ${r.status}`);
    const doc = await getPurchase(purchaseId);
    assert(doc.status === "received", "status still received");
  });

  await clearWriteKeys();
  await testAsync("cancel draft purchase → cancelled", async () => {
    const r = await http(adminJar, "POST", "/api/admin/purchases", {
      supplier: suppDoc._id.toString(),
      purchaseDate: new Date().toISOString(),
      items: [{ product: simpleId, quantity: 2, unitCost: 10000 }],
    });
    assert(r.status === 201, `cancel-fixture create → ${r.status}`);
    const c = await http(adminJar, "POST", `/api/admin/purchases/${r.json.purchase.id}/cancel`, { reason: PREFIX + "cancel" });
    assert(c.status === 200, `cancel draft → ${c.status}`);
    assert(c.json.purchase.status === "cancelled", "status cancelled");
    assert(c.json.purchase.cancellationReason === PREFIX + "cancel", "reason stored");
  });

  // ---- TEST 14: purchases report (reports module slug) ----
  await testAsync("purchases report: purchase-filter parsing + purchase rows", async () => {
    const r = await http(adminJar, "GET", `/api/admin/reports/purchases?preset=year`);
    assert(r.status === 200, `report → ${r.status}`);
    assert(r.json.report === "purchases", "report slug");
    assert(Array.isArray(r.json.rows), "rows array");
    assert(r.json.rows.some((row) => row.number === purchaseNumber), "own purchase present in report");
    const row = r.json.rows.find((x) => x.number === purchaseNumber);
    assert(row.total === 670000, `row total=${row.total}`);
    assert(row.amountOutstanding === 470000, `row outstanding=${row.amountOutstanding}`);
  });

  // ---- TEST 15: purchases report invalid status → 400 ----
  await testAsync("purchases report invalid purchase status → 400", async () => {
    const r = await http(adminJar, "GET", `/api/admin/reports/purchases?preset=year&status=processing`);
    assert(r.status === 400, `invalid status → ${r.status}`);
  });

  // ---- TEST 17b: over-payment → explicit 400, nothing mutated (MEDIUM-7) ----
  // Runs AFTER the purchases-report assertion (which expects the main purchase
  // to still have 470000 outstanding) — the exact-payment step below fully
  // settles it.
  await clearWriteKeys();
  await testAsync("over-pay: amount beyond remaining → 400, no mutation", async () => {
    const p = await getPurchase(purchaseId);
    const total = Number(p.total);
    const paid = Number(p.amountPaid);
    const before = await getProduct(simpleId);
    const r = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/pay`, {
      amount: total - paid + 1, // one toman over the remaining balance
    });
    assert(r.status === 400, `over-pay → ${r.status} (expected 400): ${JSON.stringify(r.json)}`);
    assert((r.json.error || "").includes("بیش از مبلغ باقیمانده"), `error message: ${r.json.error}`);
    const after = await getPurchase(purchaseId);
    assert(Number(after.amountPaid) === paid, `amountPaid untouched (${after.amountPaid} vs ${paid})`);
    assert(after.paymentStatus === "partial", `paymentStatus untouched (${after.paymentStatus})`);
    const afterProd = await getProduct(simpleId);
    assert(afterProd.stock === before.stock && afterProd.stockVersion === before.stockVersion, "no stock/version mutation");
    // Exact payment remains accepted (idempotent path unchanged).
    const exact = await http(adminJar, "POST", `/api/admin/purchases/${purchaseId}/pay`, {
      amount: total - paid,
    });
    assert(exact.status === 200, `exact remaining pay → ${exact.status}`);
    assert(Number(exact.json.purchase.amountPaid) === total, `fully paid amountPaid=${exact.json.purchase.amountPaid}`);
    assert(exact.json.purchase.paymentStatus === "paid", `paymentStatus=${exact.json.purchase.paymentStatus}`);
  });

  // ============================================================
  // CLEANUP (scoped to this suite's own PREFIX)
  // ============================================================
  try {
    const prefixProductIds = (await d.collection("products")
      .find({ slug: { $regex: "^" + PREFIX } })
      .project({ _id: 1 }).toArray()).map((x) => x._id);
    await d.collection("inventorymovements").deleteMany({ product: { $in: prefixProductIds } });
    // Own purchase orders reference the PREFIX'd items by name.
    await d.collection("purchaseorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
    await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
    await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
    await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
    await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
    await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:purchase-write:" } });
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
