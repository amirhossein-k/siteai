/**
 * Application-wide constants
 */

export const APP_NAME = "مارلو شاپ";
export const APP_DESCRIPTION =
  "مارلو شاپ یک فروشگاه اینترنتی برای خرید آنلاین محصولات باکیفیت، قیمت مناسب و ارسال سریع است.";
export const APP_TAGLINE = "تجربه خرید هوشمند، سریع و مطمئن";
export const APP_ALTERNATE_NAMES = [
  "مارلو شاپ",
  "مارلو",
  "Marloo",
  "MarlooShop",
  "Marloo Shop",
] as const;
export const APP_KEYWORDS = [
  "مارلو شاپ",
  "فروشگاه اینترنتی",
  "خرید آنلاین",
  "بهترین قیمت",
  "تخفیف ویژه",
  "مشاور خرید هوشمند",
  "marloo shop",
];

/**
 * The public origin — the SINGLE source of truth for canonical URLs, the
 * sitemap, Open Graph, JSON-LD and robots (Session 71 audit).
 *
 * Dev-only fallback: localhost. Production FAILS FAST on a missing or
 * malformed NEXT_PUBLIC_APP_URL instead of silently emitting incorrect SEO
 * URLs — a production app must never serve canonical/OG/JSON-LD pointing at
 * http://localhost (or a schemeless string). CI runs dev servers only
 * (NODE_ENV=development), so this guard never affects test runs.
 */
const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL;
if (process.env.NODE_ENV === "production") {
  if (!rawAppUrl || !/^https?:\/\//.test(rawAppUrl)) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be set to the public HTTPS origin in production " +
        "(e.g. https://mystore.com) — canonical, sitemap, Open Graph and " +
        "JSON-LD URLs are derived from it."
    );
  }
}
export const APP_URL = rawAppUrl || "http://localhost:3000";

export const ROLES = {
  CUSTOMER: "customer",
  SUPPLIER: "supplier",
  ADMIN: "admin",
} as const;

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  ADMIN: "/admin",
  SUPPLIER: "/supplier",
} as const;

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

/**
 * Price-stamp policy (Session 93) — the CAS (compare-and-set) contract behind
 * `Product.priceLastUpdatedAt`.
 *
 * A price write is a BOUNDED read → conditional-write loop: the snapshot
 * carries the product's `priceVersion` token and the write only lands while the
 * stored token still equals it. `PRICE_STAMP_MAX_ATTEMPTS` (3) bounds that
 * loop; the 4th conflict is a genuine concurrent-edit storm and is REPORTED
 * (HTTP 409), never resolved by an unconditional fallback write.
 */
export const PRICE_STAMP_MAX_ATTEMPTS = 3;

/**
 * Store time zone (Asia/Tehran, UTC+03:30) — the SINGLE zone constant for
 * Jalali date + time labels rendered SERVER-side, today the product price stamp
 * on the public detail payload (src/lib/persian-date.ts). Pinned explicitly so
 * a rendered label never depends on the host TZ (the VPS runs UTC, browsers run
 * the visitor's zone) and stays deterministic in tests.
 * Client-rendered dates keep using the runtime zone (src/lib/utils.ts).
 */
export const STORE_TIMEZONE = "Asia/Tehran";

/**
 * 409 body for an exhausted price-stamp CAS (the product's `priceVersion`
 * changed under every attempt — a genuine concurrent-edit storm). Never
 * resolved by an unconditional fallback write; the caller retries with fresh
 * data.
 */
export const PRICE_CONFLICT_ERROR =
  "قیمت این محصول همزمان تغییر کرده است؛ لطفاً دوباره تلاش کنید";
