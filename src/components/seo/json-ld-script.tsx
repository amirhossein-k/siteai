import {
  organizationSchema,
  websiteSchema,
  breadcrumbSchema,
  productSchema,
  faqSchema,
  articleSchema,
  serializeJsonLd,
} from "@/lib/schemas/json-ld";
import { APP_URL } from "@/lib/constants";

interface JsonLdScriptProps {
  type: "organization" | "website" | "breadcrumb" | "product" | "faq" | "article";
  data: Record<string, unknown>;
}

function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        // Session 71 — serializeJsonLd escapes < > & U+2028/29 so hostile
        // data can never break out of the script element.
        __html: serializeJsonLd({
          "@context": "https://schema.org",
          ...data,
        }),
      }}
    />
  );
}

/**
 * Pre-built JSON-LD components for common use cases
 */

export function OrganizationJsonLd() {
  return (
    <JsonLdScript
      data={organizationSchema({
        name: "فروشگاه من",
        url: APP_URL,
        sameAs: ["#"],
      })}
    />
  );
}

export function WebsiteJsonLd() {
  return (
    <JsonLdScript
      data={websiteSchema({
        name: "فروشگاه من",
        url: APP_URL,
        searchUrl: `${APP_URL}/search?q={search_term_string}`,
      })}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: Array<{ name: string; url?: string }>;
}) {
  return <JsonLdScript data={breadcrumbSchema(items)} />;
}

export function ProductJsonLd({ data }: { data: Parameters<typeof productSchema>[0] }) {
  return <JsonLdScript data={productSchema(data)} />;
}

export function FaqJsonLd({
  questions,
}: {
  questions: Array<{ question: string; answer: string }>;
}) {
  return <JsonLdScript data={faqSchema(questions)} />;
}

export function ArticleJsonLd({
  data,
}: {
  data: Parameters<typeof articleSchema>[0];
}) {
  return <JsonLdScript data={articleSchema(data)} />;
}
