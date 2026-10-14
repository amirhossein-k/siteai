import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/storefront/breadcrumbs";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld-script";
import { AboutPageContent } from "@/components/storefront/about/about-page-content";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

/**
 * About Us page — Server Component (storefront).
 *
 * A thin server shell that provides:
 *   - server-rendered metadata (title/description/canonical/OG) — present in
 *     the INITIAL HTML. The canonical is relative, so it resolves against
 *     `metadataBase` (= APP_URL = NEXT_PUBLIC_APP_URL — the production origin
 *     https://marloo.shop); it never points at localhost in production,
 *   - the shared storefront Breadcrumbs (same items feed the visible UI and
 *     the BreadcrumbList JSON-LD, so they can never disagree),
 *   - the About content (hero, mission, story, commitments, values, ordering
 *     steps, helpful links, CTA) as a Server Component.
 *
 * The header/footer and the dark/light storefront theme come from the
 * (storefront) route-group layout — this page carries no chrome of its own.
 *
 * Content lives in src/lib/about-content.ts and is limited to behaviour
 * verified in this codebase plus owner-approved FAQ/Terms policy; the
 * reference page's fabricated statistics, history, team and testimonials are
 * deliberately not reproduced.
 */
export const metadata: Metadata = {
  title: "درباره ما",
  description:
    "با مارلو شاپ آشنا شوید؛ فروشگاه اینترنتیای که بر ارائه محصولات اصل و باکیفیت، ارسال سریع، پرداخت امن و پشتیبانی پاسخگو تمرکز دارد.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "درباره ما",
    description:
      "با مارلو شاپ آشنا شوید؛ فروشگاه اینترنتیای که بر ارائه محصولات اصل و باکیفیت، ارسال سریع، پرداخت امن و پشتیبانی پاسخگو تمرکز دارد.",
    type: "website",
  },
};

const breadcrumbItems: BreadcrumbItem[] = [
  { name: "صفحه اصلی", url: "/" },
  { name: "درباره ما" },
];

export default function AboutPage() {
  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbItems} />

      <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      <AboutPageContent />
    </>
  );
}
