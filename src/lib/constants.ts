/**
 * Application-wide constants
 */

export const APP_NAME = "فروشگاه من";
export const APP_DESCRIPTION = "فروشگاه آنلاین با بهترین قیمت‌ها";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
