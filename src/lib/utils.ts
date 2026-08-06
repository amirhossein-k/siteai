import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { clsx, type ClassValue };

/**
 * Merges Tailwind CSS classes with proper conflict resolution.
 * Combines clsx for conditional classes and tailwind-merge for deduplication.
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-blue-500", "px-6")
 * // => "py-2 bg-blue-500 px-6"
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date string into Persian/English format
 */
export function formatDate(date: string | Date, locale: "fa" | "en" = "fa") {
  const d = new Date(date);
  return d.toLocaleDateString(locale === "fa" ? "fa-IR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format a number as currency (Toman)
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat("fa-IR").format(price) + " تومان";
}

/**
 * Generate a slug from a string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}

/**
 * Get base URL for API calls
 */
export function getBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Session 61 — next/image host allowlist mirror (client-side guard).
 *
 * next/image throws a RENDER-TIME error on any `src` whose hostname is not in
 * `images.remotePatterns` — where the old native <img> just degraded to a
 * broken image / the onError placeholder. Storefront components therefore
 * skip <Image> for URLs outside the allowlist and fall back to their existing
 * placeholder (identical to a failed image load).
 *
 * Mirrors next.config.ts `remotePatterns`:
 *   - the project's known Liara S3 host (LIARA_ENDPOINT is server-only, so the
 *     default host is used here — next.config keeps the env-derived value),
 *   - NEXT_PUBLIC_APP_URL host when set,
 *   - localhost (dev) and any same-origin relative path.
 * Fail-safe by design: an unknown host degrades to a placeholder, never a crash.
 */
const ALLOWED_IMAGE_HOSTS: ReadonlySet<string> = (() => {
  const hosts = new Set<string>(["localhost", "c589564.parspack.net"]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).hostname);
    } catch {
      // malformed env — the fixed allowlist still applies
    }
  }
  return hosts;
})();

export function isAllowedImageSrc(src: string | undefined | null): boolean {
  if (!src) return false;
  // Same-origin relative paths always work with next/image (no remotePatterns).
  // Protocol-relative (`//host/...`) is NOT same-origin — the browser resolves
  // it to https://host/... and next/image would reject the unconfigured host.
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    return ALLOWED_IMAGE_HOSTS.has(new URL(src).hostname);
  } catch {
    return false; // malformed, data:, blob:, protocol-relative, etc.
  }
}
