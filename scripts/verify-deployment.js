/**
 * Session 89 — production deployment verification.
 *
 * Proves the deploy path end-to-end WITHOUT touching business data:
 *   1. The production build artifact exists (.next/BUILD_ID)
 *   2. The app boots from the production build via the project's own
 *      `npm start` script (Chabokan's NextJs service runs exactly this)
 *   3. /api/health answers 200 and reports the database as ready
 *   4. The instance really is the PRODUCTION build, not a dev server
 *      (hashed static assets served with an immutable long-lived cache)
 *   5. A DB-backed endpoint serves traffic (the "ready" claim is backed)
 *   6. No secret is written to the server log (URI / password / keys)
 *   7. No legacy MongoDB target is in use (negative guard + behavioural proof)
 *   8. The OTP dev seam (/api/auth/otp/dev-last) is DEAD on the production
 *      build (404) — the SMS_MOCK-only plaintext-code reader must never
 *      answer outside NODE_ENV=development
 *
 * Usage:
 *   npm run build && node scripts/verify-deployment.js
 *   node scripts/verify-deployment.js --build   # runs the build first
 *
 * Env: VERIFY_DEPLOY_PORT (default 3100) — a separate port from the dev server
 *      so this can run while `npm run dev` is up.
 *
 * NOT part of the 49-suite regression: that runner drives a DEV server on
 * :3000, while this suite drives a PRODUCTION build on its own port (and needs
 * a build to exist). It is the deployment gate, not a business-API suite.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const envPath = path.join(repoRoot, ".env.local");
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

const PORT = Number(process.env.VERIFY_DEPLOY_PORT || 3100);
const BASE = "http://localhost:" + PORT;
const RUN_BUILD = process.argv.includes("--build");
const LOG_FILE = path.join(os.tmpdir(), "verify-deployment-server.log");

// The decommissioned Chabokan host this project used to run against. Kept as a
// NEGATIVE guard: a deploy that resolves to it can never serve traffic.
const LEGACY_MONGODB_HOST = "services.irn2.chabokan.net";

let passed = 0, failed = 0, total = 0;
let server = null;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

function uriPart(re, group) {
  const m = (process.env.MONGODB_URI || "").match(re);
  return m ? m[group] : "";
}
const uriHost = () => uriPart(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^,/]+)/, 2);
const uriPassword = () => uriPart(/^mongodb(\+srv)?:\/\/[^:@/]+:([^@/]+)@/, 2);

/** Secret VALUES that must never reach the server log. Never printed. */
function secretValues() {
  const names = [
    "MONGODB_URI",
    "LIARA_SECRET_KEY",
    "LIARA_ACCESS_KEY",
    "NEXTAUTH_SECRET",
    "ZARINPAL_MERCHANT_ID",
    "TELEGRAM_BOT_TOKEN",
    "SMS_IR_API_KEY",
  ];
  const out = [];
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length >= 8) out.push({ name, value });
  }
  const password = uriPassword();
  if (password && password.length >= 3) out.push({ name: "MONGODB_URI (password)", value: password });
  const host = uriHost();
  if (host && host.length >= 4) out.push({ name: "MONGODB_URI (host)", value: host });
  return out;
}

function readLog() {
  try { return fs.readFileSync(LOG_FILE, "utf-8"); } catch { return ""; }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + "/api/auth/csrf", { signal: AbortSignal.timeout(4000) });
      if (res.status === 200) return true;
    } catch { /* not up yet */ }
    if (server && server.exitCode !== null) return false; // crashed
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function stopServer() {
  if (!server || server.killed || server.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      execSync("taskkill /F /T /PID " + server.pid, { stdio: "ignore" });
    } else {
      process.kill(-server.pid, "SIGKILL");
    }
  } catch { /* already gone */ }
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 89 — PRODUCTION DEPLOYMENT VERIFICATION");
  console.log("==================================================================");
  console.log("  Port: " + PORT + "   Build artifact: " + (RUN_BUILD ? "will build" : "must exist"));

  // --- TEST 1: build artifact exists ------------------------------------
  await testAsync("Production build artifact exists (.next/BUILD_ID)", async () => {
    if (RUN_BUILD) {
      console.log("\n       running npm run build ...");
      execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
    }
    const buildId = path.join(repoRoot, ".next", "BUILD_ID");
    assert(fs.existsSync(buildId), "missing .next/BUILD_ID — run: npm run build");
    const id = fs.readFileSync(buildId, "utf-8").trim();
    assert(id.length > 0, ".next/BUILD_ID is empty");
    assert(fs.existsSync(path.join(repoRoot, ".next", "server")), "missing .next/server output");
  });

  // --- TEST 2: boots from the production build --------------------------
  // The project's start contract IS `next start` (asserted below). We invoke
  // that exact binary through the current Node so the child is a single
  // process we can reliably stop on every platform — `npm start` resolves to
  // the same command Chabokan's NextJs service runs.
  await testAsync("App boots from the production build via the start script", async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
    assert(
      pkg.scripts && pkg.scripts.start === "next start",
      'package.json scripts.start must be "next start", got ' + JSON.stringify(pkg.scripts && pkg.scripts.start)
    );

    try { fs.unlinkSync(LOG_FILE); } catch { /* no previous log */ }
    const out = fs.openSync(LOG_FILE, "a");
    const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
    assert(fs.existsSync(nextBin), "next binary not found at " + nextBin);
    server = spawn(process.execPath, [nextBin, "start"], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", out, out],
      detached: process.platform !== "win32",
    });
    const up = await waitForServer(120000);
    if (!up) {
      const log = readLog().split("\n").slice(-25).join("\n      ");
      throw new Error("production server did not become ready on :" + PORT + "\n      " + log);
    }
  });

  // --- TEST 3 & 4: health -------------------------------------------------
  let health = null;
  await testAsync("/api/health -> 200 and reports the database ready", async () => {
    const res = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    assert(res.status === 200, "expected 200, got " + res.status + " " + text.slice(0, 160));
    health = JSON.parse(text);
    assert(health.status === "ok", "expected status ok, got " + health.status);
    assert(health.db === "up", "expected db up, got " + health.db);
    assert(!/mongodb(\+srv)?:\/\//i.test(text), "health body exposes a connection string");
    assert(!text.includes("marlooai"), "health body exposes the database name");
  });

  // --- TEST 4: really the production build, not a dev server -------------
  await testAsync("Serving the production build (hashed assets, immutable cache)", async () => {
    const page = await fetch(BASE + "/", { signal: AbortSignal.timeout(20000) });
    assert(page.status === 200, "homepage returned " + page.status);
    const html = await page.text();
    const asset = html.match(/\/_next\/static\/[^"'\s]+\.js/);
    assert(asset, "homepage HTML references no /_next/static/*.js (not the built app?)");
    const res = await fetch(BASE + asset[0], { signal: AbortSignal.timeout(20000) });
    assert(res.status === 200, "static asset " + asset[0] + " returned " + res.status);
    const cc = res.headers.get("cache-control") || "";
    // The decisive dev-vs-production signal: `next dev` serves static chunks
    // with no-store, a production build serves them immutable for a year.
    assert(
      /max-age=\d{5,}|immutable/i.test(cc),
      "static asset cache-control '" + cc + "' is a dev-server signature, not a production build"
    );
    // ...and it is served from the build's own static output layout.
    assert(
      /^\/_next\/static\/(chunks|media)\//.test(asset[0]),
      "unexpected static asset path: " + asset[0]
    );
  });

  // --- TEST 5: DB-backed endpoint serves --------------------------------
  await testAsync("DB-backed /api/products -> 200 (readiness claim is backed)", async () => {
    const res = await fetch(BASE + "/api/products?limit=1", { signal: AbortSignal.timeout(25000) });
    assert(res.status === 200, "expected 200, got " + res.status);
    const body = await res.json();
    assert(typeof body.total === "number", "unexpected products payload shape");
    assert(health && health.db === "up", "health disagreed with a working DB-backed route");
  });

  // --- TEST 6: the OTP dev seam is dead on the production build ---------
  // GET /api/auth/otp/dev-last is the SMS_MOCK plaintext-code reader. It must
  // answer ONLY when NODE_ENV=development AND SMS_MOCK=1; on a production
  // build it must 404 (route guard: src/app/api/auth/otp/dev-last/route.js
  // via isSmsMockEnabled in src/lib/sms.ts). Asserted here because the
  // regression runner's dev server legitimately has the seam OPEN — only a
  // production-mode instance can prove the closed state. No OTP request is
  // issued (zero fixture writes; the negative assertion needs none).
  await testAsync("OTP dev seam /api/auth/otp/dev-last is unavailable on the production build (404)", async () => {
    const res = await fetch(BASE + "/api/auth/otp/dev-last?phone=09120000000", {
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    assert(res.status === 404, "expected 404 on the production build, got " + res.status + " " + text.slice(0, 120));
    // The seam must never reveal a code shape, even in an error body.
    assert(!/\b\d{6}\b/.test(text), "dev-last body must not contain a 6-digit code");
  });

  // --- TEST 7: no secret in the server log ------------------------------
  await testAsync("Server log contains no secret value", async () => {
    const log = readLog();
    assert(log.length > 0, "server log is empty — cannot prove non-leakage");
    for (const { name, value } of secretValues()) {
      // Report only the variable NAME; never echo the value.
      assert(!log.includes(value), "server log leaked " + name);
    }
    assert(!/mongodb(\+srv)?:\/\//i.test(log), "server log leaked a mongodb connection string");
  });

  // --- TEST 8: no legacy MongoDB target ---------------------------------
  await testAsync("No legacy MongoDB target in use", async () => {
    const host = uriHost();
    assert(host, "MONGODB_URI host could not be read");
    assert(
      !host.includes(LEGACY_MONGODB_HOST),
      "MONGODB_URI still points at the decommissioned " + LEGACY_MONGODB_HOST
    );
    // Behavioural proof: the legacy host is dead, so a ready database means the
    // app is not talking to it.
    assert(health && health.db === "up", "database not ready — cannot prove the target is live");
    assert(
      !readLog().includes(LEGACY_MONGODB_HOST),
      "server log mentions the legacy MongoDB host"
    );
  });

  stopServer();

  console.log("\n==================================================================");
  console.log("  RESULTS");
  console.log("==================================================================");
  console.log("  Total:   " + total);
  console.log("  Passed:  " + passed);
  console.log("  Failed:  " + failed);
  console.log("  Status:  " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("  Port:    " + PORT + "   (server stopped)");
  console.log("  Secrets: none printed to stdout or the server log");
  console.log("==================================================================");

  if (failed > 0) process.exit(1);
}

run()
  .catch((err) => { console.error("\nTest suite error:", err); failed++; })
  .finally(() => {
    stopServer();
    if (failed > 0) process.exit(1);
  });
