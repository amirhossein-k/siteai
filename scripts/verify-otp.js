/**
 * Session 62 — SMS/OTP Authentication Verification (real HTTP API)
 *
 * Validates the additive OTP login/registration flow end-to-end:
 *   1.  mock seam reachable (dev-last) — hard requirement, clear failure otherwise
 *   2.  OTP register request → 200 { sent: true }
 *   3.  dev-last returns the 6-digit code (SMS inbox equivalent)
 *   4.  wrong code → 400 + attempts recorded (code still usable)
 *   5.  correct code → 200 { loginToken } + customer account created
 *       (DB: role customer, NO passwordHash, tokenVersion 0)
 *   6.  loginToken exchange via the NextAuth credentials callback → session
 *   7.  replay of the SAME loginToken → no session (atomic consume)
 *   8.  OTP login for an existing PASSWORD user → works (backward compatible)
 *   9.  account-existence contract (both purposes):
 *         login + unknown phone → 404 { reason: "not_registered" } — the
 *         deliberate presence gate (no OtpCode row, no SMS; the login UI
 *         offers registration instead). register + existing phone → 409.
 *         password_reset + unknown phone → 200 { sent: true } PLUS a dummy
 *         row (closed oracle: nothing is ever delivered and verify() fails
 *         uniformly).  Limiter keys run BEFORE every lookup, so both oracles
 *         are capped at the same rate.
 *  10.  resend cooldown → 429 with Retry-After
 *  11.  OTP-created account cannot password-login (no hash); password user can
 *  12.  per-IP request cap (15/15min) → 429 (SMS-bombing guard): with a
 *       dedicated x-forwarded-for IP, 15 requests are admitted (counter == 15,
 *       15-min window), the 16th is 429 with Retry-After, and a DIFFERENT IP
 *       is unaffected (the cap is keyed per IP, never global)
 *  13.  CONCURRENT verify of the SAME valid code → the code is consumed and
 *       AT MOST ONE of the issued tokens can ever authenticate (real HTTP,
 *       real MongoDB — no mocks; pins the end-to-end single-session invariant:
 *       the row stores one loginTokenHash, authorize() claims it atomically)
 *  14.  wrong-code LOCKOUT boundary: exactly 5 wrong attempts lock the code
 *       (row consumed at the 5th), and the CORRECT code is still rejected
 *       afterwards — the per-phone verify budget is isolated first so the
 *       lockout — not the shared 429 limiter — is what rejects it
 *
 * REQUIRES: dev server on http://localhost:3000 started with SMS_MOCK=1
 * (the hermetic seam — src/lib/sms.ts + /api/auth/otp/dev-last). Without it
 * the suite exits 1 with a clear setup message instead of failing obscurely.
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
const PREFIX = "otp62_" + Date.now() + "_";

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

async function http(method, urlPath, body, extraHeaders) {
  const headers = {};
  let requestBody = body;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  // The OTP routes key their per-IP budget on x-forwarded-for / x-real-ip
  // (falling back to "unknown"), so tests that need an ISOLATED per-IP key
  // pass one explicitly here instead of sharing the suite-wide "unknown" key.
  Object.assign(headers, extraHeaders || {});
  const res = await fetch(BASE + urlPath, { method, headers, body: requestBody, redirect: "manual" });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return {
    status: res.status,
    data,
    retryAfter: res.headers.get("retry-after"),
    rateLimitRemaining: res.headers.get("x-ratelimit-remaining"),
  };
}

// Counter suffix instead of random: two calls within the same 10-second
// Date.now() window share the same 7-digit prefix, so a random 2-digit
// suffix could collide (~1/90 per pair) — the OTP register request then
// 409s with "phone already registered" (pre-existing flake, same pattern
// as verify-session-security).
let phoneCounter = 0;
function uniquePhone() {
  // Exactly 11 digits: 09 + 7 + 2 (Date.now() is always >= 7 digits).
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
  console.log("  SESSION 62 — SMS/OTP AUTHENTICATION (REAL HTTP API)");
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
  const User = mongoose.models.User_OTP62 || mongoose.model("User_OTP62", UserSchema);

  const phones = {
    register: uniquePhone(),
    passwordUser: uniquePhone(), // also reused by the resend-cooldown test
    unknown: uniquePhone(), // #9 rejected login presence gate
    resetUnknown: uniquePhone(), // #9 password_reset closed-oracle dummy row
    cap: uniquePhone(), // #12 registered account for the per-IP cap fixture
    concurrent: uniquePhone(), // #13 same-code concurrent verify
    lockout: uniquePhone(), // #14 wrong-code lockout boundary
    // + up to 16 unique phones for the per-IP cap test

  };
  const createdUserIds = [];
  let registerToken = null;
  let passwordUserToken = null;

  // --- Idempotency sweep + setup ---
  await db.collection("otpcodes").deleteMany({ phone: { $in: Object.values(phones) } });
  // Test-state budget isolation (the verify-password-reset convention): this
  // suite registers users and issues OTPs from ONE test IP, so re-running it
  // within the limiter windows would 429 on the shared per-IP fixtures keys.
  // These are FIXTURE keys in the shared dev DB — the production limiter is
  // untouched and its budgets are exercised by the dedicated cap tests.
  await db.collection("ratelimits").deleteMany({
    _id: { $regex: "^rl:(register|otp_request_ip):" },
  });

  await testAsync("Mock seam active: register OTP request -> 200 { sent: true }", async () => {
    // If SMS_MOCK=1 is NOT set on the dev server, sendOtp returns the
    // controlled SMS_NOT_CONFIGURED error and this request fails 503 — a
    // clear setup failure instead of an obscure mid-suite one.
    const res = await http("POST", "/api/auth/otp/request", {
      phone: phones.register,
      purpose: "register",
    });
    assert(res.status === 200, "expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 150) + " — the dev server must be started with SMS_MOCK=1 (see src/lib/sms.ts)");
    assert(res.data.sent === true, "sent must be true");
    assert(res.data.purpose === "register", "purpose echo wrong");
  });

  await testAsync("dev-last returns the 6-digit code (SMS inbox equivalent)", async () => {
    const res = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.register);
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(/^\d{6}$/.test(res.data.code), "code must be 6 digits: " + JSON.stringify(res.data));
  });

  await testAsync("Wrong code -> 400; correct code still accepted after", async () => {
    const wrong = await http("POST", "/api/auth/otp/verify", {
      phone: phones.register,
      code: "999999",
      purpose: "register",
      name: "Wrong Tester",
    });
    assert(wrong.status === 400, "wrong code expected 400, got " + wrong.status);
    assert(/صحیح نیست/.test(wrong.data.error || ""), "expected a Persian wrong-code error");
    // Attempt was recorded on the row
    const row = await db.collection("otpcodes").findOne({ phone: phones.register, consumedAt: null });
    assert(row && row.attempts === 1, "attempts must be 1, got " + (row && row.attempts));
  });

  await testAsync("Correct code -> 200 { loginToken } + customer created (no passwordHash)", async () => {
    const res = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.register);
    const code = res.data.code;
    const verify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.register,
      code,
      purpose: "register",
      name: "OTP Register " + PREFIX,
    });
    assert(verify.status === 200, "expected 200, got " + verify.status + " " + JSON.stringify(verify.data).slice(0, 150));
    assert(verify.data.loginToken && /^[0-9a-f]{64}$/.test(verify.data.loginToken), "loginToken missing/malformed");
    registerToken = verify.data.loginToken;

    const user = await User.findOne({ phone: phones.register });
    assert(!!user, "account not created");
    assert(user.role === "customer", "role must be customer");
    assert(!user.passwordHash, "OTP-created account must have NO passwordHash");
    assert(user.tokenVersion === 0, "tokenVersion must default to 0");
    createdUserIds.push(user._id);
  });

  await testAsync("loginToken exchange via NextAuth credentials -> session", async () => {
    const { session } = await login(phones.register, { loginToken: registerToken });
    assert(session && session.user, "no session after token exchange");
    assert(session.user.phone === phones.register, "session phone mismatch");
    assert(session.user.role === "customer", "role must be customer");
  });

  await testAsync("REPLAY of the same loginToken -> no session (atomic consume)", async () => {
    const { session } = await login(phones.register, { loginToken: registerToken });
    assert(!session || !session.user, "replayed token must NOT create a session");
  });

  await testAsync("OTP login for an existing PASSWORD user works (backward compatible)", async () => {
    const reg = await http("POST", "/api/register", {
      name: "OTP Password User " + PREFIX,
      phone: phones.passwordUser,
      password: "otp-password-123",
    });
    assert(reg.status === 201, "register failed " + reg.status);
    createdUserIds.push(reg.data.id);

    const req = await http("POST", "/api/auth/otp/request", {
      phone: phones.passwordUser,
      purpose: "login",
    });
    assert(req.status === 200, "login OTP request expected 200, got " + req.status);
    const codeRes = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.passwordUser);
    const verify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.passwordUser,
      code: codeRes.data.code,
      purpose: "login",
    });
    assert(verify.status === 200, "login OTP verify expected 200, got " + verify.status + " " + JSON.stringify(verify.data).slice(0, 150));
    passwordUserToken = verify.data.loginToken;

    const { session } = await login(phones.passwordUser, { loginToken: passwordUserToken });
    assert(session && session.user, "no session for password-user OTP login");
  });

  // --- #9 Account-existence contract ------------------------------------
  // The login purpose is a DELIBERATE presence gate (product decision,
  // documented in the route and pinned end-to-end by
  // tests/e2e/otp-login.spec.ts): an unknown phone gets 404
  // { reason: "not_registered" } so the login UI can offer registration
  // instead of waiting for an SMS that never arrives. No OtpCode row is
  // created, no code is issued, and verify() still fails uniformly. The
  // per-phone + per-IP limiters run BEFORE the lookup, so the oracle is
  // capped at exactly the same rate as the pre-existing register-purpose 409.
  //
  // The password_reset purpose CLOSES the oracle instead (Session 84
  // decision): an unknown phone receives the SAME 200 { sent: true } a known
  // one does, plus a dummy row whose hash was never delivered — so neither
  // the response nor the 60s resend cooldown reveals existence.
  await testAsync("Account-existence contract: login unknown -> 404 not_registered; register existing -> 409; password_reset unknown -> 200 + dummy row", async () => {
    // (a) login + unknown phone — the presence gate.
    const login = await http("POST", "/api/auth/otp/request", {
      phone: phones.unknown,
      purpose: "login",
    });
    assert(login.status === 404, "login for an unknown phone must be 404 not_registered, got " + login.status + " " + JSON.stringify(login.data).slice(0, 140));
    assert(login.data && login.data.reason === "not_registered", "reason must be not_registered, got " + JSON.stringify(login.data).slice(0, 140));
    assert(login.data.sent === undefined, "the gate must never report sent:true");
    const rows = await db.collection("otpcodes").countDocuments({ phone: phones.unknown });
    assert(rows === 0, "the rejected login phone must have NO OtpCode row, got " + rows);

    const dev = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.unknown);
    assert(dev.status === 404, "no code must exist for the rejected phone, got " + dev.status);

    const verify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.unknown,
      code: "000000",
      purpose: "login",
    });
    assert(verify.status === 400, "verify for an unknown phone must fail uniformly, got " + verify.status);
    assert(/صحیح نیست/.test(verify.data.error || ""), "expected the uniform rejection message, got " + JSON.stringify(verify.data));
    assert(!(verify.data && verify.data.loginToken), "an unknown phone must never mint a loginToken");

    // (b) register + EXISTING phone — the pre-existing 409 oracle, unchanged.
    const dup = await http("POST", "/api/auth/otp/request", {
      phone: phones.passwordUser,
      purpose: "register",
    });
    assert(dup.status === 409, "register for an existing phone must stay 409, got " + dup.status);

    // (c) password_reset + unknown phone — same 200 as a known number, plus
    // the dummy row that keeps the cooldown indistinguishable.
    const reset = await http("POST", "/api/auth/otp/request", {
      phone: phones.resetUnknown,
      purpose: "password_reset",
    });
    assert(reset.status === 200, "password_reset for an unknown phone must be 200 (closed oracle), got " + reset.status + " " + JSON.stringify(reset.data).slice(0, 140));
    assert(reset.data.sent === true, "sent must be true");
    const dummy = await db.collection("otpcodes").findOne({ phone: phones.resetUnknown, purpose: "password_reset" });
    assert(!!dummy, "the dummy row must exist so the 60s cooldown behaves identically");
    assert(!dummy.devPlaintextCode, "the dummy row must carry NO plaintext code");

    const resetDev = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.resetUnknown);
    assert(resetDev.status === 404, "no code was ever delivered — dev-last must 404, got " + resetDev.status);

    const resetVerify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.resetUnknown,
      code: "000000",
      purpose: "password_reset",
    });
    assert(resetVerify.status === 400, "verify against the dummy row must fail uniformly, got " + resetVerify.status);
    assert(
      !(resetVerify.data && (resetVerify.data.loginToken || resetVerify.data.resetToken)),
      "the dummy row must never mint a token, got " + JSON.stringify(resetVerify.data).slice(0, 140)
    );
  });

  await testAsync("Resend cooldown: immediate re-request -> 429 with Retry-After", async () => {
    // Must use an EXISTING user — unknown phones (anti-enumeration) get no code.
    const first = await http("POST", "/api/auth/otp/request", {
      phone: phones.passwordUser,
      purpose: "login",
    });
    assert(first.status === 200, "first request expected 200, got " + first.status);

    const second = await http("POST", "/api/auth/otp/request", {
      phone: phones.passwordUser,
      purpose: "login",
    });
    assert(second.status === 429, "immediate re-request expected 429, got " + second.status);
    assert(second.retryAfter && Number(second.retryAfter) > 0, "Retry-After header missing/invalid");
  });

  await testAsync("Password login compatibility: OTP user fails, password user succeeds", async () => {
    // OTP-created account has no hash → password login must fail (no session)
    const otpLogin = await login(phones.register, { password: "any-password" });
    assert(!otpLogin.session || !otpLogin.session.user, "OTP-created account must NOT password-login");
    // Password user still logs in with the password (the untouched branch)
    const pwLogin = await login(phones.passwordUser, { password: "otp-password-123" });
    assert(pwLogin.session && pwLogin.session.user, "password user must still login with password");
    assert(pwLogin.session.user.phone === phones.passwordUser, "session phone mismatch");
  });

  // --- #13 Concurrent verify of the SAME valid code ---------------------
  // Real HTTP against the real verify route + real MongoDB, no mocks.
  //
  // DISCOVERED CONTRACT (pinned by this test): the verify route consumes the
  // CODE via findOne + updateOne({ _id }) — last writer wins the row's single
  // loginTokenHash — so two racing verifies of one valid code can BOTH get
  // 200, each with its own loginToken (one hash overwrites the other). The
  // single-use guarantee therefore lives one layer up, and this test pins it
  // END-TO-END: (a) the code is consumed after the race (a third verify is
  // rejected), and (b) exactly ONE of the issued tokens can ever mint a
  // session — authorize() looks up the row by hash and claims it CONDITIONALLY
  // ATOMICALLY (updateOne({ _id, consumedAt: null }) + modifiedCount check),
  // so the overwritten token is dead on arrival and the surviving one is
  // single-use. Net: no code reuse, no second session, no auth bypass.
  await testAsync("CONCURRENT verify of the SAME valid code -> code consumed, at most ONE usable session", async () => {
    const reg = await http("POST", "/api/register", {
      name: "OTP Concurrent " + PREFIX,
      phone: phones.concurrent,
      password: "otp-concurrent-123",
    });
    assert(reg.status === 201, "register failed " + reg.status + " " + JSON.stringify(reg.data).slice(0, 150));
    createdUserIds.push(reg.data.id);

    const req = await http("POST", "/api/auth/otp/request", {
      phone: phones.concurrent,
      purpose: "login",
    });
    assert(req.status === 200, "OTP request expected 200, got " + req.status);
    const codeRes = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.concurrent);
    assert(codeRes.status === 200, "dev-last expected 200, got " + codeRes.status);
    const code = codeRes.data.code;

    const [a, b] = await Promise.allSettled([
      http("POST", "/api/auth/otp/verify", { phone: phones.concurrent, code, purpose: "login" }),
      http("POST", "/api/auth/otp/verify", { phone: phones.concurrent, code, purpose: "login" }),
    ]);
    const results = [a, b].map((r) => (r.status === "fulfilled" ? r.value.status : "rejected"));
    assert(
      results.every((s) => s === 200 || s === 400),
      "each racing verify must be 200 or 400, got " + JSON.stringify(results)
    );
    const tokens = [a, b]
      .filter((r) => r.status === "fulfilled" && r.value.status === 200)
      .map((r) => r.value.data && r.value.data.loginToken)
      .filter(Boolean);
    assert(tokens.length >= 1, "at least one verify must succeed, got " + JSON.stringify(results));

    // (a) The code is consumed either way — a THIRD verify must be rejected.
    const third = await http("POST", "/api/auth/otp/verify", {
      phone: phones.concurrent,
      code,
      purpose: "login",
    });
    assert(
      third.status === 400,
      "the code must be consumed after the race, got " + third.status + " " + JSON.stringify(third.data).slice(0, 120)
    );

    // (b) THE single-use invariant: exactly ONE of the issued tokens
    // authenticates (the overwritten hash is dead on arrival; the surviving
    // hash is claimed atomically and single-use).
    let sessions = 0;
    for (const t of tokens) {
      const { session } = await login(phones.concurrent, { loginToken: t });
      if (session && session.user) sessions++;
    }
    assert(
      sessions === 1,
      "exactly ONE of the racing tokens must authenticate, got " + sessions + " (tokens issued: " + tokens.length + ")"
    );
  });

  // --- #14 Wrong-code LOCKOUT boundary ----------------------------------
  // Exactly OTP_MAX_ATTEMPTS (5) well-formed wrong codes lock the row at the
  // 5th (codeConsumedAt set); the CORRECT code is then still rejected. The
  // per-phone verify budget is reset first (suite-wide test-state isolation
  // convention — the shared 429 limiter is exercised by its own tests) so
  // the LOCKOUT — not the rate limiter — is provably what rejects it.
  await testAsync("Wrong-code LOCKOUT boundary: 5 wrong attempts lock the code; the CORRECT code is then rejected", async () => {
    const reg = await http("POST", "/api/register", {
      name: "OTP Lockout " + PREFIX,
      phone: phones.lockout,
      password: "otp-lockout-123",
    });
    assert(reg.status === 201, "register failed " + reg.status + " " + JSON.stringify(reg.data).slice(0, 150));
    createdUserIds.push(reg.data.id);

    const req = await http("POST", "/api/auth/otp/request", {
      phone: phones.lockout,
      purpose: "login",
    });
    assert(req.status === 200, "OTP request expected 200, got " + req.status);
    const codeRes = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.lockout);
    assert(codeRes.status === 200, "dev-last expected 200, got " + codeRes.status);
    const code = codeRes.data.code;
    // Well-formed but wrong for this row (and never equal to the real code).
    const wrongCode = code === "000000" ? "111111" : "000000";

    let sawLock = false;
    for (let i = 1; i <= 5; i++) {
      const res = await http("POST", "/api/auth/otp/verify", {
        phone: phones.lockout,
        code: wrongCode,
        purpose: "login",
      });
      assert(res.status === 400, "wrong verify " + i + " expected 400, got " + res.status);
      if (/ناموفق بیش از حد مجاز بود/.test(res.data.error || "")) {
        sawLock = i === 5; // the lock must fire exactly at the 5th attempt
        break;
      }
    }
    assert(sawLock, "the 5th wrong attempt must return the lock message (4 earlier ones must not)");

    // Real row state: consumed by the lock, 5 attempts recorded.
    const row = await db.collection("otpcodes").findOne({ phone: phones.lockout });
    assert(row && row.codeConsumedAt, "the locked row must have codeConsumedAt set");
    assert(row.attempts === 5, "attempts must be 5 after the lock, got " + row.attempts);

    // Isolate THIS phone's verify budget so the shared limiter cannot mask
    // the lockout boundary with a 429 (fixture key only — production limiter
    // logic untouched; the budget itself is exercised by its own tests).
    await db.collection("ratelimits").deleteMany({ _id: "rl:otp_verify:" + phones.lockout });

    const correct = await http("POST", "/api/auth/otp/verify", {
      phone: phones.lockout,
      code,
      purpose: "login",
    });
    assert(
      correct.status === 400,
      "the CORRECT code must still be rejected after lockout, got " + correct.status + " " + JSON.stringify(correct.data).slice(0, 120)
    );
    assert(!(correct.data && correct.data.loginToken), "a locked OTP must never mint a loginToken");
    assert(/صحیح نیست/.test(correct.data.error || ""), "expected the uniform rejection message, got " + JSON.stringify(correct.data));
  });

  // --- #12 Per-IP request cap (OTP_REQUEST_IP_LIMIT = 15 / 15 min) --------
  // Requirements pinned here: the count (exactly 15 admitted, the 16th 429),
  // the window (the limiter doc's expiresAt), the header (Retry-After), the
  // KEY (an isolated x-forwarded-for IP — every other suite request shares the
  // "unknown" key, which is why the fixture must not use it), and the
  // per-IP-ness (a different IP is unaffected). Slots are consumed with a
  // REGISTERED account first (the login gate must not reject it) and then with
  // distinct phones in the register purpose — one phone per request, so the
  // separate 5/phone budget can never mask the per-IP boundary.
  await testAsync("Per-IP request cap (15/15min, isolated x-forwarded-for key) -> 16th is 429 + Retry-After; another IP unaffected", async () => {
    const testIp = "198.51.100." + (10 + (Date.now() % 80));
    const otherIp = "198.51.100." + (200 + (Date.now() % 40));
    const capPhones = [];

    // Slot 1 — a registered account must be served (not gated) from this IP.
    const reg = await http("POST", "/api/register", {
      name: "OTP Cap " + PREFIX,
      phone: phones.cap,
      password: "otp-cap-123",
    });
    assert(reg.status === 201, "cap fixture register failed " + reg.status + " " + JSON.stringify(reg.data).slice(0, 140));
    createdUserIds.push(reg.data.id);
    const first = await http("POST", "/api/auth/otp/request", { phone: phones.cap, purpose: "login" }, { "x-forwarded-for": testIp });
    assert(first.status === 200, "registered account from a fresh IP expected 200, got " + first.status + " " + JSON.stringify(first.data).slice(0, 140));

    // Slots 2..15 — 14 more requests from the SAME IP, each a different phone.
    for (let i = 2; i <= 15; i++) {
      const phone = uniquePhone();
      capPhones.push(phone);
      const res = await http("POST", "/api/auth/otp/request", { phone, purpose: "register" }, { "x-forwarded-for": testIp });
      assert(res.status === 200, "request " + i + "/15 from one IP expected 200, got " + res.status + " " + JSON.stringify(res.data).slice(0, 140));
    }

    // Count + window, read straight from the limiter document.
    const rlDoc = await db.collection("ratelimits").findOne({ _id: "rl:otp_request_ip:" + testIp });
    assert(!!rlDoc, "the per-IP limiter doc must exist for the dedicated test IP");
    assert(rlDoc.count === 15, "the per-IP counter must be exactly 15 after 15 admitted requests, got " + rlDoc.count);
    const windowLeftMs = new Date(rlDoc.expiresAt).getTime() - Date.now();
    assert(
      windowLeftMs > 13 * 60 * 1000 && windowLeftMs <= 15 * 60 * 1000,
      "the window must be the 15-minute config, got " + Math.round(windowLeftMs / 1000) + "s left"
    );

    // Slot 16 — the cap trips, with Retry-After inside the window.
    const phone16 = uniquePhone();
    capPhones.push(phone16);
    const capped = await http("POST", "/api/auth/otp/request", { phone: phone16, purpose: "register" }, { "x-forwarded-for": testIp });
    assert(capped.status === 429, "the 16th request from one IP must be 429, got " + capped.status + " " + JSON.stringify(capped.data).slice(0, 140));
    assert(
      capped.retryAfter && Number(capped.retryAfter) > 0 && Number(capped.retryAfter) <= 900,
      "Retry-After must be present and inside the 15-minute window, got " + capped.retryAfter
    );
    const afterCap = await db.collection("ratelimits").findOne({ _id: "rl:otp_request_ip:" + testIp });
    assert(afterCap.count === 16, "the capped request must still be recorded, got " + afterCap.count);

    // The cap is keyed PER IP: the same kind of request from another IP passes.
    const otherPhone = uniquePhone();
    capPhones.push(otherPhone);
    const other = await http("POST", "/api/auth/otp/request", { phone: otherPhone, purpose: "register" }, { "x-forwarded-for": otherIp });
    assert(other.status === 200, "a different IP must not inherit the cap, got " + other.status + " " + JSON.stringify(other.data).slice(0, 140));

    // Fixture cleanup (the production limiter config is untouched).
    await db.collection("otpcodes").deleteMany({ phone: { $in: capPhones } });
    await db.collection("ratelimits").deleteMany({ _id: { $regex: "^rl:otp_request(_ip)?:" } });
  });

  // --- Cleanup fixtures ---
  console.log("\nCleaning up test data...");
  if (createdUserIds.length > 0) {
    await db.collection("users").deleteMany({ _id: { $in: createdUserIds } });
  }
  await db.collection("otpcodes").deleteMany({ phone: { $in: Object.values(phones) } });
  await db.collection("ratelimits").deleteMany({
    _id: { $regex: "^rl:(otp_request|otp_request_ip|otp_verify):" },
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
