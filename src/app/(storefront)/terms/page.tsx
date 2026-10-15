import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/storefront/breadcrumbs";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld-script";
import { TermsPageContent } from "@/components/storefront/terms/terms-page-content";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

/**
 * Terms & Conditions page — Server Component (storefront).
 *
 * A thin server shell that provides:
 *   - server-rendered metadata (title/description/canonical/OG) — present in
 *     the INITIAL HTML. The canonical is relative, so it resolves against
 *     `metadataBase` (= APP_URL = NEXT_PUBLIC_APP_URL, the production origin
 *     https://marloo.shop); it never points at localhost in production,
 *   - the shared storefront Breadcrumbs (same items feed the visible UI and
 *     the BreadcrumbList JSON-LD, so they can never disagree),
 *   - the sectioned terms content (TOC scroll-spy + acknowledgement) as the
 *     client `TermsPageContent` island below.
 *
 * The header/footer and the dark/light storefront theme come from the
 * (storefront) route-group layout — this page carries no chrome of its own.
 *
 * Content lives in src/lib/terms-content.ts, adapted from the owner-approved
 * reference and reconciled with this codebase + the approved FAQ; see the
 * reconciliation notes in that module.
 */
export const metadata: Metadata = {
  title: "قوانین و مقررات",
  description:
    "شرایط و قوانین استفاده از فروشگاه مارلو شاپ؛ شامل شرایط عضویت، فرآیند ثبت سفارش، روش‌های پرداخت، ارسال و تحویل، بازگشت کالا، حریم خصوصی و مالکیت معنوی.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "قوانین و مقررات",
    description:
      "شرایط و قوانین استفاده از فروشگاه مارلو شاپ؛ شامل شرایط عضویت، فرآیند ثبت سفارش، روش‌های پرداخت، ارسال و تحویل، بازگشت کالا، حریم خصوصی و مالکیت معنوی.",
    type: "website",
  },
};

const breadcrumbItems: BreadcrumbItem[] = [
  { name: "صفحه اصلی", url: "/" },
  { name: "قوانین و مقررات" },
];

export default function TermsPage() {
  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbItems} />

      <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      <TermsPageContent />
    </>
  );
}
