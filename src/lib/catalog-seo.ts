import mongoose from "mongoose";
import { APP_NAME, APP_URL, PAGINATION } from "@/lib/constants";
import { dbConnect } from "@/lib/dbConnect";
import Category from "@/models/Category";
import Product from "@/models/Product";
import { parsePageParam } from "@/lib/pagination";

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
 *   - BASE pagination (Session 76) is now INDEXABLE: `/products?page=N` (page
 *     param with NO other params) is `index, follow` with a SELF-canonical
 *     `/products?page=N`; `?page=1` and invalid page values canonicalize to
 *     the clean `/products` (the content IS page 1); an OUT-OF-RANGE page
 *     (page beyond totalPages, detected via one indexed count) is
 *     `noindex, follow` canonicalized to `/products` — never a thin indexed
 *     page. Any URL with OTHER filter parameters stays `noindex, follow`
 *     (Session 74 rule unchanged), and `/products?category=<id>` still
 *     canonicalizes toward `/categories/<slug>` regardless of `page`.
 *
 * The pure policy functions are hermetic (unit-tested). The async
 * `getCatalogMetadata` is the thin generateMetadata-facing wrapper that
 * normalizes Next.js searchParams, resolves the category slug via the DB and
 * (only for page-only URLs) counts products to detect out-of-range pages
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
 * The page-only URL (no filter/sort/facet params, page param alone) — the
 * ONLY relaxed case of the Session 74 fail-closed policy.
 */
function isPageOnlyUrl(params: CatalogSearchParams): boolean {
  const rest = { ...params };
  delete rest.page;
  return Object.keys(rest).length === 0;
}

/**
 * Indexable when:
 *   - the URL is the clean `/products` (no params at all), OR
 *   - it is a PAGE-ONLY URL whose page resolves to a REAL page: page 1,
 *     invalid values (content = page 1), or a valid in-range page ≥ 2.
 *
 * Fail-closed everywhere else: ANY other key (known facet, sort, or an
 * unknown future param) → non-indexable, and a page-only URL beyond
 * `totalPages` (opts.pageOutOfRange) → non-indexable (a thin page with no
 * content must never enter the index).
 */
export function isIndexableCatalogUrl(
  params: CatalogSearchParams,
  opts: { pageOutOfRange?: boolean } = {}
): boolean {
  if (!isPageOnlyUrl(params)) return false;
  if (params.page === undefined) return true;
  const page = parsePageParam(params.page);
  // page 1 / invalid values serve page-1 content → indexable with the clean
  // canonical. Valid page ≥ 2 is indexable UNLESS it is out of range.
  if (page <= 1) return true;
  return !opts.pageOutOfRange;
}

/**
 * Robots policy: `index, follow` on indexable URLs (clean + in-range base
 * pagination), `noindex, follow` everywhere else — Google can still CRAWL
 * filtered variants (and discover product links inside them) but never
 * indexes the duplicates or thin out-of-range pages.
 */
export function getCatalogRobots(
  params: CatalogSearchParams,
  opts: { pageOutOfRange?: boolean } = {}
): { index: boolean; follow: boolean } {
  return isIndexableCatalogUrl(params, opts)
    ? { index: true, follow: true }
    : { index: false, follow: true };
}

/**
 * Canonical URL for a given parameter set.
 *
 * - `?category=<id>` (slug resolvable) → the `/categories/<slug>` route
 *   (Session 75) — the single URL that will represent that category.
 *   A `page` param is deliberately ignored here: category-filtered URLs are
 *   `noindex, follow` duplicate surfaces and their canonical points at the
 *   canonical page-1 category URL (never a fragile deep-canonical that could
 *   point at a nonexistent category page).
 * - PAGE-ONLY URLs: `?page=N` (valid, in range, N ≥ 2) → self-canonical
 *   `/products?page=N`; page 1 / invalid / out-of-range → clean `/products`.
 * - every other parameterized URL → the clean `/products` base.
 *
 * The `categorySlug` argument is resolved asynchronously by
 * `getCatalogMetadata` (DB lookup); pure callers pass it explicitly.
 */
export function getCatalogCanonicalUrl(
  params: CatalogSearchParams,
  categorySlug: string | null = null,
  opts: { pageOutOfRange?: boolean } = {}
): string {
  if (params.category && categorySlug) {
    return `${APP_URL}/categories/${categorySlug}`;
  }
  if (isPageOnlyUrl(params) && params.page !== undefined) {
    const page = parsePageParam(params.page);
    if (page > 1 && !opts.pageOutOfRange) {
      return `${APP_URL}/products?page=${page}`;
    }
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
  categorySlug: string | null = null,
  opts: { pageOutOfRange?: boolean } = {}
): CatalogMetadata {
  const canonical = getCatalogCanonicalUrl(params, categorySlug, opts);
  const robots = getCatalogRobots(params, opts);
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
 * Detect an out-of-range page-only URL: one indexed count (isActive +
 * in-stock, the exact public listing rule), totalPages from
 * DEFAULT_PAGE_SIZE. Fail-open — a DB error leaves the page indexable (the
 * count is an SEO refinement, never a reason to hide a real page).
 */
async function isPageOutOfRange(
  params: CatalogSearchParams
): Promise<boolean> {
  const page = parsePageParam(params.page);
  if (page <= 1) return false;
  try {
    await dbConnect();
    const total = await Product.countDocuments({
      isActive: true,
      stock: { $gt: 0 },
    });
    const totalPages = Math.max(1, Math.ceil(total / PAGINATION.DEFAULT_PAGE_SIZE));
    return page > totalPages;
  } catch {
    return false;
  }
}

/**
 * generateMetadata-facing wrapper: normalizes Next.js searchParams, resolves
 * the category slug when a `category` param is present (one indexed DB
 * lookup, only for category-filtered URLs) and — ONLY for page-only URLs —
 * counts products to detect out-of-range pages (one indexed count). Called
 * from the /products page's `generateMetadata`.
 */
export async function getCatalogMetadata(
  searchParams: Promise<Record<string, string | string[] | undefined>>
) {
  const params = normalizeCatalogParams(await searchParams);
  const categorySlug = params.category
    ? await resolveCategorySlug(params.category)
    : null;
  const pageOutOfRange = isPageOnlyUrl(params)
    ? await isPageOutOfRange(params)
    : false;
  return buildCatalogMetadata(params, categorySlug, { pageOutOfRange });
}
