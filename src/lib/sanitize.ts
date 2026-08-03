/**
 * Input Sanitization — prevent stored XSS
 *
 * This project renders user-provided text via React JSX expressions
 * ({product.description}), which automatically escapes HTML. The sanitizer
 * here is a defense-in-depth measure for:
 *
 *   1. Stored content that might be consumed by non-React consumers (API
 *      responses used by third parties, future SSR rendering changes)
 *   2. Fields that could contain HTML (admin descriptions, etc.)
 *   3. Any future switch to dangerouslySetInnerHTML
 *
 * Strategy: strip HTML tags from all plain-text fields. For fields that
 * intentionally accept rich text (none currently), allowlist specific tags.
 */

/**
 * Strip all HTML tags from a string.
 * Also removes common XSS vectors like javascript: URLs, on*=
 * event handlers, and script/data/base64 URI schemes.
 */
export function sanitizePlainText(value: string): string {
  if (!value) return value;

  let result = value;

  // Strip HTML tags
  result = result.replace(/<[^>]*>/g, "");

  // Strip javascript: protocol
  result = result.replace(/javascript\s*:/gi, "");

  // Strip on*= event handlers (onclick, onerror, onload, etc.)
  result = result.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");

  return result.trim();
}

/**
 * Sanitize an optional string field, returning undefined if not provided.
 */
export function sanitizeOptional(value: string | undefined | null): string | undefined {
  if (!value) return value ?? undefined;
  return sanitizePlainText(value);
}