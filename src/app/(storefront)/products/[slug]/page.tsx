import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Package } from "lucide-react";
import { ProductDetailView } from "@/components/storefront/product-detail-view";
import { ProductJsonLd } from "@/components/seo/json-ld-script";
import { getPublicProductBySlug, type PublicProduct } from "@/lib/public-products";
import { buildProductUrl } from "@/lib/product-slug";
import { APP_URL, APP_NAME } from "@/lib/constants";
import { isAllowedImageSrc } from "@/lib/utils";

/**
 * Product detail page — Server Component (Session 71).
 *
 * Previously a client component that fetched /api/products at runtime, so the
 * canonical link + Product JSON-LD only appeared AFTER hydration. Now the
 * page renders server-side: title, meta description, canonical, Open Graph,
 * Twitter and Product JSON-LD are all present in the INITIAL HTML that
 * crawlers receive — while the interactive surface (gallery, cart, wishlist,
 * variants, reviews) stays in the client ProductDetailView below.
 *
 * - `dynamic = "force-dynamic"`: stock/price/availability and ratings are
 *   read from the live DB per request (the old client-fetched page was always
 *   per-request too — same freshness, now with server-rendered SEO).
 * - React `cache()`: dedupes the DB query between `generateMetadata` and the
 *   page render within the same request (Next's documented pattern).
 * - URL consistency: canonical, JSON-LD `url`, sitemap and Open Graph all use
 *   `buildProductUrl` — one source of truth.
 */

export const dynamic = "force-dynamic";

/**
 * Next.js 16.2.12 (Turbopack) quirk — verified in dev: the PAGE component
 * receives dynamic-segment params STILL percent-encoded for Unicode slugs
 * («هدفون-...» arrives as «%D9%87%D8%AF...»), while `generateMetadata`
 * receives the decoded slug. The old client page masked this because axios
 * re-encoded the param and the API route's URLSearchParams decoded it again;
 * the Server Component queries the DB directly, so the page pass must decode
 * explicitly. decodeURIComponent is a no-op on an already-decoded slug
 * (valid slugs contain no `%`); a malformed sequence falls back to the raw
 * value instead of throwing.
 */
function normalizeSlugParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// React cache() — dedupes same-argument queries within a render pass
// (generateMetadata + page share ONE DB query per request). Callers must
// normalize the slug BEFORE invoking it (see the two call sites) — otherwise
// the encoded-vs-decoded asymmetry above would make the cache keys differ
// and the dedupe silently fail for every Unicode slug.
const getProduct = cache((slug: string) => getPublicProductBySlug(slug));

/** Absolute image URL for OG/JSON-LD (same-origin paths need the host). */
function absoluteImageUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${APP_URL}${url}`;
}

/** Meta description — the plain-text projection, cleaned to ≤160 chars. */
function toMetaDescription(product: PublicProduct): string {
  return (product.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(normalizeSlugParam(slug));
  if (!product) return {};

  const productUrl = buildProductUrl(APP_URL, product.slug || product._id);
  const description = toMetaDescription(product);
  const images = (product.images || [])
    .filter(isAllowedImageSrc)
    .map(absoluteImageUrl);

  return {
    // The root layout's title template appends «| APP_NAME» — a unique,
    // natural-Persian title per product (no keyword stuffing).
    title: product.name,
    description,
    alternates: { canonical: productUrl },
    openGraph: {
      title: product.name,
      description,
      url: productUrl,
      siteName: APP_NAME,
      locale: "fa_IR",
      type: "website",
      ...(images.length > 0 && { images }),
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
      description,
      ...(images.length > 0 && { images }),
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(normalizeSlugParam(slug));

  if (!product) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="mb-3 h-8 w-8" />
            <p>محصول مورد نظر یافت نشد</p>
            <Button className="mt-4" asChild>
              <Link href="/products">مشاهده همه محصولات</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const productUrl = buildProductUrl(APP_URL, product.slug || product._id);
  // Session 61 — same host allowlist as the client gallery.
  const displayImages = (product.images || []).filter(isAllowedImageSrc);
  const ratingSummary = product.ratingSummary;

  return (
    <>
      <ProductDetailView product={product} />
      {/* SEO: Product structured data — real data only, nothing invented.
          aggregateRating appears ONLY when approved reviews exist. */}
      <ProductJsonLd
        data={{
          name: product.name,
          description: product.description || "",
          image: displayImages.map(absoluteImageUrl),
          url: productUrl,
          brand:
            typeof product.brand === "object" && product.brand
              ? (product.brand as { name: string }).name
              : undefined,
          offers: {
            price: product.price,
            priceCurrency: "IRR",
            availability: (product.stock ?? 0) > 0 ? "InStock" : "OutOfStock",
          },
          aggregateRating:
            ratingSummary && ratingSummary.count > 0
              ? {
                  ratingValue: ratingSummary.average,
                  reviewCount: ratingSummary.count,
                }
              : undefined,
        }}
      />
    </>
  );
}
