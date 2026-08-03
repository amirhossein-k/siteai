import {
  organizationSchema,
  websiteSchema,
  breadcrumbSchema,
  productSchema,
  faqSchema,
  articleSchema,
} from "@/lib/schemas/json-ld";

interface JsonLdScriptProps {
  type: "organization" | "website" | "breadcrumb" | "product" | "faq" | "article";
  data: Record<string, unknown>;
}

function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
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
        url: process.env.NEXT_PUBLIC_APP_URL || "https://example.com",
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
        url: process.env.NEXT_PUBLIC_APP_URL || "https://example.com",
        searchUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/search?q={search_term_string}`,
      })}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: Array<{ name: string; url: string }>;
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
