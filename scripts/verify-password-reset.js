/**
 * Session 84 — Password Recovery Verification (real HTTP API)
 *
 * Validates the «بازیابی رمز عبور» flow end-to-end:
 *   1.  mock seam reachable (dev-last) — hard requirement, clear failure otherwise
 *   2.  request (password_reset) for an EXISTING user → 200 { sent: true }
 *   3.  unknown phone → SAME 200 shape + NO code stored/sent (dev-last 404)
 *   4.  unknown phone cooldown → 429 with Retry-After (dummy row closes the
 *       known-vs-unknown resend-cooldown oracle — Session 84 decision)
 *   5.  known phone cooldown → identical 429 behavior
 *   6.  dev-last returns the 6-digit code
 *   7.  wrong code → 400 + attempts recorded
 *   8.  login-purpose code canNOT verify a reset (and vice versa)
 *   9.  correct code → 200 { resetToken } (64-hex), NO loginToken, hashed at rest
 *  10.  verify does NOT create a session (reset cannot authenticate)
 *  11.  full reset: old password dies, new password works, tokenVersion bumped
 *  12.  resetToken REPLAY → second complete 400 (atomic single-use)
 *  13.  CONCURRENT completes → exactly one succeeds
 *  14.  IDOR: another phone's resetToken cannot reset a different account
 *  15.  passwordless (OTP-only) account establishes its FIRST password
 *  16.  expired OTP → 400 «کد منقضی شده است»
 *  17.  expired resetToken → 400 uniform
 *  18.  wrong-code lockout after 5 attempts
 *  19.  password < 6 → 400 (same policy as register)
 *  20.  rate limits: request / verify / complete → 429
 *  21.  a login OTP issued BEFORE the reset is invalidated by the reset
 *  22.  login/register OTP behavior unchanged (backward compat)
 *
 * REQUIRES: dev server on http://localhost:3000 started with SMS_MOCK=1
 * (the hermetic seam — src/lib/sms.ts + /api/auth/otp/dev-last).
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
const PREFIX = "pr84_" + Date.now() + "_";

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// --- Cookie jar (the exact Session 36 pattern) ---
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

/** NextAuth credentials exchange (password OR loginToken) → cookie jar. */
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

async function http(method, urlPath, body) {
  const headers = {};
  let requestBody = body;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, { method, headers, body: requestBody, redirect: "manual" });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, retryAfter: res.headers.get("retry-after") };
}

let phoneSeq = 100000;
function uniquePhone() {
  // 09 + 3 ms digits + 6-digit monotonic sequence (11 digits total). The OLD
  // generator (2-digit counter 10..99 + ms-suffix) collided once 10+ phones
  // are built in the same millisecond: the counter wraps (10..90,10,20,..)
  // while Date.now().slice(-7) is identical for all calls, so every phone
  // after the 9th duplicated an earlier one (register -> 409, resend
  // cooldown -> 429). The monotonic sequence is unique per call within the
  // run regardless of ms resolution.
  phoneSeq += 1;
  return "09" + String(Date.now()).slice(-3) + String(phoneSeq).slice(-6);
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
  console.log("  SESSION 84 — PASSWORD RECOVERY (REAL HTTP API)");
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
  const User = mongoose.models.User_PR84 || mongoose.model("User_PR84", UserSchema);

  // Hermetic start — the shared OTP/reset rate-limit budgets must be clean
  // (the regression runner sweeps them too; standalone runs need it here).
  await db.collection("ratelimits").deleteMany({
    _id: { $regex: "^rl:(otp_request|otp_request_ip|otp_verify|password_reset_complete):" },
  });

  // Crashed-run residue: if a previous run was killed before its cleanup, its
  // `PR pr84_...` users (and their OTP rows) would otherwise collide with this
  // run's fixture phones (register -> 409, resend cooldown -> 429). Scope the
  // sweep by the suite's own name prefix — never touches real accounts.
  const leftover = await db
    .collection("users")
    .find({ name: { $regex: "^PR pr84_" } })
    .project({ phone: 1 })
    .toArray();
  if (leftover.length > 0) {
    await db.collection("users").deleteMany({ name: { $regex: "^PR pr84_" } });
    await db.collection("otpcodes").deleteMany({
      phone: { $in: leftover.map((u) => u.phone) },
    });
    console.log("  Cleaned " + leftover.length + " crashed-run fixture(s)");
  }

  const phones = {
    known: uniquePhone(),
    unknown: uniquePhone(),
    unknownCooldown: uniquePhone(),
    knownCooldown: uniquePhone(),
    crossLoginToReset: uniquePhone(),
    crossResetToLogin: uniquePhone(),
    fullReset: uniquePhone(),
    replay: uniquePhone(),
    concurrent: uniquePhone(),
    idorVictim: uniquePhone(),
    idorAttacker: uniquePhone(),
    passwordless: uniquePhone(),
    expiredOtp: uniquePhone(),
    expiredToken: uniquePhone(),
    lockout: uniquePhone(),
    shortPassword: uniquePhone(),
    rateRequest: uniquePhone(),
    rateVerify: uniquePhone(),
    rateComplete: uniquePhone(),
    outstanding: uniquePhone(),
    backwardCompat: uniquePhone(),
  };
  const createdUserIds = [];
  let fullResetToken = null;

  await db.collection("otpcodes").deleteMany({ phone: { $in: Object.values(phones) } });

  const registerUser = async (phone, password) => {
    // Test-state isolation: this suite registers ~18 users, far past the
    // shared `register:<ip>` budget (5/15min) — a FIXTURE key in the shared
    // dev DB, swept between suites by the regression runner too. Production
    // limiter logic is untouched (the budget itself is exercised elsewhere).
    await db.collection("ratelimits").deleteMany({
      _id: { $regex: "^rl:register:" },
    });
    const reg = await http("POST", "/api/register", {
      name: "PR " + PREFIX,
      phone,
      password: password || "reset-old-pass-123",
    });
    assert(reg.status === 201, "register failed " + reg.status + " " + JSON.stringify(reg.data));
    createdUserIds.push(reg.data.id);
  };

  // OTP request with test-state budget isolation: this suite issues ~20
  // OTP requests, which would exhaust the shared per-IP budget (15/15min) the
  // way verify-otp deliberately does. These are FIXTURE rate-limit keys in the
  // shared dev DB (the regression runner sweeps them between suites too) —
  // production limiter logic is untouched. The per-PHONE counters are kept
  // intact for the cooldown/rate-limit assertions.
  const requestOtp = async (phone, purpose) => {
    await db.collection("ratelimits").deleteMany({
      _id: { $regex: "^rl:otp_request_ip:" },
    });
    return http("POST", "/api/auth/otp/request", { phone, purpose });
  };
  const requestReset = (phone) => requestOtp(phone, "password_reset");

  const readCode = async (phone) => {
    const res = await http("GET", "/api/auth/otp/dev-last?phone=" + phone);
    assert(res.status === 200, "dev-last expected 200, got " + res.status);
    assert(/^\d{6}$/.test(res.data.code), "code must be 6 digits");
    return res.data.code;
  };

  const verifyReset = async (phone, code) =>
    http("POST", "/api/auth/otp/verify", { phone, code, purpose: "password_reset" });

  const completeReset = async (phone, resetToken, newPassword) =>
    http("POST", "/api/auth/password-reset/complete", {
      phone,
      resetToken,
      newPassword: newPassword || "reset-new-pass-456",
    });

  /** Full happy-path reset → returns { resetToken }. */
  const doFullVerify = async (phone) => {
    const req = await requestReset(phone);
    assert(req.status === 200, "reset request expected 200, got " + req.status + " " + JSON.stringify(req.data).slice(0, 120));
    const code = await readCode(phone);
    const verify = await verifyReset(phone, code);
    assert(verify.status === 200, "reset verify expected 200, got " + verify.status + " " + JSON.stringify(verify.data).slice(0, 150));
    assert(verify.data.resetToken && /^[0-9a-f]{64}$/.test(verify.data.resetToken), "resetToken missing/malformed");
    assert(!verify.data.loginToken, "reset verify must NEVER return a loginToken");
    return verify.data.resetToken;
  };

  // --- 1. Mock seam + known-user request ---
  await testAsync("Mock seam + request for an existing user -> 200 { sent: true }", async () => {
    await registerUser(phones.known, "reset-old-pass-123");
    const res = await requestReset(phones.known);
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150) + " — the dev server must be started with SMS_MOCK=1 (see src/lib/sms.ts)");
    assert(res.data.sent === true, "sent must be true");
    assert(res.data.purpose === "password_reset", "purpose echo wrong");
    assert(res.data.expiresInSeconds > 0, "expiresInSeconds missing");
  });

  // --- 2. Unknown phone — same response, nothing stored/sent ---
  await testAsync("Unknown phone -> SAME 200 shape + no code stored (dev-last 404)", async () => {
    const unknown = await requestReset(phones.unknown);
    assert(unknown.status === 200, "expected 200 sent:true (must NOT reveal account existence), got " + unknown.status);
    // Identical public shape to the known-phone request in TEST 1.
    assert(unknown.data.sent === true, "sent must be true");
    assert(unknown.data.purpose === "password_reset", "purpose shape differs");
    assert(unknown.data.expiresInSeconds === 120, "expiresInSeconds must match the known-phone response");

    const dev = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.unknown);
    assert(dev.status === 404, "no code must be sent/stored for the unknown phone, got " + dev.status);

    const verify = await verifyReset(phones.unknown, "000000");
    assert(verify.status === 400, "verify for unknown phone must fail uniformly, got " + verify.status);
  });

  // --- 3. Unknown phone cooldown — identical to known (dummy row closes the oracle) ---
  await testAsync("Unknown phone cooldown -> 429 with Retry-After (dummy row)", async () => {
    const first = await requestReset(phones.unknownCooldown);
    assert(first.status === 200, "first request expected 200, got " + first.status);
    const second = await requestReset(phones.unknownCooldown);
    assert(second.status === 429, "immediate re-request expected 429, got " + second.status);
    assert(second.retryAfter && Number(second.retryAfter) > 0, "Retry-After missing/invalid");
  });

  // --- 4. Known phone cooldown — identical behavior ---
  await testAsync("Known phone cooldown -> identical 429 with Retry-After", async () => {
    await registerUser(phones.knownCooldown, "reset-old-pass-123");
    const first = await requestReset(phones.knownCooldown);
    assert(first.status === 200, "first request expected 200, got " + first.status);
    const second = await requestReset(phones.knownCooldown);
    assert(second.status === 429, "immediate re-request expected 429, got " + second.status);
    assert(second.retryAfter && Number(second.retryAfter) > 0, "Retry-After missing/invalid");
  });

  // --- 5. dev-last + wrong code (uses the TEST 1 code — still unconsumed) ---
  await testAsync("Wrong code -> 400 + attempts recorded", async () => {
    const wrong = await verifyReset(phones.known, "999999");
    assert(wrong.status === 400, "wrong code expected 400, got " + wrong.status);
    assert(/صحیح نیست/.test(wrong.data.error || ""), "expected a Persian wrong-code error");
    const row = await db.collection("otpcodes").findOne({ phone: phones.known, consumedAt: null });
    assert(row && row.attempts >= 1, "attempts must be recorded");
  });

  // --- 6. Cross-purpose isolation (login ↔ reset) ---
  await testAsync("Login-purpose code canNOT verify a password reset", async () => {
    await registerUser(phones.crossLoginToReset, "reset-old-pass-123");
    const req = await requestOtp(phones.crossLoginToReset, "login");
    assert(req.status === 200, "login OTP request expected 200");
    const code = await readCode(phones.crossLoginToReset);
    const verify = await verifyReset(phones.crossLoginToReset, code);
    assert(verify.status === 400, "login code must not verify a reset, got " + verify.status + " " + JSON.stringify(verify.data).slice(0, 120));
  });

  await testAsync("Reset-purpose code canNOT be used to login", async () => {
    await registerUser(phones.crossResetToLogin, "reset-old-pass-123");
    const req = await requestReset(phones.crossResetToLogin);
    assert(req.status === 200, "reset request expected 200");
    const code = await readCode(phones.crossResetToLogin);
    const verify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.crossResetToLogin,
      code,
      purpose: "login",
    });
    assert(verify.status === 400, "reset code must not verify a login, got " + verify.status + " " + JSON.stringify(verify.data).slice(0, 120));
  });

  // --- 7. Correct code → resetToken (no loginToken) + hashed at rest ---
  await testAsync("Correct code -> 200 { resetToken } ONLY, hashed at rest", async () => {
    await registerUser(phones.replay, "reset-old-pass-123");
    const req = await requestReset(phones.replay);
    assert(req.status === 200, "request expected 200");
    const code = await readCode(phones.replay);
    const verify = await verifyReset(phones.replay, code);
    assert(verify.status === 200, "verify expected 200, got " + verify.status);
    assert(verify.data.resetToken && /^[0-9a-f]{64}$/.test(verify.data.resetToken), "resetToken missing/malformed");
    assert(!verify.data.loginToken, "verify must NEVER return a loginToken");

    const row = await db.collection("otpcodes").findOne({ phone: phones.replay, consumedAt: null });
    assert(row && row.resetTokenHash, "resetTokenHash must be stored");
    assert(row.resetTokenHash !== verify.data.resetToken, "plaintext must NOT be stored (only the hash)");
    assert(!row.loginTokenHash, "reset verify must not set loginTokenHash");
    assert(row.codeConsumedAt, "code must be consumed");
    assert(!row.consumedAt, "consumedAt reserved for the complete exchange");
  });

  // --- 8. Verify does not create a session ---
  await testAsync("Verify does NOT create a session (reset cannot authenticate)", async () => {
    await registerUser(phones.fullReset, "reset-old-pass-123");
    const req = await requestReset(phones.fullReset);
    assert(req.status === 200, "request expected 200");
    const code = await readCode(phones.fullReset);
    const verify = await verifyReset(phones.fullReset, code);
    assert(verify.status === 200, "verify expected 200");
    fullResetToken = verify.data.resetToken;
    const session = await http("GET", "/api/auth/session");
    assert(!session.data || !session.data.user, "verify must not create a session");
  });

  // --- 9. Full reset — old password dies, new works, tokenVersion bumped ---
  await testAsync("Full reset: old password fails, new password works, tokenVersion bumped", async () => {
    const before = await User.findOne({ phone: phones.fullReset });
    assert(before && before.tokenVersion === 0, "fresh user tokenVersion must be 0");

    // Uses the resetToken minted in TEST 8 (still valid, single-use).
    const res = await completeReset(phones.fullReset, fullResetToken, "reset-new-pass-456");
    assert(res.status === 200, "complete expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const after = await User.findOne({ phone: phones.fullReset });
    assert(after.tokenVersion === (before.tokenVersion + 1), "tokenVersion must be bumped, got " + after.tokenVersion);

    const oldLogin = await login(phones.fullReset, { password: "reset-old-pass-123" });
    assert(!oldLogin.session || !oldLogin.session.user, "OLD password must no longer work");
    const newLogin = await login(phones.fullReset, { password: "reset-new-pass-456" });
    assert(newLogin.session && newLogin.session.user, "NEW password must work");
    assert(newLogin.session.user.phone === phones.fullReset, "session phone mismatch");
  });

  // --- 10. Session revocation — a pre-reset session dies ---
  await testAsync("Pre-reset session is REVOKED (protected API -> 401)", async () => {
    const phone = uniquePhone();
    await registerUser(phone, "reset-old-pass-123");
    const { jar } = await login(phone, { password: "reset-old-pass-123" });
    const before = await fetch(BASE + "/api/profile", { headers: { Cookie: jar.header() } });
    assert(before.status === 200, "pre-reset session must be valid, got " + before.status);

    const rt = await doFullVerify(phone);
    const res = await completeReset(phone, rt, "reset-new-pass-456");
    assert(res.status === 200, "complete expected 200");

    const after = await fetch(BASE + "/api/profile", { headers: { Cookie: jar.header() } });
    assert(after.status === 401, "pre-reset session must be revoked (401), got " + after.status);
  });

  // --- 11. resetToken replay ---
  await testAsync("resetToken REPLAY -> second complete 400 (atomic single-use)", async () => {
    const req = await requestReset(phones.replay);
    assert(req.status === 200, "request expected 200");
    const code = await readCode(phones.replay);
    const verify = await verifyReset(phones.replay, code);
    assert(verify.status === 200, "verify expected 200");
    const rt = verify.data.resetToken;

    const first = await completeReset(phones.replay, rt, "replay-new-pass-1");
    assert(first.status === 200, "first complete expected 200, got " + first.status);
    const second = await completeReset(phones.replay, rt, "replay-new-pass-2");
    assert(second.status === 400, "replayed token must be rejected, got " + second.status);
  });

  // --- 12. Concurrent completes — exactly one winner ---
  await testAsync("CONCURRENT completes -> exactly one 200", async () => {
    await registerUser(phones.concurrent, "reset-old-pass-123");
    const rt = await doFullVerify(phones.concurrent);
    const [a, b] = await Promise.allSettled([
      completeReset(phones.concurrent, rt, "concurrent-new-1"),
      completeReset(phones.concurrent, rt, "concurrent-new-2"),
    ]);
    const results = [a, b].map((r) => (r.status === "fulfilled" ? r.value.status : "rejected"));
    assert(results.filter((s) => s === 200).length === 1, "exactly one complete must succeed, got " + JSON.stringify(results));
    assert(results.filter((s) => s === 400).length === 1, "the loser must get 400, got " + JSON.stringify(results));
  });

  // --- 13. IDOR — another account's token cannot reset you ---
  await testAsync("IDOR: attacker phone + victim's resetToken -> 400", async () => {
    await registerUser(phones.idorVictim, "reset-old-pass-123");
    await registerUser(phones.idorAttacker, "reset-old-pass-123");
    const rt = await doFullVerify(phones.idorVictim);
    const res = await completeReset(phones.idorAttacker, rt, "stolen-new-pass");
    assert(res.status === 400, "cross-phone token must be rejected, got " + res.status);
    const attacker = await User.findOne({ phone: phones.idorAttacker });
    const ok = await login(phones.idorAttacker, { password: "reset-old-pass-123" });
    assert(ok.session && ok.session.user, "attacker's password must be untouched");
    assert(attacker.tokenVersion === 0, "attacker's tokenVersion must be untouched");
  });

  // --- 14. Passwordless account sets its first password ---
  await testAsync("Passwordless (OTP-only) account establishes its FIRST password", async () => {
    // Direct DB insert mirrors an OTP-registered customer (passwordHash null).
    const doc = await User.create({
      name: "PR Passwordless " + PREFIX,
      phone: phones.passwordless,
      role: "customer",
      isActive: true,
      tokenVersion: 0,
      passwordHash: null,
    });
    createdUserIds.push(doc._id);

    const rt = await doFullVerify(phones.passwordless);
    const res = await completeReset(phones.passwordless, rt, "first-pass-789");
    assert(res.status === 200, "complete expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150));

    const loginRes = await login(phones.passwordless, { password: "first-pass-789" });
    assert(loginRes.session && loginRes.session.user, "newly-set password must work");
  });

  // --- 15. Expired OTP ---
  await testAsync("Expired OTP -> 400 «کد منقضی شده است»", async () => {
    await registerUser(phones.expiredOtp, "reset-old-pass-123");
    const req = await requestReset(phones.expiredOtp);
    assert(req.status === 200, "request expected 200");
    const code = await readCode(phones.expiredOtp);
    // Force expiry by rewinding the row (fixture-level; the TTL index needs
    // the real 2-minute lifetime in production).
    await db.collection("otpcodes").updateMany(
      { phone: phones.expiredOtp, codeConsumedAt: null },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const verify = await verifyReset(phones.expiredOtp, code);
    assert(verify.status === 400, "expired code expected 400, got " + verify.status);
    assert(/منقضی شده/.test(verify.data.error || ""), "expected the expiry message");
  });

  // --- 16. Expired resetToken ---
  await testAsync("Expired resetToken -> 400 uniform", async () => {
    await registerUser(phones.expiredToken, "reset-old-pass-123");
    const rt = await doFullVerify(phones.expiredToken);
    await db.collection("otpcodes").updateMany(
      { phone: phones.expiredToken, resetTokenHash: { $ne: null } },
      { $set: { resetTokenExpiresAt: new Date(Date.now() - 1000) } }
    );
    const res = await completeReset(phones.expiredToken, rt, "expired-new-pass");
    assert(res.status === 400, "expired token expected 400, got " + res.status);
    assert(/نامعتبر یا منقضی شده/.test(res.data.error || ""), "expected the uniform invalid/expired message");
  });

  // --- 17. Wrong-code lockout ---
  await testAsync("Wrong-code lockout after 5 attempts", async () => {
    await registerUser(phones.lockout, "reset-old-pass-123");
    const req = await requestReset(phones.lockout);
    assert(req.status === 200, "request expected 200");
    let locked = false;
    for (let i = 0; i < 5; i++) {
      const res = await verifyReset(phones.lockout, "000000");
      assert(res.status === 400, "wrong code expected 400, got " + res.status);
      if (/ناموفق بیش از حد مجاز بود/.test(res.data.error || "")) { locked = true; break; }
    }
    assert(locked, "attempt-lock must trigger within 5 wrong codes");
  });

  // --- 18. Password policy ---
  await testAsync("Short password -> 400 (same policy as register)", async () => {
    await registerUser(phones.shortPassword, "reset-old-pass-123");
    const rt = await doFullVerify(phones.shortPassword);
    const res = await completeReset(phones.shortPassword, rt, "12345");
    assert(res.status === 400, "5-char password expected 400, got " + res.status);
    assert(/۶/.test(res.data.error || ""), "expected the 6-char minimum message");
  });

  // --- 19. Rate limits ---
  await testAsync("Rate limits: verify / complete -> 429 (request cooldown covered in TESTS 3-4)", async () => {
    // verify — a fresh phone with a real code, then wrong-code attempts.
    await registerUser(phones.rateVerify, "reset-old-pass-123");
    const req = await requestReset(phones.rateVerify);
    assert(req.status === 200, "request expected 200");
    for (let i = 0; i < 6; i++) {
      const res = await verifyReset(phones.rateVerify, "000000");
      if (i < 5) assert(res.status === 400, "verify " + i + " expected 400, got " + res.status);
      else assert(res.status === 429, "6th verify expected 429, got " + res.status);
    }
    // complete — burn the dedicated reset-complete budget.
    await registerUser(phones.rateComplete, "reset-old-pass-123");
    for (let i = 0; i < 6; i++) {
      const res = await completeReset(phones.rateComplete, "deadbeef".repeat(8), "ratelimit-pass");
      if (i < 5) assert(res.status === 400, "complete " + i + " expected 400 (invalid token), got " + res.status);
      else assert(res.status === 429, "6th complete expected 429, got " + res.status);
    }
  });

  // --- 20. Outstanding login OTP invalidated by the reset ---
  await testAsync("A login OTP issued BEFORE the reset is invalidated by it", async () => {
    await registerUser(phones.outstanding, "reset-old-pass-123");
    // Issue a login-purpose code + verify it → pending loginToken (unspent).
    const loginReq = await requestOtp(phones.outstanding, "login");
    assert(loginReq.status === 200, "login OTP request expected 200");
    const loginCode = await readCode(phones.outstanding);
    const loginVerify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.outstanding,
      code: loginCode,
      purpose: "login",
    });
    assert(loginVerify.status === 200, "login verify expected 200");
    const pendingLoginToken = loginVerify.data.loginToken;

    // Now reset the password (full flow).
    const rt = await doFullVerify(phones.outstanding);
    const res = await completeReset(phones.outstanding, rt, "reset-new-pass-456");
    assert(res.status === 200, "complete expected 200");

    // The pending loginToken must be dead — exchanging it yields NO session.
    const exchange = await login(phones.outstanding, { loginToken: pendingLoginToken });
    assert(!exchange.session || !exchange.session.user, "pending loginToken must be invalidated by the reset");
  });

  // --- 21. Backward compatibility — login OTP still works ---
  await testAsync("Backward compat: login/register OTP flow unchanged", async () => {
    await registerUser(phones.backwardCompat, "reset-old-pass-123");
    const req = await requestOtp(phones.backwardCompat, "login");
    assert(req.status === 200, "login OTP request expected 200, got " + req.status);
    const code = await readCode(phones.backwardCompat);
    const verify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.backwardCompat,
      code,
      purpose: "login",
    });
    assert(verify.status === 200, "login verify expected 200, got " + verify.status);
    assert(verify.data.loginToken && !verify.data.resetToken, "login verify must return ONLY a loginToken");
    const { session } = await login(phones.backwardCompat, { loginToken: verify.data.loginToken });
    assert(session && session.user, "login OTP exchange must still create a session");
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  if (createdUserIds.length > 0) {
    await db.collection("users").deleteMany({ _id: { $in: createdUserIds } });
  }
  await db.collection("otpcodes").deleteMany({ phone: { $in: Object.values(phones) } });
  await db.collection("ratelimits").deleteMany({
    _id: { $regex: "^rl:(otp_request|otp_request_ip|otp_verify|password_reset_complete):" },
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
