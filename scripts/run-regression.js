/**
 * Session 44 — full sequential regression runner.
 * Runs every verify-*.js suite one at a time (shared-DB discipline) and
 * reports a PASS/SKIP/FAIL status per suite. Exits 1 on any suite failure,
 * 2 if any suite is skipped (missing script), 0 otherwise.
 *
 * verify-db-reconnect (post-Session 44 bugfix guard) is the FIRST suite and
 * is hermetic — needs no dev server and no MongoDB. When the dev server is
 * down, it still runs; the HTTP suites then SKIP and the run exits 1 with a
 * clear note instead of aborting before any suite executes.
 *
 * HERMETICITY (Session 52 regression fix): the shared login rate-limiter keys
 * (`login:<phone>` max 10/15min and `login_ip:<ip>` max 30/15min in the shared
 * `ratelimits` collection) accumulate across suites — every suite performs
 * real NextAuth logins against the same localhost IP, so after ~30 cumulative
 * logins in a 15-minute window the `login_ip` limiter rejects all later
 * logins (401s) even though each suite passes standalone. Before EACH suite we
 * therefore clear those shared login keys so every suite starts with the same
 * clean rate-limit state it has when run standalone. This ONLY resets test
 * state between isolated runs — the production limiter logic is untouched.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const scriptsDir = path.resolve(__dirname);
const suites = [
  "verify-db-reconnect", // hermetic — runs first, needs no server/DB
  "verify-notifications",
  "verify-sse",
  "verify-supplier-replies",
  "verify-wishlist-cart",
  "verify-reviews",
  "verify-wishlist",
  "verify-refund",
  "verify-order-cancel",
  "verify-payment-retry",
  "verify-variant-polish",
  "verify-facets",
  "verify-attribute-facets",
  "verify-search",
  "verify-search-suggest",
  "verify-pagination",
  "verify-variants",
  "verify-upload-repro",
  "verify-variants-e2e",
  "verify-upload-formats",
  "verify-concurrency",
  "verify-coupons",
  "verify-payouts",
  "verify-analytics",
  "verify-suppliers",
  "verify-variant-wishlist",
  "verify-product-import-export", // Session 51 (before coupons-marketing: creates users/suppliers/products, cleans its own PREFIX'd rows)
  "verify-coupons-marketing",
  "verify-coupon-eligibility", // Session 55 — private/targeted coupons (audience), runs AFTER coupons-marketing (shared-collection wipes)
  "verify-best-sellers", // Session 56 — Product.soldCount ranking, leak scans, refund reversal, CMS block (cleans its own PREFIX'd rows)
  "verify-order-management", // Session 57 — order lifecycle state machine, claim-based transitions, shipping metadata, actor audit, list sort (cleans its own PREFIX'd rows)
  "verify-homepage-cms", // Session 53 — admin CRUD + public composition + visibility rules
  "verify-otp", // Session 62 — SMS OTP auth (REQUIRES the dev server started with SMS_MOCK=1; hermetic otherwise — fails with a clear setup message)
  "verify-telegram-alerts",
];

// Same env-loading convention as the verify suites (no dotenv dependency):
// parse .env.local into process.env if present.
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

// Clear the shared login rate-limit keys (same dbName the server uses via
// src/lib/dbConnect.js). Fail-safe: if the DB is unreachable we only warn —
// the HTTP suites report their own connectivity errors and the hermetic
// verify-db-reconnect suite remains runnable when the server is down.
async function clearLoginRateLimits() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: "marlooai" });
    // Session 52 keys + Session 62 OTP keys (verify-otp burns the per-IP OTP
    // budget inside its own suite, so later suites must start clean).
    const res = await mongoose.connection.db
      .collection("ratelimits")
      .deleteMany({
        _id: { $regex: "^rl:(login|login_ip|otp_request|otp_request_ip|otp_verify):" },
      });
    console.log(`  [clean] login/OTP rate-limit state cleared (${res.deletedCount} docs)`);
    await mongoose.disconnect();
  } catch (err) {
    console.warn(`  [clean] WARNING: could not clear login rate-limit state — ${err.message}`);
    try { await mongoose.disconnect(); } catch {}
  }
}

// Pre-flight: the dev server must be up for the HTTP verify suites.
// Uses Node's global fetch (same as the verify suites) — no curl dependency.
async function serverUp() {
  try {
    const res = await fetch("http://localhost:3000/api/auth/csrf", {
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

serverUp().then((up) => {
  if (up) {
    console.log("Dev server reachable — running " + suites.length + " suites sequentially.\n");
  } else {
    console.warn("WARNING: dev server not reachable at http://localhost:3000 — the hermetic");
    console.warn("verify-db-reconnect suite will still run; all HTTP suites will be skipped.\n");
  }
  runAll(up);
});

async function runAll(serverUp) {

const results = [];
for (const name of suites) {
  const script = path.join(scriptsDir, name + ".js");
  if (!fs.existsSync(script)) {
    console.log(`=== ${name} ===\n  SKIP (missing script)`);
    results.push({ name, ok: false, skipped: true });
    continue;
  }
  if (!serverUp && name !== "verify-db-reconnect") {
    console.log(`=== ${name} ===\n  SKIP (dev server not reachable — HTTP suite)`);
    results.push({ name, ok: false, skipped: true });
    continue;
  }
  // Hermeticity: reset shared login rate-limit state before each suite so a
  // suite never inherits accumulated login counters from earlier suites.
  await clearLoginRateLimits();
  process.stdout.write(`=== ${name} ===\n`);
  try {
    const out = execSync(`node scripts/${name}.js`, {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600000,
    }).toString();
    // Summarize the tail: last 6 lines (results block)
    const lines = out.trim().split("\n");
    const tail = lines.slice(-6).join(" | ");
    console.log(`  PASS (${name})\n  tail: ${tail}\n`);
    results.push({ name, ok: true });
  } catch (err) {
    const out = (err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "");
    const lines = out.trim().split("\n");
    const tail = lines.slice(-15).join("\n  ");
    console.log(`  FAIL (${name})\n  tail:\n  ${tail}\n`);
    results.push({ name, ok: false });
  }
}

console.log("==================================================================");
console.log("  REGRESSION RESULTS");
console.log("==================================================================");
for (const r of results) {
  const tag = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
  console.log(`  ${tag}  ${r.name}`);
}
const skipped = results.filter((r) => r.skipped);
const failed = results.filter((r) => !r.ok && !r.skipped);
console.log(`\n  Total: ${results.length}  Passed: ${results.length - failed.length - skipped.length}  Failed: ${failed.length}  Skipped: ${skipped.length}`);
console.log("==================================================================");
if (failed.length > 0) process.exit(1);
if (!serverUp && skipped.length > 0) {
  console.log("Dev server was not reachable — only the hermetic suite ran; full regression incomplete (exit 1).");
  process.exit(1);
}
if (skipped.length > 0) process.exit(2);
}

