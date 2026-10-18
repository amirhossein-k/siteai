/**
 * Persian (Jalali) date + time rendering for SERVER-rendered labels (Session 93).
 *
 * The storefront's interactive dates use the RUNTIME's time zone
 * (src/lib/utils.ts `formatDate` / inline `toLocaleDateString` in client
 * components). This helper exists for labels rendered during SSR — today the
 * product price stamp on the public detail payload — where the emitted string
 * must be identical on every host: the time zone is pinned to the store's zone
 * (STORE_TIMEZONE) instead of the server's TZ (the VPS runs UTC, which would
 * shift every local evening timestamp to the previous day).
 *
 * Rendering goes through `Intl` with the `fa-IR` locale, which yields the
 * Persian calendar + Persian digits — the same mechanism `formatPrice`
 * (src/lib/utils.ts) and `formatPersianRemaining` (src/lib/discount-countdown.ts)
 * already use. Never a hand-written digit map or hand-rolled Jalali conversion.
 */

import { STORE_TIMEZONE } from "@/lib/constants";

const persianDateTime = new Intl.DateTimeFormat("fa-IR", {
  timeZone: STORE_TIMEZONE,
  calendar: "persian",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  // `hourCycle: "h23"` (NOT `hour12: false`, which ICU may map to h24): midnight
  // renders as ۰۰:۰۰ instead of ۲۴:۰۰, and no «قبل از ظهر / بعد از ظهر» day
  // period ever leaks into a label.
  hourCycle: "h23",
});

/**
 * Format an instant as a Jalali date + clock time, e.g.
 * «۲۵ آبان ۱۴۰۳ ساعت ۰۳:۳۰».
 *
 * The TIME is part of the contract: the price-stamp label says WHEN the pricing
 * configuration changed, which a date alone cannot express (two edits on the
 * same day are indistinguishable without the hour/minute). The export keeps the
 * `formatPersianDate` name from the approved plan; only its options gained the
 * hour/minute fields.
 *
 * Returns `null` — never "Invalid Date" — for a missing (null/undefined/""),
 * malformed or non-parseable value, so callers can branch on the absence of a
 * label instead of printing a broken string.
 */
export function formatPersianDate(
  value: Date | string | null | undefined
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return persianDateTime.format(date);
}