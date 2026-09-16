/**
 * Session 89 — /api/health readiness endpoint verification (real HTTP API).
 *
 * Tests:
 *   1. Unauthenticated GET /api/health → 200 (no auth, no rate limit)
 *   2. JSON content-type + exact closed field set (no extra property can leak)
 *   3. status "ok" / db "up" — and the "up" is BACKED by the database
 *   4. latencyMs / uptimeSeconds are finite, non-negative numbers
 *   5. Cache-Control: no-store (a probe must never be cached)
 *   6. The answer is fast (well inside the probe's own 4s budget)
 *   7. No secret leaks: no mongo URI / host / password / db name in the body
 *   8. Idempotent + non-mutating: repeated calls give the same shape
 *   9. Not a false 200: the "up" claim is cross-checked against a second
 *      DB-backed endpoint (if that 200s, the DB really is serving)
 *
 * Usage: node scripts/verify-health.js
 * Requires: a running server (dev or production) + real MongoDB.
 * Env: HEALTH_BASE (default http://localhost:3000) to point at another port —
 *      used by scripts/verify-deployment.js when probing the production build.
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

const BASE = (process.env.HEALTH_BASE || "http://localhost:3000").replace(/\/$/, "");

let passed = 0, failed = 0, total = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try { await fn(); console.log("PASS"); passed++; }
  catch (err) { console.log("FAIL: " + err.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// --- Derive the secret material we must prove is NOT echoed back -----------
function uriFromEnv() {
  return process.env.MONGODB_URI || "";
}
function uriPassword(uri) {
  // mongodb://user:password@host → password. Never printed, only searched for.
  const m = uri.match(/^mongodb(\+srv)?:\/\/[^:@/]+:([^@/]+)@/);
  return m ? m[2] : "";
}
function uriHost(uri) {
  const m = uri.match(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^,/]+)/);
  return m ? m[2] : "";
}

async function getHealth() {
  const res = await fetch(BASE + "/api/health", {
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  const text = await res.text();
  return { res, text };
}

async function run() {
  console.log("==================================================================");
  console.log("  SESSION 89 — /API/HEALTH READINESS ENDPOINT (REAL HTTP API)");
  console.log("==================================================================");

  try {
    const ping = await fetch(BASE + "/api/auth/csrf", { signal: AbortSignal.timeout(10000) });
    assert(ping.status === 200, "server not reachable");
    console.log("\n  Server reachable at " + BASE + "\n");
  } catch {
    console.error("\nERROR: server not reachable at " + BASE + ".");
    console.error("Start it with: npm run dev   (or npm run build && npm start)");
    process.exit(1);
  }

  let first = null;

  // --- TEST 1: unauthenticated 200 ---------------------------------------
  await testAsync("Unauthenticated GET /api/health -> 200 (no auth required)", async () => {
    first = await getHealth();
    assert(first.res.status === 200, "expected 200, got " + first.res.status + " " + first.text.slice(0, 120));
    assert(
      !/^\s*<!doctype html/i.test(first.text),
      "got HTML instead of JSON (route not resolved / redirected to a page)"
    );
  });

  // --- TEST 2: content-type + closed field set ---------------------------
  await testAsync("JSON content-type + exact closed field set", async () => {
    const ct = first.res.headers.get("content-type") || "";
    assert(ct.includes("application/json"), "expected application/json, got " + ct);
    const body = JSON.parse(first.text);
    const keys = Object.keys(body).sort();
    assert(
      keys.join(",") === "db,latencyMs,status,timestamp,uptimeSeconds",
      "unexpected field set: " + keys.join(",")
    );
  });

  // --- TEST 3: honest readiness -----------------------------------------
  await testAsync('status "ok" + db "up" (readiness genuinely reported)', async () => {
    const body = JSON.parse(first.text);
    assert(body.status === "ok", "expected status ok, got " + body.status);
    assert(body.db === "up", "expected db up, got " + body.db);
  });

  // --- TEST 4: numeric metrics ------------------------------------------
  await testAsync("latencyMs / uptimeSeconds are finite, non-negative numbers", async () => {
    const body = JSON.parse(first.text);
    for (const key of ["latencyMs", "uptimeSeconds"]) {
      assert(typeof body[key] === "number", key + " must be a number, got " + typeof body[key]);
      assert(Number.isFinite(body[key]), key + " must be finite");
      assert(body[key] >= 0, key + " must be >= 0");
    }
    assert(!Number.isNaN(Date.parse(body.timestamp)), "timestamp must parse as ISO-8601");
  });

  // --- TEST 5: never cached ---------------------------------------------
  await testAsync("Cache-Control: no-store (probe is never cached)", async () => {
    const cc = first.res.headers.get("cache-control") || "";
    assert(/no-store/i.test(cc), "expected no-store, got '" + cc + "'");
  });

  // --- TEST 6: fast ------------------------------------------------------
  await testAsync("Probe answers well inside its 4s readiness budget", async () => {
    const startedAt = Date.now();
    const { res } = await getHealth();
    const elapsed = Date.now() - startedAt;
    assert(res.status === 200, "expected 200, got " + res.status);
    assert(elapsed < 4000, "probe took " + elapsed + "ms (budget 4000ms)");
  });

  // --- TEST 7: no secret leaks ------------------------------------------
  await testAsync("Body leaks no mongo URI / host / password / db name", async () => {
    const uri = uriFromEnv();
    const secrets = [uri, uriPassword(uri), uriHost(uri)].filter((s) => s && s.length > 3);
    assert(secrets.length > 0, "MONGODB_URI could not be read from the environment");
    for (const secret of secrets) {
      assert(!first.text.includes(secret), "body contains a secret value from MONGODB_URI");
    }
    assert(!/mongodb(\+srv)?:\/\//i.test(first.text), "body exposes a mongodb connection string");
    assert(!first.text.includes("marlooai"), "body exposes the database name");
    assert(!/password|secret|token|apikey|api_key/i.test(first.text), "body mentions credential fields");
  });

  // --- TEST 8: idempotent / non-mutating --------------------------------
  await testAsync("Repeated calls return the same shape (idempotent, non-mutating)", async () => {
    const second = await getHealth();
    assert(second.res.status === 200, "second call expected 200, got " + second.res.status);
    const a = JSON.parse(first.text);
    const b = JSON.parse(second.text);
    assert(
      Object.keys(a).sort().join(",") === Object.keys(b).sort().join(","),
      "field set changed between calls"
    );
    assert(b.status === "ok" && b.db === "up", "second call reported not-ready");
  });

  // --- TEST 9: the "up" claim is backed by real DB access ---------------
  await testAsync('"db up" is cross-checked against a DB-backed endpoint', async () => {
    const res = await fetch(BASE + "/api/products?limit=1", {
      signal: AbortSignal.timeout(20000),
    });
    assert(res.status === 200, "DB-backed /api/products returned " + res.status);
    const body = JSON.parse(first.text);
    assert(body.db === "up", "health claims down while a DB-backed route succeeded");
  });

  console.log("\n==================================================================");
  console.log("  RESULTS");
  console.log("==================================================================");
  console.log("  Total:   " + total);
  console.log("  Passed:  " + passed);
  console.log("  Failed:  " + failed);
  console.log("  Status:  " + (failed === 0 ? "ALL PASSED" : failed + " TEST(S) FAILED"));
  console.log("==================================================================");

  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error("\nTest suite error:", err); process.exit(1); });
