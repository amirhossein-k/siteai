"use client";

import { REPORT_TITLES } from "@/lib/report-titles";

export type CellFormat = "money" | "count" | "date" | "text" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  format?: CellFormat;
  align?: "right" | "center";
  width?: string;
  className?: string;
}

/** Format a single cell for display (fa-IR). Money = whole toman digits. */
export function formatCell(value: unknown, format: CellFormat = "text"): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "money":
    case "count": {
      const n = Number(value);
      return Number.isFinite(n) ? new Intl.NumberFormat("fa-IR").format(n) : String(value);
    }
    case "percent": {
      const n = Number(value);
      return Number.isFinite(n) ? `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(n)}٪` : String(value);
    }
    case "date": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
    default:
      return String(value);
  }
}

export interface ReportMeta {
  title: string;
  description: string;
  columns: ReportColumn[];
  /** Which filters make sense for this report. */
  filters: {
    preset: boolean;
    status?: boolean;
    paymentStatus?: boolean;
    method?: boolean;
    category?: boolean;
    q?: boolean;
    coupon?: boolean;
  };
  /** Keys that receive a bold totals footer row. */
  totalKeys: string[];
}

function moneyColumn(key: string, label: string): ReportColumn {
  return { key, label: `${label} (تومان)`, format: "money", align: "right" };
}

export const REPORT_META: Record<string, ReportMeta> = {
  sales: {
    title: REPORT_TITLES.sales,
    description: "فروش هر محصول بر اساس اسنپ‌شات قیمت زمان خرید (قیمت فعلی محصول استفاده نمی‌شود)",
    filters: { preset: true, category: true, q: true },
    totalKeys: ["quantity", "grossSales", "productDiscount", "couponDiscount", "netSales", "cogs", "returnedQuantity", "returnedAmount", "netSalesAfterReturns"],
    columns: [
      { key: "name", label: "نام محصول" },
      { key: "sku", label: "SKU", className: "font-mono text-xs" },
      { key: "category", label: "دسته‌بندی" },
      { key: "quantity", label: "تعداد", format: "count", align: "right" },
      moneyColumn("avgUnitPrice", "قیمت میانگین واحد"),
      moneyColumn("grossSales", "فروش ناخالص"),
      moneyColumn("productDiscount", "تخفیف محصول"),
      moneyColumn("couponDiscount", "تخفیف کوپن"),
      moneyColumn("netSales", "فروش خالص"),
      moneyColumn("cogs", "COGS"),
      { key: "returnedQuantity", label: "تعداد بازگشتی", format: "count", align: "right" },
      moneyColumn("returnedAmount", "مبلغ بازگشتی"),
      { key: "netQuantity", label: "تعداد خالص", format: "count", align: "right" },
      moneyColumn("netSalesAfterReturns", "فروش خالص پس از بازگشت"),
      { key: "firstSaleAt", label: "اولین فروش", format: "date" },
      { key: "lastSaleAt", label: "آخرین فروش", format: "date" },
    ],
  },
  orders: {
    title: REPORT_TITLES.orders,
    description: "گزارش سفارش‌ها با مبالغ ناخالص، تخفیف‌ها، مبلغ نهایی و وضعیت پرداخت",
    filters: { preset: true, status: true, paymentStatus: true, q: true },
    totalKeys: ["grossAmount", "productDiscount", "couponDiscount", "netAmount", "paidAmount", "refundedAmount", "outstandingAmount"],
    columns: [
      { key: "orderNo", label: "شماره", className: "font-mono text-xs" },
      { key: "createdAt", label: "تاریخ", format: "date" },
      { key: "customerName", label: "مشتری" },
      { key: "customerPhone", label: "تلفن", className: "font-mono text-xs" },
      { key: "status", label: "وضعیت" },
      { key: "paymentStatus", label: "پرداخت" },
      { key: "paymentMethod", label: "روش" },
      { key: "itemsCount", label: "اقلام", format: "count", align: "right" },
      moneyColumn("grossAmount", "ناخالص"),
      moneyColumn("productDiscount", "تخفیف محصول"),
      moneyColumn("couponDiscount", "تخفیف کوپن"),
      moneyColumn("netAmount", "نهایی"),
      moneyColumn("paidAmount", "پرداخت‌شده"),
      moneyColumn("refundedAmount", "بازپرداخت"),
      moneyColumn("outstandingAmount", "معوق"),
    ],
  },
  payments: {
    title: REPORT_TITLES.payments,
    description: "وضعیت پرداخت سفارش‌ها — مبلغ سفارش، مبلغ واقعی پرداخت‌شده، بازپرداخت و معوق",
    filters: { preset: true, paymentStatus: true, method: true },
    totalKeys: ["amount", "paidAmount", "refundedAmount", "outstandingAmount"],
    columns: [
      { key: "orderNo", label: "شماره", className: "font-mono text-xs" },
      { key: "createdAt", label: "تاریخ", format: "date" },
      { key: "paidAt", label: "تاریخ پرداخت", format: "date" },
      { key: "customerName", label: "مشتری" },
      { key: "method", label: "روش" },
      { key: "status", label: "وضعیت" },
      { key: "refId", label: "کد رهگیری", className: "font-mono text-xs" },
      moneyColumn("amount", "مبلغ سفارش"),
      moneyColumn("paidAmount", "پرداخت‌شده"),
      moneyColumn("refundedAmount", "بازپرداخت"),
      moneyColumn("outstandingAmount", "معوق"),
    ],
  },
  refunds: {
    title: REPORT_TITLES.refunds,
    description: "بازپرداخت‌های سفارش (سطح سفارش — جزئیات کالایی ثبت نمی‌شود)",
    filters: { preset: true, q: true },
    totalKeys: ["refundAmount"],
    columns: [
      { key: "orderNo", label: "شماره", className: "font-mono text-xs" },
      { key: "createdAt", label: "تاریخ سفارش", format: "date" },
      { key: "refundedAt", label: "تاریخ بازپرداخت", format: "date" },
      { key: "customerName", label: "مشتری" },
      { key: "products", label: "محصولات" },
      moneyColumn("refundAmount", "مبلغ بازپرداخت"),
      { key: "reason", label: "دلیل" },
      { key: "refundedBy", label: "بازپرداخت توسط" },
      { key: "paymentRefId", label: "کد رهگیری", className: "font-mono text-xs" },
    ],
  },
  coupons: {
    title: REPORT_TITLES.coupons,
    description: "عملکرد کدهای تخفیف — فقط تخفیف کوپن (بدون تخفیف محصول) شمارش می‌شود",
    filters: { preset: true, coupon: true },
    totalKeys: ["uses", "grossSales", "totalDiscount", "netSales"],
    columns: [
      { key: "code", label: "کد", className: "font-mono" },
      { key: "type", label: "نوع" },
      { key: "value", label: "مقدار", format: "count", align: "right" },
      { key: "isActive", label: "فعال" },
      { key: "uses", label: "استفاده", format: "count", align: "right" },
      moneyColumn("grossSales", "فروش ناخالص"),
      moneyColumn("totalDiscount", "تخفیف اعمال‌شده"),
      moneyColumn("netSales", "فروش خالص"),
      moneyColumn("avgOrderValue", "میانگین سفارش"),
      { key: "firstUseAt", label: "اولین استفاده", format: "date" },
      { key: "lastUseAt", label: "آخرین استفاده", format: "date" },
    ],
  },
  customers: {
    title: REPORT_TITLES.customers,
    description: "فروش به تفکیک مشتری",
    filters: { preset: true, q: true },
    totalKeys: ["orders", "units", "grossSales", "discounts", "netSales", "refunds", "netRevenue"],
    columns: [
      { key: "name", label: "نام" },
      { key: "phone", label: "تلفن", className: "font-mono text-xs" },
      { key: "orders", label: "سفارش‌ها", format: "count", align: "right" },
      { key: "units", label: "واحد", format: "count", align: "right" },
      moneyColumn("grossSales", "فروش ناخالص"),
      moneyColumn("discounts", "تخفیف‌ها"),
      moneyColumn("netSales", "فروش خالص"),
      moneyColumn("refunds", "بازپرداخت‌ها"),
      moneyColumn("netRevenue", "درآمد خالص"),
      moneyColumn("avgOrderValue", "میانگین سفارش"),
      { key: "firstOrderAt", label: "اولین سفارش", format: "date" },
      { key: "lastOrderAt", label: "آخرین سفارش", format: "date" },
    ],
  },
  inventory: {
    title: REPORT_TITLES.inventory,
    description: "موجودی فعلی، فروش بازه و ارزش موجودی (هزینه واحد فعلی — بازسازی موجودی ابتدای بازه تقریبی است)",
    filters: { preset: true, category: true, q: true },
    totalKeys: ["currentStock", "salesQuantity", "returnedQuantity", "inventoryValue"],
    columns: [
      { key: "name", label: "نام محصول" },
      { key: "sku", label: "SKU", className: "font-mono text-xs" },
      { key: "category", label: "دسته‌بندی" },
      { key: "openingStock", label: "ابتدای بازه (بازسازی)", format: "count", align: "right" },
      { key: "salesQuantity", label: "فروش بازه", format: "count", align: "right" },
      { key: "returnedQuantity", label: "بازگشت بازه", format: "count", align: "right" },
      { key: "currentStock", label: "موجودی فعلی", format: "count", align: "right" },
      moneyColumn("unitCost", "هزینه واحد"),
      moneyColumn("inventoryValue", "ارزش موجودی"),
      moneyColumn("retailValue", "ارزش خرده‌فروشی"),
      { key: "stockStatus", label: "وضعیت" },
      { key: "movement", label: "حرکت" },
      { key: "lastSaleAt", label: "آخرین فروش", format: "date" },
    ],
  },
};

export const REPORT_NAV: Array<{ report: string; title: string }> = [
  { report: "dashboard", title: REPORT_TITLES.dashboard },
  { report: "sales", title: REPORT_TITLES.sales },
  { report: "orders", title: REPORT_TITLES.orders },
  { report: "payments", title: REPORT_TITLES.payments },
  { report: "refunds", title: REPORT_TITLES.refunds },
  { report: "coupons", title: REPORT_TITLES.coupons },
  { report: "customers", title: REPORT_TITLES.customers },
  { report: "inventory", title: REPORT_TITLES.inventory },
  { report: "pnl", title: REPORT_TITLES.pnl },
];

/** Build the canonical query string for a params object (empty values dropped). */
export function buildReportQuery(params: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.sort().join("&");
}

/** Strip report-specific filters when navigating to another report. */
export function cleanParamsForReport(report: string, params: Record<string, string>): Record<string, string> {
  const meta = REPORT_META[report];
  const keep = new Set<string>(["preset", "from", "to", "page"]);
  if (meta?.filters.status) keep.add("status");
  if (meta?.filters.paymentStatus) keep.add("paymentStatus");
  if (meta?.filters.method) keep.add("method");
  if (meta?.filters.category) keep.add("category");
  if (meta?.filters.q) keep.add("q");
  if (meta?.filters.coupon) keep.add("coupon");
  const out: Record<string, string> = {};
  for (const key of keep) {
    if (params[key]) out[key] = params[key];
  }
  return out;
}

/** Default filters when no preset chosen yet. */
export function defaultReportParams(): Record<string, string> {
  return { preset: "month" };
}
