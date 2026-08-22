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
  windowDates,
} from "@/lib/report-matches";
import {
  roundToman,
  safePct,
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
  from: Date;
  to: Date;
  netSales: number;
  cogs: number;
  grossProfit: number;
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
  }>;
  totalNetSales: number;
  totalCogs: number;
  totalGrossSales: number;
  totalProductDiscount: number;
  totalCouponDiscount: number;
  totalGrossProfit: number;
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

  // Order-level totals
  const [orderTotals] = await Order.aggregate([
    { $match: orderMatch as unknown as mongoose.PipelineStage.Match },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        netSales: { $sum: "$totalAmount" },
        couponDiscount: { $sum: { $ifNull: ["$discount.amount", 0] } },
        refunds: {
          $sum: {
            $cond: [
              { $eq: ["$payment.status", "refunded"] },
              "$totalAmount",
              0,
            ],
          },
        },
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
  const totalNetSales = roundToman(ot.netSales ?? 0);
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
  const totalGrossProfit = totalNetSales - totalCogs;

  const items = productAgg.map((r) => ({
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
  }));

  return {
    items,
    totalNetSales,
    totalCogs,
    totalGrossSales,
    totalProductDiscount,
    totalCouponDiscount,
    totalGrossProfit,
    orders: ot.orders ?? 0,
    units: items.reduce((s, r) => s + r.quantity, 0),
    refunds: roundToman(ot.refunds ?? 0),
    paidAmount: roundToman(ot.paidAmount ?? 0),
    pendingAmount: roundToman(ot.pendingAmount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Trend: bucket orders by day/week/month
// ---------------------------------------------------------------------------

async function computeTrend(
  filters: ReportFilters
): Promise<TrendBucket[]> {
  const { from, to } = windowDates(filters);
  const rangeDays = Math.ceil(
    (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
  );

  // Use the requested grouping when present; otherwise choose a sensible
  // default for the selected range.
  const groupBy = filters.trendGroup ??
    (rangeDays <= 31 ? "day" : rangeDays <= 180 ? "week" : "month");
  const dateFormat =
    groupBy === "day"
      ? "%Y-%m-%d"
      : groupBy === "week"
        ? "%G-W%V"
        : "%Y-%m";

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

  const expenseByGroup = new Map(
    expenseAgg.map((e) => [e._id, roundToman(e.expenses)])
  );

  return buckets.map((b) => {
    const ns = roundToman(b.netSales ?? 0);
    const cogs = roundToman(b.cogs ?? 0);
    const gp = ns - cogs;
    const exp = expenseByGroup.get(b._id.group) ?? 0;
    return {
      label: String(b._id ?? ""),
      from,
      to,
      netSales: ns,
      cogs,
      grossProfit: gp,
      netProfit: gp - exp,
    };
  });
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
  const grossProfit = current.totalNetSales - current.totalCogs;
  const prevGrossProfit = previous.totalNetSales - previous.totalCogs;
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

  // --- Waterfall ---
  const waterfall: WaterfallStep[] = [
    {
      key: "grossSales",
      label: "فروش ناخالص",
      amount: current.totalGrossSales,
      cumulative: current.totalGrossSales,
      subtractive: false,
    },
    {
      key: "productDiscount",
      label: "تخفیف محصولات",
      amount: -current.totalProductDiscount,
      cumulative: current.totalGrossSales - current.totalProductDiscount,
      subtractive: true,
    },
    {
      key: "couponDiscount",
      label: "تخفیف کوپن",
      amount: -current.totalCouponDiscount,
      cumulative:
        current.totalGrossSales -
        current.totalProductDiscount -
        current.totalCouponDiscount,
      subtractive: true,
    },
    {
      key: "netSales",
      label: "فروش خالص",
      amount: current.totalNetSales,
      cumulative: current.totalNetSales,
      subtractive: false,
    },
    {
      key: "cogs",
      label: "COGS",
      amount: -current.totalCogs,
      cumulative: grossProfit,
      subtractive: true,
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
      amount: -currentExpenses,
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

  // --- Product Profitability ---
  const productRows: ProductProfitRow[] = current.items.map((item) => {
    // Distribute coupon proportionally
    const couponAlloc = item.couponAllocation;
    const netSales = item.lineNet - couponAlloc;
    const gp = netSales - item.cogs;
    const margin = safePct(gp, netSales);
    const share = safePct(gp, grossProfit);
    return {
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      grossSales: item.grossLine,
      productDiscount: item.discountLine,
      couponAllocation: couponAlloc,
      netSales,
      cogs: item.cogs,
      grossProfit: gp,
      grossMargin: margin,
      profitShare: share,
    };
  });

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
}

/** Summary totals from the order-level aggregation. */
export interface AggSummary {
  totalNetSales: number;
  totalCogs: number;
  totalGrossSales: number;
  totalProductDiscount: number;
  totalCouponDiscount: number;
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
  const netSales = item.lineNet - couponAlloc;
  const grossProfit = netSales - item.cogs;
  const totalGrossProfit = summary.totalNetSales - summary.totalCogs;
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
    netSales,
    cogs: roundToman(item.cogs),
    grossProfit: roundToman(grossProfit),
    grossMargin,
    profitShare,
  };
}

/**
 * Pure formula: compute the waterfall from summary totals.
 */
export function computeWaterfallSteps(
  summary: AggSummary,
  operatingExpenses: number,
): WaterfallStep[] {
  const netSales = summary.totalNetSales;
  const grossProfit = netSales - summary.totalCogs;
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
      cumulative: grossProfit,
      subtractive: true,
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
