/**
 * Application-wide constants
 */

export const APP_NAME = "فروشگاه من";
export const APP_DESCRIPTION = "فروشگاه آنلاین با بهترین قیمت‌ها";

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
