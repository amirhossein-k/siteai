import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/storefront/breadcrumbs";
import {
  FaqJsonLd,
  BreadcrumbJsonLd,
} from "@/components/seo/json-ld-script";
import { FaqPageContent } from "@/components/storefront/faq/faq-page-content";
import { getFaqJsonLdItems } from "@/lib/faq-content";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

/**
 * FAQ page — Server Component (storefront).
 *
 * A thin server shell that provides:
 *   - server-rendered metadata (title/description/canonical/OG) — present in
 *     the INITIAL HTML,
 *   - the shared storefront Breadcrumbs (same items feed the visible UI and
 *     the BreadcrumbList JSON-LD, so they can never disagree),
 *   - the FAQPage JSON-LD built from the SAME content module the UI renders
 *     (`src/lib/faq-content.ts`) — the structured data always matches the
 *     visible questions,
 *   - the interactive list (search / category filter / accordion) as the
 *     client `FaqPageContent` island below.
 *
 * The header/footer and the dark/light storefront theme come from the
 * (storefront) route-group layout — this page carries no chrome of its own.
 *
 * Content is strictly limited to behaviour verifiable in this codebase; see
 * the CONTENT POLICY note in src/lib/faq-content.ts.
 */
export const metadata: Metadata = {
  title: "سوالات متداول",
  description:
    "پاسخ پرسش‌های رایج درباره ثبت سفارش، پرداخت، کد تخفیف، ارسال و پیگیری، حساب کاربری، محصولات و پشتیبانی فروشگاه.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "سوالات متداول",
    description:
      "پاسخ پرسش‌های رایج درباره ثبت سفارش، پرداخت، کد تخفیف، ارسال و پیگیری، حساب کاربری، محصولات و پشتیبانی فروشگاه.",
    type: "website",
  },
};

const breadcrumbItems: BreadcrumbItem[] = [
  { name: "صفحه اصلی", url: "/" },
  { name: "سوالات متداول" },
];

export default function FaqPage() {
  return (
    <>
      <FaqJsonLd questions={getFaqJsonLdItems()} />
      <BreadcrumbJsonLd items={breadcrumbItems} />

      <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      <FaqPageContent />
    </>
  );
}
