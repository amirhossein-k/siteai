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
 *   9.  anti-enumeration: unknown phone → same 200 sent:true, nothing stored,
 *       verify fails uniformly
 *  10.  resend cooldown → 429 with Retry-After
 *  11.  OTP-created account cannot password-login (no hash); password user can
 *  12.  per-IP request cap → 429 (SMS-bombing guard)
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

function uniquePhone() {
  // Exactly 11 digits: 09 + 7 + 2 (Date.now() is always >= 7 digits).
  return "09" + String(Date.now()).slice(-7) + String((Math.random() * 90 + 10) | 0);
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
    unknown: uniquePhone(),
    // + up to 16 unique phones for the per-IP cap test
  };
  const createdUserIds = [];
  let registerToken = null;
  let passwordUserToken = null;

  // --- Idempotency sweep + setup ---
  await db.collection("otpcodes").deleteMany({ phone: { $in: Object.values(phones) } });

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

  await testAsync("Anti-enumeration: unknown phone -> 200 sent:true, nothing stored, verify 400", async () => {
    const req = await http("POST", "/api/auth/otp/request", {
      phone: phones.unknown,
      purpose: "login",
    });
    assert(req.status === 200, "expected 200 sent:true (must NOT reveal account existence), got " + req.status);
    assert(req.data.sent === true, "sent must be true");

    const dev = await http("GET", "/api/auth/otp/dev-last?phone=" + phones.unknown);
    assert(dev.status === 404, "no code must exist for the unknown phone, got " + dev.status);

    const verify = await http("POST", "/api/auth/otp/verify", {
      phone: phones.unknown,
      code: "000000",
      purpose: "login",
    });
    assert(verify.status === 400, "verify for unknown phone must fail uniformly, got " + verify.status);
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

  await testAsync("Per-IP request cap (15/15min) -> 429 (SMS-bombing guard)", async () => {
    let saw429 = false;
    let attempts = 0;
    while (attempts < 16) {
      attempts++;
      const res = await http("POST", "/api/auth/otp/request", {
        phone: uniquePhone(),
        purpose: "login",
      });
      if (res.status === 429) { saw429 = true; break; }
      assert(res.status === 200, "unexpected status " + res.status + " before the cap");
    }
    assert(saw429, "per-IP OTP cap never tripped within 16 requests");
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
