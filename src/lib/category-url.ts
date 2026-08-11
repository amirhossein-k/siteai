/**
 * Category URL contract (Session 75).
 *
 * The SINGLE source of truth for the public category page URL used by the
 * canonical link, breadcrumbs, ItemList JSON-LD, the sitemap and Open Graph —
 * so every surface resolves to exactly the same resource. Mirrors
 * `buildProductUrl` (src/lib/product-slug.ts) byte-for-byte: the base URL is
 * stripped of trailing slashes, and Unicode Persian slugs are emitted raw —
 * browsers/search engines percent-encode them on the wire while the Next.js
 * route param is decoded back to the exact stored slug.
 *
 * Category pages live at `/categories/<slug>` (Session 75) — the real,
 * indexable route. The interactive catalog filter `/products?category=<id>`
 * remains a separate surface (noindex,follow) that canonicalizes here.
 */
export function buildCategoryUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/categories/${slug}`;
}
