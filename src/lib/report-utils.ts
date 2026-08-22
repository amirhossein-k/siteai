/**
 * Reports — pure helpers (Session 81).
 *
 * Everything here is side-effect-free and DB-free so it can be unit-tested
 * hermetically (see tests/unit/report-utils.test.ts). The aggregation queries
 * themselves live in src/lib/reports.ts (server-only, Mongoose).
 *
 * Time semantics (documented, matching /api/admin/analytics):
 *  - All day boundaries are UTC. An order created at 23:30 Tehran time lands
 *    in the next UTC day — a known v1 limitation shared with the existing
 *    analytics windowing.
 *  - `from`/`to` are YYYY-MM-DD inclusive days → the effective Mongo window is
 *    [from 00:00:00, to+1d 00:00:00).
 */

import type { ReportFilters, ReportPreset } from "@/types";

export const REPORT_PRESETS: readonly ReportPreset[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "lastMonth",
  "year",
  "custom",
] as const;

export const ORDER_STATUSES = [
  "pending_payment",
  "processing",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "canceled",
  "refunded",
] as const;

export const PAYMENT_METHODS = ["zarinpal", "manual"] as const;

/** Purchase statuses (Session 82 Phase B) — the purchases report's status filter. */
export const PURCHASE_STATUSES = [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
] as const;

/** Purchase payment statuses — the purchases report's payment filter. */
export const PURCHASE_PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;

/** Expense statuses (Session 82 Phase E) — the expenses report's status filter. */
export const EXPENSE_STATUSES = ["paid", "pending", "void"] as const;

/** Expense categories (Session 82 Phase E) — the expenses report's category filter. */
export const EXPENSE_CATEGORIES = [
  "shipping",
  "packaging",
  "advertising",
  "gateway_fees",
  "rent",
  "utilities",
  "salaries",
  "software",
  "maintenance",
  "other",
] as const;

/** Low-stock threshold — the Product model has no minStock field (documented). */
export const LOW_STOCK_THRESHOLD = 5;

/** UI + API pagination bounds. */
export const REPORT_DEFAULT_LIMIT = 100;
export const REPORT_MAX_LIMIT = 500;
/** Hard row cap for aggregations / Excel exports (bounds memory). */
export const EXPORT_MAX_ROWS = 10_000;

/** 24h in ms. */
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** UTC start of the day containing `d`. */
export function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** `d` + `n` days (UTC-safe — same time-of-day, so DST cannot skew it). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** First UTC day of the month containing `d`. */
export function startOfUtcMonth(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return out;
}

/** First UTC day of the year containing `d`. */
export function startOfUtcYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

/**
 * Resolve a preset to an inclusive [from, to) range.
 * `custom` has no intrinsic range → returns null (callers must supply from/to).
 * Week = Monday-start (ISO). Month/year = UTC calendar boundaries.
 */
export function dateRangeFromPreset(
  preset: ReportPreset,
  now: Date = new Date()
): { from: Date; to: Date } | null {
  if (preset === "custom") return null;
  const today = startOfUtcDay(now);

  switch (preset) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "week": {
      // ISO Monday start: getUTCDay() 1 (Mon) → 0; 0 (Sun) → 6.
      const offset = (now.getUTCDay() + 6) % 7;
      const monday = addDays(today, -offset);
      return { from: monday, to: addDays(monday, 7) };
    }
    case "month": {
      const monthStart = startOfUtcMonth(now);
      const nextMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
      );
      return { from: monthStart, to: nextMonth };
    }
    case "lastMonth": {
      const firstOfLast = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
      );
      const firstOfThis = startOfUtcMonth(now);
      return { from: firstOfLast, to: firstOfThis };
    }
    case "year": {
      const yearStart = startOfUtcYear(now);
      return {
        from: yearStart,
        to: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)),
      };
    }
  }
}

const DATE_PARAM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a YYYY-MM-DD string into a UTC start-of-day Date.
 * Returns null for anything else (malformed / out-of-range like 2023-02-31).
 */
export function parseDateParam(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = DATE_PARAM_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers (2023-02-31 → Mar 3).
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

/** YYYY-MM-DD (UTC) for a Date — the canonical filter wire format. */
export function dateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO datetime (UTC) for a Date or null. */
export function isoOrNull(d: unknown): string | null {
  return d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toISOString()
    : null;
}

// ---------------------------------------------------------------------------
// Filter validation (whitelist everything — never trust the client)
// ---------------------------------------------------------------------------

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function parseOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const v = value.trim();
  return OBJECT_ID_RE.test(v) ? v.toLowerCase() : undefined;
}

function parseBoundedString(
  value: unknown,
  max: number
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const v = value.trim().slice(0, max);
  return v || undefined;
}

function parsePaging(
  value: Record<string, string | undefined>
): { page: number; limit: number } | { error: string } {
  const rawPage = value.page;
  const rawLimit = value.limit;
  let page = 1;
  let limit = REPORT_DEFAULT_LIMIT;
  if (rawPage !== undefined && rawPage !== "") {
    const n = Number(rawPage);
    if (!Number.isInteger(n) || n < 1) return { error: "شماره صفحه نامعتبر است" };
    page = n;
  }
  if (rawLimit !== undefined && rawLimit !== "") {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > REPORT_MAX_LIMIT) {
      return { error: `تعداد ردیف نامعتبر است (حداکثر ${REPORT_MAX_LIMIT})` };
    }
    limit = n;
  }
  return { page, limit };
}

/**
 * Parse + validate the query string for a report endpoint.
 * Returns either a valid ReportFilters or a Persian 400 error message.
 * Pure — takes an already-built Record (e.g. Object.fromEntries(searchParams)).
 */
export function parseReportFilters(
  params: Record<string, string | undefined>,
  opts?: { kind?: "order" | "purchase" | "expense" }
): { filters: ReportFilters } | { error: string } {
  const rawPreset = params.preset;
  let preset: ReportPreset | null = null;
  if (rawPreset !== undefined && rawPreset !== "") {
    if (!(REPORT_PRESETS as readonly string[]).includes(rawPreset)) {
      return { error: "بازه زمانی نامعتبر است" };
    }
    preset = rawPreset as ReportPreset;
  }

  const trendGroupRaw = parseBoundedString(params.group, 10);
  if (
    trendGroupRaw &&
    !( ["day", "week", "month"] as const).includes(
      trendGroupRaw as "day" | "week" | "month"
    )
  ) {
    return { error: "گروه‌بندی روند نامعتبر است" };
  }
  const trendGroup = trendGroupRaw as
    | "day"
    | "week"
    | "month"
    | undefined;

  const fromParam = params.from;
  const toParam = params.to;
  let from: string | null = null;
  let to: string | null = null;

  if (preset === "custom" || fromParam || toParam) {
    const fromDate = parseDateParam(fromParam ?? "");
    const toDate = parseDateParam(toParam ?? "");
    if (!fromDate || !toDate) {
      return { error: "تاریخ شروع و پایان (YYYY-MM-DD) الزامی است" };
    }
    if (fromDate.getTime() > toDate.getTime()) {
      return { error: "تاریخ شروع باید قبل از تاریخ پایان باشد" };
    }
    from = dateParam(fromDate);
    to = dateParam(toDate);
  } else if (preset) {
    const range = dateRangeFromPreset(preset);
    if (range) {
      from = dateParam(range.from);
      to = dateParam(addDays(range.to, -1));
    }
  }

  if (!from || !to) {
    return { error: "بازه زمانی گزارش مشخص نشده است" };
  }

  const isPurchase = opts?.kind === "purchase";
  const isExpense = opts?.kind === "expense";
  const statusList = isPurchase
    ? PURCHASE_STATUSES
    : isExpense
      ? EXPENSE_STATUSES
      : ORDER_STATUSES;
  const paymentStatusList = isPurchase
    ? PURCHASE_PAYMENT_STATUSES
    : PAYMENT_STATUSES;
  const statusLabel = isPurchase ? "وضعیت خرید" : isExpense ? "وضعیت هزینه" : "وضعیت سفارش";
  const paymentLabel = isPurchase ? "وضعیت پرداخت خرید" : "وضعیت پرداخت";

  const orderStatus = parseBoundedString(params.status, 30);
  if (orderStatus && !(statusList as readonly string[]).includes(orderStatus)) {
    return { error: `${statusLabel} نامعتبر است` };
  }
  const purchaseStatus = isPurchase ? orderStatus : undefined;
  const expenseStatus = isExpense ? orderStatus : undefined;

  // Expenses use an ENUM category (not a product ObjectId) — `category` is
  // validated against EXPENSE_CATEGORIES and mapped to expenseCategory.
  const expenseCategoryRaw = parseBoundedString(params.category, 30);
  let expenseCategory: string | undefined;
  if (isExpense) {
    if (
      expenseCategoryRaw &&
      !(EXPENSE_CATEGORIES as readonly string[]).includes(expenseCategoryRaw)
    ) {
      return { error: "دسته‌بندی هزینه نامعتبر است" };
    }
    expenseCategory = expenseCategoryRaw || undefined;
  }

  const paymentStatus = parseBoundedString(params.paymentStatus, 30);
  if (
    paymentStatus &&
    !(paymentStatusList as readonly string[]).includes(paymentStatus)
  ) {
    return { error: `${paymentLabel} نامعتبر است` };
  }
  const paymentMethod = parseBoundedString(params.method, 30);
  if (
    paymentMethod &&
    !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
  ) {
    return { error: "روش پرداخت نامعتبر است" };
  }

  const paging = parsePaging(params);
  if ("error" in paging) return paging;

  return {
    filters: {
      preset,
      from,
      to,
      productId: parseOptionalId(params.product),
      categoryId: parseOptionalId(params.category),
      customerId: parseOptionalId(params.customer),
      orderStatus: isPurchase || isExpense ? undefined : orderStatus,
      purchaseStatus,
      expenseStatus,
      expenseCategory,
      trendGroup,
      paymentStatus,
      paymentMethod,
      coupon: parseBoundedString(params.coupon, 50),
      q: parseBoundedString(params.q, 100),
      page: paging.page,
      limit: paging.limit,
    },
  };
}

// ---------------------------------------------------------------------------
// Money + discount allocation
// ---------------------------------------------------------------------------

/** Whole-toman rounding (the store's currency convention). */
export function roundToman(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Percentage with one decimal, or null when the whole is 0/absent. */
export function safePct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Allocate an order-level coupon discount across its lines, proportionally to
 * each line's net value. Guarantees Σ allocated == couponAmount (subject to
 * per-line toman rounding; the last line absorbs the residual) so every
 * product-level report reconciles to the order totals.
 *
 * @param lineNets  per-line net amounts (items.price × items.quantity)
 * @param couponAmount  order-level discount.amount
 */
export function allocateCouponToLines(
  lineNets: number[],
  couponAmount: number
): number[] {
  if (!Array.isArray(lineNets) || lineNets.length === 0) {
    return [];
  }
  const totalNet = lineNets.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (totalNet <= 0 || couponAmount <= 0) {
    return lineNets.map(() => 0);
  }
  const allocated = lineNets.map((net) => roundToman((net / totalNet) * couponAmount));
  // Residual correction (rounding) — last line absorbs the difference.
  const residual = roundToman(couponAmount) - allocated.reduce((a, b) => a + b, 0);
  if (residual !== 0 && allocated.length > 0) {
    allocated[allocated.length - 1] = roundToman(
      allocated[allocated.length - 1] + residual
    );
  }
  return allocated;
}

/** Persian plural-aware relative label for a stock/movement status. */
export function stockStatusLabel(status: string): string {
  switch (status) {
    case "in_stock":
      return "موجود";
    case "low_stock":
      return "کم موجود";
    case "out_of_stock":
      return "ناموجود";
    default:
      return status;
  }
}
