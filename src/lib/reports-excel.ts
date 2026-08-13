/**
 * Reports — Excel export builder (Session 81).
 *
 * Generates a professional, accountant-oriented .xlsx workbook with:
 *  - a Summary sheet (title, date range, generated-at, KPI rows),
 *  - one or more detail sheets with frozen header rows, auto-filter, styled
 *    headers and formatted numbers (whole toman, one-decimal percent),
 *  - a bold totals row when totals are available.
 *
 * Dates are written as ISO strings (yyyy-mm-dd hh:mm) — unambiguous for Excel
 * regardless of the viewer's timezone. Money is written as numbers formatted
 * '#,##0'. Margins are written as fractions formatted '0.0%'.
 */

import ExcelJS from "exceljs";
import type { ReportFilters, ReportSummary } from "@/types";
import { roundToman } from "@/lib/report-utils";
import { REPORT_TITLES } from "@/lib/report-titles";

const MONEY = "#,##0";
const INTEGER = "#,##0";
const PERCENT = "0.0%";

interface Column {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
  align?: "left" | "right" | "center";
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};
const TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true };

function iso(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return String(d);
  }
}

function styleHeaderRow(row: ExcelJS.Row, count: number) {
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row.height = 22;
}

function writeDetailSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Column[],
  rows: Array<Record<string, unknown>>,
  totals?: Record<string, number>
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }));

  const headerRow = sheet.getRow(1);
  styleHeaderRow(headerRow, columns.length);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  for (const row of rows) {
    sheet.addRow(row);
  }

  if (totals && Object.keys(totals).length > 0) {
    const totalRow = sheet.addRow({});
    totalRow.font = TOTAL_FONT;
    columns.forEach((c, idx) => {
      const cell = totalRow.getCell(idx + 1);
      if (c.key === "__label") {
        cell.value = "جمع";
      } else if (c.key in totals) {
        const v = totals[c.key];
        cell.value = typeof v === "number" ? roundToman(v) : v;
        if (c.numFmt === MONEY || c.numFmt === INTEGER) {
          cell.numFmt = c.numFmt;
        }
      }
    });
  }

  // Apply number formats to data cells (headers defined via column style).
  // exceljs applies the column style to all rows automatically, but we
  // re-assert for safety and set per-cell alignment.
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    columns.forEach((c, idx) => {
      const cell = row.getCell(idx + 1);
      if (c.align) cell.alignment = { horizontal: c.align };
      if (c.numFmt === MONEY || c.numFmt === INTEGER || c.numFmt === PERCENT) {
        const v = cell.value;
        if (typeof v === "number") cell.numFmt = c.numFmt;
      }
    });
  });

  return sheet;
}

type KpiValue = { kind: "text"; label: string; value: string } | { kind: "number"; label: string; value: number; numFmt: string };

function kpi(label: string, value: number | null, fmt: "money" | "count" | "percent"): KpiValue {
  if (value === null) return { kind: "text", label, value: "نامشخص" };
  if (fmt === "money") return { kind: "number", label, value: roundToman(value), numFmt: MONEY };
  if (fmt === "percent") return { kind: "number", label, value: value / 100, numFmt: PERCENT };
  return { kind: "number", label, value, numFmt: INTEGER };
}

function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  title: string,
  filters: ReportFilters,
  summary: ReportSummary
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("خلاصه");
  sheet.columns = [{ width: 42 }, { width: 20 }];

  sheet.mergeCells("A1:B1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = `بازه گزارش: ${filters.from ?? "—"} تا ${filters.to ?? "—"}`;
  sheet.getCell("A2").font = { italic: true };
  sheet.mergeCells("A3:B3");
  sheet.getCell("A3").value = `تولید شده در: ${iso(new Date().toISOString())}`;
  sheet.getCell("A3").font = { italic: true };

  const rows: KpiValue[] = [
    kpi("تعداد سفارش‌ها", summary.orders, "count"),
    kpi("تعداد واحد فروخته‌شده", summary.unitsSold, "count"),
    kpi("فروش ناخالص", summary.grossSales, "money"),
    kpi("تخفیف محصول", summary.productDiscount, "money"),
    kpi("تخفیف کوپن", summary.couponDiscount, "money"),
    kpi("فروش خالص", summary.netSales, "money"),
    kpi("بهای تمام‌شده (COGS)", summary.cogs, "money"),
    kpi("سود ناخالص", summary.grossProfit, "money"),
    kpi("حاشیه سود ناخالص", summary.grossMargin, "percent"),
    kpi("سفارش‌های بازپرداخت‌شده", summary.refundedOrders, "count"),
    kpi("مبلغ بازپرداخت", summary.refunds, "money"),
    kpi("مبلغ پرداخت‌شده", summary.paidAmount, "money"),
    kpi("مبلغ در انتظار پرداخت", summary.pendingAmount, "money"),
    kpi("مبلغ معوق", summary.outstandingAmount, "money"),
    kpi("ارزش موجودی (به بهای تمام‌شده)", summary.inventoryValue, "money"),
  ];

  let r = 5;
  for (const item of rows) {
    sheet.getCell(`A${r}`).value = item.label;
    const vCell = sheet.getCell(`B${r}`);
    if (item.kind === "number") {
      vCell.value = item.value;
      vCell.numFmt = item.numFmt;
    } else {
      vCell.value = item.value;
    }
    r++;
  }

  // Note about unavailable metrics.
  sheet.mergeCells(`A${r + 1}:B${r + 1}`);
  sheet.getCell(`A${r + 1}`).value =
    "یادداشت: مالیات و هزینه ارسال ثبت نمی‌شوند؛ سود خالص (پس از هزینه‌ها) در دسترس نیست؛ ارزش موجودی بر اساس بهای تمام‌شده فعلی است.";
  sheet.getCell(`A${r + 1}`).font = { italic: true, size: 9 };
  sheet.getCell(`A${r + 1}`).alignment = { wrapText: true };

  return sheet;
}

// ---------------------------------------------------------------------------
// Detail column definitions
// ---------------------------------------------------------------------------

const SALES_COLUMNS: Column[] = [
  { header: "شناسه محصول", key: "productId", width: 26 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "نام محصول", key: "name", width: 34 },
  { header: "دسته‌بندی", key: "category", width: 20 },
  { header: "تعداد", key: "quantity", width: 10, numFmt: INTEGER, align: "right" },
  { header: "قیمت میانگین واحد", key: "avgUnitPrice", width: 16, numFmt: MONEY, align: "right" },
  { header: "فروش ناخالص", key: "grossSales", width: 16, numFmt: MONEY, align: "right" },
  { header: "تخفیف محصول", key: "productDiscount", width: 15, numFmt: MONEY, align: "right" },
  { header: "تخفیف کوپن", key: "couponDiscount", width: 14, numFmt: MONEY, align: "right" },
  { header: "فروش خالص", key: "netSales", width: 16, numFmt: MONEY, align: "right" },
  { header: "COGS", key: "cogs", width: 15, numFmt: MONEY, align: "right" },
  { header: "تعداد بازگشتی", key: "returnedQuantity", width: 13, numFmt: INTEGER, align: "right" },
  { header: "مبلغ بازگشتی", key: "returnedAmount", width: 15, numFmt: MONEY, align: "right" },
  { header: "تعداد خالص", key: "netQuantity", width: 11, numFmt: INTEGER, align: "right" },
  { header: "فروش خالص پس از بازگشت", key: "netSalesAfterReturns", width: 20, numFmt: MONEY, align: "right" },
  { header: "اولین فروش", key: "firstSaleAt", width: 18 },
  { header: "آخرین فروش", key: "lastSaleAt", width: 18 },
];

const ORDERS_COLUMNS: Column[] = [
  { header: "شماره سفارش", key: "orderNo", width: 12 },
  { header: "تاریخ", key: "createdAt", width: 18 },
  { header: "مشتری", key: "customerName", width: 20 },
  { header: "تلفن", key: "customerPhone", width: 14 },
  { header: "وضعیت", key: "status", width: 14 },
  { header: "پرداخت", key: "paymentStatus", width: 14 },
  { header: "روش پرداخت", key: "paymentMethod", width: 12 },
  { header: "تعداد اقلام", key: "itemsCount", width: 10, numFmt: INTEGER, align: "right" },
  { header: "مبلغ ناخالص", key: "grossAmount", width: 15, numFmt: MONEY, align: "right" },
  { header: "تخفیف محصول", key: "productDiscount", width: 13, numFmt: MONEY, align: "right" },
  { header: "تخفیف کوپن", key: "couponDiscount", width: 13, numFmt: MONEY, align: "right" },
  { header: "مبلغ نهایی", key: "netAmount", width: 15, numFmt: MONEY, align: "right" },
  { header: "پرداخت‌شده", key: "paidAmount", width: 14, numFmt: MONEY, align: "right" },
  { header: "بازپرداخت", key: "refundedAmount", width: 14, numFmt: MONEY, align: "right" },
  { header: "معوق", key: "outstandingAmount", width: 14, numFmt: MONEY, align: "right" },
];

const PAYMENTS_COLUMNS: Column[] = [
  { header: "شماره سفارش", key: "orderNo", width: 12 },
  { header: "تاریخ", key: "createdAt", width: 18 },
  { header: "تاریخ پرداخت", key: "paidAt", width: 18 },
  { header: "مشتری", key: "customerName", width: 20 },
  { header: "تلفن", key: "customerPhone", width: 14 },
  { header: "روش", key: "method", width: 12 },
  { header: "وضعیت", key: "status", width: 14 },
  { header: "کد رهگیری", key: "refId", width: 20 },
  { header: "Authority", key: "authority", width: 24 },
  { header: "مبلغ سفارش", key: "amount", width: 14, numFmt: MONEY, align: "right" },
  { header: "پرداخت‌شده", key: "paidAmount", width: 14, numFmt: MONEY, align: "right" },
  { header: "بازپرداخت", key: "refundedAmount", width: 14, numFmt: MONEY, align: "right" },
  { header: "معوق", key: "outstandingAmount", width: 14, numFmt: MONEY, align: "right" },
];

const REFUNDS_COLUMNS: Column[] = [
  { header: "شماره سفارش", key: "orderNo", width: 12 },
  { header: "تاریخ سفارش", key: "createdAt", width: 18 },
  { header: "تاریخ بازپرداخت", key: "refundedAt", width: 18 },
  { header: "مشتری", key: "customerName", width: 20 },
  { header: "تلفن", key: "customerPhone", width: 14 },
  { header: "محصولات", key: "products", width: 44 },
  { header: "مبلغ بازپرداخت", key: "refundAmount", width: 16, numFmt: MONEY, align: "right" },
  { header: "دلیل", key: "reason", width: 30 },
  { header: "بازپرداخت توسط", key: "refundedBy", width: 18 },
  { header: "کد رهگیری پرداخت", key: "paymentRefId", width: 20 },
];

const COUPONS_COLUMNS: Column[] = [
  { header: "کد", key: "code", width: 18 },
  { header: "نوع", key: "type", width: 10 },
  { header: "مقدار", key: "value", width: 10, numFmt: MONEY, align: "right" },
  { header: "فعال", key: "isActive", width: 8 },
  { header: "استفاده در بازه", key: "uses", width: 13, numFmt: INTEGER, align: "right" },
  { header: "سفارش‌ها", key: "orders", width: 10, numFmt: INTEGER, align: "right" },
  { header: "فروش ناخالص", key: "grossSales", width: 15, numFmt: MONEY, align: "right" },
  { header: "تخفیف اعمال‌شده", key: "totalDiscount", width: 16, numFmt: MONEY, align: "right" },
  { header: "فروش خالص", key: "netSales", width: 15, numFmt: MONEY, align: "right" },
  { header: "میانگین سفارش", key: "avgOrderValue", width: 14, numFmt: MONEY, align: "right" },
  { header: "اولین استفاده", key: "firstUseAt", width: 18 },
  { header: "آخرین استفاده", key: "lastUseAt", width: 18 },
  { header: "پایان اعتبار", key: "endsAt", width: 18 },
];

const CUSTOMERS_COLUMNS: Column[] = [
  { header: "شناسه مشتری", key: "customerId", width: 26 },
  { header: "نام", key: "name", width: 22 },
  { header: "تلفن", key: "phone", width: 14 },
  { header: "سفارش‌ها", key: "orders", width: 10, numFmt: INTEGER, align: "right" },
  { header: "تعداد واحد", key: "units", width: 10, numFmt: INTEGER, align: "right" },
  { header: "فروش ناخالص", key: "grossSales", width: 15, numFmt: MONEY, align: "right" },
  { header: "تخفیف‌ها", key: "discounts", width: 13, numFmt: MONEY, align: "right" },
  { header: "فروش خالص", key: "netSales", width: 15, numFmt: MONEY, align: "right" },
  { header: "بازپرداخت‌ها", key: "refunds", width: 13, numFmt: MONEY, align: "right" },
  { header: "درآمد خالص", key: "netRevenue", width: 14, numFmt: MONEY, align: "right" },
  { header: "میانگین سفارش", key: "avgOrderValue", width: 14, numFmt: MONEY, align: "right" },
  { header: "اولین سفارش", key: "firstOrderAt", width: 18 },
  { header: "آخرین سفارش", key: "lastOrderAt", width: 18 },
];

const INVENTORY_COLUMNS: Column[] = [
  { header: "شناسه محصول", key: "productId", width: 26 },
  { header: "SKU", key: "sku", width: 20 },
  { header: "نام محصول", key: "name", width: 34 },
  { header: "دسته‌بندی", key: "category", width: 20 },
  { header: "موجودی ابتدای بازه (بازسازی)", key: "openingStock", width: 24, numFmt: INTEGER, align: "right" },
  { header: "فروش بازه", key: "salesQuantity", width: 12, numFmt: INTEGER, align: "right" },
  { header: "بازگشت بازه", key: "returnedQuantity", width: 12, numFmt: INTEGER, align: "right" },
  { header: "موجودی فعلی", key: "currentStock", width: 12, numFmt: INTEGER, align: "right" },
  { header: "هزینه واحد", key: "unitCost", width: 12, numFmt: MONEY, align: "right" },
  { header: "ارزش موجودی", key: "inventoryValue", width: 14, numFmt: MONEY, align: "right" },
  { header: "ارزش خرده‌فروشی", key: "retailValue", width: 15, numFmt: MONEY, align: "right" },
  { header: "وضعیت", key: "stockStatus", width: 12 },
  { header: "حرکت", key: "movement", width: 12 },
  { header: "آخرین فروش", key: "lastSaleAt", width: 18 },
];

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

/** Flatten nested customer objects and ISO-format date strings for Excel. */
function flattenRows<T>(
  rows: T[],
  columns: Column[]
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const out: Record<string, unknown> = { ...r };
    const cust = r.customer as { name?: string; phone?: string } | null | undefined;
    if (cust) {
      out.customerName = cust.name ?? "";
      out.customerPhone = cust.phone ?? "";
    } else {
      out.customerName = "";
      out.customerPhone = "";
    }
    for (const col of columns) {
      const v = out[col.key];
      if (
        typeof v === "string" &&
        (col.key.endsWith("At") ||
          col.key === "createdAt" ||
          col.key === "paidAt" ||
          col.key === "refundedAt")
      ) {
        out[col.key] = iso(v);
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

type EnvelopeWithRows<T = unknown> = {
  filters: ReportFilters;
  summary: ReportSummary;
  rows: T[];
  totals?: Record<string, number>;
};

/** Build a workbook for a single (non-dashboard) report. */
export function buildReportWorkbook<T>(
  slug: string,
  data: EnvelopeWithRows<T>,
  filters: ReportFilters
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "فروشگاه من";
  writeSummarySheet(workbook, REPORT_TITLES[slug] ?? slug, filters, data.summary);

  let columns: Column[] = [];
  let sheetName = "";

  switch (slug) {
    case "sales":
      columns = SALES_COLUMNS;
      sheetName = "فروش";
      break;
    case "orders":
      columns = ORDERS_COLUMNS;
      sheetName = "سفارش‌ها";
      break;
    case "payments":
      columns = PAYMENTS_COLUMNS;
      sheetName = "پرداخت‌ها";
      break;
    case "refunds":
      columns = REFUNDS_COLUMNS;
      sheetName = "بازگشت‌ها";
      break;
    case "coupons":
      columns = COUPONS_COLUMNS;
      sheetName = "کوپن‌ها";
      break;
    case "customers":
      columns = CUSTOMERS_COLUMNS;
      sheetName = "مشتریان";
      break;
    case "inventory":
      columns = INVENTORY_COLUMNS;
      sheetName = "موجودی";
      break;
    case "pnl": {
      const pnl = data as unknown as {
        current: { summary: ReportSummary; rows: Array<Record<string, unknown>> };
        previous?: { summary: ReportSummary; rows: Array<Record<string, unknown>> } | null;
      };
      writePnlSheet(workbook, pnl);
      return workbook;
    }
    default:
      return workbook;
  }

  writeDetailSheet(
    workbook,
    sheetName,
    columns,
    flattenRows(data.rows as Array<Record<string, unknown>>, columns),
    data.totals
  );
  return workbook;
}

/** P&L sheet — a statement (title / section / amount / %) with previous period. */
function writePnlSheet(
  workbook: ExcelJS.Workbook,
  pnl: {
    current: { summary: ReportSummary; rows: Array<unknown> };
    previous?: { summary: ReportSummary; rows: Array<unknown> } | null;
  }
) {
  const sheet = workbook.addWorksheet("سود و زیان");
  const columns: Column[] = [
    { header: "عنوان", key: "__label", width: 34 },
    { header: "مبلغ دوره جاری", key: "__amount", width: 18, numFmt: MONEY, align: "right" },
    { header: "درصد", key: "__percent", width: 10, numFmt: PERCENT, align: "right" },
    { header: "مبلغ دوره قبل", key: "__prev", width: 18, numFmt: MONEY, align: "right" },
  ];
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  styleHeaderRow(sheet.getRow(1), columns.length);

  const prevAmount = new Map<string, number>();
  for (const row of pnl.previous?.rows ?? []) {
    const r = row as { key?: unknown; amount?: unknown };
    if (typeof r.amount === "number" && typeof r.key === "string") {
      prevAmount.set(r.key, r.amount);
    }
  }

  const typedCurrent = pnl.current.rows as Array<{
    key: string;
    label: string;
    amount: number | null;
    percent: number | null;
    unavailable?: boolean;
  }>;
  for (const row of typedCurrent) {
    const amount = row.amount;
    const prev = prevAmount.get(row.key);
    sheet.addRow({
      __label: row.unavailable ? `${row.label} (در دسترس نیست)` : row.label,
      __amount: amount,
      __percent: row.percent !== null ? row.percent / 100 : null,
      __prev: prev,
    });
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const amountCell = row.getCell(2);
    if (typeof amountCell.value === "number") amountCell.numFmt = MONEY;
    const pctCell = row.getCell(3);
    if (typeof pctCell.value === "number") pctCell.numFmt = PERCENT;
    const prevCell = row.getCell(4);
    if (typeof prevCell.value === "number") prevCell.numFmt = MONEY;
  });
}

/** Full dashboard workbook: Summary + P&L + all detail sheets. */
export function buildDashboardWorkbook(data: {
  filters: ReportFilters;
  summary: ReportSummary;
  sales: EnvelopeWithRows<unknown>;
  orders: EnvelopeWithRows<unknown>;
  payments: EnvelopeWithRows<unknown>;
  refunds: EnvelopeWithRows<unknown>;
  coupons: EnvelopeWithRows<unknown>;
  customers: EnvelopeWithRows<unknown>;
  inventory: EnvelopeWithRows<unknown>;
  pnl: {
    current: { summary: ReportSummary; rows: Array<unknown> };
    previous?: { summary: ReportSummary; rows: Array<unknown> } | null;
  };
}): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "فروشگاه من";
  writeSummarySheet(workbook, REPORT_TITLES.dashboard, data.filters, data.summary);

  writePnlSheet(workbook, data.pnl);
  writeDetailSheet(workbook, "فروش", SALES_COLUMNS, flattenRows(data.sales.rows, SALES_COLUMNS), data.sales.totals);
  writeDetailSheet(workbook, "سفارش‌ها", ORDERS_COLUMNS, flattenRows(data.orders.rows, ORDERS_COLUMNS), data.orders.totals);
  writeDetailSheet(workbook, "پرداخت‌ها", PAYMENTS_COLUMNS, flattenRows(data.payments.rows, PAYMENTS_COLUMNS), data.payments.totals);
  writeDetailSheet(workbook, "بازگشت‌ها", REFUNDS_COLUMNS, flattenRows(data.refunds.rows, REFUNDS_COLUMNS), data.refunds.totals);
  writeDetailSheet(workbook, "کوپن‌ها", COUPONS_COLUMNS, flattenRows(data.coupons.rows, COUPONS_COLUMNS), data.coupons.totals);
  writeDetailSheet(workbook, "مشتریان", CUSTOMERS_COLUMNS, flattenRows(data.customers.rows, CUSTOMERS_COLUMNS), data.customers.totals);
  writeDetailSheet(workbook, "موجودی", INVENTORY_COLUMNS, flattenRows(data.inventory.rows, INVENTORY_COLUMNS), data.inventory.totals);

  return workbook;
}
