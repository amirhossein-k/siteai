/**
 * Session 64 — Session Security Verification (real HTTP API)
 *
 * Validates the tokenVersion session-revocation layer end-to-end:
 *   1.  unauth change-password → 401
 *   2.  password user: wrong current password → 400 (session survives)
 *   3.  password user: correct change → 200 + tokenVersion bumped + passwordHash
 *       updated (DB assertions) + the pre-change session cookie is REVOKED
 *       (protected API → 401) — the enforcement window proof
 *   4.  old password no longer logs in; NEW password does (fresh tokenVersion)
 *   5.  passwordless (OTP-registered) user sets their FIRST password — no
 *       currentPassword needed → 200; password login now works
 *   6.  logout-all → 200 + tokenVersion bumped; both pre-bump sessions revoked
 *   7.  admin revoke: customer session revoked → 401; malformed id → 400;
 *       unknown user → 404; non-admin caller → 403; admin session unaffected
 *   8.  a fresh login after revocation carries the new tokenVersion
 *
 * REQUIRES: dev server on http://localhost:3000 (started with SMS_MOCK=1 so
 * the OTP register path works for test 5 — same convention as verify-otp).
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

const BASE = "http://localhost:3000";
const DB_NAME = "marlooai";
const PREFIX = "sec64_" + Date.now() + "_";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// --- Cookie jar (the exact Session 36/62 pattern) ---
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

/** NextAuth credentials exchange (password OR loginToken) → fresh cookie jar. */
async function login(phone, secret) {
  const jar = makeJar();
  let res = await fetch(BASE + "/api/auth/csrf");
  jar.get(res.headers);
  const { csrfToken } = await res.json();
  const form = new URLSearchParams({ csrfToken, phone, json: "true" });
  if (secret.loginToken) form.set("loginToken", secret.loginToken);
  else form.set("password", secret.password);
  res = await fetch(BASE + "/api/auth/callback/credentials", {
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
  const sessionRes = await fetch(BASE + "/api/auth/session", {
    headers: { Cookie: jar.header() },
  });
  const session = await sessionRes.json();
  return { jar, session };
}

async function http(method, urlPath, body, jar) {
  const headers = { ...(jar ? { Cookie: jar.header() } : {}) };
  let requestBody = undefined;
  // GET/HEAD never carry a body (Node fetch rejects one) — only attach it
  // for methods that accept one and only when provided.
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: requestBody, redirect: "manual" });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, retryAfter: res.headers.get("retry-after") };
}

// Counter suffix instead of random: two calls within the same 10-second
// Date.now() window share the same 7-digit prefix, so a random 2-digit
// suffix could collide (~1/90) — the OTP register request then 409s with
// "phone already registered" (pre-existing flake, observed in regression).
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter = (phoneCounter % 90) + 10; // 10..99, guaranteed distinct per run
  return "09" + String(Date.now()).slice(-7) + phoneCounter;
}

// --- Minimal schema (fixtures only; API routes use the real models) ---
const UserSchema = new mongoose.Schema(
  {
    name: String, phone: String, passwordHash: String, role: String,
    tokenVersion: Number, isActive: Boolean,
  },
  { timestamps: true, collection: "users" }
);

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 64 — SESSION SECURITY (REAL HTTP API)");
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
  const User = mongoose.models.User_SEC64 || mongoose.model("User_SEC64", UserSchema);

  const phone = uniquePhone();            // password customer
  const otpPhone = uniquePhone();         // passwordless OTP customer
  const createdUserIds = [];

  // --- Setup: a password customer (via the public register API) + an OTP
  //     customer (via the real OTP flow with the dev-last seam). ---
  const reg = await http("POST", "/api/register", {
    name: "Security Tester " + PREFIX,
    phone,
    password: "sec-old-pass-1",
  });
  assert(reg.status === 201, "register password customer failed " + reg.status);
  createdUserIds.push(reg.data.id);

  const otpReq = await http("POST", "/api/auth/otp/request", {
    phone: otpPhone,
    purpose: "register",
  });
  assert(otpReq.status === 200, "OTP request failed " + otpReq.status + " — dev server must run with SMS_MOCK=1");
  const dev = await http("GET", "/api/auth/otp/dev-last?phone=" + otpPhone);
  assert(dev.status === 200 && /^\d{6}$/.test(dev.data.code), "dev-last must return the code");
  const otpVerify = await http("POST", "/api/auth/otp/verify", {
    phone: otpPhone,
    code: dev.data.code,
    purpose: "register",
    name: "OTP Security " + PREFIX,
  });
  assert(otpVerify.status === 200, "OTP verify failed " + otpVerify.status);
  const otpLoginRes = await login(otpPhone, { loginToken: otpVerify.data.loginToken });
  assert(otpLoginRes.session && otpLoginRes.session.user, "OTP customer login failed");
  createdUserIds.push(otpLoginRes.session.user.id);

  await testAsync("Unauthenticated change-password -> 401", async () => {
    const res = await http("POST", "/api/auth/change-password", {
      currentPassword: "x", newPassword: "y",
    });
    assert(res.status === 401, "expected 401, got " + res.status);
  });

  let session = null;
  await testAsync("Password user: wrong current password -> 400, session survives", async () => {
    const { jar, session: s } = await login(phone, { password: "sec-old-pass-1" });
    session = s;
    const res = await http("POST", "/api/auth/change-password", {
      currentPassword: "wrong-current",
      newPassword: "sec-new-pass-2",
    }, jar);
    assert(res.status === 400, "expected 400, got " + res.status + " " + JSON.stringify(res.data));
    assert(/فعلی صحیح نیست/.test(res.data.error || ""), "expected current-password error");

    const profile = await http("GET", "/api/profile", null, jar);
    assert(profile.status === 200, "session must survive a wrong current password");
    assert(profile.data.hasPassword === true, "hasPassword must be true for a password user");
  });

  // Capture the PRE-CHANGE cookie jar — the enforcement-window proof.
  let preChange = null;
  await testAsync("Password user: correct change -> 200, tokenVersion bumped, hash updated", async () => {
    const { jar } = await login(phone, { password: "sec-old-pass-1" });
    preChange = jar;
    const res = await http("POST", "/api/auth/change-password", {
      currentPassword: "sec-old-pass-1",
      newPassword: "sec-new-pass-2",
    }, jar);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    assert(res.data.success === true, "success flag missing");

    const user = await User.findOne({ phone });
    assert(!!user, "user not found");
    assert(user.tokenVersion >= 1, "tokenVersion must be bumped, got " + user.tokenVersion);
    const bcrypt = require("bcryptjs");
    const ok = await bcrypt.compare("sec-new-pass-2", user.passwordHash);
    assert(ok, "passwordHash must match the NEW password");
  });

  await testAsync("PRE-CHANGE session cookie is REVOKED at a protected API (enforcement window)", async () => {
    const res = await http("GET", "/api/profile", null, preChange);
    assert(res.status === 401, "pre-change cookie must be 401, got " + res.status);
  });

  await testAsync("Old password fails; NEW password logs in with a fresh tokenVersion", async () => {
    const oldLogin = await login(phone, { password: "sec-old-pass-1" });
    assert(!oldLogin.session || !oldLogin.session.user, "old password must NOT log in");

    const newLogin = await login(phone, { password: "sec-new-pass-2" });
    assert(newLogin.session && newLogin.session.user, "new password must log in");
    const user = await User.findOne({ phone });
    assert(newLogin.session.user.tokenVersion === user.tokenVersion, "fresh JWT must carry the CURRENT tokenVersion");
  });

  await testAsync("Passwordless (OTP) user sets their FIRST password — no currentPassword needed", async () => {
    // Obtain a live session for the OTP user via a FRESH OTP login (they have
    // no password yet — password login cannot work).
    const otpReq2 = await http("POST", "/api/auth/otp/request", {
      phone: otpPhone,
      purpose: "login",
    });
    assert(otpReq2.status === 200, "OTP re-request failed " + otpReq2.status);
    const dev2 = await http("GET", "/api/auth/otp/dev-last?phone=" + otpPhone);
    assert(dev2.status === 200 && /^\d{6}$/.test(dev2.data.code), "dev-last must return the code");
    const verify2 = await http("POST", "/api/auth/otp/verify", {
      phone: otpPhone,
      code: dev2.data.code,
      purpose: "login",
    });
    assert(verify2.status === 200, "OTP re-verify failed " + verify2.status);
    const otpLogin2 = await login(otpPhone, { loginToken: verify2.data.loginToken });
    assert(otpLogin2.session && otpLogin2.session.user, "OTP re-login failed");
    const jar = otpLogin2.jar;

    const profile = await http("GET", "/api/profile", null, jar);
    assert(profile.status === 200, "need a live session for the OTP user");
    assert(profile.data.hasPassword === false, "OTP user must start passwordless");

    const setRes = await http("POST", "/api/auth/change-password", {
      newPassword: "sec-otp-pass-9", // NO currentPassword — first password
    }, jar);
    assert(setRes.status === 200, "setting the first password expected 200, got " + setRes.status + " " + JSON.stringify(setRes.data).slice(0, 120));

    const user = await User.findOne({ phone: otpPhone });
    assert(user && user.passwordHash, "passwordHash must now exist");
    assert(user.tokenVersion >= 1, "tokenVersion must be bumped");

    const pwLogin = await login(otpPhone, { password: "sec-otp-pass-9" });
    assert(pwLogin.session && pwLogin.session.user, "OTP user must now log in with a password");
  });

  let jarA = null, jarB = null;
  await testAsync("logout-all bumps tokenVersion and revokes BOTH pre-bump sessions", async () => {
    jarA = (await login(phone, { password: "sec-new-pass-2" })).jar;
    jarB = (await login(phone, { password: "sec-new-pass-2" })).jar;
    const before = await User.findOne({ phone });
    const res = await http("POST", "/api/auth/logout-all", null, jarA);
    assert(res.status === 200, "logout-all expected 200, got " + res.status);
    const after = await User.findOne({ phone });
    assert(after.tokenVersion === before.tokenVersion + 1, "tokenVersion must bump by exactly 1");

    const a = await http("GET", "/api/profile", null, jarA);
    const b = await http("GET", "/api/profile", null, jarB);
    assert(a.status === 401, "the triggering session must also be revoked, got " + a.status);
    assert(b.status === 401, "the other session must be revoked, got " + b.status);
  });

  await testAsync("Fresh login after logout-all works (revocation only killed old sessions)", async () => {
    const fresh = await login(phone, { password: "sec-new-pass-2" });
    assert(fresh.session && fresh.session.user, "fresh login must succeed after logout-all");
    const profile = await http("GET", "/api/profile", null, fresh.jar);
    assert(profile.status === 200, "fresh session must be valid at a protected API");
  });

  // --- Admin revoke ---
  const ADMIN = { phone: "09120000000", password: "admin123456" };
  await testAsync("Admin revoke: customer session 401, admin session unaffected", async () => {
    const admin = await login(ADMIN.phone, { password: ADMIN.password });
    assert(admin.session && admin.session.user && admin.session.user.role === "admin", "admin login failed");

    // The customer (phone) currently holds a fresh session after logout-all.
    const customer = await login(phone, { password: "sec-new-pass-2" });
    const before = await User.findOne({ phone });

    const res = await http("POST", "/api/admin/users/" + before._id + "/revoke-session", null, admin.jar);
    assert(res.status === 200, "revoke expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 120));
    const after = await User.findOne({ phone });
    assert(after.tokenVersion === before.tokenVersion + 1, "target tokenVersion must bump");

    const cust = await http("GET", "/api/profile", null, customer.jar);
    assert(cust.status === 401, "revoked customer session must be 401, got " + cust.status);

    const adminStill = await http("GET", "/api/profile", null, admin.jar);
    assert(adminStill.status === 200, "admin session must be unaffected");
  });

  await testAsync("Admin revoke: malformed id -> 400; unknown user -> 404", async () => {
    const admin = await login(ADMIN.phone, { password: ADMIN.password });
    const bad = await http("POST", "/api/admin/users/not-an-objectid/revoke-session", null, admin.jar);
    assert(bad.status === 400, "malformed id expected 400, got " + bad.status);

    const fakeId = "64e000000000000000000000";
    const missing = await http("POST", "/api/admin/users/" + fakeId + "/revoke-session", null, admin.jar);
    assert(missing.status === 404, "unknown user expected 404, got " + missing.status);
  });

  await testAsync("Admin revoke: non-admin caller -> 403", async () => {
    const customer = await login(phone, { password: "sec-new-pass-2" });
    const res = await http("POST", "/api/admin/users/" + "64e000000000000000000000" + "/revoke-session", null, customer.jar);
    assert(res.status === 403, "customer caller expected 403, got " + res.status);
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  if (createdUserIds.length > 0) {
    await db.collection("users").deleteMany({ _id: { $in: createdUserIds } });
  }
  await db.collection("ratelimits").deleteMany({
    _id: { $regex: "^rl:(change_password|logout_all|revoke_session):" },
  });
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
