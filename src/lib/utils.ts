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

/** Persian + Arabic digits → Latin (e.g. "۱۰۰۰۰۰" → "100000"). */
const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";
const DIGIT_MAP: Record<string, string> = {};
FA.split("").forEach((d, i) => (DIGIT_MAP[d] = String(i)));
AR.split("").forEach((d, i) => (DIGIT_MAP[d] = String(i)));
const PERSIAN_ARABIC_DIGITS = /[\u06F0-\u06F9\u0660-\u0669]/g;

/**
 * Convert Persian/Arabic-Indic digits to Latin digits ("۱۰۰" → "100").
 * Shared by slugify (SEO slugs keep universal Latin digits) and the CSV
 * import path (Session 51).
 */
export function toLatinDigits(value: string): string {
  return value.replace(PERSIAN_ARABIC_DIGITS, (ch) => DIGIT_MAP[ch] ?? ch);
}

// Arabic ي (U+064A) → Persian ی (U+06CC), Arabic ك (U+0643) → Persian ک (U+06A9)
// so normalized Persian names produce consistent, readable slugs.
const ARABIC_YE = /\u064A/g;
const ARABIC_KAF = /\u0643/g;
// Arabic diacritics (harakat), superscript alef and tatweel — removed.
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
// ZWNJ (نیم‌فاصله U+200C) — handled as a word separator.
const ZWNJ = /\u200C/g;
// Anything outside the slug alphabet (lowercase Latin, digits, Arabic/Persian
// block U+0600–U+06FF, hyphen) is removed. No `u`-flag property escapes here
// so the project's ES2017 tsconfig target stays happy (constructor form is
// not target-checked anyway) and the output ALWAYS satisfies SLUG_PATTERN.
const INVALID_SLUG_CHARS = new RegExp("[^a-z0-9\\u0600-\\u06FF-]", "g");

/**
 * Generate a slug from a string (Session 70 — SEO-first, Persian-first).
 *
 * Persian/Arabic product names keep their own script in the slug —
 * «هدفون بیسیم بلوتوثی» → `هدفون-بیسیم-بلوتوثی` — instead of a transliteration
 * or a hash. The output is deterministic and ALWAYS satisfies the slug
 * validation contract /^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/
 * (src/lib/product-slug.ts). Uniqueness stays at the server/DB layer; an
 * auto-generated slug that collides gets a deterministic `-2`/`-3` suffix
 * server-side (see src/lib/product-slug.ts createWithUniqueSlug).
 *
 * Normalization steps:
 *  1. trim + Latin lowercase,
 *  2. Arabic ي/ك → Persian ی/ک, remove Arabic diacritics,
 *  3. ZWNJ → word separator (`-`),
 *  4. Persian/Arabic digits → Latin digits,
 *  5. whitespace/underscore runs → `-`,
 *  6. remove anything outside the slug alphabet,
 *  7. collapse repeated hyphens, strip leading/trailing hyphens.
 */
export function slugify(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(ARABIC_YE, "\u06CC")
    .replace(ARABIC_KAF, "\u06A9")
    .replace(ARABIC_DIACRITICS, "")
    .replace(ZWNJ, "-")
    .replace(/[\s_]+/g, "-");

  return toLatinDigits(normalized)
    .replace(INVALID_SLUG_CHARS, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}

/**
 * Session 65 — normalize a (possibly populated) Mongo relation into its id
 * string. Product edit pages receive relations from populated API responses
 * where a deleted ref surfaces as `null` (and legacy/edge payloads may carry
 * the raw ObjectId string):
 *   - populated doc     → its `_id` string
 *   - raw ObjectId instance → its hex string (via its custom toString)
 *   - ObjectId string   → itself
 *   - null / undefined  → "" (safe fallback — the forms treat "" as unset)
 * The previous `typeof x === "object" ? x._id : x` pattern crashed on null
 * because `typeof null === "object"` then dereferences `null._id`.
 */
export function relationId(value: unknown): string {
  if (value && typeof value === "object") {
    const id = (value as { _id?: unknown })._id;
    if (id != null) return String(id);
    // Raw ObjectId instance (e.g. server-side with live Mongoose docs) has no
    // `_id` property but a custom toString yielding the hex string. Guard with
    // the toString check so plain objects ({name}) never produce "[object Object]".
    const toString = (value as { toString?: () => string }).toString;
    if (typeof toString === "function" && toString !== Object.prototype.toString) {
      return toString.call(value);
    }
    return "";
  }
  return typeof value === "string" ? value : "";
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
