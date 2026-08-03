/**
 * Session 33 — Supplier Payout Approval System Verification (real HTTP API)
 *
 * Uses two independent suppliers so each flow has clean state:
 *   Supplier A (balance 100000) — reserve semantics + approve flow
 *   Supplier B (balance 100000) — concurrent double-approve + reject flow
 *
 * Tests:
 *   1. Supplier requests payout → reserve incremented, balance UNCHANGED
 *   2. Request over available (reserved not spendable) → 400
 *   3. Concurrent requests cannot over-reserve (atomic $expr claim)
 *   4. Customer cannot request payout → 403
 *   5. Unauthenticated request → 401
 *   6. Supplier cannot approve (admin API) → 403
 *   7. Admin lists pending payouts → 200
 *   8. Admin approves → balance debited + reserve released + status approved + reviewedAt
 *   9. Re-approving processed request → 400 (atomic claim)
 *  10. Concurrent double-approve → exactly one 200 + one 400 (balance debited once)
 *  11. Reject without reason → 400
 *  12. Admin rejects → status rejected + reason saved, balance untouched, reserve released
 *  13. wallet GET: totalPaidOut only counts approved; availableBalance reflects reserve
 *
 * Usage: node scripts/verify-payouts.js
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
const PREFIX = "payout_" + Date.now() + "_";
const PASS = "payout-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const SUPPLIER_A_PHONE = "09167770001";
const SUPPLIER_B_PHONE = "09167770002";
const CUSTOMER_PHONE = "09167770003";

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

async function http(method, urlPath, jar, body, extraHeaders) {
  const headers = { ...(extraHeaders || {}) };
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

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    businessName: String,
    contactPhone: String,
    bankAccount: { cardNumber: String, iban: String, ownerName: String },
    balance: Number,
    pendingReserve: Number,
    isActive: Boolean,
  },
  { timestamps: true, collection: "suppliers" }
);

async function getSupplier(db, supplierId) {
  return db.collection("suppliers").findOne({ _id: supplierId });
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 33 — SUPPLIER PAYOUT APPROVAL (REAL HTTP API)");
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
  const User = mongoose.models.User_PAYOUT || mongoose.model("User_PAYOUT", UserSchema);
  const Supplier = mongoose.models.Supplier_PAYOUT || mongoose.model("Supplier_PAYOUT", SupplierSchema);

  // --- Idempotency sweep ---
  await db.collection("transactions").deleteMany({ note: { $regex: "^" + PREFIX } });
  await User.deleteMany({ phone: { $in: [SUPPLIER_A_PHONE, SUPPLIER_B_PHONE, CUSTOMER_PHONE] } });
  await Supplier.deleteMany({ businessName: { $regex: "^PayoutTest" } });

  // --- Fixtures ---
  const mkSupplier = async (name, phone) => {
    const user = await User.create({ name, phone, passwordHash: await bcrypt.hash(PASS, 10), role: "supplier", isActive: true });
    const doc = await Supplier.create({
      user: user._id,
      businessName: "PayoutTest " + name,
      contactPhone: phone,
      bankAccount: { cardNumber: "6037991234567890", iban: "IR123456789012345678901234", ownerName: name },
      balance: 100000,
      pendingReserve: 0,
      isActive: true,
    });
    await User.findByIdAndUpdate(user._id, { $set: { supplier: doc._id } });
    return { user, doc };
  };

  const supplierA = await mkSupplier("Supplier A", SUPPLIER_A_PHONE);
  const supplierB = await mkSupplier("Supplier B", SUPPLIER_B_PHONE);
  const customer = await User.create({ name: "Payout Customer", phone: CUSTOMER_PHONE, passwordHash: await bcrypt.hash(PASS, 10), role: "customer", isActive: true });

  let adminJar = null;
  let aJar = null;
  let bJar = null;
  let customerJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier A login", async () => {
    aJar = await login(SUPPLIER_A_PHONE, PASS);
    assert(aJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Supplier B login", async () => {
    bJar = await login(SUPPLIER_B_PHONE, PASS);
    assert(bJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 1: request payout → reserve, balance unchanged ---
  let request1Id = null;
  await testAsync("Request payout -> reserve incremented, balance UNCHANGED", async () => {
    const res = await http("POST", "/api/supplier/wallet", aJar, { amount: 40000, note: PREFIX + "req-1" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.pendingReserve === 40000, "pendingReserve must be 40000, got " + res.data.pendingReserve);
    assert(res.data.availableBalance === 60000, "availableBalance must be 60000, got " + res.data.availableBalance);

    const supp = await getSupplier(db, supplierA.doc._id);
    assert(supp.balance === 100000, "balance must stay 100000 (reserved, not debited), got " + supp.balance);
    assert(supp.pendingReserve === 40000, "pendingReserve must be 40000, got " + supp.pendingReserve);

    const tx = await db.collection("transactions").findOne({ note: PREFIX + "req-1" });
    assert(tx && tx.status === "pending", "request must be pending");
    request1Id = String(tx._id);
    console.log("\n      balance=100000 pendingReserve=40000 status=pending");
  });

  // --- TEST 2: over-available → 400 ---
  await testAsync("Cannot request more than available (reserved not spendable) -> 400", async () => {
    const res = await http("POST", "/api/supplier/wallet", aJar, { amount: 70000, note: PREFIX + "over" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const supp = await getSupplier(db, supplierA.doc._id);
    assert(supp.pendingReserve === 40000, "reserve must stay 40000, got " + supp.pendingReserve);
  });

  // --- TEST 3: concurrent requests cannot over-reserve ---
  await testAsync("Concurrent requests cannot over-reserve (atomic $expr)", async () => {
    // available is 60000; two concurrent 60000 requests → at most one succeeds
    const [r1, r2] = await Promise.all([
      http("POST", "/api/supplier/wallet", aJar, { amount: 60000, note: PREFIX + "conc-a" }),
      http("POST", "/api/supplier/wallet", aJar, { amount: 60000, note: PREFIX + "conc-b" }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert(statuses[0] === 200 && statuses[1] === 400, "expected [200,400], got " + JSON.stringify(statuses));
    const supp = await getSupplier(db, supplierA.doc._id);
    assert(supp.pendingReserve === 100000, "reserve must be capped at 100000 (never > balance), got " + supp.pendingReserve);
    console.log("\n      statuses=" + JSON.stringify(statuses) + " reserve=" + supp.pendingReserve);
  });

  // --- TEST 4+5: authz ---
  await testAsync("Customer cannot request payout -> 403", async () => {
    const res = await http("POST", "/api/supplier/wallet", customerJar, { amount: 10000 });
    assert(res.status === 403, "expected 403, got " + res.status);
  });
  await testAsync("Unauthenticated payout request -> 401", async () => {
    const res = await http("POST", "/api/supplier/wallet", null, { amount: 10000 });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 6: supplier cannot approve ---
  await testAsync("Supplier cannot approve payout (admin API) -> 403", async () => {
    const res = await http("POST", "/api/admin/payouts", aJar, { transactionId: request1Id, action: "approve" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 7: admin lists pending payouts ---
  await testAsync("Admin lists pending payouts -> 200 + request present", async () => {
    const res = await http("GET", "/api/admin/payouts?status=pending", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    const found = (res.data || []).some((p) => String(p._id) === request1Id);
    assert(found, "request 1 not in pending list");
  });

  // --- TEST 8: admin approves → balance debited + reserve released ---
  await testAsync("Admin approves -> balance debited + reserve released + status approved", async () => {
    const res = await http("POST", "/api/admin/payouts", adminJar, { transactionId: request1Id, action: "approve" });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "approved", "status must be approved");
    assert(!!res.data.reviewedAt, "reviewedAt missing");

    const supp = await getSupplier(db, supplierA.doc._id);
    assert(supp.balance === 60000, "balance must be debited to 60000, got " + supp.balance);
    assert(supp.pendingReserve === 60000, "reserve must drop to 60000, got " + supp.pendingReserve);
    console.log("\n      balance 100000->60000 reserve 100000->60000");
  });

  // --- TEST 9: re-approve same request → 400 (atomic claim) ---
  await testAsync("Re-approving processed request -> 400", async () => {
    const res = await http("POST", "/api/admin/payouts", adminJar, { transactionId: request1Id, action: "approve" });
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
  });

  // --- TEST 10: concurrent double-approve of same pending request → one wins ---
  let request2Id = null;
  await testAsync("Concurrent double-approve -> exactly one 200 + one 400", async () => {
    const res = await http("POST", "/api/supplier/wallet", bJar, { amount: 20000, note: PREFIX + "conc-approve" });
    assert(res.status === 200, "request failed: " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const tx = await db.collection("transactions").findOne({ note: PREFIX + "conc-approve" });
    request2Id = String(tx._id);

    const [r1, r2] = await Promise.all([
      http("POST", "/api/admin/payouts", adminJar, { transactionId: request2Id, action: "approve" }),
      http("POST", "/api/admin/payouts", adminJar, { transactionId: request2Id, action: "approve" }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert(statuses[0] === 200 && statuses[1] === 400, "expected [200,400], got " + JSON.stringify(statuses));

    // Balance debited exactly once
    const supp = await getSupplier(db, supplierB.doc._id);
    assert(supp.balance === 80000, "balance must be debited exactly once (100000-20000=80000), got " + supp.balance);
    assert(supp.pendingReserve === 0, "reserve must be 0 after approve, got " + supp.pendingReserve);
    console.log("\n      statuses=" + JSON.stringify(statuses) + " balance=" + supp.balance);
  });

  // --- TEST 11+12: reject flow (Supplier B, independent state) ---
  let request3Id = null;
  await testAsync("Reject without reason -> 400", async () => {
    const res = await http("POST", "/api/supplier/wallet", bJar, { amount: 15000, note: PREFIX + "reject-me" });
    assert(res.status === 200, "request failed: " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const tx = await db.collection("transactions").findOne({ note: PREFIX + "reject-me" });
    request3Id = String(tx._id);
    const r = await http("POST", "/api/admin/payouts", adminJar, { transactionId: request3Id, action: "reject" });
    assert(r.status === 400, "expected 400 for missing reason, got " + r.status);
  });

  await testAsync("Admin rejects -> status rejected + reason saved, balance untouched", async () => {
    const res = await http("POST", "/api/admin/payouts", adminJar, {
      transactionId: request3Id,
      action: "reject",
      reason: "اطلاعات بانکی نامعتبر",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "rejected", "status must be rejected");
    assert(res.data.rejectionReason === "اطلاعات بانکی نامعتبر", "rejectionReason missing");

    const supp = await getSupplier(db, supplierB.doc._id);
    assert(supp.balance === 80000, "balance must be untouched (80000), got " + supp.balance);
    assert(supp.pendingReserve === 0, "reserve must release 15000 (back to 0), got " + supp.pendingReserve);
    console.log("\n      balance still 80000, reserve released");
  });

  // --- TEST 13: wallet GET totals ---
  await testAsync("wallet GET: totalPaidOut only approved + availableBalance reflects reserve", async () => {
    const resA = await http("GET", "/api/supplier/wallet", aJar);
    assert(resA.status === 200, "expected 200, got " + resA.status);
    // A: approved req-1 (40000); conc-a (60000) still pending → not counted
    assert(resA.data.totalPaidOut === 40000, "A totalPaidOut must be 40000, got " + resA.data.totalPaidOut);
    assert(resA.data.balance === 60000, "A balance must be 60000, got " + resA.data.balance);
    assert(resA.data.pendingReserve === 60000, "A pendingReserve must be 60000, got " + resA.data.pendingReserve);
    assert(resA.data.availableBalance === 0, "A availableBalance must be 0, got " + resA.data.availableBalance);

    const resB = await http("GET", "/api/supplier/wallet", bJar);
    assert(resB.status === 200, "expected 200, got " + resB.status);
    // B: approved conc-approve (20000); reject-me rejected (not counted)
    assert(resB.data.totalPaidOut === 20000, "B totalPaidOut must be 20000, got " + resB.data.totalPaidOut);
    assert(resB.data.balance === 80000, "B balance must be 80000, got " + resB.data.balance);
    assert(resB.data.availableBalance === 80000, "B availableBalance must be 80000, got " + resB.data.availableBalance);
    console.log("\n      A: paidOut=40000 reserve=60000 available=0 | B: paidOut=20000 available=80000");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("transactions").deleteMany({ note: { $regex: "^" + PREFIX } });
  await Supplier.deleteMany({ _id: { $in: [supplierA.doc._id, supplierB.doc._id] } });
  await User.deleteMany({ _id: { $in: [supplierA.user._id, supplierB.user._id, customer._id] } });
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
