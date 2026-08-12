/**
 * Discount Countdown helpers (Session 78) — PURE presentation utilities.
 *
 * These helpers only FORMAT data the server already vetted: the public
 * discount summary is ACTIVE-only (null for future/expired/disabled), so the
 * presence of `discount.endsAt` already means "a discount is live right now
 * and it ends at this time". No discount-validity logic is re-implemented
 * here — the authoritative window math stays in src/lib/product-pricing.ts
 * (`getEffectivePrice`); the client countdown is presentation only and never
 * influences pricing (checkout re-reads the DB product server-side).
 *
 * Uses Intl.NumberFormat("fa-IR") for Persian digits — never a hand-written
 * digit conversion.
 */

import type { CountdownParts } from "@/hooks/use-countdown";

const faNumber = new Intl.NumberFormat("fa-IR");

/**
 * Format a countdown as a natural Persian remaining-time phrase, e.g.
 * «۲ روز و ۵ ساعت باقی مانده». `hours` from `useCountdown` is a TOTAL (53 for
 * 2 days + 5 hours), so days/hours are decomposed here.
 *
 * Granularity ladder (compact by design — sub-units are dropped below the
 * coarsest pair):
 *   - days > 0        → «N روز [و M ساعت]»
 *   - hours > 0       → «N ساعت [و M دقیقه]»
 *   - minutes > 0     → «N دقیقه [و S ثانیه]»
 *   - otherwise       → «N ثانیه»
 *
 * Required outputs:
 *   2 days + 5 hours          → «۲ روز و ۵ ساعت باقی مانده»
 *   2 days + 0 hours          → «۲ روز باقی مانده»
 *   5 hours + 12 minutes      → «۵ ساعت و ۱۲ دقیقه باقی مانده»
 *   12 minutes + 30 seconds   → «۱۲ دقیقه و ۳۰ ثانیه باقی مانده»
 *   30 seconds                → «۳۰ ثانیه باقی مانده»
 *   expired / zero / not-ready → "" (empty string)
 */
export function formatPersianRemaining(parts: CountdownParts): string {
  if (!parts.ready || parts.expired) return "";
  const totalSeconds = parts.hours * 3600 + parts.minutes * 60 + parts.seconds;
  if (totalSeconds <= 0) return "";

  const n = (value: number) => faNumber.format(value);
  const days = Math.floor(parts.hours / 24);
  const hours = parts.hours % 24;
  const chunks: string[] = [];

  if (days > 0) {
    chunks.push(`${n(days)} روز`);
    if (hours > 0) chunks.push(`${n(hours)} ساعت`);
  } else if (hours > 0) {
    chunks.push(`${n(hours)} ساعت`);
    if (parts.minutes > 0) chunks.push(`${n(parts.minutes)} دقیقه`);
  } else if (parts.minutes > 0) {
    chunks.push(`${n(parts.minutes)} دقیقه`);
    if (parts.seconds > 0) chunks.push(`${n(parts.seconds)} ثانیه`);
  } else {
    chunks.push(`${n(parts.seconds)} ثانیه`);
  }

  return `${chunks.join(" و ")} باقی مانده`;
}

/** Minimal structural view of a product row's ACTIVE discount (public shape). */
export interface DiscountEndsAtSource {
  discount?: { endsAt?: string | null } | null;
}

/**
 * Earliest finite `discount.endsAt` (epoch ms) among the given products, or
 * `null` when none is finite and in the future. Drives the section-level
 * countdown + the single refetch-per-expiry cycle. Already-expired or
 * malformed timestamps are skipped defensively (the server never sends them).
 */
export function findNearestDiscountEndsAt(
  products: DiscountEndsAtSource[],
  now: Date = new Date()
): number | null {
  const nowMs = now.getTime();
  let nearest: number | null = null;
  for (const product of products) {
    const endsAt = product.discount?.endsAt;
    if (!endsAt) continue;
    const ms = new Date(endsAt).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms <= nowMs) continue;
    if (nearest === null || ms < nearest) nearest = ms;
  }
  return nearest;
}
