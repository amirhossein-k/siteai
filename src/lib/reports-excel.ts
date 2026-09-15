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
import type { AccountingExportData } from "@/lib/accounting-v2";

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
    "یادداشت: مالیات و هزینه ارسال ثبت نمی‌شوند؛ ارزش موجودی بر اساس بهای تمام‌شده فعلی است. سود خالص = سود ناخالص − هزینه‌های عملیاتی ثبت‌شده در دفتر هزینه‌ها.";
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

const PURCHASES_COLUMNS: Column[] = [
  { header: "شماره خرید", key: "number", width: 20 },
  { header: "تاریخ خرید", key: "purchaseDate", width: 18 },
  { header: "تأمین‌کننده", key: "supplierName", width: 26 },
  { header: "وضعیت", key: "status", width: 14 },
  { header: "وضعیت پرداخت", key: "paymentStatus", width: 14 },
  { header: "سفارش‌شده", key: "totalOrdered", width: 10, numFmt: INTEGER, align: "right" },
  { header: "دریافت‌شده", key: "totalReceived", width: 10, numFmt: INTEGER, align: "right" },
  { header: "باقیمانده", key: "totalOutstanding", width: 10, numFmt: INTEGER, align: "right" },
  { header: "جمع جزء", key: "subtotal", width: 14, numFmt: MONEY, align: "right" },
  { header: "تخفیف", key: "discount", width: 12, numFmt: MONEY, align: "right" },
  { header: "هزینه اضافی", key: "additionalCosts", width: 13, numFmt: MONEY, align: "right" },
  { header: "جمع کل", key: "total", width: 14, numFmt: MONEY, align: "right" },
  { header: "پرداخت‌شده", key: "amountPaid", width: 14, numFmt: MONEY, align: "right" },
  { header: "مانده", key: "amountOutstanding", width: 14, numFmt: MONEY, align: "right" },
];

const EXPENSES_COLUMNS: Column[] = [
  { header: "تاریخ", key: "expenseDate", width: 18 },
  { header: "دسته‌بندی", key: "categoryLabel", width: 22 },
  { header: "شرح", key: "description", width: 40 },
  { header: "مبلغ (تومان)", key: "amount", width: 15, numFmt: MONEY, align: "right" },
  { header: "روش پرداخت", key: "paymentMethodLabel", width: 16 },
  { header: "مرجع", key: "reference", width: 20 },
  { header: "دریافت‌کننده", key: "payee", width: 20 },
  { header: "وضعیت", key: "statusLabel", width: 14 },
  { header: "ثبت توسط", key: "createdByName", width: 18 },
  { header: "باطل در", key: "voidedAt", width: 18 },
  { header: "دلیل باطل‌سازی", key: "voidReason", width: 30 },
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
// Accounting V2 columns (Session 82 Phase F — the accounting workbook)
// ---------------------------------------------------------------------------

const ORDER_ITEMS_COLUMNS: Column[] = [
  { header: "شماره سفارش", key: "orderNo", width: 12 },
  { header: "تاریخ", key: "createdAt", width: 18 },
  { header: "وضعیت سفارش", key: "orderStatus", width: 14 },
  { header: "وضعیت پرداخت", key: "paymentStatus", width: 14 },
  { header: "شناسه محصول", key: "productId", width: 26 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "نام محصول", key: "name", width: 34 },
  { header: "واریانت", key: "variantLabel", width: 14 },
  { header: "تعداد", key: "quantity", width: 10, numFmt: INTEGER, align: "right" },
  { header: "قیمت واحد فروش", key: "unitPrice", width: 16, numFmt: MONEY, align: "right" },
  { header: "قیمت اصلی", key: "originalPrice", width: 14, numFmt: MONEY, align: "right" },
  { header: "تخفیف محصول", key: "productDiscount", width: 15, numFmt: MONEY, align: "right" },
  { header: "سهم کوپن", key: "couponAllocation", width: 14, numFmt: MONEY, align: "right" },
  { header: "فروش خالص", key: "netSales", width: 16, numFmt: MONEY, align: "right" },
  { header: "بهای واحد FIFO", key: "fifoUnitCost", width: 14, numFmt: MONEY, align: "right" },
  { header: "COGS", key: "cogs", width: 15, numFmt: MONEY, align: "right" },
  { header: "منبع COGS", key: "cogsSourceLabel", width: 28 },
  { header: "سود ناخالص", key: "grossProfit", width: 16, numFmt: MONEY, align: "right" },
  { header: "حاشیه", key: "grossMargin", width: 10, numFmt: PERCENT, align: "right" },
];

const PURCHASE_ITEMS_COLUMNS: Column[] = [
  { header: "شماره خرید", key: "number", width: 20 },
  { header: "تاریخ خرید", key: "purchaseDate", width: 18 },
  { header: "تأمین‌کننده", key: "supplierName", width: 26 },
  { header: "نام محصول", key: "name", width: 34 },
  { header: "واریانت", key: "variantLabel", width: 14 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "سفارش‌شده", key: "ordered", width: 10, numFmt: INTEGER, align: "right" },
  { header: "دریافت‌شده", key: "received", width: 10, numFmt: INTEGER, align: "right" },
  { header: "باقیمانده", key: "remaining", width: 10, numFmt: INTEGER, align: "right" },
  { header: "بهای واحد", key: "unitCost", width: 14, numFmt: MONEY, align: "right" },
  { header: "جمع ردیف", key: "lineTotal", width: 15, numFmt: MONEY, align: "right" },
  { header: "وضعیت خرید", key: "status", width: 14 },
  { header: "وضعیت پرداخت", key: "paymentStatus", width: 14 },
  { header: "پرداخت‌شده", key: "amountPaid", width: 14, numFmt: MONEY, align: "right" },
  { header: "مانده", key: "amountOutstanding", width: 14, numFmt: MONEY, align: "right" },
  { header: "مرجع", key: "reference", width: 20 },
];

const MOVEMENTS_COLUMNS: Column[] = [
  { header: "تاریخ", key: "createdAt", width: 18 },
  { header: "نام محصول", key: "name", width: 34 },
  { header: "واریانت", key: "variantLabel", width: 14 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "نوع حرکت", key: "typeLabel", width: 20 },
  { header: "تعداد", key: "quantity", width: 10, numFmt: INTEGER, align: "right" },
  { header: "بهای واحد", key: "unitCost", width: 14, numFmt: MONEY, align: "right" },
  { header: "جمع بها", key: "totalCost", width: 15, numFmt: MONEY, align: "right" },
  { header: "مرجع منبع", key: "sourceRef", width: 34 },
  { header: "شرح", key: "description", width: 40 },
  { header: "ثبت توسط", key: "createdByName", width: 18 },
];

const LAYERS_COLUMNS: Column[] = [
  { header: "نام محصول", key: "name", width: 34 },
  { header: "واریانت", key: "variantLabel", width: 14 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "منبع لایه", key: "sourceLabel", width: 20 },
  { header: "مرجع", key: "ref", width: 34 },
  { header: "تاریخ ایجاد", key: "acquiredAt", width: 18 },
  { header: "تعداد اولیه", key: "originalQty", width: 12, numFmt: INTEGER, align: "right" },
  { header: "باقیمانده", key: "remaining", width: 10, numFmt: INTEGER, align: "right" },
  { header: "بهای واحد", key: "unitCost", width: 14, numFmt: MONEY, align: "right" },
  { header: "ارزش باقیمانده", key: "remainingValue", width: 16, numFmt: MONEY, align: "right" },
];

const COGS_COLUMNS: Column[] = [
  { header: "شماره سفارش", key: "orderNo", width: 12 },
  { header: "تاریخ", key: "createdAt", width: 18 },
  { header: "نام محصول", key: "name", width: 34 },
  { header: "واریانت", key: "variantLabel", width: 14 },
  { header: "SKU", key: "sku", width: 18 },
  { header: "تعداد", key: "quantity", width: 10, numFmt: INTEGER, align: "right" },
  { header: "بهای واحد (FIFO)", key: "fifoUnitCost", width: 16, numFmt: MONEY, align: "right" },
  { header: "COGS", key: "cogs", width: 15, numFmt: MONEY, align: "right" },
  { header: "منبع بها", key: "cogsSourceLabel", width: 30 },
  { header: "مرجع لایه/حرکت", key: "sourceRef", width: 34 },
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
  // The purchases report gets its own purchase-labeled summary sheet below —
  // the generic (order-labeled) sheet would mislabel procurement KPIs. The
  // profitability report is ALSO excluded: its payload has no `summary`
  // envelope (it returns KPIs, a waterfall, products, expenses and a trend
  // instead), so writing the generic sheet would throw on `summary.orders`.
  // Profitability builds its five dedicated sheets in its own branch below.
  if (slug !== "purchases" && slug !== "profitability") {
    writeSummarySheet(workbook, REPORT_TITLES[slug] ?? slug, filters, data.summary);
  }

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
    case "purchases": {
      writePurchaseSummarySheet(workbook, filters, data.summary);
      writeDetailSheet(
        workbook,
        "خریدها",
        PURCHASES_COLUMNS,
        flattenRows(data.rows as Array<Record<string, unknown>>, PURCHASES_COLUMNS),
        data.totals
      );
      return workbook;
    }
    case "expenses": {
      writeExpenseSummarySheet(workbook, filters, data.summary);
      writeDetailSheet(
        workbook,
        "هزینه‌ها",
        EXPENSES_COLUMNS,
        flattenRows(data.rows as Array<Record<string, unknown>>, EXPENSES_COLUMNS),
        data.totals
      );
      return workbook;
    }
    case "profitability": {
      // Profitability report — SELF-CONTAINED workbook (the generic summary
      // sheet is skipped for this slug above). Five sheets are always written
      // so the sheet set is stable regardless of the data in the window.
      const profitData = data as unknown as {
        kpis?: Array<{
          key: string;
          label: string;
          value: number | null;
          format: "money" | "percent";
          prevValue: number | null;
          changePercent: number | null;
        }>;
        waterfall?: Array<{
          key: string;
          label: string;
          amount: number;
          cumulative: number;
          subtractive: boolean;
        }>;
        products?: Array<Record<string, unknown>>;
        categories?: Array<Record<string, unknown>>;
        expenses?: Array<Record<string, unknown>>;
        trend?: Array<{
          label: string;
          from: string;
          to: string;
          netSales: number;
          cogs: number;
          grossProfit: number;
          expenses: number;
          netProfit: number;
        }>;
      };

      // --- خلاصه سودآوری (KPI summary). Money and percent KPIs live in
      // separate columns so every cell keeps its own correct number format;
      // percent values are stored as fractions (the Excel `0.0%` convention).
      const KPI_COLUMNS: Column[] = [
        { header: "شاخص", key: "label", width: 34 },
        { header: "مقدار (تومان)", key: "valueMoney", width: 20, numFmt: MONEY, align: "right" },
        { header: "مقدار (٪)", key: "valuePercent", width: 14, numFmt: PERCENT, align: "right" },
        { header: "دوره قبل (تومان)", key: "prevMoney", width: 20, numFmt: MONEY, align: "right" },
        { header: "دوره قبل (٪)", key: "prevPercent", width: 14, numFmt: PERCENT, align: "right" },
        { header: "تغییر (٪)", key: "changePercent", width: 14, numFmt: PERCENT, align: "right" },
      ];
      const kpiRows = (profitData.kpis ?? []).map((k) => {
        const isMoney = k.format === "money";
        return {
          label: k.label,
          valueMoney: isMoney && k.value !== null ? k.value : "",
          valuePercent: !isMoney && k.value !== null ? k.value / 100 : "",
          prevMoney: isMoney && k.prevValue !== null ? k.prevValue : "",
          prevPercent: !isMoney && k.prevValue !== null ? k.prevValue / 100 : "",
          changePercent: k.changePercent !== null ? k.changePercent / 100 : "",
        };
      });
      writeDetailSheet(workbook, "خلاصه سودآوری", KPI_COLUMNS, kpiRows);

      // --- آبشار سودآوری (waterfall: one row per existing step).
      const WATERFALL_COLUMNS: Column[] = [
        { header: "مرحله", key: "label", width: 28 },
        { header: "نوع", key: "kind", width: 12 },
        { header: "مبلغ (تومان)", key: "amount", width: 20, numFmt: MONEY, align: "right" },
        { header: "تجمعی (تومان)", key: "cumulative", width: 20, numFmt: MONEY, align: "right" },
      ];
      const waterfallRows = (profitData.waterfall ?? []).map((s) => ({
        label: s.label,
        kind: s.subtractive ? "کاهشی" : "افزایشی",
        amount: s.amount,
        cumulative: s.cumulative,
      }));
      writeDetailSheet(workbook, "آبشار سودآوری", WATERFALL_COLUMNS, waterfallRows);

      // --- سودآوری محصولات (columns preserved from the Foundation).
      const PROFITABILITY_COLUMNS: Column[] = [
        { header: "محصول", key: "name", width: 34 },
        { header: "SKU", key: "sku", width: 16 },
        { header: "تعداد", key: "quantity", width: 10, numFmt: INTEGER, align: "right" },
        { header: "فروش خالص", key: "netSales", width: 18, numFmt: MONEY, align: "right" },
        { header: "COGS", key: "cogs", width: 18, numFmt: MONEY, align: "right" },
        { header: "سود ناخالص", key: "grossProfit", width: 18, numFmt: MONEY, align: "right" },
        { header: "حاشیه سود", key: "grossMargin", width: 12, numFmt: PERCENT, align: "right" },
        { header: "سهم از سود", key: "profitShare", width: 12, numFmt: PERCENT, align: "right" },
      ];
      writeDetailSheet(
        workbook,
        "سودآوری محصولات",
        PROFITABILITY_COLUMNS,
        flattenRows(profitData.products ?? [], PROFITABILITY_COLUMNS)
      );

      // --- تحلیل هزینه‌ها (non-void expense analysis).
      const EXPENSE_ANALYSIS_COLUMNS: Column[] = [
        { header: "دسته‌بندی", key: "categoryLabel", width: 26 },
        { header: "مبلغ (تومان)", key: "amount", width: 20, numFmt: MONEY, align: "right" },
        { header: "سهم از کل هزینه‌ها (٪)", key: "pctOfTotalExpenses", width: 22, numFmt: PERCENT, align: "right" },
        { header: "سهم از سود ناخالص (٪)", key: "pctOfGrossProfit", width: 22, numFmt: PERCENT, align: "right" },
      ];
      const expenseRows = (profitData.expenses ?? []).map((e) => {
        const pctGross = e.pctOfGrossProfit;
        return {
          categoryLabel: e.categoryLabel,
          amount: e.amount,
          pctOfTotalExpenses: Number(e.pctOfTotalExpenses ?? 0) / 100,
          pctOfGrossProfit: typeof pctGross === "number" ? pctGross / 100 : "",
        };
      });
      writeDetailSheet(
        workbook,
        "تحلیل هزینه‌ها",
        EXPENSE_ANALYSIS_COLUMNS,
        expenseRows
      );

      // --- روند (every bucket covering the window, zero-filled).
      const TREND_COLUMNS: Column[] = [
        { header: "گروه", key: "label", width: 14 },
        { header: "از تاریخ", key: "from", width: 18 },
        { header: "تا تاریخ", key: "to", width: 18 },
        { header: "فروش خالص", key: "netSales", width: 18, numFmt: MONEY, align: "right" },
        { header: "COGS", key: "cogs", width: 18, numFmt: MONEY, align: "right" },
        { header: "سود ناخالص", key: "grossProfit", width: 18, numFmt: MONEY, align: "right" },
        { header: "هزینه‌های عملیاتی", key: "expenses", width: 20, numFmt: MONEY, align: "right" },
        { header: "سود خالص", key: "netProfit", width: 18, numFmt: MONEY, align: "right" },
      ];
      const trendRows = (profitData.trend ?? []).map((t) => ({
        label: t.label,
        from: iso(t.from),
        to: iso(t.to),
        netSales: t.netSales,
        cogs: t.cogs,
        grossProfit: t.grossProfit,
        expenses: t.expenses,
        netProfit: t.netProfit,
      }));
      writeDetailSheet(workbook, "روند", TREND_COLUMNS, trendRows);

      // --- Category profitability stays intentionally UNAVAILABLE until an
      // immutable category snapshot exists on OrderItem (`categories` is always
      // empty today, so no sheet is emitted). Logic preserved from the
      // Foundation so the sheet appears automatically once the data exists.
      if (profitData.categories && profitData.categories.length > 0) {
        const CAT_COLUMNS: Column[] = [
          { header: "دسته‌بندی", key: "categoryName", width: 26 },
          { header: "تعداد فروش", key: "quantity", width: 12, numFmt: INTEGER, align: "right" },
          { header: "فروش خالص", key: "netSales", width: 18, numFmt: MONEY, align: "right" },
          { header: "COGS", key: "cogs", width: 18, numFmt: MONEY, align: "right" },
          { header: "سود ناخالص", key: "grossProfit", width: 18, numFmt: MONEY, align: "right" },
          { header: "حاشیه سود", key: "grossMargin", width: 12, numFmt: PERCENT, align: "right" },
        ];
        writeDetailSheet(workbook, "سودآوری دسته‌بندی", CAT_COLUMNS, flattenRows(profitData.categories, CAT_COLUMNS));
      }
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

/** Purchase-labeled summary sheet (Session 82 Phase B) — procurement KPIs. */
function writePurchaseSummarySheet(
  workbook: ExcelJS.Workbook,
  filters: ReportFilters,
  summary: ReportSummary
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("خلاصه");
  sheet.columns = [{ width: 42 }, { width: 20 }];

  sheet.mergeCells("A1:B1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = REPORT_TITLES.purchases;
  titleCell.font = { bold: true, size: 14 };
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = `بازه گزارش: ${filters.from ?? "—"} تا ${filters.to ?? "—"}`;
  sheet.getCell("A2").font = { italic: true };
  sheet.mergeCells("A3:B3");
  sheet.getCell("A3").value = `تولید شده در: ${iso(new Date().toISOString())}`;
  sheet.getCell("A3").font = { italic: true };

  const rows: KpiValue[] = [
    kpi("تعداد خرید", summary.orders, "count"),
    kpi("واحد سفارش‌شده", summary.unitsSold, "count"),
    kpi("جمع جزء (subtotal)", summary.grossSales, "money"),
    kpi("تخفیف", summary.productDiscount, "money"),
    kpi("هزینه‌های اضافی", summary.netSales - summary.grossSales + summary.productDiscount, "money"),
    kpi("جمع کل خرید", summary.netSales, "money"),
    kpi("پرداخت‌شده به تأمین‌کننده", summary.paidAmount, "money"),
    kpi("مانده پرداخت", summary.outstandingAmount, "money"),
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

  sheet.mergeCells(`A${r + 1}:B${r + 1}`);
  sheet.getCell(`A${r + 1}`).value =
    "یادداشت: این گزارش خرید/تدارکات است — هیچ مبلغی به‌عنوان سود فروش یا COGS محسوب نمی‌شود.";
  sheet.getCell(`A${r + 1}`).font = { italic: true, size: 9 };
  sheet.getCell(`A${r + 1}`).alignment = { wrapText: true };

  return sheet;
}

/** Expense-labeled summary sheet (Session 82 Phase E) — expense KPIs. */
function writeExpenseSummarySheet(
  workbook: ExcelJS.Workbook,
  filters: ReportFilters,
  summary: ReportSummary
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("خلاصه");
  sheet.columns = [{ width: 42 }, { width: 20 }];

  sheet.mergeCells("A1:B1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = REPORT_TITLES.expenses;
  titleCell.font = { bold: true, size: 14 };
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = `بازه گزارش: ${filters.from ?? "—"} تا ${filters.to ?? "—"}`;
  sheet.getCell("A2").font = { italic: true };
  sheet.mergeCells("A3:B3");
  sheet.getCell("A3").value = `تولید شده در: ${iso(new Date().toISOString())}`;
  sheet.getCell("A3").font = { italic: true };

  const rows: KpiValue[] = [
    kpi("تعداد هزینه‌ها (غیرباطل)", summary.orders, "count"),
    kpi("جمع هزینه‌های عملیاتی", summary.grossSales, "money"),
    kpi("پرداخت‌شده", summary.paidAmount, "money"),
    kpi("در انتظار پرداخت", summary.pendingAmount, "money"),
    kpi("باطل‌شده (جمع)", summary.refunds, "money"),
    kpi("باطل‌شده (تعداد)", summary.refundedOrders, "count"),
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

  sheet.mergeCells(`A${r + 1}:B${r + 1}`);
  sheet.getCell(`A${r + 1}`).value =
    "یادداشت: هزینه‌های باطل‌شده در مجموع‌ها محاسبه نمی‌شوند؛ هر مبلغ دقیقاً همان است که ثبت شده — هیچ هزینه‌ای تخمین زده نمی‌شود (مثلاً کارمزد درگاه فقط با ثبت دستی به‌عنوان هزینه محاسبه می‌شود).";
  sheet.getCell(`A${r + 1}`).font = { italic: true, size: 9 };
  sheet.getCell(`A${r + 1}`).alignment = { wrapText: true };

  return sheet;
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

// ---------------------------------------------------------------------------
// Accounting workbook V2 (Session 82 Phase F) — the 17-sheet accountant book
// ---------------------------------------------------------------------------

/**
 * The accounting summary sheet (خلاصه حسابداری) — label/value KPIs with the
 * valuation basis + historical note, so an accountant sees exactly how the
 * figures were derived (nothing is invented or shown as a fake zero).
 */
function writeAccountingSummarySheet(
  workbook: ExcelJS.Workbook,
  data: AccountingExportData
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("خلاصه حسابداری");
  sheet.columns = [{ width: 46 }, { width: 20 }];

  sheet.mergeCells("A1:B1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = "خلاصه حسابداری";
  titleCell.font = { bold: true, size: 14 };
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = `بازه گزارش: ${data.filters.from ?? "—"} تا ${data.filters.to ?? "—"}`;
  sheet.getCell("A2").font = { italic: true };
  sheet.mergeCells("A3:B3");
  sheet.getCell("A3").value = `تولید شده در: ${iso(new Date().toISOString())}`;
  sheet.getCell("A3").font = { italic: true };

  let r = 5;
  for (const item of data.accounting.rows) {
    sheet.getCell(`A${r}`).value = item.label;
    const vCell = sheet.getCell(`B${r}`);
    if (item.numFmt === "money" && item.value !== null) {
      vCell.value = roundToman(item.value);
      vCell.numFmt = MONEY;
    } else if (item.numFmt === "percent" && item.value !== null) {
      vCell.value = item.value / 100;
      vCell.numFmt = PERCENT;
    } else if (item.numFmt === "count" && item.value !== null) {
      vCell.value = item.value;
      vCell.numFmt = INTEGER;
    } else {
      vCell.value = item.value === null ? "در دسترس نیست" : item.value;
    }
    r++;
  }

  const notes = [
    data.accounting.valuation.valuationBasisLabel,
    data.accounting.valuation.historicalNote,
    "روش ارزیابی: FIFO (لایه‌های صریح) — روش میانگین موزون استفاده نمی‌شود.",
    "هیچ مبلغی تخمین زده نمی‌شود؛ داده‌های در دسترس نبوده به‌عنوان «در دسترس نیست» علامت‌گذاری می‌شوند.",
  ];
  let nr = r + 1;
  for (const note of notes) {
    sheet.mergeCells(`A${nr}:B${nr}`);
    sheet.getCell(`A${nr}`).value = note;
    sheet.getCell(`A${nr}`).font = { italic: true, size: 9 };
    sheet.getCell(`A${nr}`).alignment = { wrapText: true };
    nr++;
  }

  return sheet;
}

/**
 * Build the full 17-sheet accounting workbook V2 (Session 82 Phase F).
 *
 * Sheet order (Persian): خلاصه · فروش · سفارش‌ها · اقلام فروش · پرداخت‌ها ·
 * مرجوعی‌ها · مشتریان · کوپن‌ها · خریدها · اقلام خرید · هزینه‌ها · موجودی ·
 * گردش موجودی · لایه‌های FIFO · بهای تمام‌شده · سود و زیان · خلاصه حسابداری.
 *
 * All money/percent values are server-computed (exceljs formatting only).
 * The first sheet is the order-labeled خلاصه so an accountant immediately
 * sees the period + core KPIs; the last is the accountant-facing خلاصه
 * حسابداری with the valuation basis + historical note.
 */
export function buildAccountingWorkbook(
  data: AccountingExportData,
  filters: ReportFilters,
  pieces: {
    summary: ReportSummary;
    sales: EnvelopeWithRows;
    orders: EnvelopeWithRows;
    payments: EnvelopeWithRows;
    refunds: EnvelopeWithRows;
    customers: EnvelopeWithRows;
    coupons: EnvelopeWithRows;
    purchases: EnvelopeWithRows;
    expenses: EnvelopeWithRows;
    inventory: EnvelopeWithRows;
    pnl: {
      current: { summary: ReportSummary; rows: Array<unknown> };
      previous?: { summary: ReportSummary; rows: Array<unknown> } | null;
    };
  }
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "فروشگاه من";

  writeSummarySheet(workbook, REPORT_TITLES.accounting, filters, data.summary);
  writeDetailSheet(workbook, "فروش", SALES_COLUMNS, flattenRows(pieces.sales.rows, SALES_COLUMNS), pieces.sales.totals);
  writeDetailSheet(workbook, "سفارش‌ها", ORDERS_COLUMNS, flattenRows(pieces.orders.rows, ORDERS_COLUMNS), pieces.orders.totals);
  writeDetailSheet(workbook, "اقلام فروش", ORDER_ITEMS_COLUMNS, flattenRows(data.orderItems.rows, ORDER_ITEMS_COLUMNS), data.orderItems.totals);
  writeDetailSheet(workbook, "پرداخت‌ها", PAYMENTS_COLUMNS, flattenRows(pieces.payments.rows, PAYMENTS_COLUMNS), pieces.payments.totals);
  writeDetailSheet(workbook, "مرجوعی‌ها", REFUNDS_COLUMNS, flattenRows(pieces.refunds.rows, REFUNDS_COLUMNS), pieces.refunds.totals);
  writeDetailSheet(workbook, "مشتریان", CUSTOMERS_COLUMNS, flattenRows(pieces.customers.rows, CUSTOMERS_COLUMNS), pieces.customers.totals);
  writeDetailSheet(workbook, "کوپن‌ها", COUPONS_COLUMNS, flattenRows(pieces.coupons.rows, COUPONS_COLUMNS), pieces.coupons.totals);
  writeDetailSheet(workbook, "خریدها", PURCHASES_COLUMNS, flattenRows(pieces.purchases.rows, PURCHASES_COLUMNS), pieces.purchases.totals);
  writeDetailSheet(workbook, "اقلام خرید", PURCHASE_ITEMS_COLUMNS, flattenRows(data.purchaseItems.rows, PURCHASE_ITEMS_COLUMNS), data.purchaseItems.totals);
  writeDetailSheet(workbook, "هزینه‌ها", EXPENSES_COLUMNS, flattenRows(pieces.expenses.rows, EXPENSES_COLUMNS), pieces.expenses.totals);
  writeDetailSheet(workbook, "موجودی", INVENTORY_COLUMNS, flattenRows(pieces.inventory.rows, INVENTORY_COLUMNS), pieces.inventory.totals);
  writeDetailSheet(workbook, "گردش موجودی", MOVEMENTS_COLUMNS, flattenRows(data.movements.rows, MOVEMENTS_COLUMNS));
  writeDetailSheet(workbook, "لایه‌های FIFO", LAYERS_COLUMNS, flattenRows(data.layers.rows, LAYERS_COLUMNS), data.layers.totals);
  writeDetailSheet(workbook, "بهای تمام‌شده", COGS_COLUMNS, flattenRows(data.cogs.rows, COGS_COLUMNS), data.cogs.totals);
  writePnlSheet(workbook, pieces.pnl);
  writeAccountingSummarySheet(workbook, data);

  return workbook;
}
