/**
 * Post-Session 44 Bugfix — dbConnect Retry & unread-count Fail-Silent
 *
 * Self-contained regression suite. NO dev server and NO MongoDB required —
 * it loads the REAL `src/lib/dbConnect.js` and the REAL
 * `src/app/api/notifications/unread-count/route.ts`, transpiles each to
 * CommonJS with the project's TypeScript compiler (the exact pattern used by
 * verify-wishlist-cart.js for the zustand cart store), and stubs only their
 * dependencies (mongoose, next/server, auth-utils, the Notification model,
 * the `@/models/*` side-effect imports). This makes the DB-outage scenarios
 * deterministic and provable, which live HTTP suites cannot do without
 * actually taking MongoDB down.
 *
 * Tests:
 *   dbConnect retry (poisoned-promise regression):
 *     1. First dbConnect() against a rejecting mongoose.connect() rejects
 *        AND `global.mongoose.promise` is reset to null (the fix).
 *     2. Second dbConnect() RETRIES — mongoose.connect() is called again —
 *        and succeeds once the DB is "back" (regression: old code reused the
 *        cached rejected promise and failed in 0 ms until a server restart).
 *     3. Happy path — fresh module, first connect succeeds (no regression).
 *     4. DISCRIMINATOR — a copy of dbConnect.js with the fix removed CANNOT
 *        recover (proves test 2 actually catches a revert).
 *   unread-count graceful fallback:
 *     5. DB down + authed  -> 200 { count: 0 }  (the fix — badge fails silent)
 *     6. DB up   + authed  -> 200 { count: 5 }  (happy path preserved)
 *     7. DB down + unauth  -> 401 (authz still enforced; fallback never masks 401)
 *     8. DB up   + unauth  -> 401
 *     9. DISCRIMINATOR — a copy of the route reverted to `serverError()`
 *        returns 500 (proves test 5 actually catches a revert)
 *
 * Usage: node scripts/verify-db-reconnect.js
 * Requires: nothing external. Exit 0 = all pass, 1 = failure.
 * NOTE: live unread-count coverage (unauth 401, real auth, real counts)
 * already exists in scripts/verify-notifications.js — this suite targets the
 * DB-down behaviors only and touches nothing in the shared dev DB.
 *
 * NOTE: `process.env.MONGODB_URI` is deliberately NOT loaded from .env.local —
 * mongoose is stubbed here, so no real connection is ever made (the suite is
 * fully hermetic). Do not "fix" this; there is no DB to connect to.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
let total = 0;
let tmpCounter = 0;

async function testAsync(name, fn) {
  total++;
  process.stdout.write("\n  [TEST " + total + "] " + name + " ... ");
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL: " + err.message);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

/**
 * Load a REAL app module (ESM/TS) as CommonJS with dependency stubbing.
 * Stubs keyed by the EXACT module specifier the transpiled code requires
 * (e.g. "mongoose", "next/server", "@/lib/dbConnect"). Any request starting
 * with "@/models/" is satisfied with an empty object (side-effect-only model
 * registration). Optionally pass `sourceOverride` to load a mutated copy.
 * The temp file lives INSIDE the project (node_modules resolution) and is
 * unlinked in `finally`; the module gets a unique filename so repeated loads
 * never collide in require.cache.
 */
function loadTranspiledModule(relPath, stubs, sourceOverride) {
  const fullPath = path.resolve(ROOT, relPath);
  const source = sourceOverride !== undefined ? sourceOverride : fs.readFileSync(fullPath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: false,
    },
    fileName: fullPath,
  });
  const tmpFile = path.resolve(ROOT, ".db-reconnect-tmp-" + Date.now() + "-" + tmpCounter++ + ".js");
  fs.writeFileSync(tmpFile, outputText);

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith("@/models/")) return {}; // model side-effect imports
    return originalLoad.apply(this, arguments);
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(tmpFile);
  } finally {
    Module._load = originalLoad;
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best effort */
    }
    try {
      delete require.cache[tmpFile];
    } catch {
      /* best effort */
    }
  }
}

const DB_ERROR = Object.assign(
  new Error("MongooseServerSelectionError: connect ETIMEDOUT 10.10.34.35:2255"),
  { name: "MongooseServerSelectionError" }
);

/** mongoose stub whose connect() rejects on the first call, then resolves. */
function makeFlakyMongooseStub() {
  let calls = 0;
  const stub = {
    connect: () => {
      calls++;
      return calls === 1
        ? Promise.reject(DB_ERROR)
        : Promise.resolve({ _id: "fake-conn-" + calls });
    },
  };
  stub.getCalls = () => calls;
  return stub;
}

async function run() {
  console.log("==================================================================");
  console.log("  POST-SESSION 44 BUGFIX — DBCONNECT RETRY + UNREAD-COUNT FAIL-SILENT");
  console.log("  (in-process; loads the REAL modules with stubbed deps; no DB/server)");
  console.log("==================================================================");

  // ================= GROUP 1 — dbConnect retry (poisoned-promise regression) =================

  // T1 + T2 share ONE module instance and ONE global.mongoose cache — exactly
  // how the real dev server behaves after a failed connect.
  global.mongoose = undefined;
  const flaky = makeFlakyMongooseStub();
  const dbc = loadTranspiledModule("src/lib/dbConnect.js", { mongoose: flaky });

  await testAsync("dbConnect: first connect against dead DB rejects + cached.promise reset to null", async () => {
    let rejected = null;
    try {
      await dbc.dbConnect();
    } catch (e) {
      rejected = e;
    }
    assert(rejected !== null, "dbConnect() must reject when mongoose.connect() rejects");
    assert(rejected.name === "MongooseServerSelectionError", "must surface the original error, got: " + rejected.name);
    assert(flaky.getCalls() === 1, "mongoose.connect() must be called exactly once, got " + flaky.getCalls());
    assert(
      global.mongoose.promise === null,
      "cached.promise must be reset to null after rejection (THE fix) — got: " + String(global.mongoose.promise)
    );
  });

  await testAsync("dbConnect: second call RETRIES and succeeds once the DB is back (poisoned-promise regression)", async () => {
    const conn = await dbc.dbConnect();
    assert(flaky.getCalls() === 2, "mongoose.connect() must be called AGAIN (retry), got " + flaky.getCalls() + " calls");
    assert(conn && conn._id === "fake-conn-2", "must return the fresh connection, got: " + JSON.stringify(conn));
    assert(global.mongoose.conn === conn, "cached.conn must hold the fresh connection");
  });

  // T3 — happy path on a fresh module: first connect succeeds, no regression.
  await testAsync("dbConnect: happy path — fresh module connects on the first call", async () => {
    global.mongoose = undefined;
    let calls = 0;
    const healthy = { connect: () => { calls++; return Promise.resolve({ _id: "ok" }); } };
    const dbc2 = loadTranspiledModule("src/lib/dbConnect.js", { mongoose: healthy });
    const conn = await dbc2.dbConnect();
    assert(calls === 1, "connect must be called once, got " + calls);
    assert(conn._id === "ok", "must return the connection");
    assert(global.mongoose.promise !== null, "cached.promise must be cached on success");
  });

  // T4 — discriminator: a copy of dbConnect.js WITHOUT the fix cannot recover.
  // Proves test 2 would actually catch a revert of the bugfix.
  await testAsync("dbConnect DISCRIMINATOR: without the fix, retry is impossible (suite catches a revert)", async () => {
    const fixedSource = fs.readFileSync(path.resolve(ROOT, "src/lib/dbConnect.js"), "utf-8");
    const oldSource = fixedSource.replace("cached.promise = null;", "/* fix removed */");
    assert(oldSource !== fixedSource, "sanity: mutated copy must differ from the fixed source");
    global.mongoose = undefined;
    const oldFlaky = makeFlakyMongooseStub();
    const oldMod = loadTranspiledModule("src/lib/dbConnect.js", { mongoose: oldFlaky }, oldSource);

    let rejected = false;
    try {
      await oldMod.dbConnect();
    } catch {
      rejected = true;
    }
    assert(rejected, "old code: first call must reject");

    // Old behavior: the rejected promise is still cached -> second call fails
    // instantly and NEVER calls mongoose.connect() again.
    let secondRejected = false;
    try {
      await oldMod.dbConnect();
    } catch (e) {
      secondRejected = true;
      assert(e.name === "MongooseServerSelectionError", "second call must reuse the cached rejection");
    }
    assert(secondRejected, "old code: second call must ALSO reject (cached rejected promise reused)");
    assert(oldFlaky.getCalls() === 1, "old code: mongoose.connect() must NOT be called again, got " + oldFlaky.getCalls());
  });

  // ================= GROUP 2 — unread-count graceful fallback =================

  function makeRouteStubs({ dbUp = true, authed = true } = {}) {
    return {
      "next/server": {
        NextResponse: {
          json: (body, init) => ({ status: init && init.status !== undefined ? init.status : 200, body }),
        },
        NextRequest: class {},
      },
      "@/lib/dbConnect": {
        dbConnect: async () => {
          if (!dbUp) throw DB_ERROR;
        },
      },
      "@/lib/auth-utils": {
        requireAuth: async () => (authed ? { id: "user_123", role: "customer" } : null),
        unauthorized: () => ({ status: 401, body: { error: "لطفاً ابتدا وارد حساب خود شوید" } }),
        // Only the reverted (pre-bugfix) route calls serverError() — the
        // discriminator test (9) exercises it; the live route never does.
        serverError: () => ({ status: 500, body: { error: "خطای سرور" } }),
      },
      "@/models/Notification": {
        countDocuments: async () => 5,
      },
    };
  }

  await testAsync("unread-count: DB down + authed -> 200 { count: 0 } (the fix)", async () => {
    const route = loadTranspiledModule("src/app/api/notifications/unread-count/route.ts", makeRouteStubs({ dbUp: false, authed: true }));
    const res = await route.GET({});
    assert(res.status === 200, "must be 200 (fail-silent), got " + res.status);
    assert(res.body && res.body.count === 0, "must return { count: 0 }, got: " + JSON.stringify(res.body));
  });

  await testAsync("unread-count: DB up + authed -> 200 { count: 5 } (happy path preserved)", async () => {
    const route = loadTranspiledModule("src/app/api/notifications/unread-count/route.ts", makeRouteStubs({ dbUp: true, authed: true }));
    const res = await route.GET({});
    assert(res.status === 200, "must be 200, got " + res.status);
    assert(res.body && res.body.count === 5, "must return the real count 5, got: " + JSON.stringify(res.body));
  });

  await testAsync("unread-count: DB down + unauth -> 401 (authz never masked by the fallback)", async () => {
    const route = loadTranspiledModule("src/app/api/notifications/unread-count/route.ts", makeRouteStubs({ dbUp: false, authed: false }));
    const res = await route.GET({});
    assert(res.status === 401, "must be 401 (requireAuth runs before dbConnect), got " + res.status);
  });

  await testAsync("unread-count: DB up + unauth -> 401", async () => {
    const route = loadTranspiledModule("src/app/api/notifications/unread-count/route.ts", makeRouteStubs({ dbUp: true, authed: false }));
    const res = await route.GET({});
    assert(res.status === 401, "must be 401, got " + res.status);
  });

  // T9 — discriminator: a copy of the route reverted to the pre-bugfix
  // `serverError()` behavior must return 500. Proves test 5 (200 { count: 0 })
  // would actually catch a revert of the graceful-fallback fix.
  await testAsync("unread-count DISCRIMINATOR: reverted serverError() -> 500 (suite catches a revert)", async () => {
    const fixedSource = fs.readFileSync(
      path.resolve(ROOT, "src/app/api/notifications/unread-count/route.ts"),
      "utf-8"
    );
    const reverted = fixedSource
      .replace(
        'import { requireAuth, unauthorized } from "@/lib/auth-utils";',
        'import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";'
      )
      .replace("return NextResponse.json({ count: 0 });", "return serverError();");
    assert(reverted !== fixedSource, "sanity: reverted copy must differ from the fixed source");

    const route = loadTranspiledModule(
      "src/app/api/notifications/unread-count/route.ts",
      makeRouteStubs({ dbUp: false, authed: true }),
      reverted
    );
    const res = await route.GET({});
    assert(res.status === 500, "reverted route must return 500, got " + res.status);
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

run().catch((err) => {
  console.error("\nTest suite error:", err);
  process.exit(1);
});
