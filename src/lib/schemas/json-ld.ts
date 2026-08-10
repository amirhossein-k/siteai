/**
 * JSON-LD Structured Data Helpers
 * Based on nextjs-seo-skill best practices
 */

/**
 * Safe JSON-LD serialization (Session 71).
 *
 * `JSON.stringify` alone does NOT escape `<`/`>`/`&`, so product data
 * containing e.g. `</script><script>alert(1)</script>` would break out of the
 * `<script type="application/ld+json">` element (the HTML parser closes the
 * script early → markup injection / broken structured data). Escaping the
 * five dangerous sequences keeps the JSON valid (the escapes decode to the
 * original characters when parsed) while making script-tag breakout
 * impossible. Do NOT trust editor/API content merely because it came from the
 * admin UI.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Organization Schema
 */
export function organizationSchema({
  name,
  url,
  logo,
  sameAs = [],
  contactPoint,
}: {
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
  contactPoint?: {
    telephone: string;
    contactType: string;
  };
}) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url,
  };

  if (logo) schema.logo = logo;
  if (sameAs.length > 0) schema.sameAs = sameAs;

  if (contactPoint) {
    schema.contactPoint = {
      "@type": "ContactPoint",
      telephone: contactPoint.telephone,
      contactType: contactPoint.contactType,
    };
  }

  return schema;
}

/**
 * Website Schema with SearchAction
 */
export function websiteSchema({
  name,
  url,
  searchUrl,
}: {
  name: string;
  url: string;
  searchUrl?: string;
}) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url,
  };

  if (searchUrl) {
    schema.potentialAction = {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: searchUrl,
      },
      "query-input": "required name=search_term_string",
    };
  }

  return schema;
}

/**
 * Article / BlogPosting Schema
 */
export function articleSchema({
  headline,
  description,
  image,
  datePublished,
  dateModified,
  author,
  url,
}: {
  headline: string;
  description: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
  author: { name: string; url?: string };
  url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    ...(image && { image }),
    datePublished,
    ...(dateModified && { dateModified }),
    author: {
      "@type": "Person",
      name: author.name,
      ...(author.url && { url: author.url }),
    },
    url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
  };
}

/**
 * BreadcrumbList Schema
 */
export function breadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Product Schema
 */
export function productSchema({
  name,
  description,
  image,
  sku,
  brand,
  url,
  offers,
  aggregateRating,
}: {
  name: string;
  description: string;
  image?: string[];
  sku?: string;
  brand?: string;
  /** Canonical product URL (Session 70 — drives structured data + canonical). */
  url?: string;
  offers: {
    price: number;
    priceCurrency: string;
    availability: "InStock" | "OutOfStock" | "PreOrder";
    url?: string;
  };
  aggregateRating?: {
    ratingValue: number;
    reviewCount: number;
  };
}) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    ...(image && image.length > 0 && { image }),
    ...(sku && { sku }),
    ...(brand && { brand: { "@type": "Brand", name: brand } }),
    ...(url && { url }),
    offers: {
      "@type": "Offer",
      price: offers.price,
      priceCurrency: offers.priceCurrency,
      availability: `https://schema.org/${offers.availability}`,
      ...(offers.url && { url: offers.url }),
    },
  };

  if (aggregateRating) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: aggregateRating.ratingValue,
      reviewCount: aggregateRating.reviewCount,
    };
  }

  return schema;
}

/**
 * FAQPage Schema
 */
export function faqSchema(questions: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer,
      },
    })),
  };
}

/**
 * LocalBusiness Schema
 */
export function localBusinessSchema({
  name,
  description,
  url,
  telephone,
  address,
  openingHours,
}: {
  name: string;
  description: string;
  url: string;
  telephone?: string;
  address?: {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
  openingHours?: string[];
}) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    description,
    url,
  };

  if (telephone) schema.telephone = telephone;

  if (address) {
    schema.address = {
      "@type": "PostalAddress",
      ...address,
    };
  }

  if (openingHours) {
    schema.openingHoursSpecification = openingHours.map((hours) => ({
      "@type": "OpeningHoursSpecification",
      ...parseHours(hours),
    }));
  }

  return schema;
}

function parseHours(hours: string) {
  const [days, timeRange] = hours.split(" ");
  const [opens, closes] = timeRange.split("-");
  return {
    dayOfWeek: days.split(",").map((d) => `https://schema.org/${d.trim()}`),
    opens,
    closes,
  };
}
