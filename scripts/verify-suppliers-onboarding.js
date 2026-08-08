/**
 * Session 66 — Supplier Onboarding (Admin Supplier Management) Verification
 * (real HTTP API + real MongoDB)
 *
 * Tests:
 *   1. Dev server reachable
 *   2. Unauthenticated GET /api/admin/suppliers?all=true -> 401
 *   3. Non-admin (customer) GET /api/admin/suppliers?all=true -> 403
 *   4. Admin creates a Supplier via POST /api/admin/users (role=supplier)
 *      -> 201; User role=supplier AND Supplier document auto-provisioned with
 *      defaults (businessName=name, contactPhone=phone) AND User.supplier
 *      back-link set (the existing provisioning behavior — unchanged)
 *   5. Admin GET /api/admin/suppliers?all=true -> 200, contains the new
 *      supplier with populated user + status fields (management shape)
 *   6. Default GET /api/admin/suppliers (no param) -> dropdown shape
 *      (active-only, businessName+user.name) — untouched for product forms
 *   7. Admin promotes an existing Customer -> Supplier (PATCH change-role)
 *      -> Supplier document auto-created + linked; old customer session
 *      revoked (401 on a protected endpoint after the bump)
 *   8. Supplier deactivation (PATCH toggle-active) -> User.isActive=false AND
 *      linked Supplier.isActive=false (public surfaces hide them)
 *   9. Deactivated supplier hidden from public active-supplier surfaces:
 *      GET /api/suppliers excludes it; GET /api/suppliers/[id] -> 404
 *  10. Deactivation revokes the supplier's existing session (401 on
 *      /api/supplier/stats with the pre-deactivation cookie)
 *  11. Reactivation (PATCH toggle-active) -> User + Supplier isActive=true;
 *      the supplier appears in public /api/suppliers again
 *  12. A promoted supplier can log in and reach the supplier panel (stats 200)
 *  13. Cleanup (fixtures removed)
 *
 * Usage: node scripts/verify-suppliers-onboarding.js
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
const PREFIX = "supon_" + Date.now() + "_";
const PASS = "onboard-test-123";
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
// Unique 11-digit phones (0 + 10 digits).
const SUPPLIER_PHONE = "09158881001";
const CUSTOMER_PHONE = "09158881002";

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

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 66 — SUPPLIER ONBOARDING / ADMIN SUPPLIER MANAGEMENT (REAL HTTP API)");
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
  const User = mongoose.models.User_SUPON || mongoose.model("User_SUPON", UserSchema);
  const Supplier = mongoose.models.Supplier_SUPON || mongoose.model("Supplier_SUPON", SupplierSchema);

  // --- Idempotency sweep (re-runs must be clean) ---
  await User.deleteMany({ phone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });
  await Supplier.deleteMany({ contactPhone: { $in: [SUPPLIER_PHONE, CUSTOMER_PHONE] } });

  // --- Fixtures: an existing CUSTOMER (to be promoted later) ---
  const customerUser = await User.create({
    name: "SUPON Customer",
    phone: CUSTOMER_PHONE,
    passwordHash: await bcrypt.hash(PASS, 10),
    role: "customer",
    isActive: true,
    tokenVersion: 0,
  });

  let adminJar = null;
  let customerJar = null;

  await testAsync("Seed admin login", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("session-token"), "no session cookie");
  });
  await testAsync("Customer login", async () => {
    customerJar = await login(CUSTOMER_PHONE, PASS);
    assert(customerJar.header().includes("session-token"), "no session cookie");
  });

  // --- TEST 2: unauth -> 401 ---
  await testAsync("Unauthenticated GET /api/admin/suppliers?all=true -> 401", async () => {
    const res = await http("GET", "/api/admin/suppliers?all=true");
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  // --- TEST 3: non-admin -> 403 ---
  await testAsync("Customer GET /api/admin/suppliers?all=true -> 403", async () => {
    const res = await http("GET", "/api/admin/suppliers?all=true", customerJar);
    assert(res.status === 403, "expected 403, got " + res.status);
  });

  // --- TEST 4: admin creates a supplier via POST /api/admin/users ---
  let createdSupplierId = null;
  let createdUserId = null;
  await testAsync("Admin creates Supplier via POST /api/admin/users -> 201 + auto-provisioned Supplier doc", async () => {
    const res = await http("POST", "/api/admin/users", adminJar, {
      name: "SUPON Store A",
      phone: SUPPLIER_PHONE,
      password: PASS,
      role: "supplier",
    });
    assert(res.status === 201, "expected 201, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.role === "supplier", "user role must be supplier");
    assert(res.data.supplierId, "supplierId must be returned (auto-provisioned)");
    createdUserId = res.data._id;
    createdSupplierId = res.data.supplierId;

    // DB verification: Supplier doc exists with defaults + back-link
    const user = await User.findById(createdUserId).lean();
    assert(user.role === "supplier", "DB user role mismatch");
    assert(String(user.supplier) === createdSupplierId, "User.supplier back-link missing");
    const supplier = await Supplier.findById(createdSupplierId).lean();
    assert(supplier, "Supplier document missing");
    assert(supplier.businessName === "SUPON Store A", "businessName default mismatch: " + supplier.businessName);
    assert(supplier.contactPhone === SUPPLIER_PHONE, "contactPhone default mismatch");
    assert(supplier.isActive === true, "supplier must be active on creation");
    assert(supplier.balance === 0, "balance must default to 0");
  });

  // --- TEST 5: management list shape ---
  await testAsync("Admin GET ?all=true returns the supplier with populated user + status", async () => {
    const res = await http("GET", "/api/admin/suppliers?all=true", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "must be an array");
    const row = res.data.find((s) => s._id === createdSupplierId);
    assert(row, "created supplier missing from management list");
    assert(row.user && row.user._id === createdUserId, "populated user missing");
    assert(row.user.role === "supplier", "populated user role missing");
    assert(typeof row.isActive === "boolean", "isActive missing");
    assert(typeof row.balance === "number", "balance missing");
  });

  // --- TEST 6: default (dropdown) shape unchanged ---
  await testAsync("Default GET /api/admin/suppliers (dropdown shape) unchanged — active + businessName/user.name", async () => {
    const res = await http("GET", "/api/admin/suppliers", adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(Array.isArray(res.data), "must be an array");
    const row = res.data.find((s) => s._id === createdSupplierId);
    assert(row, "active supplier must appear in the dropdown list");
    const keys = Object.keys(row).sort();
    assert(JSON.stringify(keys) === JSON.stringify(["_id", "businessName", "user"]), "dropdown shape changed: " + keys.join(","));
  });

  // --- TEST 7: promote customer -> supplier ---
  let promotedUserId = null;
  let promotedSupplierId = null;
  await testAsync("Admin promotes Customer -> Supplier (change-role): Supplier auto-created + old session revoked", async () => {
    // The customer has a live session BEFORE the promotion.
    const before = await http("GET", "/api/profile", customerJar);
    assert(before.status === 200, "customer session should work before promotion");

    const res = await http("PATCH", "/api/admin/users?id=" + customerUser._id, adminJar, {
      action: "change-role",
      value: "supplier",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));
    assert(res.data.user.role === "supplier", "role must be supplier");

    // Supplier doc auto-created + linked
    const user = await User.findById(customerUser._id).lean();
    assert(user.role === "supplier", "DB role mismatch");
    assert(user.supplier, "Supplier back-link missing after promotion");
    promotedUserId = user._id.toString();
    promotedSupplierId = user.supplier.toString();
    const supplier = await Supplier.findById(user.supplier).lean();
    assert(supplier, "Supplier document missing after promotion");
    assert(supplier.businessName === "SUPON Customer", "businessName defaults to the user name");
    assert(supplier.isActive === true, "new supplier must be active");

    // Old customer session must be REVOKED (tokenVersion bump on role change)
    const after = await http("GET", "/api/profile", customerJar);
    assert(after.status === 401, "old customer session must be revoked, got " + after.status);
  });

  // --- TEST 12: promoted supplier can log in + reach the panel ---
  await testAsync("Promoted supplier logs in and reaches the supplier panel", async () => {
    const jar = await login(CUSTOMER_PHONE, PASS);
    assert(jar.header().includes("session-token"), "no session cookie");
    const res = await http("GET", "/api/supplier/stats", jar);
    assert(res.status === 200, "supplier stats expected 200, got " + res.status);
  });

  // --- TEST 8+9+10: deactivation ---
  let supplierJar = null;
  await testAsync("Supplier logs in (session to be revoked by deactivation)", async () => {
    supplierJar = await login(SUPPLIER_PHONE, PASS);
    assert(supplierJar.header().includes("session-token"), "no session cookie");
    const res = await http("GET", "/api/supplier/stats", supplierJar);
    assert(res.status === 200, "supplier session should work before deactivation");
  });

  await testAsync("Admin deactivates the supplier -> User + Supplier isActive=false", async () => {
    const res = await http("PATCH", "/api/admin/users?id=" + createdUserId, adminJar, {
      action: "toggle-active",
    });
    assert(res.status === 200, "expected 200, got " + res.status);
    const user = await User.findById(createdUserId).lean();
    assert(user.isActive === false, "User.isActive must be false");
    const supplier = await Supplier.findById(createdSupplierId).lean();
    assert(supplier.isActive === false, "Supplier.isActive must be false (public surfaces hide it)");
  });

  await testAsync("Deactivated supplier hidden from public active-supplier surfaces", async () => {
    const list = await http("GET", "/api/suppliers");
    const names = list.data.data.map((s) => s.businessName);
    assert(!names.includes("SUPON Store A"), "deactivated supplier leaked into public list");
    const detail = await http("GET", "/api/suppliers/" + createdSupplierId);
    assert(detail.status === 404, "deactivated supplier detail must 404, got " + detail.status);
  });

  await testAsync("Deactivation revokes the supplier's existing session (401)", async () => {
    const res = await http("GET", "/api/supplier/stats", supplierJar);
    assert(res.status === 401, "deactivated supplier's old session must be revoked, got " + res.status);
  });

  // --- TEST 11: reactivation ---
  await testAsync("Admin reactivates the supplier -> User + Supplier active again + visible publicly", async () => {
    const res = await http("PATCH", "/api/admin/users?id=" + createdUserId, adminJar, {
      action: "toggle-active",
    });
    assert(res.status === 200, "expected 200, got " + res.status);
    const user = await User.findById(createdUserId).lean();
    assert(user.isActive === true, "User.isActive must be true");
    const supplier = await Supplier.findById(createdSupplierId).lean();
    assert(supplier.isActive === true, "Supplier.isActive must be true");
    const list = await http("GET", "/api/suppliers");
    const names = list.data.data.map((s) => s.businessName);
    assert(names.includes("SUPON Store A"), "reactivated supplier must reappear in the public list");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await Supplier.deleteMany({ _id: { $in: [createdSupplierId, promotedSupplierId] } });
  await User.deleteMany({ _id: { $in: [createdUserId, promotedUserId, customerUser._id] } });
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
