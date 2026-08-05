import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Session 58 — Vitest unit-test foundation.
 *
 * - Node environment (no jsdom; these are pure/DB-mocked helper tests).
 * - `@/` alias resolved explicitly (Vite does not read tsconfig paths).
 * - Forks pool (Windows-safe; also the Vitest 3+ default).
 * - Coverage is REPORT-ONLY (no fail threshold) and scoped to src/lib.
 * - Test files live in tests/unit/*.test.ts and are type-checked by
 *   `npx tsc --noEmit` (the tsconfig includes every .ts file).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      // npm scripts always run from the repo root.
      "@": path.resolve(process.cwd(), "src"),
    },
  },
});
