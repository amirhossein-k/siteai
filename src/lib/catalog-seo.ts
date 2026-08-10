import mongoose from "mongoose";
import { APP_NAME, APP_URL } from "@/lib/constants";
import { dbConnect } from "@/lib/dbConnect";
import Category from "@/models/Category";

/**
 * Catalog listing SEO policy (Session 74) — the SINGLE implementation of the
 * metadata/robots/canonical decisions for the `/products` storefront page.
 *
 * Rules (approved Session 73 matrix):
 *   - The CLEAN `/products` URL (no params) is INDEXABLE with a self-canonical.
 *   - EVERY parameterized / faceted / filter / sort / pagination variant is
 *     `noindex, follow` and canonicalizes toward the clean `/products` URL —
 *     so parameter-driven duplicates never enter the index.
 *   - `/products?category=<id>` is `noindex, follow` and canonicalizes toward
 *     the FUTURE `/categories/<slug>` route (Session 75). The slug is resolved
 *     from the DB here; when the category is unknown/deleted/malformed the
 *     canonical falls back to `/products` (never a fabricated URL).
 *   - `?page=N` is treated as non-indexable for now: the catalog client keeps
 *     pagination in local state (not the URL), so `?page=2` currently serves
 *     page-1 content — indexing it would create a duplicate. Session 76
 *     (URL-driven pagination with real links) flips base pagination to
 *     indexable.
 *
 * The pure policy functions are hermetic (unit-tested). The async
 * `getCatalogMetadata` is the thin generateMetadata-facing wrapper that
 * normalizes Next.js searchParams and resolves the category slug via the DB
 * (same pattern as src/lib/breadcrumbs.ts — model import is inert until the
 * DB function is called, so the pure tests stay hermetic).
 */

export interface CatalogSearchParams {
  category?: string;
  brand?: string;
  tag?: string;
  search?: string;
  sort?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: string;
  supplier?: string;
  limit?: string;
  /** Attribute facets arrive as literal `attributes[<slug>]` keys. */
  [key: string]: string | undefined;
}

/** Natural Persian title/description for the catalog page (no keyword
 *  stuffing — describes what the page actually offers). */
export const CATALOG_TITLE = "محصولات";
export const CATALOG_DESCRIPTION =
  "مرور و خرید آنلاین محصولات فروشگاه؛ جدیدترین و پرفروشترین کالاها را با فیلتر دستهبندی، برند و مرتبسازی پیدا کنید.";

/**
 * Normalize Next.js 16 searchParams (`string | string[] | undefined`) into a
 * flat string map: first value of arrays, empty values dropped (the products
 * API treats empty params as absent — same rule here). Attribute keys
 * (`attributes[<slug>]`) pass through unchanged.
 */
export function normalizeCatalogParams(
  raw: Record<string, string | string[] | undefined>
): CatalogSearchParams {
  const params: CatalogSearchParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (!v || v === "") continue;
    params[key] = v;
  }
  return params;
}

/**
 * Indexable ONLY when the URL is the clean `/products` (no params at all).
 * Fail-closed: ANY key (known facet, sort, page, or an unknown future param)
 * → non-indexable. This is deliberately stricter than enumerating params,
 * so an unexpected query string can never create an accidentally-indexed
 * duplicate.
 */
export function isIndexableCatalogUrl(params: CatalogSearchParams): boolean {
  return Object.keys(params).length === 0;
}

/**
 * Robots policy: `index, follow` on the clean URL, `noindex, follow`
 * everywhere else — Google can still CRAWL filtered variants (and discover
 * product links inside them) but never indexes the duplicates.
 */
export function getCatalogRobots(
  params: CatalogSearchParams
): { index: boolean; follow: boolean } {
  return isIndexableCatalogUrl(params)
    ? { index: true, follow: true }
    : { index: false, follow: true };
}

/**
 * Canonical URL for a given parameter set.
 *
 * - `?category=<id>` (slug resolvable) → the future `/categories/<slug>`
 *   route (Session 75) — the single URL that will represent that category.
 * - everything else → the clean `/products` base.
 *
 * The `categorySlug` argument is resolved asynchronously by
 * `getCatalogMetadata` (DB lookup); pure callers pass it explicitly.
 */
export function getCatalogCanonicalUrl(
  params: CatalogSearchParams,
  categorySlug: string | null = null
): string {
  if (params.category && categorySlug) {
    return `${APP_URL}/categories/${categorySlug}`;
  }
  return `${APP_URL}/products`;
}

/**
 * Resolve a category's public slug for the future `/categories/<slug>`
 * canonical. Returns `null` for malformed ids, inactive/deleted categories,
 * empty slugs, or any DB error — the caller then falls back to `/products`
 * (a canonical must never point at a fabricated URL).
 */
export async function resolveCategorySlug(
  categoryId: string
): Promise<string | null> {
  if (!mongoose.isValidObjectId(categoryId)) return null;
  try {
    await dbConnect();
    const cat = (await Category.findById(categoryId)
      .select("slug isActive")
      .lean()) as { slug?: string; isActive?: boolean } | null;
    if (!cat || cat.isActive === false) return null;
    return cat.slug && cat.slug !== "" ? cat.slug : null;
  } catch {
    return null;
  }
}

/**
 * The exact Metadata shape this helper produces — named + exported so unit
 * tests can assert every field without casts (Next's `Metadata.twitter` is a
 * discriminated union where `card` is not reachable on the base member, and
 * `alternates` is nullable, so typing the return as bare `Metadata` would
 * force casts in tests). The shape itself satisfies `Metadata` — tsc verifies
 * the assignment at every call site (generateMetadata).
 */
export interface CatalogMetadata {
  title: string;
  description: string;
  alternates: { canonical: string };
  robots: { index: boolean; follow: boolean };
  openGraph: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    locale: string;
    type: "website";
  };
  twitter: { card: "summary"; title: string; description: string };
}

/**
 * Compose the full Metadata object for the catalog page (pure — unit-testable).
 * The root layout's title template appends «| APP_NAME», producing a natural
 * Persian title «محصولات | فروشگاه من».
 */
export function buildCatalogMetadata(
  params: CatalogSearchParams,
  categorySlug: string | null = null
): CatalogMetadata {
  const canonical = getCatalogCanonicalUrl(params, categorySlug);
  const robots = getCatalogRobots(params);
  return {
    title: CATALOG_TITLE,
    description: CATALOG_DESCRIPTION,
    alternates: { canonical },
    robots,
    openGraph: {
      title: CATALOG_TITLE,
      description: CATALOG_DESCRIPTION,
      url: canonical,
      siteName: APP_NAME,
      locale: "fa_IR",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: CATALOG_TITLE,
      description: CATALOG_DESCRIPTION,
    },
  };
}

/**
 * generateMetadata-facing wrapper: normalizes Next.js searchParams and
 * resolves the category slug when a `category` param is present (one indexed
 * DB lookup, only for category-filtered URLs). Called from the /products
 * page's `generateMetadata`.
 */
export async function getCatalogMetadata(
  searchParams: Promise<Record<string, string | string[] | undefined>>
) {
  const params = normalizeCatalogParams(await searchParams);
  const categorySlug = params.category
    ? await resolveCategorySlug(params.category)
    : null;
  return buildCatalogMetadata(params, categorySlug);
}
