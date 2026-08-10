import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Session 71 audit — the public origin must FAIL FAST in production when
 * NEXT_PUBLIC_APP_URL is missing or malformed, instead of silently emitting
 * localhost canonical/sitemap/OG/JSON-LD URLs. The dev fallback stays.
 *
 * Tests re-import the module fresh (vi.resetModules) with a controlled
 * process.env per case — constants.ts is a plain module, so this is hermetic.
 * vi.stubEnv handles the read-only NODE_ENV safely and restores after each.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("APP_URL production guard", () => {
  it("falls back to localhost in development when unset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const { APP_URL } = await import("@/lib/constants");
    expect(APP_URL).toBe("http://localhost:3000");
  });

  it("throws in production when NEXT_PUBLIC_APP_URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await expect(import("@/lib/constants")).rejects.toThrow(
      /NEXT_PUBLIC_APP_URL must be set to the public HTTPS origin in production/
    );
  });

  it("throws in production for a schemeless (malformed) origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "mystore.com"); // no scheme
    await expect(import("@/lib/constants")).rejects.toThrow(
      /NEXT_PUBLIC_APP_URL must be set/
    );
  });

  it("accepts a valid https origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://mystore.com");
    const { APP_URL } = await import("@/lib/constants");
    expect(APP_URL).toBe("https://mystore.com");
  });

  it("accepts http in production only when explicitly configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://internal-store.example");
    const { APP_URL } = await import("@/lib/constants");
    expect(APP_URL).toBe("http://internal-store.example");
  });
});
