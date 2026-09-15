import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildReportWorkbook } from "@/lib/reports-excel";
import {
  assembleTrendBuckets,
  computeTrendBuckets,
  type TrendSalesAgg,
} from "@/lib/profitability";
import type { ReportFilters } from "@/types";

/**
 * Profitability Excel export (Session 88).
 *
 * The Foundation's export called the generic `writeSummarySheet(data.summary)`
 * for this slug, but the profitability payload has NO `summary` envelope — so
 * the builder threw `TypeError: Cannot read properties of undefined (reading
 * 'orders')` and `/api/admin/reports/profitability/export` returned HTTP 500.
 *
 * These tests build the REAL workbook and re-parse the written .xlsx buffer, so
 * they run without a database (the HTTP layer is covered by verify-reports.js).
 */

const filters: ReportFilters = {
  preset: "custom",
  from: "2026-09-01",
  to: "2026-09-03",
  page: 1,
  limit: 10_000,
};

/** 3-day window; every sale lands on the last day (mirrors the verify fixtures). */
const trend = assembleTrendBuckets(
  computeTrendBuckets(
    new Date("2026-09-01T00:00:00.000Z"),
    new Date("2026-09-04T00:00:00.000Z"),
    "day"
  ),
  new Map<string, TrendSalesAgg>([
    ["2026-09-03", { netSales: 5450, cogs: 2300 }],
  ]),
  new Map<string, number>([["2026-09-03", 900]])
);

const payload = {
  filters,
  kpis: [
    {
      key: "netSales",
      label: "فروش خالص",
      value: 5450,
      format: "money",
      prevValue: 4000,
      changePercent: 36.3,
    },
    {
      key: "grossMargin",
      label: "حاشیه سود ناخالص",
      value: 57.8,
      format: "percent",
      prevValue: 50,
      changePercent: null,
    },
    {
      key: "netProfit",
      label: "سود خالص",
      value: 3150,
      format: "money",
      prevValue: null,
      changePercent: null,
    },
  ],
  waterfall: [
    { key: "grossSales", label: "فروش ناخالص", amount: 6000, cumulative: 6000, subtractive: false },
    { key: "cogs", label: "COGS", amount: -2300, cumulative: 3700, subtractive: true },
    { key: "grossProfit", label: "سود ناخالص", amount: 3700, cumulative: 3700, subtractive: false },
    { key: "netProfit", label: "سود خالص", amount: 3700, cumulative: 3700, subtractive: false },
  ],
  products: [
    { productId: "p1", name: "P1", sku: "S1", quantity: 3, netSales: 2700, cogs: 1200, grossProfit: 1500, grossMargin: 55.6, profitShare: 47.6 },
    { productId: "p2", name: "P2", sku: "S2", quantity: 4, netSales: 1950, cogs: 800, grossProfit: 1150, grossMargin: 59, profitShare: 36.5 },
    { productId: "p3", name: "P3", sku: "S3", quantity: 1, netSales: 800, cogs: 300, grossProfit: 500, grossMargin: 62.5, profitShare: 15.9 },
  ],
  // Category profitability is intentionally unavailable (no immutable category
  // snapshot on OrderItem) — the sheet must simply not be emitted.
  categories: [],
  expenses: [
    { category: "shipping", categoryLabel: "حمل‌ونقل", amount: 900, pctOfTotalExpenses: 100, pctOfGrossProfit: 24.3 },
  ],
  trend,
};

/** Build the workbook, then round-trip it through a real .xlsx buffer. */
async function buildParsed(): Promise<ExcelJS.Workbook> {
  const wb = buildReportWorkbook(
    "profitability",
    payload as unknown as Parameters<typeof buildReportWorkbook>[1],
    filters
  );
  const buffer = await wb.xlsx.writeBuffer();
  const parsed = new ExcelJS.Workbook();
  // exceljs types its `load()` input with a concrete Buffer variant, so mirror
  // its own parameter type instead of hard-coding one.
  await parsed.xlsx.load(
    buffer as unknown as Parameters<typeof parsed.xlsx.load>[0]
  );
  return parsed;
}

describe("profitability Excel export (Session 88)", () => {
  it("builds without throwing even though the payload has no `summary`", async () => {
    await expect(buildParsed()).resolves.toBeTruthy();
  });

  it("contains the five dedicated sheets and NO generic summary sheet", async () => {
    const wb = await buildParsed();
    const names = wb.worksheets.map((ws) => ws.name);

    for (const expected of [
      "خلاصه سودآوری",
      "آبشار سودآوری",
      "سودآوری محصولات",
      "تحلیل هزینه‌ها",
      "روند",
    ]) {
      expect(names).toContain(expected);
    }
    // The generic (order-labeled) summary sheet was the crash source.
    expect(names).not.toContain("خلاصه");
    // Categories stay unavailable, so no category sheet is emitted.
    expect(names).not.toContain("سودآوری دسته‌بندی");
  });

  it("KPI sheet keeps money and percent values numeric, in their own columns", async () => {
    const wb = await buildParsed();
    const sheet = wb.getWorksheet("خلاصه سودآوری")!;

    const rows = new Map<string, ExcelJS.Row>();
    sheet.eachRow((row, n) => {
      if (n > 1) rows.set(String(row.getCell(1).value), row);
    });

    // Money KPI → numeric value in the money column with the money format.
    const net = rows.get("فروش خالص")!;
    expect(net).toBeTruthy();
    expect(typeof net.getCell(2).value).toBe("number");
    expect(net.getCell(2).value).toBe(5450);
    expect(net.getCell(2).numFmt).toBe("#,##0");
    // changePercent is a fraction with the percent format (Excel 0.0%).
    expect(net.getCell(6).numFmt).toBe("0.0%");
    expect(Number(net.getCell(6).value)).toBeCloseTo(0.363, 5);

    // Percent KPI → numeric fraction in the percent column.
    const margin = rows.get("حاشیه سود ناخالص")!;
    expect(typeof margin.getCell(3).value).toBe("number");
    expect(Number(margin.getCell(3).value)).toBeCloseTo(0.578, 5);
    expect(margin.getCell(3).numFmt).toBe("0.0%");

    // Each KPI lives in ONE of the two unit columns; the other stays blank.
    expect(net.getCell(3).value ?? "").toBe("");
    expect(margin.getCell(2).value ?? "").toBe("");

    // A null previous value stays blank rather than becoming a fake zero.
    expect(rows.get("سود خالص")!.getCell(4).value ?? "").toBe("");
  });

  it("waterfall sheet lists every step with cumulative values", async () => {
    const wb = await buildParsed();
    const sheet = wb.getWorksheet("آبشار سودآوری")!;

    expect(sheet.rowCount).toBe(payload.waterfall.length + 1); // + header
    const rows = new Map<string, ExcelJS.Row>();
    sheet.eachRow((row, n) => {
      if (n > 1) rows.set(String(row.getCell(1).value), row);
    });

    expect(rows.size).toBe(payload.waterfall.length);

    const cogsCell = rows.get("COGS")!.getCell(3);
    expect(typeof cogsCell.value).toBe("number");
    expect(cogsCell.value).toBe(-2300);
    expect(cogsCell.numFmt).toBe("#,##0");
    expect(String(rows.get("COGS")!.getCell(2).value)).toBe("کاهشی");

    const cumulative = rows.get("سود خالص")!.getCell(4);
    expect(typeof cumulative.value).toBe("number");
    expect(cumulative.value).toBe(3700);
  });

  it("product sheet is preserved and Σ netSales reconciles with the KPI", async () => {
    const wb = await buildParsed();
    const sheet = wb.getWorksheet("سودآوری محصولات")!;

    expect(String(sheet.getRow(1).getCell(4).value)).toContain("فروش خالص");
    expect(sheet.rowCount).toBe(payload.products.length + 1);

    let sumNet = 0;
    let numericCells = 0;
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const cell = row.getCell(4);
      // Real numeric Excel cells (not strings) with the money format.
      expect(cell.numFmt).toBe("#,##0");
      expect(typeof cell.value).toBe("number");
      if (typeof cell.value === "number") {
        sumNet += cell.value;
        numericCells++;
      }
    });
    expect(numericCells).toBe(payload.products.length);
    expect(sumNet).toBe(5450);
    expect(sumNet).toBe(payload.kpis.find((k) => k.key === "netSales")!.value);
  });

  it("expense sheet exports the expense analysis with percent shares", async () => {
    const wb = await buildParsed();
    const sheet = wb.getWorksheet("تحلیل هزینه‌ها")!;

    const row = sheet.getRow(2);
    expect(String(row.getCell(1).value)).toBe("حمل‌ونقل");
    expect(Number(row.getCell(2).value)).toBe(900);
    expect(Number(row.getCell(3).value)).toBeCloseTo(1, 5); // 100% as a fraction
    expect(Number(row.getCell(4).value)).toBeCloseTo(0.243, 5);
  });

  it("trend sheet exports every bucket with its own from/to and zero-filled values", async () => {
    const wb = await buildParsed();
    const sheet = wb.getWorksheet("روند")!;

    expect(sheet.rowCount).toBe(trend.length + 1);
    expect(sheet.rowCount).toBe(4); // header + 3 daily buckets

    // Empty buckets keep their own (empty) day and zeros.
    expect(String(sheet.getRow(2).getCell(1).value)).toBe("2026-09-01");
    expect(Number(sheet.getRow(2).getCell(4).value)).toBe(0);
    expect(Number(sheet.getRow(2).getCell(8).value)).toBe(0);

    // The last bucket carries the sales AND the expense-only day's cost base.
    const last = sheet.getRow(4);
    expect(String(last.getCell(1).value)).toBe("2026-09-03");
    expect(typeof last.getCell(4).value).toBe("number");
    expect(last.getCell(4).value).toBe(5450);
    expect(last.getCell(5).value).toBe(2300);
    expect(last.getCell(7).value).toBe(900);
    expect(last.getCell(8).value).toBe(3150 - 900);
    expect(last.getCell(8).numFmt).toBe("#,##0");
    // Trend dates are human-readable (not raw ISO instants).
    expect(String(last.getCell(2).value)).toContain("2026-09-03");
    expect(String(last.getCell(3).value)).toContain("2026-09-03");
  });
});
