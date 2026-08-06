import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  createTokenVersionChecker,
  evictTokenVersionCacheEntry,
  TOKEN_VERSION_CACHE_TTL_MS,
  type TokenVersionCacheEntry,
} from "@/lib/token-version";

/**
 * Session 64 — tokenVersion revocation checker (pure factory).
 *
 * Hermetic: the factory is injected with a fake `fetchUserVersion`, so no
 * mongoose/DB is ever touched. Covers the cache, the revocation decision, the
 * deleted-user rule, and the fail-open contract.
 */
describe("createTokenVersionChecker (Session 64 — session revocation)", () => {
  let fetchVersion: Mock<(userId: string) => Promise<number | null>>;
  let onError: Mock<(err: unknown) => void>;
  let now: Mock<() => number>;

  beforeEach(() => {
    fetchVersion = vi.fn();
    onError = vi.fn();
    now = vi.fn(() => 1_000_000);
  });

  const make = () =>
    createTokenVersionChecker({
      fetchUserVersion: fetchVersion,
      now,
      onError,
    });

  describe("cache behavior", () => {
    it("fetches the DB version on a cold check and compares it to the token", async () => {
      fetchVersion.mockResolvedValue(3);
      const isCurrent = make();

      await expect(isCurrent("u1", 3)).resolves.toBe(true);
      await expect(isCurrent("u1", 2)).resolves.toBe(false);
      expect(fetchVersion).toHaveBeenCalledTimes(1); // second check hit the cache
    });

    it("serves the second check from the cache (no extra DB call)", async () => {
      fetchVersion.mockResolvedValue(1);
      const isCurrent = make();

      await isCurrent("u1", 1);
      await isCurrent("u1", 1);
      await isCurrent("u1", 1);
      expect(fetchVersion).toHaveBeenCalledTimes(1);
    });

    it("refetches after the TTL window", async () => {
      fetchVersion.mockResolvedValue(1);
      const isCurrent = make();

      await isCurrent("u1", 1); // cache at t=1_000_000
      now.mockReturnValue(1_000_000 + TOKEN_VERSION_CACHE_TTL_MS + 1); // expired
      fetchVersion.mockResolvedValue(2); // bumped meanwhile
      await expect(isCurrent("u1", 1)).resolves.toBe(false);
      expect(fetchVersion).toHaveBeenCalledTimes(2);
    });

    it("tracks separate users independently", async () => {
      fetchVersion.mockImplementation(async (id: string) =>
        id === "admin" ? 0 : 7
      );
      const isCurrent = make();

      await expect(isCurrent("admin", 0)).resolves.toBe(true);
      await expect(isCurrent("customer", 7)).resolves.toBe(true);
      expect(fetchVersion).toHaveBeenCalledTimes(2);
    });
  });

  describe("revocation decisions", () => {
    it("accepts a matching tokenVersion", async () => {
      fetchVersion.mockResolvedValue(0);
      const isCurrent = make();
      await expect(isCurrent("u1", 0)).resolves.toBe(true);
    });

    it("rejects a stale tokenVersion (the session was revoked)", async () => {
      fetchVersion.mockResolvedValue(5); // bumped (logout-all / password change)
      const isCurrent = make();
      await expect(isCurrent("u1", 4)).resolves.toBe(false);
    });

    it("rejects a missing tokenVersion claim against a bumped user", async () => {
      fetchVersion.mockResolvedValue(1);
      const isCurrent = make();
      await expect(isCurrent("u1", undefined)).resolves.toBe(false);
    });

    it("treats a deleted user as revoked", async () => {
      fetchVersion.mockResolvedValue(null);
      const isCurrent = make();
      await expect(isCurrent("u1", 0)).resolves.toBe(false);
    });

    it("accepts an id-less token (nothing to enforce against)", async () => {
      const isCurrent = make();
      await expect(isCurrent(undefined, 0)).resolves.toBe(true);
      expect(fetchVersion).not.toHaveBeenCalled();
    });
  });

  describe("fail-open on checker errors", () => {
    it("does NOT throw and allows the request when the DB read fails", async () => {
      fetchVersion.mockRejectedValue(new Error("db down"));
      const isCurrent = make();

      await expect(isCurrent("u1", 0)).resolves.toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(String(onError.mock.calls[0][0])).toContain("db down");
    });

    it("still enforces the cache on the next successful check", async () => {
      fetchVersion
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValueOnce(2);
      const isCurrent = make();

      await expect(isCurrent("u1", 0)).resolves.toBe(true); // fail-open
      await expect(isCurrent("u1", 0)).resolves.toBe(false); // now revoked
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("asymmetric cache semantics (Session 64 hardening)", () => {
    it("does NOT falsely revoke a fresh session when the cache holds an OLDER version", async () => {
      // Cache learned version 0 (pre-change). A NEW sign-in issued token v1.
      fetchVersion.mockResolvedValue(0);
      const isCurrent = make();
      await isCurrent("u1", 0); // populate cache with 0

      // Fresh token v1 hits the stale cache (0 < 1) → must refetch, not 401.
      fetchVersion.mockResolvedValue(1); // DB now says 1
      await expect(isCurrent("u1", 1)).resolves.toBe(true);
      expect(fetchVersion).toHaveBeenCalledTimes(2);
    });

    it("revokes when the cache holds a NEWER version than the token", async () => {
      fetchVersion.mockResolvedValue(1);
      const isCurrent = make();
      await isCurrent("u1", 1); // cache says 1
      // An old pre-bump token (v0) must be rejected from the cache alone.
      await expect(isCurrent("u1", 0)).resolves.toBe(false);
      expect(fetchVersion).toHaveBeenCalledTimes(1); // no extra DB call
    });

    it("evictTokenVersionCacheEntry clears only the targeted user", () => {
      const cache = new Map<string, TokenVersionCacheEntry>([
        ["u1", { version: 1, checkedAt: 1 }],
        ["u2", { version: 2, checkedAt: 1 }],
      ]);
      evictTokenVersionCacheEntry(cache, "u1");
      expect(cache.has("u1")).toBe(false);
      expect(cache.has("u2")).toBe(true);
      evictTokenVersionCacheEntry(cache, undefined); // no-op, no crash
      evictTokenVersionCacheEntry(undefined, "u3"); // no-op, no crash
    });

    it("evicting a user forces the next check to refetch (immediate revocation in-process)", async () => {
      const cache = new Map<string, TokenVersionCacheEntry>();
      fetchVersion.mockResolvedValue(0);
      const isCurrent = createTokenVersionChecker({
        fetchUserVersion: fetchVersion as unknown as (
          userId: string
        ) => Promise<number | null>,
        now,
        cache,
      });
      await isCurrent("u1", 0); // cache populated

      // Simulate an in-process bump route: bump the DB + evict the cache.
      fetchVersion.mockResolvedValue(1);
      evictTokenVersionCacheEntry(cache, "u1");
      await expect(isCurrent("u1", 0)).resolves.toBe(false);
      expect(fetchVersion).toHaveBeenCalledTimes(2);
    });
  });

  describe("injected cache (HMR/dev-server pattern)", () => {
    it("shares a caller-provided Map so dev-server restarts do not reset it", async () => {
      const cache = new Map<string, TokenVersionCacheEntry>();
      fetchVersion.mockResolvedValue(4);
      const isCurrent = make(); // uses the module-level default cache...
      const isCurrentShared = createTokenVersionChecker({
        fetchUserVersion: fetchVersion as unknown as (
          userId: string
        ) => Promise<number | null>,
        now,
        cache, // ...but this one is explicitly shared
      });

      await isCurrentShared("u1", 4); // populates the shared cache
      await expect(isCurrent("u1", 4)).resolves.toBe(true); // separate map → refetch
      expect(fetchVersion).toHaveBeenCalledTimes(2);
      expect(cache.has("u1")).toBe(true);
    });
  });
});
