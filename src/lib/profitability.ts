/**
 * Profitability Report — server-side calculations (Session 87).
 *
 * Provides the analytical layer for the management profitability dashboard.
 * All calculations reuse the existing report infrastructure:
 *  - OrderItem snapshots for sales/COGS (never current prices)
 *  - FIFO fifoUnitCost when present; supplierPrice snapshot otherwise
 *  - Expense model for operating expenses (non-void only)
 *  - Category analysis is withheld because OrderItem has no category snapshot
 *
 * No financial data is fabricated. Missing data surfaces as null/empty.
 */

import mongoose from "mongoose";
import Order from "@/models/Order";
import Expense, { EXPENSE_CATEGORY_LABELS } from "@/models/Expense";
import {
  buildOrderMatch,
  buildLineMatch,
  buildRefundMatch,
  windowDates,
} from "@/lib/report-matches";
import {
  addDays,
  roundToman,
  safePct,
  startOfUtcDay,
  startOfUtcMonth,
} from "@/lib/report-utils";
import type { ReportFilters } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfitabilityKpi {
  key: string;
  label: string;
  value: number | null;
  format: "money" | "percent";
  prevValue: number | null;
  changePercent: number | null;
}

export interface WaterfallStep {
  key: string;
  label: string;
  amount: number;
  /** Cumulative value after this step. */
  cumulative: number;
  /** Is this a subtractive step? (for visual styling) */
  subtractive: boolean;
}

export interface ProductProfitRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  grossSales: number;
  productDiscount: number;
  couponAllocation: number;
  /** Refunded revenue attributed to this product (refund-window basis). */
  returnedAmount: number;
  /** Refunded COGS attributed to this product (historical snapshot basis). */
  returnedCogs: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
  profitShare: number | null;
}

export interface CategoryProfitRow {
  categoryId: string;
  categoryName: string;
  quantity: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
}

export interface ExpenseAnalysisRow {
  category: string;
  categoryLabel: string;
  amount: number;
  pctOfTotalExpenses: number;
  pctOfGrossProfit: number | null;
}

export interface TrendBucket {
  label: string;
  /** Inclusive bucket start (UTC). */
  from: Date;
  /** Inclusive bucket end (UTC). */
  to: Date;
  /** Net of refunds issued inside this bucket. */
  netSales: number;
  /** Net of refunded COGS issued inside this bucket. */
  cogs: number;
  /** Refund reversal issued inside this bucket (memo). */
  refunds: number;
  /** Refunded-COGS reversal issued inside this bucket (memo). */
  refundedCogs: number;
  grossProfit: number;
  /** Non-void operating expenses recorded inside this bucket. */
  expenses: number;
  netProfit: number;
}

export interface DiagnosticInsight {
  key: string;
  text: string;
  type: "positive" | "negative" | "neutral" | "warning";
}

export interface FinancialHealthIndicator {
  key: string;
  label: string;
  value: number | null;
  format: "percent";
}

export interface ProfitabilityReportData {
  report: "profitability";
  filters: ReportFilters;
  /** Executive KPIs with previous-period comparison. */
  kpis: ProfitabilityKpi[];
  /** Waterfall progression from gross sales to net profit. */
  waterfall: WaterfallStep[];
  /** Product-level profitability. */
  products: ProductProfitRow[];
  /** Category-level profitability. */
  categories: CategoryProfitRow[];
  /** Expense analysis by category. */
  expenses: ExpenseAnalysisRow[];
  /** Diagnostic insights. */
  diagnostics: DiagnosticInsight[];
  /** Financial health indicators. */
  health: FinancialHealthIndicator[];
  /** Time-series trend data. */
  trend: TrendBucket[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sum non-void expenses in a date range. */
async function sumNonVoidExpenses(
  from: Date,
  to: Date
): Promise<number> {
  const [agg] = await Expense.aggregate<{ total: number }>([
    {
      $match: {
        expenseDate: { $gte: from, $lt: to },
        status: { $ne: "void" },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return roundToman(agg?.total ?? 0);
}

/** Expenses grouped by category (non-void only). */
async function expensesByCategory(
  from: Date,
  to: Date
): Promise<Array<{ category: string; total: number }>> {
  const agg = await Expense.aggregate<{ _id: string; total: number }>([
    {
      $match: {
        expenseDate: { $gte: from, $lt: to },
        status: { $ne: "void" },
      },
    },
    { $group: { _id: "$category", total: { $sum: "$amount" } } },
    { $sort: { total: -1 } },
  ]);
  return agg.map((a) => ({
    category: a._id,
    total: roundToman(a.total),
  }));
}

// ---------------------------------------------------------------------------
// Core: per-item profitability aggregation
// ---------------------------------------------------------------------------

async function aggregateItemProfitability(
  filters: ReportFilters
): Promise<{
  items: Array<{
    productId: string;
    name: string;
    sku: string;
    quantity: number;
    lineNet: number;
    grossLine: number;
    discountLine: number;
    cogs: number;
    supplierPrice: number;
    couponAllocation: number;
    returnedAmount: number;
    returnedCogs: number;
  }>;
  totalNetSales: number;
  totalCogs: number;
  totalGrossSales: number;
  totalProductDiscount: number;
  totalCouponDiscount: number;
  totalGrossProfit: number;
  totalRefundsRevenue: number;
  totalRefundsCogs: number;
  orders: number;
  units: number;
  refunds: number;
  paidAmount: number;
  pendingAmount: number;
}> {
  const orderMatch = await buildOrderMatch(filters, {
    excludeLineScoped: true,
  });
  const lineMatch = await buildLineMatch(filters);

  const stages: mongoose.PipelineStage[] = [
    { $match: orderMatch as unknown as mongoose.PipelineStage.Match },
    { $unwind: "$items" },
  ];
  if (lineMatch) {
    stages.push({
      $match: lineMatch as unknown as mongoose.PipelineStage.Match,
    });
  }

  // Aggregate per-product
  const productAgg = await Order.aggregate([
    ...stages,
    {
      $set: {
        _lineNet: { $multiply: ["$items.price", "$items.quantity"] },
        _couponLine: {
          $cond: [
            {
              $and: [
                { $gt: [{ $ifNull: ["$discount.amount", 0] }, 0] },
                { $gt: [{ $ifNull: ["$subtotalAmount", 0] }, 0] },
              ],
            },
            {
              $multiply: [
                { $multiply: ["$items.price", "$items.quantity"] },
                {
                  $divide: [
                    { $ifNull: ["$discount.amount", 0] },
                    "$subtotalAmount",
                  ],
                },
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        sku: { $first: { $ifNull: ["$items.sku", ""] } },
        quantity: { $sum: "$items.quantity" },
        grossLine: {
          $sum: {
            $multiply: [
              { $ifNull: ["$items.originalPrice", "$items.price"] },
              "$items.quantity",
            ],
          },
        },
        discountLine: {
          $sum: {
            $multiply: [
              { $ifNull: ["$items.discountAmount", 0] },
              "$items.quantity",
            ],
          },
        },
        lineNet: { $sum: "$_lineNet" },
        couponAllocation: { $sum: "$_couponLine" },
        cogs: {
          $sum: {
            $multiply: [
              {
                $ifNull: [
                  { $ifNull: ["$items.fifoUnitCost", "$items.supplierPrice"] },
                  0,
                ],
              },
              "$items.quantity",
            ],
          },
        },
        supplierPrice: { $first: "$items.supplierPrice" },
      },
    },
    { $sort: { lineNet: -1 } },
  ]);

  // REFUND side — refunds ISSUED in the window (refund.refundedAt), grouped
  // per product so a product's own refund reversal lands on its own row.
  // Revenue uses the same per-line proration as the sales report
  // (line net × totalAmount/subtotalAmount); COGS uses the historical cost
  // snapshot (fifoUnitCost ?? supplierPrice), never the current price.
  const refundStages: mongoose.PipelineStage[] = [
    {
      $match: buildRefundMatch(filters) as unknown as mongoose.PipelineStage.Match,
    },
    { $unwind: "$items" },
  ];
  if (lineMatch) {
    refundStages.push({
      $match: lineMatch as unknown as mongoose.PipelineStage.Match,
    });
  }
  const [refundOrderTotals, refundProductAgg] = await Promise.all([
    Order.aggregate([
      {
        $match: buildRefundMatch(filters) as unknown as mongoose.PipelineStage.Match,
      },
      {
        $group: {
          _id: null,
          refundsRevenue: { $sum: "$totalAmount" },
        },
      },
    ]),
    Order.aggregate([
      ...refundStages,
      {
        $project: {
          product: "$items.product",
          returnedAmount: {
            $cond: [
              { $gt: [{ $ifNull: ["$subtotalAmount", 0] }, 0] },
              {
                $multiply: [
                  { $multiply: ["$items.price", "$items.quantity"] },
                  { $divide: ["$totalAmount", "$subtotalAmount"] },
                ],
              },
              { $multiply: ["$items.price", "$items.quantity"] },
            ],
          },
          returnedCogs: {
            $multiply: [
              {
                $ifNull: [
                  { $ifNull: ["$items.fifoUnitCost", "$items.supplierPrice"] },
                  0,
                ],
              },
              "$items.quantity",
            ],
          },
        },
      },
      {
        $group: {
          _id: "$product",
          returnedAmount: { $sum: "$returnedAmount" },
          returnedCogs: { $sum: "$returnedCogs" },
        },
      },
    ]),
  ]);

  // Order-level totals
  const [orderTotals] = await Order.aggregate([
    { $match: orderMatch as unknown as mongoose.PipelineStage.Match },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        netSales: { $sum: "$totalAmount" },
        couponDiscount: { $sum: { $ifNull: ["$discount.amount", 0] } },
        paidAmount: {
          $sum: {
            $cond: [
              { $in: ["$payment.status", ["paid", "refunded"]] },
              "$totalAmount",
              0,
            ],
          },
        },
        pendingAmount: {
          $sum: {
            $cond: [{ $eq: ["$payment.status", "pending"] }, "$totalAmount", 0],
          },
        },
      },
    },
  ]);

  const ot = orderTotals ?? {};
  const rt = refundOrderTotals[0] ?? {};
  const refundByProduct = new Map(
    refundProductAgg.map((r) => [
      String(r._id),
      {
        returnedAmount: roundToman(r.returnedAmount ?? 0),
        returnedCogs: roundToman(r.returnedCogs ?? 0),
      },
    ])
  );
  const totalRefundsRevenue = roundToman(rt.refundsRevenue ?? 0);
  const totalRefundsCogs = roundToman(
    refundProductAgg.reduce((s, r) => s + (r.returnedCogs ?? 0), 0)
  );
  // Revenue is net of the refund reversal issued in this window (accrual —
  // see buildRefundMatch); COGS stays GROSS and the refunded COGS is
  // reversed explicitly via +totalRefundsCogs, keeping every reconciliation
  // additive:  netSales − grossCOGS + refundedCOGS = grossProfit.
  const totalNetSales = roundToman((ot.netSales ?? 0) - totalRefundsRevenue);
  const totalCouponDiscount = roundToman(ot.couponDiscount ?? 0);
  const totalCogs = roundToman(
    productAgg.reduce((s, r) => s + (r.cogs ?? 0), 0)
  );
  const totalGrossSales = roundToman(
    productAgg.reduce((s, r) => s + (r.grossLine ?? 0), 0)
  );
  const totalProductDiscount = roundToman(
    productAgg.reduce((s, r) => s + (r.discountLine ?? 0), 0)
  );
  const totalGrossProfit = totalNetSales - totalCogs + totalRefundsCogs;

  const items = productAgg.map((r) => {
    const refunds = refundByProduct.get(String(r._id)) ?? {
      returnedAmount: 0,
      returnedCogs: 0,
    };
    return {
      productId: String(r._id),
      name: String(r.name ?? "نامشخص"),
      sku: String(r.sku ?? ""),
      quantity: Number(r.quantity ?? 0),
      lineNet: roundToman(r.lineNet ?? 0),
      grossLine: roundToman(r.grossLine ?? 0),
      discountLine: roundToman(r.discountLine ?? 0),
      cogs: roundToman(r.cogs ?? 0),
      supplierPrice: Number(r.supplierPrice ?? 0),
      couponAllocation: roundToman(r.couponAllocation ?? 0),
      returnedAmount: refunds.returnedAmount,
      returnedCogs: refunds.returnedCogs,
    };
  });

  return {
    items,
    totalNetSales,
    totalCogs,
    totalGrossSales,
    totalProductDiscount,
    totalCouponDiscount,
    totalGrossProfit,
    totalRefundsRevenue,
    totalRefundsCogs,
    orders: ot.orders ?? 0,
    units: items.reduce((s, r) => s + r.quantity, 0),
    refunds: totalRefundsRevenue,
    paidAmount: roundToman(ot.paidAmount ?? 0),
    pendingAmount: roundToman(ot.pendingAmount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Trend: bucket orders by day/week/month
// ---------------------------------------------------------------------------

/** Trend grouping granularity (whitelist-validated by `parseReportFilters`). */
export type TrendGroup = "day" | "week" | "month";

/**
 * MongoDB `$dateToString` formats used to group orders/expenses. The generated
 * bucket labels MUST match these exactly — a mismatch would silently drop a
 * group's data from the trend.
 */
const TREND_DATE_FORMATS: Record<TrendGroup, string> = {
  day: "%Y-%m-%d",
  week: "%G-W%V",
  month: "%Y-%m",
};

const TREND_DAY_MS = 24 * 60 * 60 * 1000;

/** Hard cap on generated buckets (bounds the payload: ~8 years of daily buckets). */
const TREND_MAX_BUCKETS = 3000;

/** UTC start of the ISO week (Monday) containing `d`. */
function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  return addDays(day, -((day.getUTCDay() + 6) % 7)); // Mon = 0 … Sun = 6
}

/** First UTC day of the trend group containing `d` (the inclusive bucket start). */
export function startOfTrendGroup(d: Date, group: TrendGroup): Date {
  if (group === "week") return startOfUtcWeek(d);
  if (group === "month") return startOfUtcMonth(d);
  return startOfUtcDay(d);
}

/** First day of the NEXT group — the exclusive upper bound of `d`'s bucket. */
export function nextTrendGroupStart(d: Date, group: TrendGroup): Date {
  if (group === "week") return addDays(d, 7);
  if (group === "month") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return addDays(d, 1);
}

/** ISO-8601 week-numbering year + week (matches Mongo's `%G` / `%V`). */
export function isoWeek(d: Date): { year: number; week: number } {
  const target = startOfUtcDay(d);
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
  // The Thursday of this ISO week decides the ISO week-numbering year.
  const thursday = addDays(target, 3 - dayNum);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = addDays(jan4, -((jan4.getUTCDay() + 6) % 7));
  const week =
    Math.round(
      (thursday.getTime() - week1Monday.getTime()) / (7 * TREND_DAY_MS)
    ) + 1;
  return { year, week };
}

/** The group key for `d` — identical to the aggregation's `$dateToString` output. */
export function trendGroupLabel(d: Date, group: TrendGroup): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (group === "week") {
    const { year, week } = isoWeek(d);
    return `${year}-W${pad(week)}`;
  }
  if (group === "month") {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface TrendBucketBoundaries {
  /** Group key — matches the `$dateToString` grouping key exactly. */
  label: string;
  /** Inclusive bucket start (UTC). */
  from: Date;
  /** Inclusive bucket end (UTC) — the last millisecond of the group. */
  to: Date;
}

/**
 * Build EVERY bucket covering `[windowFrom, windowTo)` for `group`, each with
 * its OWN boundaries (never the overall report window).
 *
 * Empty periods are included so the caller can zero-fill them — without this,
 * a period containing only expenses would vanish from the trend entirely.
 *
 * DATE CONVENTION (matches the rest of the reports subsystem): the report's
 * `filters.from`/`filters.to` and `ReportSummary.from`/`to` are INCLUSIVE UTC
 * calendar days, while `windowDates()` turns them into the half-open query
 * window `[from 00:00Z, to 00:00Z + 1d)` used by `buildOrderMatch()`. A bucket
 * therefore reports its inclusive span — `from` = the group's first instant,
 * `to` = the group's LAST instant (e.g. daily `2026-09-01T00:00:00.000Z` →
 * `2026-09-01T23:59:59.999Z`), which prints as the same inclusive date when
 * sliced. The exclusive form is derivable because the buckets are contiguous:
 * `bucket[i].to + 1ms === bucket[i + 1].from`, and the final bucket's `to` is
 * exactly `windowTo − 1ms` — so buckets tile the window with no gap or overlap.
 */
export function computeTrendBuckets(
  windowFrom: Date,
  windowTo: Date,
  group: TrendGroup
): TrendBucketBoundaries[] {
  if (
    !(windowFrom instanceof Date) ||
    !(windowTo instanceof Date) ||
    Number.isNaN(windowFrom.getTime()) ||
    Number.isNaN(windowTo.getTime()) ||
    windowTo.getTime() <= windowFrom.getTime()
  ) {
    return [];
  }

  const out: TrendBucketBoundaries[] = [];
  let cursor = startOfTrendGroup(windowFrom, group);
  while (
    cursor.getTime() < windowTo.getTime() &&
    out.length < TREND_MAX_BUCKETS
  ) {
    const next = nextTrendGroupStart(cursor, group);
    out.push({
      label: trendGroupLabel(cursor, group),
      from: cursor,
      to: new Date(next.getTime() - 1),
    });
    cursor = next;
  }
  return out;
}

/** Per-group sales totals emitted by the order aggregation. */
export interface TrendSalesAgg {
  netSales: number;
  cogs: number;
  /** Refund revenue reversal ISSUED inside this bucket (optional). */
  refunds?: number;
  /** Refunded-COGS reversal ISSUED inside this bucket (optional). */
  refundedCogs?: number;
}

/**
 * Map the grouped aggregation results onto the bucket skeleton.
 *
 * EVERY bucket in `buckets` is returned — a bucket with no sales and no
 * expenses is zero-filled rather than dropped, and a bucket with expenses but
 * no sales still carries its expense total (so period costs never disappear
 * from trend/net-profit analysis).
 */
export function assembleTrendBuckets(
  buckets: TrendBucketBoundaries[],
  salesByGroup: Map<string, TrendSalesAgg>,
  expenseByGroup: Map<string, number>
): TrendBucket[] {
  return buckets.map((bucket) => {
    const sales = salesByGroup.get(bucket.label) ?? { netSales: 0, cogs: 0 };
    const expenses = expenseByGroup.get(bucket.label) ?? 0;
    // Refund reversal ISSUED inside this bucket (accrual) — nets the bucket
    // so Σ buckets reconciles with the report's netted KPIs. The reversal
    // amounts are kept as memo fields for transparency.
    const refunds = sales.refunds ?? 0;
    const refundedCogs = sales.refundedCogs ?? 0;
    const netSales = sales.netSales - refunds;
    const cogs = sales.cogs; // gross — the refunded COGS is an explicit add-back
    const grossProfit = netSales - cogs + refundedCogs;
    return {
      label: bucket.label,
      from: bucket.from,
      to: bucket.to,
      netSales,
      cogs,
      refunds,
      refundedCogs,
      grossProfit,
      expenses,
      netProfit: grossProfit - expenses,
    };
  });
}

async function computeTrend(
  filters: ReportFilters
): Promise<TrendBucket[]> {
  const { from, to } = windowDates(filters);
  const rangeDays = Math.ceil((to.getTime() - from.getTime()) / TREND_DAY_MS);

  // Use the requested grouping when present; otherwise choose a sensible
  // default for the selected range.
  const groupBy: TrendGroup =
    filters.trendGroup ??
    (rangeDays <= 31 ? "day" : rangeDays <= 180 ? "week" : "month");
  const dateFormat = TREND_DATE_FORMATS[groupBy];

  // Every bucket covering the window is generated up-front, so periods with no
  // orders are still represented (zero-filled) instead of being dropped.
  const skeleton = computeTrendBuckets(from, to, groupBy);
  if (skeleton.length === 0) return [];

  const orderMatch = await buildOrderMatch(filters);

  const buckets = await Order.aggregate([
    { $match: orderMatch as unknown as mongoose.PipelineStage.Match },
    {
      $set: {
        _dateGroup: {
          $dateToString: { format: dateFormat, date: "$createdAt" },
        },
        _orderCogs: {
          $reduce: {
            input: "$items",
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                {
                  $multiply: [
                    {
                      $ifNull: [
                        { $ifNull: ["$$this.fifoUnitCost", "$$this.supplierPrice"] },
                        0,
                      ],
                    },
                    "$$this.quantity",
                  ],
                },
              ],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: { order: "$_id", group: "$_dateGroup" },
        netSales: { $first: "$totalAmount" },
        cogs: { $first: "$_orderCogs" },
      },
    },
    {
      $group: {
        _id: "$_id.group",
        netSales: { $sum: "$netSales" },
        cogs: { $sum: "$cogs" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Refund reversals ISSUED per bucket (grouped by refund.refundedAt, not
  // createdAt) — nets into the bucket so a cross-window refund lands in the
  // period it happened, never retroactively in the sale period.
  const refundBuckets = await Order.aggregate([
    {
      $match: buildRefundMatch(filters) as unknown as mongoose.PipelineStage.Match,
    },
    {
      $set: {
        _dateGroup: {
          $dateToString: { format: dateFormat, date: "$refund.refundedAt" },
        },
        _orderCogs: {
          $reduce: {
            input: "$items",
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                {
                  $multiply: [
                    {
                      $ifNull: [
                        { $ifNull: ["$$this.fifoUnitCost", "$$this.supplierPrice"] },
                        0,
                      ],
                    },
                    "$$this.quantity",
                  ],
                },
              ],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: { order: "$_id", group: "$_dateGroup" },
        refunds: { $first: "$totalAmount" },
        refundedCogs: { $first: "$_orderCogs" },
      },
    },
    {
      $group: {
        _id: "$_id.group",
        refunds: { $sum: "$refunds" },
        refundedCogs: { $sum: "$refundedCogs" },
      },
    },
  ]);

  // Compute operating expenses per bucket
  const expenseAgg = await Expense.aggregate([
    {
      $match: {
        expenseDate: { $gte: from, $lt: to },
        status: { $ne: "void" },
      },
    },
    {
      $set: {
        _dateGroup: {
          $dateToString: { format: dateFormat, date: "$expenseDate" },
        },
      },
    },
    {
      $group: {
        _id: "$_dateGroup",
        expenses: { $sum: "$amount" },
      },
    },
  ]);

  const refundByGroup = new Map(
    refundBuckets.map((b) => [
      String(b._id ?? ""),
      {
        refunds: roundToman(b.refunds ?? 0),
        refundedCogs: roundToman(b.refundedCogs ?? 0),
      },
    ])
  );
  const salesByGroup = new Map<string, TrendSalesAgg>(
    buckets.map((b) => {
      const key = String(b._id ?? "");
      const refund = refundByGroup.get(key) ?? { refunds: 0, refundedCogs: 0 };
      return [
        key,
        {
          netSales: roundToman(b.netSales ?? 0),
          cogs: roundToman(b.cogs ?? 0),
          refunds: refund.refunds,
          refundedCogs: refund.refundedCogs,
        },
      ];
    })
  );
  const expenseByGroup = new Map<string, number>(
    expenseAgg.map((e) => [e._id, roundToman(e.expenses)])
  );

  return assembleTrendBuckets(skeleton, salesByGroup, expenseByGroup);
}

// ---------------------------------------------------------------------------
// Main: getProfitabilityReport
// ---------------------------------------------------------------------------

export async function getProfitabilityReport(
  filters: ReportFilters
): Promise<ProfitabilityReportData> {
  const { from, to } = windowDates(filters);

  // Previous period (same length, ending at current period start)
  const rangeMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - rangeMs);
  const prevTo = new Date(from.getTime());

  const prevFilters: ReportFilters = {
    ...filters,
    from: prevFrom.toISOString().slice(0, 10),
    to: new Date(prevTo.getTime() - 1).toISOString().slice(0, 10),
  };

  // Parallel fetches
  const [
    current,
    previous,
    currentExpenses,
    prevExpenses,
    currentExpenseCats,
    trend,
  ] = await Promise.all([
    aggregateItemProfitability(filters),
    aggregateItemProfitability(prevFilters),
    sumNonVoidExpenses(from, to),
    sumNonVoidExpenses(prevFrom, prevTo),
    expensesByCategory(from, to),
    computeTrend(filters),
  ]);

  // OrderItem does not preserve a category snapshot. Using the current
  // Product.category here would rewrite historical sales after a product is
  // moved, so category profitability is intentionally unavailable.

  // --- KPIs ---
  // grossProfit = netSales − grossCOGS + refundedCOGS (explicit reversal)
  const grossProfit =
    current.totalNetSales - current.totalCogs + current.totalRefundsCogs;
  const prevGrossProfit =
    previous.totalNetSales - previous.totalCogs + previous.totalRefundsCogs;
  const netProfit = grossProfit - currentExpenses;
  const prevNetProfit = prevGrossProfit - prevExpenses;

  const kpis: ProfitabilityKpi[] = [
    {
      key: "grossSales",
      label: "فروش ناخالص",
      value: current.totalGrossSales,
      format: "money",
      prevValue: previous.totalGrossSales,
      changePercent: safePct(
        current.totalGrossSales - previous.totalGrossSales,
        previous.totalGrossSales
      ),
    },
    {
      key: "productDiscount",
      label: "تخفیف محصولات",
      value: current.totalProductDiscount,
      format: "money",
      prevValue: previous.totalProductDiscount,
      changePercent: safePct(
        current.totalProductDiscount - previous.totalProductDiscount,
        previous.totalProductDiscount
      ),
    },
    {
      key: "couponDiscount",
      label: "تخفیف کوپن",
      value: current.totalCouponDiscount,
      format: "money",
      prevValue: previous.totalCouponDiscount,
      changePercent: safePct(
        current.totalCouponDiscount - previous.totalCouponDiscount,
        previous.totalCouponDiscount
      ),
    },
    {
      key: "refunds",
      label: "بازپرداخت‌ها",
      value: current.totalRefundsRevenue,
      format: "money",
      prevValue: previous.totalRefundsRevenue,
      changePercent: safePct(
        current.totalRefundsRevenue - previous.totalRefundsRevenue,
        previous.totalRefundsRevenue
      ),
    },
    {
      key: "refundsCogs",
      label: "بازگشت بهای تمام‌شده",
      value: current.totalRefundsCogs,
      format: "money",
      prevValue: previous.totalRefundsCogs,
      changePercent: safePct(
        current.totalRefundsCogs - previous.totalRefundsCogs,
        previous.totalRefundsCogs
      ),
    },
    {
      key: "netSales",
      label: "فروش خالص",
      value: current.totalNetSales,
      format: "money",
      prevValue: previous.totalNetSales,
      changePercent: safePct(
        current.totalNetSales - previous.totalNetSales,
        previous.totalNetSales
      ),
    },
    {
      key: "cogs",
      label: "بهای تمام‌شده (COGS)",
      value: current.totalCogs,
      format: "money",
      prevValue: previous.totalCogs,
      changePercent: safePct(
        current.totalCogs - previous.totalCogs,
        previous.totalCogs
      ),
    },
    {
      key: "grossProfit",
      label: "سود ناخالص",
      value: grossProfit,
      format: "money",
      prevValue: prevGrossProfit,
      changePercent: safePct(grossProfit - prevGrossProfit, prevGrossProfit),
    },
    {
      key: "grossMargin",
      label: "حاشیه سود ناخالص",
      value: safePct(grossProfit, current.totalNetSales),
      format: "percent",
      prevValue: safePct(prevGrossProfit, previous.totalNetSales),
      changePercent: null,
    },
    {
      key: "operatingExpenses",
      label: "هزینه‌های عملیاتی",
      value: currentExpenses,
      format: "money",
      prevValue: prevExpenses,
      changePercent: safePct(
        currentExpenses - prevExpenses,
        prevExpenses
      ),
    },
    {
      key: "netProfit",
      label: "سود خالص",
      value: netProfit,
      format: "money",
      prevValue: prevNetProfit,
      changePercent: safePct(netProfit - prevNetProfit, prevNetProfit),
    },
    {
      key: "netMargin",
      label: "حاشیه سود خالص",
      value: safePct(netProfit, current.totalNetSales),
      format: "percent",
      prevValue: safePct(prevNetProfit, previous.totalNetSales),
      changePercent: null,
    },
  ];

  // --- Waterfall (pure formula — explicit refund steps, see computeWaterfallSteps) ---
  const waterfall: WaterfallStep[] = computeWaterfallSteps(
    {
      totalNetSales: current.totalNetSales,
      totalCogs: current.totalCogs,
      totalGrossSales: current.totalGrossSales,
      totalProductDiscount: current.totalProductDiscount,
      totalCouponDiscount: current.totalCouponDiscount,
      totalRefundsRevenue: current.totalRefundsRevenue,
      totalRefundsCogs: current.totalRefundsCogs,
    },
    currentExpenses
  );

  // --- Product Profitability (net of refund reversals via computeProductRow) ---
  const productRows: ProductProfitRow[] = current.items.map((item) =>
    computeProductRow(item, {
      totalNetSales: current.totalNetSales,
      totalCogs: current.totalCogs,
      totalGrossSales: current.totalGrossSales,
      totalProductDiscount: current.totalProductDiscount,
      totalCouponDiscount: current.totalCouponDiscount,
      totalRefundsRevenue: current.totalRefundsRevenue,
      totalRefundsCogs: current.totalRefundsCogs,
    })
  );

  // Category profitability is unavailable until category is stored as an
  // immutable OrderItem snapshot.
  const categories: CategoryProfitRow[] = [];

  // --- Expense Analysis ---
  const totalExpenseAmount = currentExpenseCats.reduce(
    (s, e) => s + e.total,
    0
  );
  const expenses: ExpenseAnalysisRow[] = currentExpenseCats.map((e) => ({
    category: e.category,
    categoryLabel:
      EXPENSE_CATEGORY_LABELS[
        e.category as keyof typeof EXPENSE_CATEGORY_LABELS
      ] || e.category,
    amount: e.total,
    pctOfTotalExpenses:
      totalExpenseAmount > 0
        ? Math.round((e.total / totalExpenseAmount) * 1000) / 10
        : 0,
    pctOfGrossProfit: safePct(e.total, grossProfit),
  }));

  // --- Diagnostics ---
  const diagnostics: DiagnosticInsight[] = [];

  // Sales vs previous
  const salesChange = safePct(
    current.totalNetSales - previous.totalNetSales,
    previous.totalNetSales
  );
  if (salesChange !== null) {
    diagnostics.push({
      key: "salesChange",
      text: `فروش خالص نسبت به دوره قبل ${salesChange > 0 ? "افزایش" : "کاهش"} ${Math.abs(salesChange)}٪ یافته است.`,
      type: salesChange > 0 ? "positive" : "negative",
    });
  }

  // Gross profit vs previous
  const gpChange = safePct(grossProfit - prevGrossProfit, prevGrossProfit);
  if (gpChange !== null) {
    diagnostics.push({
      key: "gpChange",
      text: `سود ناخالص ${gpChange > 0 ? "افزایش" : "کاهش"} ${Math.abs(gpChange)}٪ یافته است.`,
      type: gpChange > 0 ? "positive" : "negative",
    });
  }

  // Margin change
  const currentMargin = safePct(grossProfit, current.totalNetSales);
  const prevMargin = safePct(prevGrossProfit, previous.totalNetSales);
  if (currentMargin !== null && prevMargin !== null) {
    const marginDiff = Math.round((currentMargin - prevMargin) * 10) / 10;
    if (Math.abs(marginDiff) > 0.5) {
      diagnostics.push({
        key: "marginChange",
        text: `حاشیه سود ناخالص از ${prevMargin}٪ به ${currentMargin}٪ ${marginDiff > 0 ? "افزایش" : "کاهش"} یافته است.`,
        type: marginDiff > 0 ? "positive" : "negative",
      });
    }
  }

  // Expense change
  const expChange = safePct(
    currentExpenses - prevExpenses,
    prevExpenses
  );
  if (expChange !== null) {
    diagnostics.push({
      key: "expenseChange",
      text: `هزینه‌های عملیاتی ${expChange > 0 ? "افزایش" : "کاهش"} ${Math.abs(expChange)}٪ یافته است.`,
      type: expChange > 0 ? "warning" : "positive",
    });
  }

  // Top profit product
  if (productRows.length > 0) {
    const sorted = [...productRows].sort(
      (a, b) => b.grossProfit - a.grossProfit
    );
    const top = sorted[0];
    if (top.grossProfit > 0) {
      diagnostics.push({
        key: "topProfitProduct",
        text: `محصول «${top.name}» بیشترین سود ناخالص (${roundToman(top.grossProfit).toLocaleString("fa-IR")} تومان) را ایجاد کرده است.`,
        type: "positive",
      });
    }
  }

  // Low margin products (positive sales, margin < 10%)
  const lowMargin = productRows.filter(
    (p) => p.netSales > 0 && p.grossMargin !== null && p.grossMargin < 10
  );
  if (lowMargin.length > 0) {
    const names = lowMargin
      .slice(0, 3)
      .map((p) => `«${p.name}»`)
      .join("، ");
    diagnostics.push({
      key: "lowMarginProducts",
      text: `${lowMargin.length} محصول حاشیه سود پایین (زیر ۱۰٪) دارند: ${names}${lowMargin.length > 3 ? ` و ${lowMargin.length - 3} مورد دیگر` : ""}.`,
      type: "warning",
    });
  }

  // Loss-making products
  const lossProducts = productRows.filter((p) => p.grossProfit < 0);
  if (lossProducts.length > 0) {
    const names = lossProducts
      .slice(0, 3)
      .map((p) => `«${p.name}»`)
      .join("، ");
    diagnostics.push({
      key: "lossProducts",
      text: `${lossProducts.length} محصول در این بازه زیان‌ده بوده‌اند: ${names}.`,
      type: "negative",
    });
  }

  // Net profit insight
  if (netProfit < 0) {
    diagnostics.push({
      key: "negativeNetProfit",
      text: `فروشگاه در این بازه زیان خالص ${Math.abs(netProfit).toLocaleString("fa-IR")} تومان داشته است.`,
      type: "negative",
    });
  } else if (netProfit > 0 && currentExpenses > grossProfit * 0.5) {
    diagnostics.push({
      key: "highExpenseRatio",
      text: `هزینه‌های عملیاتی بیش از ۵۰٪ سود ناخالص را مصرف می‌کنند.`,
      type: "warning",
    });
  }

  // --- Financial Health ---
  const health: FinancialHealthIndicator[] = [
    {
      key: "grossMargin",
      label: "حاشیه سود ناخالص",
      value: currentMargin,
      format: "percent",
    },
    {
      key: "netMargin",
      label: "حاشیه سود خالص",
      value: safePct(netProfit, current.totalNetSales),
      format: "percent",
    },
    {
      key: "cogsRatio",
      label: "نسبت COGS به فروش",
      value: safePct(current.totalCogs, current.totalNetSales),
      format: "percent",
    },
    {
      key: "expenseToSales",
      label: "نسبت هزینه عملیاتی به فروش",
      value: safePct(currentExpenses, current.totalNetSales),
      format: "percent",
    },
    {
      key: "expenseToGp",
      label: "نسبت هزینه عملیاتی به سود ناخالص",
      value: safePct(currentExpenses, grossProfit),
      format: "percent",
    },
  ];

  return {
    report: "profitability",
    filters,
    kpis,
    waterfall,
    products: productRows,
    categories,
    expenses,
    diagnostics,
    health,
    trend,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit-testing — no DB access)
// ---------------------------------------------------------------------------

/** Raw line item shape as returned by the MongoDB aggregation. */
export interface AggProductLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  lineNet: number;     // price × qty
  grossLine: number;   // originalPrice × qty
  discountLine: number; // discountAmount × qty
  cogs: number;        // fifoUnitCost or supplierPrice × qty
  couponAllocation?: number;
  /** Refunded revenue attributed to this line's product (optional for tests). */
  returnedAmount?: number;
  /** Refunded COGS attributed to this line's product (optional for tests). */
  returnedCogs?: number;
}

/** Summary totals from the order-level aggregation (net of refund reversals). */
export interface AggSummary {
  totalNetSales: number;
  totalCogs: number;
  totalGrossSales: number;
  totalProductDiscount: number;
  totalCouponDiscount: number;
  /** Refund revenue reversal ISSUED in the window (optional for tests). */
  totalRefundsRevenue?: number;
  /** Refunded-COGS reversal ISSUED in the window (optional for tests). */
  totalRefundsCogs?: number;
}

/**
 * Pure formula: compute a single product profitability row.
 * Encapsulates coupon allocation + gross-profit + margin + share.
 */
export function computeProductRow(
  item: AggProductLine,
  summary: AggSummary,
): ProductProfitRow {
  const couponAlloc =
    item.couponAllocation ??
    (summary.totalNetSales > 0
      ? roundToman(
          (item.lineNet / summary.totalNetSales) * summary.totalCouponDiscount,
        )
      : 0);
  // Refund reversal attributed to this product (refund-window basis): the
  // row's revenue is net of the refunded revenue, COGS stays gross, and the
  // refunded COGS is added back explicitly —
  //   netSales − cogs + returnedCogs = grossProfit
  // so Σ rows reconciles with the netted KPIs on every column.
  const returnedAmount = item.returnedAmount ?? 0;
  const returnedCogs = item.returnedCogs ?? 0;
  const netSales = item.lineNet - couponAlloc - returnedAmount;
  const grossProfit = netSales - item.cogs + returnedCogs;
  const totalGrossProfit =
    summary.totalNetSales - summary.totalCogs + (summary.totalRefundsCogs ?? 0);
  const grossMargin = safePct(grossProfit, netSales);
  const profitShare = safePct(grossProfit, totalGrossProfit);
  return {
    productId: item.productId,
    name: item.name,
    sku: item.sku,
    quantity: item.quantity,
    grossSales: item.grossLine,
    productDiscount: item.discountLine,
    couponAllocation: couponAlloc,
    returnedAmount: roundToman(returnedAmount),
    returnedCogs: roundToman(returnedCogs),
    netSales: roundToman(netSales),
    cogs: roundToman(item.cogs),
    grossProfit: roundToman(grossProfit),
    grossMargin,
    profitShare,
  };
}

/**
 * Pure formula: compute the waterfall from summary totals.
 *
 * Explicit, fully additive refund steps (refund-treatment fix):
 *   grossSales − productDiscount − couponDiscount − refunds = netSales
 *   netSales − cogs + refundsCogs = grossProfit
 *   grossProfit − operatingExpenses = netProfit
 * `refundsCogs` is ADDITIVE (a reversal of the gross COGS step), mirroring
 * the P&L statement rows.
 */
export function computeWaterfallSteps(
  summary: AggSummary,
  operatingExpenses: number,
): WaterfallStep[] {
  const refundsRevenue = summary.totalRefundsRevenue ?? 0;
  const refundsCogs = summary.totalRefundsCogs ?? 0;
  const netSales = summary.totalNetSales;
  // COGS stays gross; the refunded COGS is an explicit ADD-BACK step:
  //   netSales − grossCOGS + refundedCOGS = grossProfit
  const grossProfit = netSales - summary.totalCogs + refundsCogs;
  const netProfit = grossProfit - operatingExpenses;
  /** Negate without producing −0 (−0 is falsy but unequal to +0). */
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return [
    {
      key: "grossSales",
      label: "فروش ناخالص",
      amount: summary.totalGrossSales,
      cumulative: summary.totalGrossSales,
      subtractive: false,
    },
    {
      key: "productDiscount",
      label: "تخفیف محصولات",
      amount: neg(summary.totalProductDiscount),
      cumulative: summary.totalGrossSales - summary.totalProductDiscount,
      subtractive: true,
    },
    {
      key: "couponDiscount",
      label: "تخفیف کوپن",
      amount: neg(summary.totalCouponDiscount),
      cumulative:
        summary.totalGrossSales -
        summary.totalProductDiscount -
        summary.totalCouponDiscount,
      subtractive: true,
    },
    {
      key: "refunds",
      label: "بازپرداخت‌ها",
      amount: neg(refundsRevenue),
      cumulative:
        summary.totalGrossSales -
        summary.totalProductDiscount -
        summary.totalCouponDiscount -
        refundsRevenue,
      subtractive: true,
    },
    {
      key: "netSales",
      label: "فروش خالص",
      amount: netSales,
      cumulative: netSales,
      subtractive: false,
    },
    {
      key: "cogs",
      label: "COGS",
      amount: neg(summary.totalCogs),
      cumulative: netSales - summary.totalCogs,
      subtractive: true,
    },
    {
      key: "refundsCogs",
      label: "بازگشت بهای تمام‌شده",
      amount: refundsCogs,
      cumulative: grossProfit,
      subtractive: false,
    },
    {
      key: "grossProfit",
      label: "سود ناخالص",
      amount: grossProfit,
      cumulative: grossProfit,
      subtractive: false,
    },
    {
      key: "operatingExpenses",
      label: "هزینه‌های عملیاتی",
      amount: neg(operatingExpenses),
      cumulative: netProfit,
      subtractive: true,
    },
    {
      key: "netProfit",
      label: "سود خالص",
      amount: netProfit,
      cumulative: netProfit,
      subtractive: false,
    },
  ];
}
