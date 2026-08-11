import type { Metadata } from "next";
import { Suspense } from "react";
import ProductsCatalogPage from "@/components/storefront/products-catalog";
import { getCatalogMetadata } from "@/lib/catalog-seo";

/**
 * Product catalog page — Server Component (Session 74).
 *
 * Previously a client component with no server-rendered metadata, so
 * /products (and every parameterized variant) served the generic root
 * title/description, no canonical and no robots signal — every
 * ?search / ?sort / ?category / ?brand / ?tag / ?minPrice / ?attributes[…]
 * URL was an uncanonicalized duplicate surface.
 *
 * Now the page is a thin Server Component that:
 *   - emits server-rendered metadata via `generateMetadata` (title, natural
 *     Persian description, canonical, Open Graph, Twitter, robots) — present
 *     in the INITIAL HTML, not only after hydration,
 *   - applies the approved Session 74 indexability policy through the single
 *     reusable helper src/lib/catalog-seo.ts (clean /products → indexable
 *     self-canonical; every parameterized variant → noindex,follow
 *     canonicalized to the base; ?category → noindex canonicalized toward
 *     the future /categories/<slug> route),
 *   - renders the interactive catalog (filters, search, sort, URL-driven
 *     pagination) as the client ProductsCatalogPage component below, wrapped
 *     in <Suspense> — required by Next.js because the catalog derives its
 *     `page` from useSearchParams (Session 76).
 *
 * - `dynamic = "force-dynamic"`: the metadata depends on the request's
 *   searchParams (and the category slug for ?category canonicalization),
 *   and the catalog content is always live — consistent with the product
 *   detail page and sitemap freshness contracts.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  return getCatalogMetadata(searchParams);
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsCatalogPage />
    </Suspense>
  );
}
