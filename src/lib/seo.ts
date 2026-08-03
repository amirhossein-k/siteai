import type { Metadata } from "next";
import { APP_NAME, APP_DESCRIPTION, APP_URL } from "@/lib/constants";

interface SeoProps {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
  locale?: string;
  type?: "website" | "article" | "profile";
}

/**
 * Generate standardized metadata for pages
 * Based on Next.js App Router best practices + SEO skill
 */
export function generateMetadata({
  title,
  description = APP_DESCRIPTION,
  keywords,
  ogImage = "/og-image.png",
  canonicalUrl,
  noIndex = false,
  locale = "fa",
  type = "website",
}: SeoProps): Metadata {
  const siteName = APP_NAME;
  const fullTitle = title
    ? `${title} | ${siteName}`
    : `${siteName} | ${APP_DESCRIPTION}`;

  return {
    title: fullTitle,
    description,
    ...(keywords && { keywords: keywords.join(", ") }),
    ...(canonicalUrl && {
      alternates: { canonical: canonicalUrl },
    }),
    ...(noIndex && { robots: { index: false, follow: false } }),

    openGraph: {
      title: fullTitle,
      description,
      siteName,
      locale: locale === "fa" ? "fa_IR" : "en_US",
      type,
      ...(ogImage && {
        images: [
          {
            url: ogImage,
            width: 1200,
            height: 630,
            alt: fullTitle,
          },
        ],
      }),
    },

    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      ...(ogImage && { images: [ogImage] }),
    },

    other: {
      "application-name": siteName,
    },
  };
}

/**
 * Generate metadata for blog posts and articles
 */
export function generateArticleMetadata({
  title,
  description,
  publishedTime,
  modifiedTime,
  authors,
  tags,
  canonicalUrl,
}: {
  title: string;
  description: string;
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  tags?: string[];
  canonicalUrl?: string;
}): Metadata {
  return {
    ...generateMetadata({ title, description, type: "article", canonicalUrl }),
    ...(publishedTime && {
      openGraph: {
        ...generateMetadata({ title, description }).openGraph,
        type: "article",
        ...(publishedTime && { publishedTime }),
        ...(modifiedTime && { modifiedTime }),
        ...(authors && { authors }),
        ...(tags && { tags }),
      },
    }),
  };
}
