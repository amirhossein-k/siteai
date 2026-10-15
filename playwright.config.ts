import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration (Session 59 — Production Readiness, tranche 1).
 *
 * Design decisions (approved Session 59 design — frozen):
 * - Single browser engine: bundled Chromium (installed via `npx playwright install
 *   chromium`). One desktop project + one narrow mobile smoke project.
 * - `workers: 1`, `fullyParallel: false` — deterministic execution against the
 *   shared dev MongoDB (mirrors the sequential 33-suite regression runner).
 *   Per-spec data is PREFIX-isolated so scaling workers later is config-only.
 * - Server lifecycle — Playwright owns the dev server for every NORMAL run,
 *   locally and in CI (`reuseExistingServer: false`: each run boots its own
 *   `npm run dev` so the mock env below is always in effect — a reused server
 *   started WITHOUT the mock would send payments to the real Zarinpal
 *   sandbox). The single exception is the nightly regression workflow
 *   (`regression.yml`): there the WORKFLOW owns the server, because the 51
 *   node suites in `scripts/run-regression.js` drive that same server and it
 *   is intentionally started WITHOUT `ZARINPAL_MOCK` so the real sandbox is
 *   exercised. That workflow health-checks the server and then sets
 *   `REGRESSION_SERVER=1`; Playwright then ATTACHES to the running server
 *   instead of starting a second one on port 3000 (the duplicate start used to
 *   abort the Liara upload job with `…/api/auth/csrf is already used` before
 *   any test body ran). `reuseExistingServer` is deliberately never `true`: in
 *   attach mode the whole `webServer` block is disabled instead.
 * - ZARINPAL_MOCK / SMS_MOCK are dev-only env seams (src/lib/zarinpal.ts) that
 *   replace the interactive Zarinpal sandbox gateway and SMS provider with
 *   hermetic stubs. They are set on the webServer for local and CI runs.
 *   See .env.example.
 * - Auth: storageState files under tests/e2e/.auth/ are produced once per run
 *   by global-setup (API login via /api/auth/csrf + callback/credentials).
 * - Artifacts: screenshot/video/trace retained only on failure.
 */
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

/**
 * `REGRESSION_SERVER=1` (set by .github/workflows/regression.yml): the workflow
 * has already started + health-checked the dev server its node suites use, so
 * Playwright must attach to it rather than boot a second instance on :3000.
 * Everywhere else this is unset and Playwright owns the server (with mocks).
 */
const externalServer = process.env.REGRESSION_SERVER === "1";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  outputDir: "test-results",
  globalSetup: "tests/e2e/global-setup.ts",
  globalTeardown: "tests/e2e/global-teardown.ts",
  webServer: externalServer
    ? undefined
    : {
        command: "npm run dev",
        url: `${BASE_URL}/api/auth/csrf`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { ...process.env, ZARINPAL_MOCK: "1", SMS_MOCK: "1" },
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: BASE_URL,
        // Fail-fast on unexpected dialogs; screenshots/video only on failure.
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "on-first-retry",
      },
    },
    {
      // RTL mobile smoke — the two highest-traffic customer journeys.
      name: "chromium-mobile",
      // Session 63 — logout added; Session 84 — password-reset-mobile added
      // (an ANONYMOUS smoke that never registers, so it cannot exhaust the
      // shared per-IP register budget): the customer flows (and the
      // responsive dashboard logout) are mobile-safe and belong in the RTL
      // smoke.
      testMatch: /customer-login.*\.spec\.ts|cart.*\.spec\.ts|logout.*\.spec\.ts|password-reset-mobile.*\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        baseURL: BASE_URL,
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "on-first-retry",
      },
    },
  ],
});
