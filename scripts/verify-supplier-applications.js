/**
 * Session 67 — Supplier Application + Admin Approval Queue Verification
 * (real HTTP API + real MongoDB)
 *
 * Tests:
 *   1. Dev server reachable
 *   2. Unauthenticated POST /api/supplier-applications -> 401
 *   3. Admin POST /api/supplier-applications -> 403 (admin is not a customer)
 *   4. Customer GET /api/admin/supplier-applications -> 403
 *   5. Customer submits an application -> 201 pending + admins notified
 *   6. Duplicate pending application -> 409 (one open application per user)
 *   7. GET /api/supplier-applications/me -> own pending application
 *   8. Admin GET queue -> pending first, populated applicant, status fields
 *   9. Admin REJECT -> status rejected, ROLE STAYS customer, applicant
 *      notified with the admin note
 *  10. Decide on an already-decided application -> 409
 *  11. A rejected applicant may RE-APPLY -> 201 (new pending row)
 *  12. Admin APPROVE -> role supplier + Supplier doc SEEDED FROM THE
 *      APPLICATION (businessName/description/contactPhone) + User.supplier
 *      back-link + the applicant's OLD CUSTOMER SESSION is revoked (401) +
 *      supplier_approved notification
 *  13. Approved applicant logs in -> reaches the supplier panel (stats 200)
 *  14. Malformed application id -> 400 (never a CastError 500)
 *  15. Cleanup (fixtures removed)
 *
 * Rate-limit aware: each applicant submits at most 2 applications per
 * 15 minutes (the designed per-user cap) — Applicant A = submit + duplicate
 * (2), Applicant B = submit + re-apply (2).
 *
 * Usage: node scripts/verify-supplier-applications.js
 * Requires: dev server on http://localhost:3000, real DB, seeded admin.
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
const bcrypt = require("bcryptjs");

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "supapp_" + Date.now() + "_";
const PASS = "app-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
// Unique 11-digit phones (0 + 10 digits).
const APPLICANT_A_PHONE = "09158882021";
const APPLICANT_B_PHONE = "09158882022";

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
  const init = { method, headers, redirect: "manual" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, init);
  if (jar) jar.get(res.headers);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data };
}

// --- Minimal schemas (fixtures only; the API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, supplier: { type: mongoose.Schema.Types.ObjectId, default: null }, isActive: Boolean, tokenVersion: Number },
  { timestamps: true, collection: "users" }
);
const SupplierSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, contactPhone: String, logo: String, description: String, balance: Number, pendingReserve: Number, isActive: Boolean },
  { timestamps: true, collection: "suppliers" }
);
const ApplicationSchema = new mongoose.Schema(
  { user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, businessName: String, description: String, contactPhone: String, status: String, adminNote: String, decidedBy: mongoose.Schema.Types.ObjectId, decidedAt: Date },
  { timestamps: true, collection: "supplierapplications" }
);
const NotificationSchema = new mongoose.Schema(
  { recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, type: String, category: String, message: String, link: String, notificationKey: String, isRead: Boolean },
  { timestamps: true, collection: "notifications" }
);

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 67 — SUPPLIER APPLICATION + ADMIN APPROVAL QUEUE (REAL HTTP API)");
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
  const User = mongoose.models.User_SUPAPP || mongoose.model("User_SUPAPP", UserSchema);
  const Supplier = mongoose.models.Supplier_SUPAPP || mongoose.model("Supplier_SUPAPP", SupplierSchema);
  const Application = mongoose.models.App_SUPAPP || mongoose.model("App_SUPAPP", ApplicationSchema);
  const Notification = mongoose.models.Notification_SUPAPP || mongoose.model("Notification_SUPAPP", NotificationSchema);

  // --- Idempotency sweep (re-runs must be clean) ---
  await User.deleteMany({ phone: { $in: [APPLICANT_A_PHONE, APPLICANT_B_PHONE] } });
  const userApps = await User.find({ phone: { $in: [APPLICANT_A_PHONE, APPLICANT_B_PHONE] } }).select("_id").lean();
  const appUserIds = userApps.map((u) => u._id);
  if (appUserIds.length > 0) {
    await Application.deleteMany({ user: { $in: appUserIds } });
    await Supplier.deleteMany({ user: { $in: appUserIds } });
  }

  // --- Fixtures: two customer applicants ---
  const customerA = await User.create({
    name: "SUPAPP Applicant A",
    phone: APPLICANT_A_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "customer",
    isActive: true,
    tokenVersion: 0,
  });
  const customerB = await User.create({
    name: "SUPAPP Applicant B",
    phone: APPLICANT_B_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "customer",
    isActive: true,
    tokenVersion: 0,
  });

  let adminJar = null;
  let jarA = null;
  let jarB = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Applicant A login", async () => {
    jarA = await login(APPLICANT_A_PHONE, PASS);
    assert(jarA.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Applicant B login", async () => {
    jarB = await login(APPLICANT_B_PHONE, PASS);
    assert(jarB.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 2: unauth -> 401 ---
  await testAsync("Unauthenticated POST /api/supplier-applications -> 401", async () => {
    const res = await http("POST", "/api/supplier-applications", null, { businessName: "X" });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 3: admin -> 403 ---
  await testAsync("Admin POST /api/supplier-applications -> 403 (customer only)", async () => {
    const res = await http("POST", "/api/supplier-applications", adminJar, { businessName: "X" });
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: customer -> admin endpoint 403 ---
  await testAsync("Customer GET /api/admin/supplier-applications -> 403", async () => {
    const res = await http("GET", "/api/admin/supplier-applications", jarA);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 5: customer submits -> 201 pending + admin notified ---
  let appAId = null;
  await testAsync("Customer submits application -> 201 pending + admins notified", async () => {
    const res = await http("POST", "/api/supplier-applications", jarA, {
      businessName: "فروشگاه برق A " + PREFIX,
      description: "توضیحات آزمایشی A",
      contactPhone: APPLICANT_A_PHONE,
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.status === "pending", "must be pending");
    appAId = res.data.id;

    // Admin notification (type supplier_application, dedupe key)
    const adminDoc = await User.findOne({ phone: ADMIN_PHONE }).select("_id").lean();
    const notif = await Notification.findOne({ recipient: adminDoc._id, notificationKey: "supplier_application_" + appAId }).lean();
    assert(notif, "admin must be notified of the new application");
    assert(notif.type === "supplier_application", "wrong notification type");
  });

  // --- TEST 6: duplicate pending -> 409 ---
  await testAsync("Duplicate pending application -> 409", async () => {
    const res = await http("POST", "/api/supplier-applications", jarA, { businessName: "تکرار " + PREFIX });
    assert(res.status === 409, "expected 409, got " + res.status);
  });

  // --- TEST 7: /me -> own pending application ---
  await testAsync("GET /api/supplier-applications/me -> own pending application", async () => {
    const res = await http("GET", "/api/supplier-applications/me", jarA);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(res.data && res.data._id === appAId, "must return A's application");
    assert(res.data.status === "pending", "must be pending");
    assert(res.data.businessName.includes("فروشگاه برق A"), "businessName missing");
  });

  // --- TEST 8: admin queue shape ---
  await testAsync("Admin GET queue -> pending first + populated applicant", async () => {
    const res = await http("GET", "/api/admin/supplier-applications", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "must be an array");
    const row = res.data.find((r) => r._id === appAId);
    assert(row, "application missing from the queue");
    assert(row.status === "pending", "must be pending");
    assert(row.user && row.user.phone === APPLICANT_A_PHONE, "populated applicant missing");
    assert(row.user.role === "customer", "applicant must still be a customer");
  });

  // --- TEST 9: reject A ---
  await testAsync("Admin rejects application -> rejected + role stays customer + applicant notified", async () => {
    const res = await http("PATCH", "/api/admin/supplier-applications?id=" + appAId, adminJar, {
      action: "reject",
      note: "مدارک ناقص",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.application.status === "rejected", "must be rejected");

    const user = await User.findById(customerA._id).lean();
    assert(user.role === "customer", "reject must NOT change the role");
    assert(!user.supplier, "reject must NOT create a Supplier doc");

    const notif = await Notification.findOne({ recipient: customerA._id, notificationKey: "supplier_rejected_" + appAId }).lean();
    assert(notif, "applicant must be notified of the rejection");
    assert(notif.message.includes("مدارک ناقص"), "admin note must be in the message");

    // /me reflects the decision + note
    const me = await http("GET", "/api/supplier-applications/me", jarA);
    assert(me.data.status === "rejected", "/me must show rejected");
    assert(me.data.adminNote === "مدارک ناقص", "/me must show the admin note");
  });

  // --- TEST 10: decide again -> 409 ---
  await testAsync("Decide on an already-decided application -> 409", async () => {
    const res = await http("PATCH", "/api/admin/supplier-applications?id=" + appAId, adminJar, { action: "approve" });
    assert(res.status === 409, "expected 409, got " + res.status);
  });

  // --- TEST 11: B submits, is rejected, then re-applies ---
  let appBFirstId = null;
  let appBId = null;
  await testAsync("Rejected applicant may RE-APPLY -> 201 new pending row", async () => {
    const first = await http("POST", "/api/supplier-applications", jarB, {
      businessName: "فروشگاه B " + PREFIX,
    });
    assert(first.status === 201, "first submit expected 201, got " + first.status);
    appBFirstId = first.data.id;

    const rejected = await http("PATCH", "/api/admin/supplier-applications?id=" + appBFirstId, adminJar, { action: "reject" });
    assert(rejected.status === 200, "reject expected 200, got " + rejected.status);

    const reapply = await http("POST", "/api/supplier-applications", jarB, {
      businessName: "فروشگاه B نسخه ۲ " + PREFIX,
      description: "توضیحات B",
      contactPhone: APPLICANT_B_PHONE,
    });
    assert(reapply.status === 201, "re-apply expected 201, got " + reapply.status + " " + JSON.stringify(reapply.data).slice(0, 150));
    appBId = reapply.data.id;
    assert(appBId !== appBFirstId, "re-apply must create a NEW application");
  });

  // --- TEST 12: approve B ---
  await testAsync("Admin approves application -> role supplier + Supplier seeded FROM THE APPLICATION + old session revoked", async () => {
    const before = await http("GET", "/api/profile", jarB);
    assert(before.status === 200, "customer session should work before approval");

    const res = await http("PATCH", "/api/admin/supplier-applications?id=" + appBId, adminJar, {
      action: "approve",
      note: "خوش آمدید",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.application.status === "approved", "must be approved");

    // Role flip + Supplier doc seeded from the APPLICATION (not user.name)
    const user = await User.findById(customerB._id).lean();
    assert(user.role === "supplier", "role must be supplier");
    assert(user.supplier, "User.supplier back-link must be set");
    const supplier = await Supplier.findById(user.supplier).lean();
    assert(supplier, "Supplier document must exist");
    assert(supplier.businessName === "فروشگاه B نسخه ۲ " + PREFIX, "Supplier businessName must come from the APPLICATION, got: " + supplier.businessName);
    assert(supplier.description === "توضیحات B", "Supplier description must come from the APPLICATION");
    assert(supplier.contactPhone === APPLICANT_B_PHONE, "Supplier contactPhone must come from the APPLICATION");
    assert(supplier.isActive === true, "new supplier must be active");

    // Notification to the applicant
    const notif = await Notification.findOne({ recipient: customerB._id, notificationKey: "supplier_approved_" + appBId }).lean();
    assert(notif, "applicant must be notified of the approval");

    // Old customer session revoked (tokenVersion bump)
    const after = await http("GET", "/api/profile", jarB);
    assert(after.status === 401, "old customer session must be revoked, got " + after.status);
  });

  // --- TEST 13: approved applicant logs in -> supplier panel ---
  await testAsync("Approved applicant logs in and reaches the supplier panel", async () => {
    const jar = await login(APPLICANT_B_PHONE, PASS);
    assert(jar.header().includes("session-token"), "no session cookie");
    const res = await http("GET", "/api/supplier/stats", jar);
    assert(res.status === 200, "supplier stats expected 200, got " + res.status);
  });

  // --- TEST 14: malformed id -> 400 ---
  await testAsync("Malformed application id -> 400 (never a CastError 500)", async () => {
    const res = await http("PATCH", "/api/admin/supplier-applications?id=not-an-id", adminJar, { action: "approve" });
    assert(res.status === 400, "expected 400, got " + res.status);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await Application.deleteMany({ user: { $in: [customerA._id, customerB._id] } });
  await Supplier.deleteMany({ user: { $in: [customerA._id, customerB._id] } });
  await User.deleteMany({ _id: { $in: [customerA._id, customerB._id] } });
  await Notification.deleteMany({ notificationKey: { $regex: "^(supplier_application|supplier_approved|supplier_rejected)_" } });
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
