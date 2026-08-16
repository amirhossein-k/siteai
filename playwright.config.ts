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
 * - `reuseExistingServer: !CI` — locally the already-running dev server on
 *   :3000 is reused; CI boots a fresh `npm run dev` (with ZARINPAL_MOCK=1).
 * - ZARINPAL_MOCK is a dev-only env seam (src/lib/zarinpal.ts) that replaces
 *   the interactive Zarinpal sandbox gateway with a same-origin stub — the
 *   payment journey runs hermetically. See .env.example.
 * - Auth: storageState files under tests/e2e/.auth/ are produced once per run
 *   by global-setup (API login via /api/auth/csrf + callback/credentials).
 * - Artifacts: screenshot/video/trace retained only on failure.
 */
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

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
  webServer: {
    command: "npm run dev",
    url: `${BASE_URL}/api/auth/csrf`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: process.env.CI
      ? { ...process.env, ZARINPAL_MOCK: "1", SMS_MOCK: "1" }
      : undefined,
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
