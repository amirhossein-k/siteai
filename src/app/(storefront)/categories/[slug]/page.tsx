import type { Metadata } from "next";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Package, LayoutGrid } from "lucide-react";
import { Breadcrumbs } from "@/components/storefront/breadcrumbs";
import { PaginationControls } from "@/components/ui/pagination";
import { BreadcrumbJsonLd, ItemListJsonLd } from "@/components/seo/json-ld-script";
import { ProductCard } from "@/components/storefront/product-card";
import { APP_URL, PAGINATION } from "@/lib/constants";
import { isAllowedImageSrc } from "@/lib/utils";
import {
  getCategoryPage,
  normalizeCategorySlug,
  resolveCategoryPageParam,
  buildCategoryBreadcrumbTrail,
  buildCategoryItemList,
  buildCategoryMetadata,
} from "@/lib/category-pages";

/**
 * Category page — `/categories/<slug>` (Session 75). Server Component.
 *
 * SEO architecture (approved design):
 *   - `dynamic = "force-dynamic"`: stock/price/availability and the first-
 *     page listing are read from the live DB per request (same freshness
 *     contract as the product page and sitemap) — the page must reflect new
 *     products/deactivations immediately.
 *   - React `cache()`: dedupes the DB query between `generateMetadata` and
 *     the page render within the same request (Next's documented pattern).
 *     The slug param is normalized BEFORE the cache call — the Next 16
 *     (Turbopack) quirk delivers percent-encoded Unicode slugs to the page
 *     component but decoded slugs to generateMetadata; normalizing first
 *     keeps the cache key identical for both passes.
 *   - Valid ACTIVE category → HTTP 200, `index, follow`, self-canonical
 *     `/categories/<slug>`, server-rendered name/description, product links,
 *     visible breadcrumbs, BreadcrumbList + ItemList JSON-LD — ALL in the
 *     initial HTML (raw HTTP, no JS).
 *   - URL-driven pagination (Session 76): `?page=N` slices the listing
 *     SERVER-side and renders REAL `<a>` pagination links in the initial
 *     HTML. Page 1 → clean canonical; page 2+ → self-canonical
 *     `/categories/<slug>?page=N`; `?page=1` / malformed values → 308 to the
 *     clean URL; page beyond totalPages → `notFound()` (404). ItemList
 *     reflects ONLY the products rendered on that page.
 *   - Missing / inactive / malformed category → `notFound()` → HTTP 404.
 *   - Only factual structured data: ItemList carries position/name/url for
 *     the rendered products — no fabricated price/rating/review count.
 */

export const dynamic = "force-dynamic";

// React cache() — dedupes same-argument queries within a render pass
// (generateMetadata + page share ONE DB load per request). Callers must
// normalize the slug BEFORE invoking it (see the two call sites) so the
// encoded-vs-decoded asymmetry above never splits the cache key, and pass
// the SAME resolved page so the pagination variant keys identically.
const getCategory = cache((slug: string, page: number) =>
  getCategoryPage(slug, page)
);

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const pageRes = resolveCategoryPageParam(
    Array.isArray(raw.page) ? raw.page[0] : raw.page
  );
  const data = await getCategory(normalizeCategorySlug(slug), pageRes.page);
  if (!data) return {};
  return buildCategoryMetadata(data.category, APP_URL, {
    page: pageRes.page,
    totalPages: data.totalPages,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const normalizedSlug = normalizeCategorySlug(slug);
  const pageRes = resolveCategoryPageParam(
    Array.isArray(raw.page) ? raw.page[0] : raw.page
  );

  // Missing / inactive / malformed slug — 404, never indexable (checked
  // BEFORE any page-param redirect so a bad category never bounces).
  const data = await getCategory(normalizedSlug, pageRes.page);
  if (!data) notFound();

  // Canonical consolidation: ?page=1 and malformed page values permanently
  // redirect to the clean category URL (never a duplicated ?page=1 or a
  // junk-param URL in the index). The slug is PERCENT-ENCODED for the
  // redirect target: Node rejects raw Unicode in the HTTP `Location` header
  // (ERR_INVALID_CHAR → 500) — the encoded form is ASCII, and the route
  // decodes it back on arrival. (Link hrefs below can stay decoded — HTML
  // attributes are not HTTP headers; browsers encode them on request.)
  if (pageRes.redirectClean) {
    permanentRedirect(`/categories/${encodeURIComponent(normalizedSlug)}`);
  }

  // Out-of-range page → 404 (a thin page must never be indexable).
  if (pageRes.page > data.totalPages) notFound();

  const { category, ancestorChain, products, total, totalPages } = data;

  // Visible breadcrumb — server-rendered in the INITIAL HTML. Same items feed
  // the BreadcrumbList JSON-LD so UI and structured data can never diverge.
  const breadcrumbItems = buildCategoryBreadcrumbTrail({
    ancestorChain,
    baseUrl: APP_URL,
  });

  // Current-page ItemList data — factual name/url only (reflects exactly the
  // products rendered below; positions are sequential per the schema).
  const itemListItems = buildCategoryItemList(products, APP_URL);

  // Real crawlable pagination links — page 1 points at the CLEAN category URL
  // (never a ?page=1 that would 308), page 2+ carry the ?page=N form. Passed
  // as a SERIALIZABLE string[] (indexed by page number) because a Server
  // Component cannot pass a function prop to the client PaginationControls.
  const pageHrefs: string[] = [];
  for (let n = 1; n <= totalPages; n++) {
    pageHrefs[n] =
      n === 1 ? `/categories/${normalizedSlug}` : `/categories/${normalizedSlug}?page=${n}`;
  }

  const categoryImage = isAllowedImageSrc(category.image)
    ? category.image
    : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs items={breadcrumbItems} />

      {/* Category header — name + description + optional image. */}
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        {categoryImage && (
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
            <Image
              src={categoryImage}
              alt={category.name}
              fill
              sizes="80px"
              loading="eager"
              className="object-cover"
            />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {category.name}
            </h1>
          </div>
          {category.description && (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {category.description}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {total > 0
              ? `${products.length > total ? total : products.length} محصول از ${total} محصول در این دسته`
              : "هنوز محصولی در این دسته ثبت نشده است"}
          </p>
        </div>
      </header>

      {products.length > 0 ? (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>

          {/* Results count + URL-driven pagination (Session 76) — real links
              server-rendered in the INITIAL HTML. */}
          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              نمایش {products.length} محصول از {total} محصول
            </div>
            <PaginationControls
              page={pageRes.page}
              totalPages={totalPages}
              pageHrefs={pageHrefs}
            />
          </div>

          {total > PAGINATION.DEFAULT_PAGE_SIZE && (
            <div className="mt-8 text-center">
              <Link
                href={`/products?category=${category._id}`}
                className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                مشاهده همه {total} محصول این دسته ←
              </Link>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-muted/30 py-20 text-center">
          <Package className="mb-3 h-12 w-12 text-muted-foreground" />
          <h2 className="mb-2 text-lg font-semibold">
            هنوز محصولی در این دسته ثبت نشده است
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            بهزودی محصولات این دستهبندی منتشر خواهد شد
          </p>
        </div>
      )}

      {/* SEO structured data — server-rendered in the INITIAL HTML. */}
      <BreadcrumbJsonLd items={breadcrumbItems} />
      {itemListItems.length > 0 && <ItemListJsonLd items={itemListItems} />}
    </div>
  );
}
