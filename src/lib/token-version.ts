/**
 * Session 64 — tokenVersion session-revocation checker (pure, injectable).
 *
 * The Session 62 foundation stores `tokenVersion` on the User and embeds it
 * in the JWT at sign-in. Enforcement lives HERE as a small pure factory so it
 * can be unit-tested hermetically (no mongoose/DB imports in this module):
 *
 *   const isCurrent = createTokenVersionChecker({
 *     fetchUserVersion: async (userId) => (await User.findById(userId).select("tokenVersion").lean())?.tokenVersion ?? null,
 *   });
 *   const ok = await isCurrent(token.id, token.tokenVersion ?? 0);
 *
 * Semantics (matching the auth-gate contract):
 *   - version match            → session valid;
 *   - cached version > token   → REVOKED (any previously-issued JWT carries a
 *     stale tokenVersion after change-password / logout-all / admin revoke);
 *   - cached version < token   → the cache is stale (a NEWER token than what
 *     we know) → REFETCH rather than falsely revoke a fresh sign-in;
 *   - user deleted (null)      → REVOKED;
 *   - checker error            → FAIL-OPEN (see below).
 *
 * The per-user cache avoids a DB round-trip on every protected request — a
 * revocation in ANOTHER process takes effect within `ttlMs` (default 60s).
 * The in-process bumping routes (change-password / logout-all / admin revoke)
 * evict the entry directly so revocation is IMMEDIATE in the same server
 * (see auth-utils.invalidateTokenVersionCache). The cache lives on
 * `globalThis` in the caller so dev-server HMR does not reset it.
 *
 * FAIL-OPEN rationale (deliberate): the DB is required by every protected API
 * route anyway, so a transient read failure at check time would fail the
 * subsequent route call regardless; locking users out here would merely add a
 * second failure mode. A bumped token therefore cannot silently survive a
 * healthy DB, and a DB blip never amplifies into a site-wide 401 storm.
 */
export interface TokenVersionCacheEntry {
  version: number;
  checkedAt: number;
}

export interface TokenVersionCheckerOptions {
  /** Returns the user's current tokenVersion, or null if the user is gone. */
  fetchUserVersion: (userId: string) => Promise<number | null>;
  /** Clock injection for tests (defaults to Date.now). */
  now?: () => number;
  /** Cache map injection for tests (defaults to a fresh Map). */
  cache?: Map<string, TokenVersionCacheEntry>;
  /** Cache TTL in ms (default 60s). */
  ttlMs?: number;
  /** Optional error logger — the checker itself NEVER throws. */
  onError?: (err: unknown) => void;
}

/** Default TTL: revocation applies within 60s of the bump. */
export const TOKEN_VERSION_CACHE_TTL_MS = 60_000;

/**
 * Evict a user's cached entry (used by the in-process bumping routes so a
 * change-password / logout-all / admin revoke takes effect immediately).
 * Requires the SAME cache map instance the checker was created with.
 */
export function evictTokenVersionCacheEntry(
  cache: Map<string, TokenVersionCacheEntry> | undefined,
  userId: string | undefined
): void {
  if (cache && userId) cache.delete(userId);
}

export function createTokenVersionChecker(
  options: TokenVersionCheckerOptions
): (userId: string | undefined, tokenVersion: number | undefined) => Promise<boolean> {
  const {
    fetchUserVersion,
    onError,
    ttlMs = TOKEN_VERSION_CACHE_TTL_MS,
  } = options;
  const now = options.now ?? Date.now;
  const cache = options.cache ?? new Map<string, TokenVersionCacheEntry>();

  return async function isTokenVersionCurrent(
    userId: string | undefined,
    tokenVersion: number | undefined
  ): Promise<boolean> {
    // No id → nothing to enforce against (cannot happen on real JWTs, which
    // always carry the id claim, but be safe rather than revoke everyone).
    if (!userId) return true;

    const t = now();
    const cached = cache.get(userId);
    if (cached && t - cached.checkedAt < ttlMs) {
      // Asymmetric comparison: equal → valid; cached NEWER than the token →
      // definitely revoked; cached OLDER than the token → the cache is stale
      // (a fresh sign-in issued a newer token) → fall through to a refetch
      // instead of falsely revoking a legitimate session.
      if (cached.version === (tokenVersion ?? 0)) return true;
      if (cached.version > (tokenVersion ?? 0)) return false;
    }

    try {
      const current = await fetchUserVersion(userId);
      if (current === null) return false; // user deleted → revoke
      cache.set(userId, { version: current, checkedAt: t });
      return current === (tokenVersion ?? 0);
    } catch (err) {
      // Fail-open (see module doc) — never break authentication on a blip.
      onError?.(err);
      return true;
    }
  };
}
