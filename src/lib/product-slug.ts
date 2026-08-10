/**
 * Product slug contract + deterministic collision handling (Session 70).
 *
 * Product slugs are user-facing URLs — short, readable, descriptive. Persian/
 * Arabic product names keep their own script («هدفون بیسیم بلوتوثی» →
 * `هدفون-بیسیم-بلوتوثی`) instead of a transliteration or a hash.
 *
 * The alphabet is the same set `slugify()` (src/lib/utils.ts) emits:
 *   - lowercase Latin letters,
 *   - digits (Persian/Arabic digits are normalized to Latin by slugify),
 *   - the Arabic/Persian block U+0600–U+06FF (letters AND the Persian/Arabic-
 *     Indic digits ۰-۹ / ٠-٩),
 *   - single hyphens between words.
 *
 * Explicitly rejected by the pattern: uppercase Latin (the Product model's
 * `lowercase: true` would store a different value than the URL → 404),
 * leading/trailing/consecutive hyphens, whitespace, and unsafe characters
 * (`/ ? # % \` control chars, HTML, …). The pattern is Unicode-safe for the
 * Next.js `products/[slug]` dynamic route — the browser/Next percent-encode
 * the non-ASCII characters on the wire while the route param is decoded.
 */

export const SLUG_PATTERN = /^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/;

/** True when `value` satisfies the product slug contract. */
export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * Absolute product URL — `${baseUrl}/products/${slug}` (Session 71).
 *
 * The SINGLE source of truth for the product URL used by the canonical link,
 * Product JSON-LD `url`, the sitemap and Open Graph — so every surface
 * resolves to exactly the same resource. Unicode slugs are emitted raw;
 * browsers/search engines percent-encode them on the wire while the Next.js
 * route param is decoded back to the exact stored slug.
 */
export function buildProductUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/products/${slug}`;
}

/**
 * True when `e` is a MongoDB duplicate-key error (E11000) on the SLUG path.
 *
 * Distinguishes slug conflicts from other unique keys (e.g. `variants.sku`)
 * so the auto-suffix retry only kicks in for real slug collisions — a SKU
 * E11000 is rethrown and handled by the existing 409 path.
 */
export function isSlugDuplicateError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; keyPattern?: Record<string, unknown> };
  if (err.code !== 11000) return false;
  const keyPattern = err.keyPattern;
  if (keyPattern && typeof keyPattern === "object" && Object.keys(keyPattern).length > 0) {
    return "slug" in keyPattern;
  }
  // No keyPattern info (legacy driver shapes) — the slug unique index is the
  // only top-level unique key, so treat it as a slug conflict.
  return true;
}

/**
 * Deterministic collision-safe creation for AUTO-GENERATED slugs.
 *
 * Tries `baseSlug`, then `baseSlug-2`, `baseSlug-3`, … until `attempt`
 * succeeds. Used ONLY when the slug was derived from the product name
 * (`autoSlug: true` from the forms) — a manually-entered slug is authoritative
 * and keeps the existing 409 behavior by passing `maxTries = 1` (one attempt,
 * conflict → `{ ok: false }`).
 *
 * The suffix is deterministic-by-convention (insertion order: first product
 * keeps the base, the next gets `-2`) and never uses random hashes — the DB
 * unique index remains the ultimate guarantee.
 */
export async function createWithUniqueSlug<T>(
  baseSlug: string,
  attempt: (candidate: string) => Promise<T>,
  maxTries = 20
): Promise<{ ok: true; value: T } | { ok: false }> {
  // Defense-in-depth (empty slug only): the forms validate via Zod, but a
  // direct API caller could send an EMPTY slug with autoSlug:true — the
  // suffix retry would then emit "-2"/"-3" (leading-hyphen) candidates.
  // Refuse empty/whitespace-only bases early. NOTE: we deliberately do NOT
  // apply the full SLUG_PATTERN here — pre-Session-71 slugs like
  // `e2e_<ts>_prod-1` (underscores, from the E2E fixtures / legacy data)
  // were accepted by the API and must keep working; only an empty base can
  // produce structurally invalid suffixed candidates.
  if (!baseSlug || baseSlug.trim() === "") return { ok: false };
  for (let i = 0; i < maxTries; i++) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
    try {
      return { ok: true, value: await attempt(candidate) };
    } catch (e) {
      if (!isSlugDuplicateError(e)) throw e;
    }
  }
  return { ok: false };
}
