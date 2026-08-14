/**
 * Session 82 Phase C — FIFO checkout integration verification (real HTTP API + real DB).
 *
 * Covers the approved matrix:
 *   1. Auth matrix (401 checkout, 403 customer/supplier on reports)
 *   2. Consignment sale → SupplierOrder payout preserved, fifoUnitCost null, no sale movement
 *   3. Purchase + receive → FIFO layer + stock + receipt movement (unit cost from the line)
 *   4. Second receipt → second layer (FIFO ordering)
 *   5. Purchased sale → fifoUnitCost snapshot, NO SupplierOrder (payout safety), sale movement
 *   6. Checkout rollback (stale price 409) → stock + layers restored exactly
 *   7. supplierPrice change → historical FIFO COGS unchanged
 *   8. Inventory report → layer-based valuation (not supplierPrice × stock)
 *   9. Multi-layer sale → exact weighted fifoUnitCost, full layer consumption
 *  10. Insufficient FIFO layers → fail-safe 409, no order, no invented cost
 *  11. Concurrent checkouts → each consumes its own layer, no oversell
 *  12. Variant FIFO → per-variant layers, variant isolation, variant sale movement
 *  13. Pre-cutover fallback → report COGS uses supplierPrice when fifoUnitCost absent
 *  14. Report COGS reconciliation (FIFO + fallback in one sum)
 *  15. Refund → exact FIFO layer restoration + return_restock movement, idempotent
 *  16. Customer cancel → exact FIFO layer restoration + cancellation_restock movement
 *
 * Usage: node scripts/verify-fifo.js  (dev server on :3000, real DB)
 * Self-cleaning: removes every PREFIX'd fixture + its own orders/supplier-orders/movements.
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
const PREFIX = "fifo82_" + Date.now() + "_";
const PASS = "fifo82-test-123";
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

/** Place a cash (manual) order for the given cart items. */
async function checkout(jar, items) {
  return http(jar, "POST", "/api/checkout", {
    items,
    shippingAddress: {
      fullName: PREFIX + "Buyer",
      phone: CUSTOMER_PHONE,
      address: PREFIX + "street",
      postalCode: "1234567890",
    },
    paymentMethod: "manual",
  });
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
  const User = mongoose.models.User_FIFO || mongoose.model("User_FIFO", UserSchema);
  const Supplier = mongoose.models.Supplier_FIFO || mongoose.model("Supplier_FIFO", SupplierSchema);

  // --- Idempotency sweep: this suite's own namespace only ---
  const ownProducts = (await d.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } })
    .project({ _id: 1 }).toArray()).map((x) => x._id);
  await d.collection("inventorymovements").deleteMany({ product: { $in: ownProducts } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("purchaseorders").deleteMany({ "items.name": { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  // Orders/supplier-orders from a crashed previous run (fixed fixture phones)
  const sweepCustomer = await User.findOne({ phone: CUSTOMER_PHONE }).lean();
  if (sweepCustomer) {
    const sweepOrders = (await d.collection("orders")
      .find({ customer: sweepCustomer._id }).project({ _id: 1 }).toArray()).map((x) => x._id);
    await d.collection("supplierorders").deleteMany({ order: { $in: sweepOrders } });
    await d.collection("orders").deleteMany({ customer: sweepCustomer._id });
  }
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
      costLayers: fields.costLayers || [], createdAt: now, updatedAt: now,
    });

  const skuSuffix = String(Date.now()).slice(-8);
  const v1 = { _id: new mongoose.Types.ObjectId(), sku: `FIFO82-${skuSuffix}-V1`, attributes: [], price: 300000, supplierPrice: 140000, stock: 0, stockVersion: 0, images: [], isActive: true, costLayers: [] };
  const v2 = { _id: new mongoose.Types.ObjectId(), sku: `FIFO82-${skuSuffix}-V2`, attributes: [], price: 310000, supplierPrice: 145000, stock: 0, stockVersion: 0, images: [], isActive: true, costLayers: [] };

  // purchased simple product — stock 0 so receipt quantities are provable
  const simpleId = (await seedProduct({ name: PREFIX + "Simple", slug: PREFIX + "simple", supplierPrice: 120000, price: 200000, stock: 0 })).insertedId.toString();
  // consignment product — existing marketplace flow must stay untouched
  const consignId = (await seedProduct({ name: PREFIX + "Consign", slug: PREFIX + "consign", supplierPrice: 90000, price: 150000, stock: 5, sourcing: "consignment" })).insertedId.toString();
  // variant product — two variants, per-variant layers
  const variantId = (await seedProduct({ name: PREFIX + "Variant", slug: PREFIX + "variant", supplierPrice: 0, price: 300000, stock: 0, variants: [v1, v2] })).insertedId.toString();
  // concurrency product — 10 units across two layers
  const concId = (await seedProduct({ name: PREFIX + "Conc", slug: PREFIX + "conc", supplierPrice: 100000, price: 180000, stock: 0 })).insertedId.toString();
  // broken purchased product: stock 3 but NO layers (inconsistent state)
  const brokenId = (await seedProduct({ name: PREFIX + "Broken", slug: PREFIX + "broken", supplierPrice: 50000, price: 100000, stock: 3, costLayers: [] })).insertedId.toString();

  const getProduct = async (id) => d.collection("products").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const getOrder = async (id) => d.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const getPurchase = async (id) => d.collection("purchaseorders").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const countMovements = async (ref) => d.collection("inventorymovements").countDocuments({ sourceRef: ref });
  const findMovement = async (ref) => d.collection("inventorymovements").findOne({ sourceRef: ref });
  const clearWriteKeys = () => d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:purchase-write:" } });
  const countSupplierOrdersFor = async (productId) => d.collection("supplierorders").countDocuments({ "items.product": new mongoose.Types.ObjectId(productId) });

  /** Create + order + receive a purchase for a product. Returns the product doc. */
  async function receivePurchase(productId, quantity, unitCost, variantId) {
    const create = await http(adminJar, "POST", "/api/admin/purchases", {
      supplier: suppDoc._id.toString(),
      purchaseDate: new Date().toISOString(),
      reference: PREFIX + "REF-" + Date.now() + Math.floor(Math.random() * 1000),
      items: [{ product: productId, ...(variantId ? { variantId } : {}), quantity, unitCost }],
    });
    assert(create.status === 201, `purchase create → ${create.status}: ${JSON.stringify(create.json)}`);
    const p = create.json.purchase;
    const order = await http(adminJar, "PATCH", `/api/admin/purchases/${p.id}`, { action: "order" });
    assert(order.status === 200, `purchase order → ${order.status}`);
    await clearWriteKeys();
    const rec = await http(adminJar, "POST", `/api/admin/purchases/${p.id}/receive`, {
      key: "key-" + Date.now() + Math.floor(Math.random() * 1000),
      items: [{ itemId: p.items[0].id, quantity }],
    });
    assert(rec.status === 200, `receive → ${rec.status}: ${JSON.stringify(rec.json)}`);
    return getProduct(productId);
  }

  let adminJar, supplierJar, customerJar;
  const orderIds = [];

  // ---- TEST 1: auth matrix ----
  await testAsync("auth matrix: 401 unauth checkout, 403 customer/supplier on reports", async () => {
    const unauth = await http(makeJar(), "POST", "/api/checkout", { items: [], shippingAddress: {} });
    assert(unauth.status === 401, `unauth checkout → ${unauth.status}`);
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    const supReport = await http(supplierJar, "GET", "/api/admin/reports/sales?preset=year");
    assert(supReport.status === 403, `supplier reports → ${supReport.status}`);
    const custReport = await http(customerJar, "GET", "/api/admin/reports/inventory?preset=year");
    assert(custReport.status === 403, `customer reports → ${custReport.status}`);
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
  });

  // ---- TEST 2: consignment sale keeps the marketplace flow ----
  await testAsync("consignment sale: fifoUnitCost null, SupplierOrder payout, no sale movement", async () => {
    const before = await getProduct(consignId);
    const r = await checkout(customerJar, [{ id: consignId, quantity: 2, price: 150000, name: PREFIX + "Consign" }]);
    assert(r.status === 201, `checkout → ${r.status}: ${JSON.stringify(r.json)}`);
    orderIds.push(r.json.orderId);
    const order = await getOrder(r.json.orderId);
    const item = order.items[0];
    assert(item.fifoUnitCost === null || item.fifoUnitCost === undefined, "consignment item has NO fifoUnitCost");
    assert(item.price === 150000 && item.supplierPrice === 90000, "consignment item snapshots");
    const soCount = await countSupplierOrdersFor(consignId);
    assert(soCount === 1, `SupplierOrder created for consignment (${soCount})`);
    const so = await d.collection("supplierorders").findOne({ "items.product": new mongoose.Types.ObjectId(consignId) });
    assert(so.amountOwed === 180000, `amountOwed=${so.amountOwed}`);
    const after = await getProduct(consignId);
    assert(after.stock === before.stock - 2, `consignment stock decremented (${after.stock})`);
    const saleMv = await countMovements(`sale-${r.json.orderId}-${consignId}`);
    assert(saleMv === 0, "NO sale movement for consignment (payout path, not owned)");
  });

  // ---- TEST 3: first receipt creates the FIFO layer ----
  await testAsync("purchase+receive 10×100000 → stock 10, one layer, receipt movement", async () => {
    const prod = await receivePurchase(simpleId, 10, 100000);
    assert(prod.stock === 10, `stock=${prod.stock}`);
    assert(prod.costLayers.length === 1, "one layer");
    assert(prod.costLayers[0].unitCost === 100000, `layer cost=${prod.costLayers[0].unitCost}`);
    assert(prod.costLayers[0].remaining === 10, "layer remaining 10");
    assert(prod.costLayers[0].source === "receipt", "layer source receipt");
  });

  // ---- TEST 4: second receipt → FIFO ordering ----
  await testAsync("purchase+receive 5×200000 → second layer, stock 15", async () => {
    const prod = await receivePurchase(simpleId, 5, 200000);
    assert(prod.stock === 15, `stock=${prod.stock}`);
    assert(prod.costLayers.length === 2, "two layers");
    assert(prod.costLayers[0].unitCost === 100000 && prod.costLayers[1].unitCost === 200000, "FIFO order 100k → 200k");
  });

  // ---- TEST 5: purchased sale → FIFO snapshot + NO SupplierOrder + sale movement ----
  await testAsync("purchased sale 5: fifoUnitCost 100000, no SupplierOrder, layers + sale movement", async () => {
    const r = await checkout(customerJar, [{ id: simpleId, quantity: 5, price: 200000, name: PREFIX + "Simple" }]);
    assert(r.status === 201, `checkout → ${r.status}: ${JSON.stringify(r.json)}`);
    orderIds.push(r.json.orderId);
    const order = await getOrder(r.json.orderId);
    const item = order.items[0];
    assert(item.fifoUnitCost === 100000, `fifoUnitCost=${item.fifoUnitCost}`);
    assert(item.price === 200000, "customer price unchanged (discount-independent)");
    const soCount = await countSupplierOrdersFor(simpleId);
    assert(soCount === 0, `NO SupplierOrder for purchased sale (${soCount}) — payout safety`);
    const prod = await getProduct(simpleId);
    assert(prod.stock === 10, `stock=${prod.stock}`);
    assert(prod.costLayers[0].remaining === 5 && prod.costLayers[0].unitCost === 100000, "first layer partially consumed");
    assert(prod.costLayers[1].remaining === 5 && prod.costLayers[1].unitCost === 200000, "second layer untouched");
    const mv = await findMovement(`sale-${r.json.orderId}-${simpleId}`);
    assert(!!mv, "sale movement exists");
    assert(mv.quantity === -5 && mv.unitCost === 100000 && mv.totalCost === 500000, `sale movement ${mv.quantity}/${mv.unitCost}/${mv.totalCost}`);
  });

  // ---- TEST 6: checkout rollback (stale price) → stock + layers restored ----
  await testAsync("checkout rollback: stale price 409 → stock + layers restored exactly", async () => {
    const before = await getProduct(simpleId);
    const r = await checkout(customerJar, [{ id: simpleId, quantity: 2, price: 199999, name: PREFIX + "Simple" }]);
    assert(r.status === 409, `stale price → ${r.status}`);
    const after = await getProduct(simpleId);
    // stockVersion is an optimistic-lock counter — it increments on the
    // restore write too; the meaningful invariants are stock + layers.
    assert(after.stock === before.stock, "stock unchanged after rollback");
    const beforeQty = before.costLayers.reduce((s, l) => s + l.remaining, 0);
    const afterQty = after.costLayers.reduce((s, l) => s + l.remaining, 0);
    assert(afterQty === beforeQty, "layer quantity unchanged after rollback");
    const beforeValue = before.costLayers.reduce((s, l) => s + l.remaining * l.unitCost, 0);
    const afterValue = after.costLayers.reduce((s, l) => s + l.remaining * l.unitCost, 0);
    assert(afterValue === beforeValue, `layer value unchanged after rollback (${afterValue})`);
  });

  // ---- TEST 7: supplierPrice change → FIFO COGS unchanged ----
  await testAsync("supplierPrice → 999999; sale 3 still COGS 100000 (not 999999)", async () => {
    await d.collection("products").updateOne({ _id: new mongoose.Types.ObjectId(simpleId) }, { $set: { supplierPrice: 999999 } });
    const r = await checkout(customerJar, [{ id: simpleId, quantity: 3, price: 200000, name: PREFIX + "Simple" }]);
    assert(r.status === 201, `checkout → ${r.status}`);
    orderIds.push(r.json.orderId);
    const order = await getOrder(r.json.orderId);
    assert(order.items[0].fifoUnitCost === 100000, `fifoUnitCost=${order.items[0].fifoUnitCost} — from LAYER, not supplierPrice`);
    const prod = await getProduct(simpleId);
    assert(prod.stock === 7, `stock=${prod.stock}`);
    // The rollback above restored units at their snapshot cost into a NEW
    // adjustment layer (newest), so the array is [5×200k, 2×100k].
    const byCost = {};
    for (const l of prod.costLayers) byCost[l.unitCost] = (byCost[l.unitCost] || 0) + l.remaining;
    assert(byCost[100000] === 2 && byCost[200000] === 5, `layers by cost ${JSON.stringify(byCost)}`);
  });

  // ---- TEST 8: inventory report values from cost layers ----
  await testAsync("inventory report: purchased row = Σ remaining×unitCost (1,200,000), not supplierPrice×stock", async () => {
    const r = await http(adminJar, "GET", `/api/admin/reports/inventory?preset=year&product=${simpleId}`);
    assert(r.status === 200, `inventory report → ${r.status}`);
    const row = r.json.rows.find((x) => x.productId === simpleId);
    assert(!!row, "row present");
    assert(row.currentStock === 7, `currentStock=${row.currentStock}`);
    assert(row.inventoryValue === 1200000, `inventoryValue=${row.inventoryValue} (2×100k + 5×200k)`);
    assert(row.unitCost === 171429, `unitCost=${row.unitCost}`);
  });

  // ---- TEST 9: multi-layer sale → exact weighted fifoUnitCost + full consumption ----
  await testAsync("multi-layer sale 7: fifoUnitCost = (2×100k+5×200k)/7, layers exhausted", async () => {
    const r = await checkout(customerJar, [{ id: simpleId, quantity: 7, price: 200000, name: PREFIX + "Simple" }]);
    assert(r.status === 201, `checkout → ${r.status}`);
    orderIds.push(r.json.orderId);
    const order = await getOrder(r.json.orderId);
    const fifo = order.items[0].fifoUnitCost;
    assert(Math.abs(fifo - 1200000 / 7) < 0.001, `fifoUnitCost=${fifo} (expected ${1200000 / 7})`);
    const prod = await getProduct(simpleId);
    assert(prod.stock === 0, `stock=${prod.stock}`);
    assert(prod.costLayers.length === 0, "layers fully consumed (archived via sale movements)");
    const mv = await findMovement(`sale-${r.json.orderId}-${simpleId}`);
    assert(mv.totalCost === 1200000, `sale movement totalCost=${mv.totalCost}`);
  });

  // ---- TEST 10: insufficient FIFO layers → fail-safe 409 ----
  await testAsync("insufficient layers (stock 3, no layers) → 409, no order, nothing invented", async () => {
    const before = await getProduct(brokenId);
    const r = await checkout(customerJar, [{ id: brokenId, quantity: 1, price: 100000, name: PREFIX + "Broken" }]);
    assert(r.status === 409, `insufficient layers → ${r.status}`);
    const after = await getProduct(brokenId);
    assert(after.stock === 3 && after.costLayers.length === 0, "stock+layers untouched");
    const orderCount = await d.collection("orders").countDocuments({ "items.product": new mongoose.Types.ObjectId(brokenId) });
    assert(orderCount === 0, "no order created");
  });

  // ---- TEST 11: concurrent checkouts consume distinct layers ----
  await testAsync("concurrent 5+5 on [5×100k, 5×200k]: both succeed, distinct layers, no oversell", async () => {
    await receivePurchase(concId, 5, 100000);
    await receivePurchase(concId, 5, 200000);
    let prod = await getProduct(concId);
    assert(prod.stock === 10 && prod.costLayers.length === 2, "concurrency fixture ready (10 across two layers)");

    const [a, b] = await Promise.all([
      checkout(customerJar, [{ id: concId, quantity: 5, price: 180000, name: PREFIX + "Conc" }]),
      checkout(customerJar, [{ id: concId, quantity: 5, price: 180000, name: PREFIX + "Conc" }]),
    ]);
    assert(a.status === 201 && b.status === 201, `concurrent statuses ${a.status}/${b.status}`);
    orderIds.push(a.json.orderId, b.json.orderId);
    const orderA = await getOrder(a.json.orderId);
    const orderB = await getOrder(b.json.orderId);
    const costs = [orderA.items[0].fifoUnitCost, orderB.items[0].fifoUnitCost].sort((x, y) => x - y);
    assert(costs[0] === 100000 && costs[1] === 200000, `fifo costs ${costs} — each consumed its own layer`);
    prod = await getProduct(concId);
    assert(prod.stock === 0, `stock=${prod.stock} (never negative)`);
    assert(prod.costLayers.length === 0, "both layers exhausted");
    const mvA = await countMovements(`sale-${a.json.orderId}-${concId}`);
    const mvB = await countMovements(`sale-${b.json.orderId}-${concId}`);
    assert(mvA === 1 && mvB === 1, "one sale movement per concurrent order");
  });

  // ---- TEST 12: variant FIFO + isolation ----
  await testAsync("variant FIFO: V1 layers consumed, V2 untouched, no SupplierOrder", async () => {
    const prod0 = await receivePurchase(variantId, 6, 111111, String(v1._id));
    const v0 = prod0.variants.find((x) => String(x._id) === String(v1._id));
    assert(v0.stock === 6 && v0.costLayers[0].unitCost === 111111, "V1 received 6 @111111");

    const r = await checkout(customerJar, [{ id: variantId, variantId: String(v1._id), quantity: 2, price: 300000, name: PREFIX + "Variant" }]);
    assert(r.status === 201, `variant checkout → ${r.status}`);
    orderIds.push(r.json.orderId);
    const order = await getOrder(r.json.orderId);
    assert(order.items[0].fifoUnitCost === 111111, `variant fifoUnitCost=${order.items[0].fifoUnitCost}`);
    const soCount = await countSupplierOrdersFor(variantId);
    assert(soCount === 0, "no SupplierOrder for purchased variant");

    const prod = await getProduct(variantId);
    const v1after = prod.variants.find((x) => String(x._id) === String(v1._id));
    const v2after = prod.variants.find((x) => String(x._id) === String(v2._id));
    assert(v1after.stock === 4 && v1after.costLayers[0].remaining === 4, "V1 consumed 2 of its own layer");
    assert(v2after.stock === 0 && (v2after.costLayers || []).length === 0, "V2 completely untouched (isolation)");
    const mv = await findMovement(`sale-${r.json.orderId}-${variantId}-${String(v1._id)}`);
    assert(!!mv && mv.quantity === -2 && mv.unitCost === 111111, "variant sale movement");
  });

  // ---- TEST 13+14: report COGS — FIFO + pre-cutover fallback reconciliation ----
  await testAsync("reports COGS: fifoUnitCost path + supplierPrice fallback reconcile to 2,180,000", async () => {
    // Seed a PRE-CUTOVER-style order directly (no fifoUnitCost — legacy shape)
    const customer = await User.findOne({ phone: CUSTOMER_PHONE }).lean();
    const seeded = await d.collection("orders").insertOne({
      customer: customer._id,
      items: [{
        product: new mongoose.Types.ObjectId(simpleId), supplier: suppDoc._id, variantId: null,
        sku: "", variantLabel: "", image: "", name: PREFIX + "PreCutover",
        price: 150000, originalPrice: 150000, discountAmount: 0, supplierPrice: 90000,
        fifoUnitCost: null, quantity: 2,
      }],
      totalAmount: 300000, subtotalAmount: 300000, discount: null,
      shippingAddress: { fullName: "x", phone: CUSTOMER_PHONE, address: "x" },
      payment: { status: "paid", method: "manual", paidAt: new Date() },
      status: "processing", stockRestored: false,
      statusHistory: [{ status: "processing", at: new Date(), note: "seeded" }],
      createdAt: new Date(), updatedAt: new Date(),
    });
    orderIds.push(seeded.insertedId.toString());

    const r = await http(adminJar, "GET", `/api/admin/reports/sales?preset=year&product=${simpleId}`);
    assert(r.status === 200, `sales report → ${r.status}`);
    // O1 500k + O2 300k + O3 1200k (fifoUnitCost) + pre-cutover 180k (supplierPrice fallback)
    assert(r.json.summary.cogs === 2180000, `sales COGS=${r.json.summary.cogs} (expected 2,180,000)`);
    assert(r.json.summary.unitsSold === 17, `unitsSold=${r.json.summary.unitsSold} (5+3+7+2)`);
  });

  // ---- TEST 15: refund → exact FIFO layer restoration, idempotent ----
  await testAsync("refund O3: layers restored at snapshot cost + return_restock movement; 2nd refund 400", async () => {
    const o3 = orderIds[3]; // 3rd checkout order = the multi-layer sale (qty 7)
    await d.collection("orders").updateOne(
      { _id: new mongoose.Types.ObjectId(o3) },
      { $set: { "payment.status": "paid", status: "processing" } }
    );
    const r = await http(adminJar, "POST", "/api/admin/orders/refund", { orderId: o3, reason: PREFIX + "refund" });
    assert(r.status === 200, `refund → ${r.status}: ${JSON.stringify(r.json)}`);
    const prod = await getProduct(simpleId);
    assert(prod.stock === 7, `stock=${prod.stock} after refund`);
    const layer = prod.costLayers[0];
    assert(layer.unitCost === 171429 && layer.remaining === 7, `restored layer ${layer.unitCost}/${layer.remaining} — snapshot cost, not supplierPrice`);
    const mv = await findMovement(`return_restock-${o3}-${simpleId}`);
    assert(!!mv && mv.quantity === 7, "return_restock movement exists");
    // Idempotency: a second refund claim fails (payment no longer paid) → no double restore
    const before = await getProduct(simpleId);
    const again = await http(adminJar, "POST", "/api/admin/orders/refund", { orderId: o3, reason: PREFIX + "again" });
    assert(again.status === 400, `second refund → ${again.status}`);
    const after = await getProduct(simpleId);
    assert(after.stock === before.stock && JSON.stringify(after.costLayers) === JSON.stringify(before.costLayers), "no double restoration");
  });

  // ---- TEST 16: customer cancel → exact FIFO layer restoration ----
  await testAsync("customer cancel O1: 5 units back @100000 + cancellation_restock movement", async () => {
    const o1 = orderIds[1]; // first purchased sale (qty 5 @100k)
    const r = await http(customerJar, "POST", `/api/orders/${o1}/cancel`);
    assert(r.status === 200, `cancel → ${r.status}: ${JSON.stringify(r.json)}`);
    const prod = await getProduct(simpleId);
    assert(prod.stock === 12, `stock=${prod.stock} (7 + 5)`);
    const costs = prod.costLayers.map((l) => l.unitCost).sort((a, b) => a - b);
    assert(costs[0] === 100000 && costs[1] === 171429, `layers restored at snapshot costs ${costs}`);
    const mv = await findMovement(`cancellation_restock-${o1}-${simpleId}`);
    assert(!!mv && mv.quantity === 5 && mv.unitCost === 100000, "cancellation_restock movement exists");
  });

  // ============================================================
  // CLEANUP (scoped to this suite's own fixtures)
  // ============================================================
  try {
    const prefixProductIds = (await d.collection("products")
      .find({ slug: { $regex: "^" + PREFIX } })
      .project({ _id: 1 }).toArray()).map((x) => x._id);
    await d.collection("inventorymovements").deleteMany({ product: { $in: prefixProductIds } });
    const cust = await User.findOne({ phone: CUSTOMER_PHONE }).lean();
    if (cust) {
      const custOrders = (await d.collection("orders")
        .find({ customer: cust._id }).project({ _id: 1 }).toArray()).map((x) => x._id);
      await d.collection("supplierorders").deleteMany({ order: { $in: custOrders } });
      await d.collection("orders").deleteMany({ customer: cust._id });
    }
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
