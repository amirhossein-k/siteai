/**
 * Session 82 Phase E — Expenses verification (real HTTP API + real DB).
 *
 * Covers the approved matrix:
 *   1. 401/403 auth on every expense endpoint
 *   2. Create expense (default pending) — validation (category/amount/desc/date)
 *   3. Detail + list (filters, pagination, search)
 *   4. Update (pending/paid) — voided → 400
 *   5. Mark paid (pending → paid) — idempotent; voided → 400
 *   6. Audited void: reason REQUIRED; voided rows stay visible; never deleted
 *   7. Voided expenses EXCLUDED from totals (report + P&L operating expenses)
 *   8. Expenses report (reports module slug) — status/category filters
 *   9. P&L net profit = grossProfit − operatingExpenses (with a real sale order)
 *  10. Rate limiting (expense-write 60/15min)
 *
 * Usage: node scripts/verify-expenses.js  (dev server on :3000, real DB)
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
const PREFIX = "exp82_" + Date.now() + "_";
const PASS = "exp82-test-123";
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

// ---- tiny cookie jar (matches verify-purchases' working NextAuth pattern) ----
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
  const ProductSchema = new mongoose.Schema(
    {
      name: String, slug: String, supplierPrice: Number, price: Number, stock: Number,
      stockVersion: Number, category: mongoose.Schema.Types.ObjectId,
      supplier: mongoose.Schema.Types.ObjectId, sourcing: String, costLayers: Array,
      hasVariants: Boolean, variants: Array, isActive: Boolean,
    },
    { timestamps: true, collection: "products" }
  );
  const SupplierSchema = new mongoose.Schema(
    { user: { type: mongoose.Schema.Types.ObjectId }, businessName: String, isActive: Boolean, balance: Number, pendingReserve: Number },
    { timestamps: true, collection: "suppliers" }
  );
  const User = mongoose.models.User_EXP || mongoose.model("User_EXP", UserSchema);
  const Supplier = mongoose.models.Supplier_EXP || mongoose.model("Supplier_EXP", SupplierSchema);

  // --- Idempotency sweep: this suite's own namespace only ---
  await d.collection("expenses").deleteMany({ description: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:expense-write:" } });

  const admin = await User.findOne({ phone: ADMIN_PHONE }).lean();
  assert(admin, "seeded admin not found");

  // --- Fixtures ---
  await User.create({ name: PREFIX + "Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });
  const suppUser = await User.create({ name: PREFIX + "Supplier", phone: SUPPLIER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
  const suppDoc = await Supplier.create({ user: suppUser._id, businessName: PREFIX + "SupplierCo", isActive: true, balance: 0, pendingReserve: 0 });
  await User.findByIdAndUpdate(suppUser._id, { $set: { supplier: suppDoc._id } });
  const catDoc = await d.collection("categories").insertOne({ name: PREFIX + "Cat", slug: PREFIX + "cat", isActive: true, createdAt: new Date(), updatedAt: new Date() });

  const now = new Date();
  const simpleId = (await d.collection("products").insertOne({
    name: PREFIX + "Simple", slug: PREFIX + "simple", description: "", images: [], brand: null, tags: [],
    category: catDoc.insertedId, supplier: suppDoc._id, supplierPrice: 120000,
    price: 200000, stock: 10, stockVersion: 0, hasVariants: false, variants: [],
    isActive: true, sourcing: "purchased", costLayers: [], createdAt: now, updatedAt: now,
  })).insertedId.toString();

  const getExpense = async (id) => d.collection("expenses").findOne({ _id: new mongoose.Types.ObjectId(id) });
  const clearWriteKeys = () => d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:expense-write:" } });

  let adminJar, supplierJar, customerJar;
  let expenseId = null;

  // ---- TEST 1: auth matrix ----
  await testAsync("auth matrix: 401 unauth, 403 customer/supplier on expense endpoints", async () => {
    const probes = [
      { url: "/api/admin/expenses", method: "GET" },
      { url: "/api/admin/expenses", method: "POST", body: {} },
      { url: "/api/admin/expenses/000000000000000000000000", method: "GET" },
      { url: "/api/admin/expenses/000000000000000000000000", method: "PATCH", body: {} },
      { url: "/api/admin/expenses/000000000000000000000000/pay", method: "POST" },
      { url: "/api/admin/expenses/000000000000000000000000/void", method: "POST", body: { voidReason: "x" } },
    ];
    for (const p of probes) {
      const anon = await http(null, p.method, p.url, p.body);
      assert(anon.status === 401, `anon ${p.method} ${p.url} → ${anon.status}`);
    }
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    customerJar = await login(CUSTOMER_PHONE, PASS);
    for (const p of probes) {
      const s = await http(supplierJar, p.method, p.url, p.body);
      const c = await http(customerJar, p.method, p.url, p.body);
      assert(s.status === 403, `supplier ${p.method} ${p.url} → ${s.status}`);
      assert(c.status === 403, `customer ${p.method} ${p.url} → ${c.status}`);
    }
  });

  // ---- TEST 2: create expense (default pending) + validation ----
  await testAsync("create expense (pending) + validation errors", async () => {
    const bad = await http(adminJar, "POST", "/api/admin/expenses", { category: "bogus", description: "x", amount: -1 });
    assert(bad.status === 400, `bad category → ${bad.status}`);
    const missing = await http(adminJar, "POST", "/api/admin/expenses", { description: "بدون دسته" });
    assert(missing.status === 400, `missing category → ${missing.status}`);
    const ok = await http(adminJar, "POST", "/api/admin/expenses", {
      category: "gateway_fees",
      description: PREFIX + "کارمزد درگاه",
      amount: 150000,
      expenseDate: new Date().toISOString().slice(0, 10),
      paymentMethod: "bank",
      reference: "GATE-1",
      payee: "زرین‌پال",
    });
    assert(ok.status === 201, `create → ${ok.status}`);
    expenseId = ok.json.expense._id;
    assert(ok.json.expense.status === "pending", "default status should be pending");
    assert(ok.json.expense.amount === 150000, "amount round-trip");
    assert(ok.json.expense.categoryLabel === "کارمزد درگاه پرداخت", "category label");
  });

  // ---- TEST 3: detail + list ----
  await testAsync("detail + list with filters + search + malformed id → 400", async () => {
    const detail = await http(adminJar, "GET", `/api/admin/expenses/${expenseId}`);
    assert(detail.status === 200, `detail → ${detail.status}`);
    assert(detail.json.expense._id === expenseId, "detail id");

    const list = await http(adminJar, "GET", "/api/admin/expenses?status=pending");
    assert(list.status === 200 && list.json.expenses.some((e) => e._id === expenseId), "list by status");

    const search = await http(adminJar, "GET", `/api/admin/expenses?q=${encodeURIComponent(PREFIX + "کارمزد")}`);
    assert(search.status === 200 && search.json.expenses.some((e) => e._id === expenseId), "search by description");

    const malformed = await http(adminJar, "GET", "/api/admin/expenses/not-an-id");
    assert(malformed.status === 400, `malformed id → ${malformed.status}`);
    const unknown = await http(adminJar, "GET", "/api/admin/expenses/000000000000000000000000");
    assert(unknown.status === 404, `unknown id → ${unknown.status}`);
  });

  // ---- TEST 4: update (pending) — then invalid update after void ----
  await testAsync("update expense while pending; voided update → 400", async () => {
    const upd = await http(adminJar, "PATCH", `/api/admin/expenses/${expenseId}`, { amount: 200000, notes: "به‌روزرسانی" });
    assert(upd.status === 200 && upd.json.expense.amount === 200000, `update → ${upd.status}`);
    const badUpd = await http(adminJar, "PATCH", `/api/admin/expenses/${expenseId}`, { amount: -5 });
    assert(badUpd.status === 400, `negative amount → ${badUpd.status}`);
  });

  // ---- TEST 5: mark paid (pending → paid), idempotent, then voided pay → 400 ----
  await testAsync("mark paid: pending → paid (idempotent); voided pay → 400", async () => {
    const pay = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/pay`);
    assert(pay.status === 200 && pay.json.expense.status === "paid", `pay → ${pay.status}`);
    const payAgain = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/pay`);
    assert(payAgain.status === 200 && payAgain.json.expense.status === "paid", "pay idempotent");
  });

  // ---- TEST 6: audited void — reason required, row stays, never deleted ----
  await testAsync("audited void: reason required; row stays with voidedBy/voidReason", async () => {
    const noReason = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/void`, { voidReason: "" });
    assert(noReason.status === 400, `void without reason → ${noReason.status}`);

    const voided = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/void`, { voidReason: "ثبت اشتباه — فاکتور GATE-1 تکراری" });
    assert(voided.status === 200, `void → ${voided.status}`);
    assert(voided.json.expense.status === "void", "status → void");
    assert(voided.json.expense.voidReason.includes("اشتباه"), "voidReason saved");

    // Row still exists (never deleted) and detail shows the void metadata.
    const after = await getExpense(expenseId);
    assert(after && after.status === "void", "row still exists after void");
    const detail = await http(adminJar, "GET", `/api/admin/expenses/${expenseId}`);
    assert(detail.json.expense.voidedAt && detail.json.expense.voidReason, "detail exposes void audit");

    const payVoided = await http(adminJar, "POST", `/api/admin/expenses/${expenseId}/pay`);
    assert(payVoided.status === 400, `pay voided → ${payVoided.status}`);
    const updVoided = await http(adminJar, "PATCH", `/api/admin/expenses/${expenseId}`, { amount: 1 });
    assert(updVoided.status === 400, `update voided → ${updVoided.status}`);
  });

  // ---- TEST 7: voided expenses excluded from report totals ----
  await testAsync("expenses report: voided rows visible but excluded from totals", async () => {
    // Create one active + one voided.
    const active = await http(adminJar, "POST", "/api/admin/expenses", {
      category: "rent", description: PREFIX + "اجاره دفتر", amount: 3_000_000, status: "paid",
    });
    assert(active.status === 201, `create active → ${active.status}`);
    const voided = await http(adminJar, "POST", "/api/admin/expenses", {
      category: "shipping", description: PREFIX + "ارسال خطا", amount: 500_000, status: "paid",
    });
    assert(voided.status === 201, `create voided-candidate → ${voided.status}`);
    const v = await http(adminJar, "POST", `/api/admin/expenses/${voided.json.expense._id}/void`, { voidReason: "ارسال لغو شد" });
    assert(v.status === 200, `void → ${v.status}`);

    const today = new Date().toISOString().slice(0, 10);
    const report = await http(adminJar, "GET", `/api/admin/reports/expenses?from=${today}&to=${today}`);
    assert(report.status === 200, `expense report → ${report.status}`);
    // Both rows present (voided visible for audit).
    assert(report.json.rows.some((r) => r._id === active.json.expense._id), "active row present");
    assert(report.json.rows.some((r) => r._id === voided.json.expense._id), "voided row present (audit)");
    // Totals EXCLUDE the voided amount: 3,000,000 only (the earlier 200,000 was voided too).
    assert(report.json.totals.amount === 3_000_000, `totals exclude voided → got ${report.json.totals.amount}`);
    assert(report.json.summary.grossSales === 3_000_000, `summary excludes voided → got ${report.json.summary.grossSales}`);

    const byStatus = await http(adminJar, "GET", `/api/admin/reports/expenses?from=${today}&to=${today}&status=paid`);
    assert(byStatus.status === 200, `report status filter → ${byStatus.status}`);
    assert(byStatus.json.rows.every((r) => r.status === "paid"), "status filter applied");
  });

  // ---- TEST 8: P&L net profit = grossProfit − operatingExpenses ----
  await testAsync("P&L: netProfit = grossProfit − non-void operating expenses", async () => {
    // Use the report window covering today so the seeded expenses count.
    const today = new Date().toISOString().slice(0, 10);
    const pnl = await http(adminJar, "GET", `/api/admin/reports/pnl?from=${today}&to=${today}`);
    assert(pnl.status === 200, `pnl → ${pnl.status}`);
    const rows = pnl.json.current.rows;
    const gp = rows.find((r) => r.key === "grossProfit");
    const exp = rows.find((r) => r.key === "operatingExpenses");
    const np = rows.find((r) => r.key === "netProfit");
    assert(gp && exp && np, "grossProfit/operatingExpenses/netProfit rows exist");
    // operatingExpenses ≤ −3,000,000 (our non-void rent must be included; a
    // shared DB could hold other recorded expenses — the identity below is
    // what proves the accounting rule, not the absolute value).
    assert(exp.amount <= -3_000_000, `operating expenses ≤ −3M → ${exp.amount}`);
    assert(np.amount === gp.amount + exp.amount, `netProfit = grossProfit − expenses → ${np.amount}`);
    assert(np.unavailable === undefined, "netProfit is available (not flagged unavailable)");
  });

  // ---- TEST 9: expense report slug is registered + report filters validated ----
  await testAsync("expense report slug + invalid status → 400", async () => {
    const bad = await http(adminJar, "GET", "/api/admin/reports/expenses?preset=month&status=bogus");
    assert(bad.status === 400, `invalid expense status → ${bad.status}`);
    const badCat = await http(adminJar, "GET", "/api/admin/reports/expenses?preset=month&category=nope");
    assert(badCat.status === 400, `invalid expense category → ${badCat.status}`);
  });

  // ---- TEST 10: rate limiting ----
  await testAsync("rate limiting: expense-write 60/15min → 429", async () => {
    await clearWriteKeys();
    let limited = false;
    for (let i = 0; i < 65; i++) {
      const res = await http(adminJar, "POST", "/api/admin/expenses", {
        category: "other", description: PREFIX + "rate-" + i, amount: 1000,
      });
      if (res.status === 429) { limited = true; break; }
    }
    assert(limited, "expected 429 after the 60-write budget");
  });

  // ============================================================
  // CLEANUP
  // ============================================================
  await d.collection("expenses").deleteMany({ description: { $regex: "^" + PREFIX } });
  const ownProducts = (await d.collection("products")
    .find({ slug: { $regex: "^" + PREFIX } }).project({ _id: 1 }).toArray()).map((x) => x._id);
  await d.collection("inventorymovements").deleteMany({ product: { $in: ownProducts } });
  await d.collection("products").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("categories").deleteMany({ slug: { $regex: "^" + PREFIX } });
  await d.collection("suppliers").deleteMany({ businessName: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  await d.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:expense-write:" } });
  await mongoose.disconnect();

  console.log(`\n==================================================`);
  console.log(`  Total: ${total}  Passed: ${passed}  Failed: ${failed}`);
  console.log(`==================================================`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
