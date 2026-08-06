/**
 * Session 63 — Logout / session termination verification (real HTTP API).
 *
 * Tests:
 *   1. Unauthenticated GET /api/auth/signout → redirect to /login
 *   2. Admin credentials login → live session (JWT cookie present)
 *   3. POST /api/auth/signout (csrf) → 200, session cookie cleared
 *   4. GET /api/auth/session → null (no user) after signout
 *   5. Re-login after logout succeeds (no server-side lockout)
 *   6. Customer signout: create a customer → login → signout → session null
 *
 * Usage: node scripts/verify-logout.js
 * Requires: dev server on http://localhost:3000 + real MongoDB. No fixtures
 * beyond one customer the suite creates and deletes itself.
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
const ADMIN_PHONE = "09120000000";
const ADMIN_PASS = "admin123456";
const CUSTOMER_PASS = "logout-test-123";

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
  res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
    body: new URLSearchParams({ csrfToken, phone, password, json: "true" }).toString(),
    redirect: "manual",
  });
  jar.get(res.headers);
  return jar;
}

async function signOut(jar) {
  let res = await fetch(BASE + "/api/auth/csrf");
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  res = await fetch(BASE + "/api/auth/signout", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: jar.header(),
    },
    body: new URLSearchParams({ csrfToken, json: "true" }).toString(),
    redirect: "manual",
  });
  jar.get(res.headers);
  return res;
}

async function session(jar) {
  const res = await fetch(BASE + "/api/auth/session", {
    headers: { Cookie: jar.header() },
  });
  return res.json();
}

// --- Minimal User schema (fixture-only; the API routes use the real model) ---
const UserSchema = new mongoose.Schema(
  { name: String, phone: String, passwordHash: String, role: String, isActive: Boolean },
  { timestamps: true, collection: "users" }
);

let phoneCounter = 0;
function genPhone() {
  phoneCounter += 1;
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}${phoneCounter}`;
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 63 — LOGOUT & SESSION TERMINATION (REAL HTTP API)");
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
  const User = mongoose.models.User_LOGOUT || mongoose.model("User_LOGOUT", UserSchema);

  // NOTE: no blanket idempotency sweep here — the customer phone embeds
  // Date.now() so it is unique per run; we only ever touch that phone.

  // --- TEST 1: unauthenticated signout is reachable + harmless ---
  // NextAuth v4 serves its built-in signout page (200 HTML) on GET when no
  // custom pages.signOut is configured; the real termination happens on POST.
  await testAsync("Unauthenticated GET /api/auth/signout -> 200, no session", async () => {
    const res = await fetch(BASE + "/api/auth/signout", { redirect: "manual" });
    assert(res.status === 200, "expected 200, got " + res.status);
    const sess = await session(makeJar());
    assert(!sess?.user, "expected no session for anonymous visitor");
  });

  // --- TEST 2: admin login → live session ---
  let adminJar = null;
  await testAsync("Admin credentials login -> live session", async () => {
    adminJar = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(adminJar.header().includes("next-auth.session-token"), "no session cookie");
    const sess = await session(adminJar);
    assert(sess?.user?.role === "admin", "expected admin session, got " + JSON.stringify(sess));
  });

  // --- TEST 3: POST signout → 200 ---
  await testAsync("POST /api/auth/signout (csrf) -> 200", async () => {
    const res = await signOut(adminJar);
    assert(res.status === 200, "expected 200, got " + res.status);
  });

  // --- TEST 4: session null after signout ---
  await testAsync("GET /api/auth/session -> null after signout", async () => {
    const sess = await session(adminJar);
    assert(!sess?.user, "expected no user after signout, got " + JSON.stringify(sess));
  });

  // --- TEST 5: re-login works after logout ---
  await testAsync("Re-login after logout succeeds (no server-side lockout)", async () => {
    const fresh = await login(ADMIN_PHONE, ADMIN_PASS);
    assert(fresh.header().includes("next-auth.session-token"), "re-login failed");
    const sess = await session(fresh);
    assert(sess?.user?.role === "admin", "expected admin session after re-login");
  });

  // --- TEST 6: customer role signout ---
  const customerPhone = genPhone();
  await testAsync("Customer signout (create -> login -> signout -> session null)", async () => {
    await User.create({
      name: "Logout Tester",
      phone: customerPhone,
      passwordHash: await bcrypt.hash(CUSTOMER_PASS, 10),
      role: "customer",
      isActive: true,
    });
    const jar = await login(customerPhone, CUSTOMER_PASS);
    assert(jar.header().includes("next-auth.session-token"), "customer login failed");
    const before = await session(jar);
    assert(before?.user?.role === "customer", "expected customer session");
    const res = await signOut(jar);
    assert(res.status === 200, "expected 200 on customer signout, got " + res.status);
    const after = await session(jar);
    assert(!after?.user, "expected no user after customer signout");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  await db.collection("users").deleteMany({ phone: customerPhone });
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
