/**
 * Reports — server-side aggregation services (Session 81).
 *
 * Sales, COGS and profit figures are computed from the order ITEM SNAPSHOTS
 * (immutable at purchase time) or the order/payment/coupon documents — never
 * from the current Product price. Inventory VALUE is the one documented
 * exception (current stock × current supplierPrice). Order-level coupon
 * discounts are allocated to lines proportionally to line net so every report
 * reconciles to `totalAmount`.
 *
 * Accounting notes (documented limitations — never fabricated):
 *  - Tax and shipping cost are NOT stored → not reported (N/A) — never shown
 *    as zero.
 *  - Refunds are whole-order (payment.status paid → refunded); per-item
 *    returned quantities do not exist → refunds are allocated per line
 *    proportionally to line net (sums exactly to the order total).
 *  - "Opening stock" is reconstructed (current + sold − returned) — stock
 *    edits/restocks within the window are not recorded.
 *  - COGS uses the historical item.supplierPrice snapshot captured at each
 *    sale (a fixed per-sale cost snapshot — NOT FIFO/weighted-average purchase
 *    costing; no procurement ledger exists).
 *  - Inventory VALUE is current stock × CURRENT product/variant supplierPrice
 *    — a current-cost approximation, NOT an accounting-grade inventory
 *    valuation (cost layers are not recorded; revaluing a product's
 *    supplierPrice revalues all remaining stock).
 *  - Expenses are not tracked → net profit (beyond gross profit) is N/A.
 */

import mongoose from "mongoose";
import Order from "@/models/Order";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";
import Supplier from "@/models/Supplier";
import User from "@/models/User";
import {
  addDays,
  dateParam,
  EXPORT_MAX_ROWS,
  LOW_STOCK_THRESHOLD,
  parseDateParam,
  roundToman,
  safePct,
  startOfUtcDay,
} from "@/lib/report-utils";
import type {
  CouponReportRow,
  CustomerSalesRow,
  DashboardReport,
  InventoryReportRow,
  OrdersReportRow,
  PaymentsReportRow,
  ProfitLossReport,
  PurchasesReportRow,
  RefundsReportRow,
  ReportFilters,
  ReportSummary,
  SalesReportRow,
} from "@/types";

const { ObjectId } = mongoose.Types;

/** Escape a user string for use inside a RegExp constructor. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve the inclusive-exclusive Mongo window for the filters. */
function windowDates(filters: ReportFilters): { from: Date; to: Date } {
  const from = parseDateParam(filters.from ?? "");
  const to = parseDateParam(filters.to ?? "");
  return {
    from: from ?? startOfUtcDay(new Date()),
    to: to ? addDays(to, 1) : addDays(startOfUtcDay(new Date()), 1),
  };
}

/**
 * Build the ORDER-level match: window + order-scoped filters.
 * Non-cancelled by default; an explicit status filter overrides that.
 *
 * With `excludeLineScoped` (used by the sales report), product / category / q
 * are NOT applied here — they are line-scoped (applied after $unwind, so a
 * matching order does not drag its non-matching lines into the report). For
 * the order-level reports (orders/payments/refunds/coupons/customers) those
 * filters keep their whole-order semantics.
 */
async function buildOrderMatch(
  filters: ReportFilters,
  { excludeLineScoped = false }: { excludeLineScoped?: boolean } = {}
) {
  const { from, to } = windowDates(filters);
  const match: Record<string, unknown> = {
    createdAt: { $gte: from, $lt: to },
  };
  if (filters.orderStatus) {
    match.status = filters.orderStatus;
  } else {
    match.status = { $ne: "cancelled" };
  }
  if (filters.paymentStatus) match["payment.status"] = filters.paymentStatus;
  if (filters.paymentMethod) match["payment.method"] = filters.paymentMethod;
  if (filters.customerId) match.customer = new ObjectId(filters.customerId);
  if (filters.coupon) {
    match["discount.code"] = new RegExp(escapeRegExp(filters.coupon), "i");
  }
  if (!excludeLineScoped) {
    if (filters.productId) {
      match["items.product"] = new ObjectId(filters.productId);
    }
    if (filters.categoryId) {
      match["items.product"] = { $in: await productIdsInCategory(filters.categoryId) };
    }
    if (filters.q) {
      // General search: customer name/phone OR product name (order snapshots)
      // OR exact order id — one filter works for every report.
      const needle = escapeRegExp(filters.q);
      const conditions: Array<Record<string, unknown>> = [];
      const userMatches = await User.find({
        $or: [
          { name: new RegExp(needle, "i") },
          { phone: new RegExp(needle, "i") },
        ],
      })
        .select("_id")
        .lean();
      const ids = userMatches.map((u) => u._id);
      if (mongoose.isValidObjectId(filters.q)) ids.push(new ObjectId(filters.q));
      if (ids.length > 0) conditions.push({ customer: { $in: ids } });
      conditions.push({ "items.name": new RegExp(needle, "i") });
      match.$or = conditions;
    }
  }
  return match;
}

async function productIdsInCategory(categoryId: string) {
  const productIds = await Product.find({ category: new ObjectId(categoryId) })
    .select("_id")
    .lean();
  return productIds.map((p) => p._id);
}

/**
 * LINE-level match (applied after $unwind in the sales report): product,
 * category and q now scope to the individual line, so a matched order never
 * drags its non-matching lines into the report.
 *
 * NOTE: after `$unwind: "$items"` the line fields are nested under `items`
 * (e.g. `items.product`, `items.name`), so the match keys MUST be prefixed
 * with `items.` — a bare `{ product: ... }` matches nothing.
 */
async function buildLineMatch(filters: ReportFilters) {
  const match: Record<string, unknown> = {};
  if (filters.productId) {
    match["items.product"] = new ObjectId(filters.productId);
  }
  if (filters.categoryId) {
    match["items.product"] = { $in: await productIdsInCategory(filters.categoryId) };
  }
  if (filters.q) {
    match["items.name"] = new RegExp(escapeRegExp(filters.q), "i");
  }
  return Object.keys(match).length > 0 ? match : null;
}

// ---------------------------------------------------------------------------
// Summary KPIs (shared by the dashboard, P&L and every report envelope)
// ---------------------------------------------------------------------------

async function computeInventoryValue() {
  const products = await Product.find()
    .select(
      "name price supplierPrice stock hasVariants variants.stock variants.supplierPrice variants.price"
    )
    .lean();
  let cost = 0;
  let retail = 0;
  for (const p of products) {
    if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
      const totalCost = p.variants.reduce(
        (a, v) => a + (v.supplierPrice || 0) * (v.stock || 0),
        0
      );
      const totalRetail = p.variants.reduce(
        (a, v) => a + (v.price || 0) * (v.stock || 0),
        0
      );
      cost += totalCost;
      retail += totalRetail;
    } else {
      cost += (p.supplierPrice || 0) * (p.stock || 0);
      retail += (p.price || 0) * (p.stock || 0);
    }
  }
  return { inventoryValue: roundToman(cost), inventoryRetail: roundToman(retail) };
}

async function computeSummary(match: Record<string, unknown>): Promise<ReportSummary> {
  const [orderAgg, lineAgg] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          netSales: { $sum: "$totalAmount" },
          couponDiscount: { $sum: { $ifNull: ["$discount.amount", 0] } },
          refunds: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "refunded"] }, "$totalAmount", 0],
            },
          },
          refundedOrders: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "refunded"] }, 1, 0],
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
          failedAmount: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "failed"] }, "$totalAmount", 0],
            },
          },
        },
      },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: null,
          units: { $sum: "$items.quantity" },
          grossSales: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.originalPrice", "$items.price"] },
                "$items.quantity",
              ],
            },
          },
          productDiscount: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.discountAmount", 0] },
                "$items.quantity",
              ],
            },
          },
          cogs: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.supplierPrice", 0] },
                "$items.quantity",
              ],
            },
          },
        },
      },
    ]),
  ]);

  const o = orderAgg[0] ?? {};
  const l = lineAgg[0] ?? {};
  const netSales = roundToman(o.netSales ?? 0);
  const cogs = roundToman(l.cogs ?? 0);
  const grossProfit = netSales - cogs;
  const { inventoryValue } = await computeInventoryValue();
  const orders = o.orders ?? 0;

  return {
    from: "",
    to: "",
    preset: null,
    orders,
    unitsSold: roundToman(l.units ?? 0),
    grossSales: roundToman(l.grossSales ?? 0),
    productDiscount: roundToman(l.productDiscount ?? 0),
    couponDiscount: roundToman(o.couponDiscount ?? 0),
    netSales,
    cogs,
    grossProfit,
    grossMargin: safePct(grossProfit, netSales),
    refundedOrders: o.refundedOrders ?? 0,
    refunds: roundToman(o.refunds ?? 0),
    paidAmount: roundToman(o.paidAmount ?? 0),
    pendingAmount: roundToman(o.pendingAmount ?? 0),
    outstandingAmount: roundToman(
      (o.pendingAmount ?? 0) + (o.failedAmount ?? 0)
    ),
    avgOrderValue: orders > 0 ? roundToman(netSales / orders) : 0,
    inventoryValue,
    inventoryCost: inventoryValue,
  };
}

function withRange(summary: ReportSummary, filters: ReportFilters): ReportSummary {
  return {
    ...summary,
    from: filters.from ?? "",
    to: filters.to ?? "",
    preset: filters.preset,
  };
}

// ---------------------------------------------------------------------------
// Sales report (per product, from immutable item snapshots)
// ---------------------------------------------------------------------------

interface SalesAggRow {
  _id: mongoose.Types.ObjectId;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  grossSales: number;
  productDiscount: number;
  couponDiscount: number;
  netSales: number;
  cogs: number;
  returnedQuantity: number;
  returnedAmount: number;
  firstSaleAt: Date | null;
  lastSaleAt: Date | null;
}

export async function getSalesReport(filters: ReportFilters) {
  const orderMatch = await buildOrderMatch(filters, { excludeLineScoped: true });
  const lineMatch = await buildLineMatch(filters);
  const baseStages: mongoose.PipelineStage[] = [
    {
      $match: orderMatch as unknown as mongoose.PipelineStage.Match,
    },
    { $unwind: "$items" },
  ];
  if (lineMatch) {
    baseStages.push({
      $match: lineMatch as unknown as mongoose.PipelineStage.Match,
    });
  }

  const [summaryAgg, agg] = await Promise.all([
    // Line-derived summary: reconciles exactly with the table totals (and
    // equals the order-level summary when no line filter is active).
    Order.aggregate<Record<string, unknown>>([
      ...baseStages,
      {
        $project: {
          qty: 1,
          gross: {
            $multiply: [
              { $ifNull: ["$items.originalPrice", "$items.price"] },
              "$items.quantity",
            ],
          },
          prodDisc: {
            $multiply: [
              { $ifNull: ["$items.discountAmount", 0] },
              "$items.quantity",
            ],
          },
          lineNet: { $multiply: ["$items.price", "$items.quantity"] },
          cogsLine: {
            $multiply: [
              { $ifNull: ["$items.supplierPrice", 0] },
              "$items.quantity",
            ],
          },
          couponLine: {
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
          returnedAmount: {
            $cond: [
              { $eq: ["$payment.status", "refunded"] },
              {
                $multiply: [
                  { $multiply: ["$items.price", "$items.quantity"] },
                  {
                    $cond: [
                      { $gt: [{ $ifNull: ["$subtotalAmount", 0] }, 0] },
                      { $divide: ["$totalAmount", "$subtotalAmount"] },
                      1,
                    ],
                  },
                ],
              },
              0,
            ],
          },
          isRefunded: { $eq: ["$payment.status", "refunded"] },
          isPaid: {
            $in: ["$payment.status", ["paid", "refunded"]],
          },
          isPending: { $eq: ["$payment.status", "pending"] },
          isFailed: { $eq: ["$payment.status", "failed"] },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $addToSet: "$_id" },
          refundedOrders: {
            $addToSet: {
              $cond: ["$isRefunded", "$_id", null],
            },
          },
          units: { $sum: "$qty" },
          grossSales: { $sum: "$gross" },
          productDiscount: { $sum: "$prodDisc" },
          couponDiscount: { $sum: "$couponLine" },
          netSales: { $sum: { $subtract: ["$lineNet", "$couponLine"] } },
          cogs: { $sum: "$cogsLine" },
          refunds: { $sum: "$returnedAmount" },
          paidAmount: {
            $sum: {
              $cond: ["$isPaid", { $subtract: ["$lineNet", "$couponLine"] }, 0],
            },
          },
          pendingAmount: {
            $sum: {
              $cond: ["$isPending", { $subtract: ["$lineNet", "$couponLine"] }, 0],
            },
          },
          failedAmount: {
            $sum: {
              $cond: ["$isFailed", { $subtract: ["$lineNet", "$couponLine"] }, 0],
            },
          },
        },
      },
    ]),
    Order.aggregate<SalesAggRow>([
      ...baseStages,
      {
        $project: {
          product: "$items.product",
          name: "$items.name",
          sku: { $ifNull: ["$items.sku", ""] },
          qty: "$items.quantity",
          lineNet: { $multiply: ["$items.price", "$items.quantity"] },
          gross: {
            $multiply: [
              { $ifNull: ["$items.originalPrice", "$items.price"] },
              "$items.quantity",
            ],
          },
          prodDisc: {
            $multiply: [
              { $ifNull: ["$items.discountAmount", 0] },
              "$items.quantity",
            ],
          },
          cogsLine: {
            $multiply: [
              { $ifNull: ["$items.supplierPrice", 0] },
              "$items.quantity",
            ],
          },
          couponLine: {
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
          isRefunded: { $eq: ["$payment.status", "refunded"] },
          returnedQty: {
            $cond: [
              { $eq: ["$payment.status", "refunded"] },
              "$items.quantity",
              0,
            ],
          },
          returnedAmount: {
            $cond: [
              { $eq: ["$payment.status", "refunded"] },
              {
                $multiply: [
                  { $multiply: ["$items.price", "$items.quantity"] },
                  {
                    $cond: [
                      { $gt: [{ $ifNull: ["$subtotalAmount", 0] }, 0] },
                      { $divide: ["$totalAmount", "$subtotalAmount"] },
                      1,
                    ],
                  },
                ],
              },
              0,
            ],
          },
          createdAt: 1,
        },
      },
      {
        $group: {
          _id: "$product",
          name: { $first: "$name" },
          sku: { $first: "$sku" },
          quantity: { $sum: "$qty" },
          grossSales: { $sum: "$gross" },
          productDiscount: { $sum: "$prodDisc" },
          couponDiscount: { $sum: "$couponLine" },
          netSales: { $sum: { $subtract: ["$lineNet", "$couponLine"] } },
          cogs: { $sum: "$cogsLine" },
          returnedQuantity: { $sum: "$returnedQty" },
          returnedAmount: { $sum: "$returnedAmount" },
          firstSaleAt: { $min: "$createdAt" },
          lastSaleAt: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDoc",
        },
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "categories",
          localField: "productDoc.category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: 1,
          sku: 1,
          quantity: 1,
          grossSales: 1,
          productDiscount: 1,
          couponDiscount: 1,
          netSales: 1,
          cogs: 1,
          returnedQuantity: 1,
          returnedAmount: 1,
          firstSaleAt: 1,
          lastSaleAt: 1,
          category: { $ifNull: ["$categoryDoc.name", "نامشخص"] },
        },
      },
      { $sort: { netSales: -1 } },
    ]),
  ]);

  const { inventoryValue } = await computeInventoryValue();
  const s = summaryAgg[0] ?? {};
  const orderIds = (s.orders as unknown[]) ?? [];
  const refundedIds = ((s.refundedOrders as unknown[]) ?? []).filter(
    (id) => id !== null
  );
  const netSales = roundToman(s.netSales as number);
  const cogs = roundToman(s.cogs as number);
  const grossProfit = netSales - cogs;
  const summary: ReportSummary = withRange(
    {
      from: "",
      to: "",
      preset: null,
      orders: orderIds.length,
      unitsSold: roundToman(s.units as number),
      grossSales: roundToman(s.grossSales as number),
      productDiscount: roundToman(s.productDiscount as number),
      couponDiscount: roundToman(s.couponDiscount as number),
      netSales,
      cogs,
      grossProfit,
      grossMargin: safePct(grossProfit, netSales),
      refundedOrders: refundedIds.length,
      refunds: roundToman(s.refunds as number),
      paidAmount: roundToman(s.paidAmount as number),
      pendingAmount: roundToman(s.pendingAmount as number),
      outstandingAmount: roundToman(
        (s.pendingAmount as number) + (s.failedAmount as number)
      ),
      avgOrderValue:
        orderIds.length > 0 ? roundToman(netSales / orderIds.length) : 0,
      inventoryValue,
      inventoryCost: inventoryValue,
    },
    filters
  );

  const rows: SalesReportRow[] = agg.map((r) => {
    const netSales = roundToman(r.netSales);
    const quantity = r.quantity ?? 0;
    return {
      productId: String(r._id),
      name: r.name || "نامشخص",
      sku: r.sku || "",
      category: r.category,
      quantity,
      avgUnitPrice: quantity > 0 ? roundToman(netSales / quantity) : 0,
      grossSales: roundToman(r.grossSales),
      productDiscount: roundToman(r.productDiscount),
      couponDiscount: roundToman(r.couponDiscount),
      netSales,
      cogs: roundToman(r.cogs),
      returnedQuantity: r.returnedQuantity ?? 0,
      returnedAmount: roundToman(r.returnedAmount),
      netQuantity: quantity - (r.returnedQuantity ?? 0),
      netSalesAfterReturns: roundToman(netSales - (r.returnedAmount ?? 0)),
      firstSaleAt: r.firstSaleAt ? r.firstSaleAt.toISOString() : null,
      lastSaleAt: r.lastSaleAt ? r.lastSaleAt.toISOString() : null,
    };
  });

  const totals: Record<string, number> = {
    quantity: rows.reduce((a, r) => a + r.quantity, 0),
    grossSales: rows.reduce((a, r) => a + r.grossSales, 0),
    productDiscount: rows.reduce((a, r) => a + r.productDiscount, 0),
    couponDiscount: rows.reduce((a, r) => a + r.couponDiscount, 0),
    netSales: rows.reduce((a, r) => a + r.netSales, 0),
    cogs: rows.reduce((a, r) => a + r.cogs, 0),
    returnedQuantity: rows.reduce((a, r) => a + r.returnedQuantity, 0),
    returnedAmount: rows.reduce((a, r) => a + r.returnedAmount, 0),
    netSalesAfterReturns: rows.reduce((a, r) => a + r.netSalesAfterReturns, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "sales",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orders report
// ---------------------------------------------------------------------------

interface OrderLean {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  totalAmount: number;
  subtotalAmount: number | null;
  discount?: { amount?: number } | null;
  payment: { status: string; method: string };
  status: string;
  items: Array<{
    price: number;
    quantity: number;
    originalPrice?: number | null;
    discountAmount?: number | null;
  }>;
  customer?: { name?: string; phone?: string } | null;
}

export async function getOrdersReport(filters: ReportFilters) {
  const match = await buildOrderMatch(filters);
  const [summary, orders] = await Promise.all([
    computeSummary(match).then((s) => withRange(s, filters)),
    Order.aggregate<OrderLean>([
      { $match: match },
      {
        $lookup: {
          from: "users",
          localField: "customer",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          totalAmount: 1,
          subtotalAmount: 1,
          discount: 1,
          payment: 1,
          status: 1,
          items: 1,
          "customer.name": 1,
          "customer.phone": 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]),
  ]);

  const rows: OrdersReportRow[] = orders.map((o) => {
    const items = o.items || [];
    const gross = items.reduce(
      (a, it) =>
        a +
        (it.originalPrice ?? it.price) * it.quantity,
      0
    );
    const productDiscount = items.reduce(
      (a, it) => a + (it.discountAmount ?? 0) * it.quantity,
      0
    );
    const couponDiscount = o.discount?.amount ?? 0;
    const netAmount = o.totalAmount ?? 0;
    const isPaid = o.payment?.status === "paid" || o.payment?.status === "refunded";
    const isRefunded = o.payment?.status === "refunded";
    return {
      _id: String(o._id),
      orderNo: String(o._id).slice(-8),
      createdAt: o.createdAt.toISOString(),
      customer: o.customer
        ? { name: o.customer.name || "", phone: o.customer.phone || "" }
        : null,
      status: o.status,
      paymentStatus: o.payment?.status || "",
      paymentMethod: o.payment?.method || "",
      itemsCount: items.reduce((a, it) => a + it.quantity, 0),
      grossAmount: roundToman(gross),
      productDiscount: roundToman(productDiscount),
      couponDiscount: roundToman(couponDiscount),
      netAmount: roundToman(netAmount),
      paidAmount: isPaid ? roundToman(netAmount) : 0,
      refundedAmount: isRefunded ? roundToman(netAmount) : 0,
      outstandingAmount: isPaid ? 0 : roundToman(netAmount),
    };
  });

  const totals: Record<string, number> = {
    grossAmount: rows.reduce((a, r) => a + r.grossAmount, 0),
    productDiscount: rows.reduce((a, r) => a + r.productDiscount, 0),
    couponDiscount: rows.reduce((a, r) => a + r.couponDiscount, 0),
    netAmount: rows.reduce((a, r) => a + r.netAmount, 0),
    paidAmount: rows.reduce((a, r) => a + r.paidAmount, 0),
    refundedAmount: rows.reduce((a, r) => a + r.refundedAmount, 0),
    outstandingAmount: rows.reduce((a, r) => a + r.outstandingAmount, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "orders",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Payments report
// ---------------------------------------------------------------------------

interface PaymentOrderLean {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  totalAmount: number;
  payment: {
    status: string;
    method: string;
    refId?: string;
    authority?: string;
    paidAt?: Date | null;
  };
  customer?: { name?: string; phone?: string } | null;
}

export async function getPaymentsReport(filters: ReportFilters) {
  const match = await buildOrderMatch(filters);
  const [summary, orders] = await Promise.all([
    computeSummary(match).then((s) => withRange(s, filters)),
    Order.aggregate<PaymentOrderLean>([
      { $match: match },
      {
        $lookup: {
          from: "users",
          localField: "customer",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          totalAmount: 1,
          payment: 1,
          "customer.name": 1,
          "customer.phone": 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]),
  ]);

  const rows: PaymentsReportRow[] = orders.map((o) => {
    const amount = o.totalAmount ?? 0;
    const st = o.payment?.status || "pending";
    const isPaid = st === "paid" || st === "refunded";
    const isRefunded = st === "refunded";
    return {
      _id: String(o._id),
      orderNo: String(o._id).slice(-8),
      createdAt: o.createdAt.toISOString(),
      paidAt: o.payment?.paidAt ? o.payment.paidAt.toISOString() : null,
      customer: o.customer
        ? { name: o.customer.name || "", phone: o.customer.phone || "" }
        : null,
      method: o.payment?.method || "",
      status: st,
      refId: o.payment?.refId || "",
      authority: o.payment?.authority || "",
      amount: roundToman(amount),
      paidAmount: isPaid ? roundToman(amount) : 0,
      refundedAmount: isRefunded ? roundToman(amount) : 0,
      outstandingAmount: isPaid ? 0 : roundToman(amount),
    };
  });

  const totals: Record<string, number> = {
    amount: rows.reduce((a, r) => a + r.amount, 0),
    paidAmount: rows.reduce((a, r) => a + r.paidAmount, 0),
    refundedAmount: rows.reduce((a, r) => a + r.refundedAmount, 0),
    outstandingAmount: rows.reduce((a, r) => a + r.outstandingAmount, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "payments",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Refunds report
// ---------------------------------------------------------------------------

interface RefundOrderLean {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  totalAmount: number;
  refund?: { reason?: string; refundedAt?: Date | null; refundedBy?: mongoose.Types.ObjectId | null };
  payment?: { refId?: string };
  items?: Array<{ name?: string; quantity?: number }>;
  customer?: { name?: string; phone?: string } | null;
}

export async function getRefundsReport(filters: ReportFilters) {
  const match = await buildOrderMatch({ ...filters, paymentStatus: "refunded" });
  const [summary, orders] = await Promise.all([
    computeSummary(match).then((s) => withRange(s, filters)),
    Order.aggregate<RefundOrderLean>([
      { $match: match },
      {
        $lookup: {
          from: "users",
          localField: "customer",
          foreignField: "_id",
          as: "customer",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "refund.refundedBy",
          foreignField: "_id",
          as: "refunder",
        },
      },
      { $unwind: { path: "$refunder", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          totalAmount: 1,
          refund: 1,
          payment: 1,
          items: 1,
          "customer.name": 1,
          "customer.phone": 1,
          "refunder.name": 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]),
  ]);

  const rows: RefundsReportRow[] = orders.map((o) => {
    const productNames = (o.items || [])
      .slice(0, 3)
      .map((it) => `${it.name || "نامشخص"} ×${it.quantity ?? 1}`)
      .join("، ");
    return {
      _id: String(o._id),
      orderNo: String(o._id).slice(-8),
      createdAt: o.createdAt.toISOString(),
      refundedAt:
        o.refund?.refundedAt instanceof Date
          ? o.refund.refundedAt.toISOString()
          : null,
      customer: o.customer
        ? { name: o.customer.name || "", phone: o.customer.phone || "" }
        : null,
      products: productNames,
      refundAmount: roundToman(o.totalAmount ?? 0),
      reason: o.refund?.reason || "",
      refundedBy: (o as unknown as { refunder?: { name?: string } })?.refunder?.name || "نامشخص",
      paymentRefId: o.payment?.refId || "",
    };
  });

  const totals: Record<string, number> = {
    refundAmount: rows.reduce((a, r) => a + r.refundAmount, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "refunds",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Coupons report
// ---------------------------------------------------------------------------

interface CouponAggRow {
  _id: string;
  uses: number;
  gross: number;
  totalDiscount: number;
  netSales: number;
  firstUseAt: Date | null;
  lastUseAt: Date | null;
  couponDoc?: Array<{
    type: string;
    value: number;
    isActive: boolean;
    usedCount: number;
    endsAt: Date | null;
  }>;
}

export async function getCouponReport(filters: ReportFilters) {
  const match = await buildOrderMatch({
    ...filters,
    coupon: filters.coupon ?? undefined,
  });
  match["discount.couponId"] = { $ne: null };
  match["discount.amount"] = { $gt: 0 };

  const [summary, agg] = await Promise.all([
    computeSummary(match).then((s) => withRange(s, filters)),
    Order.aggregate<CouponAggRow>([
      { $match: match },
      {
        $group: {
          _id: "$discount.code",
          uses: { $sum: 1 },
          gross: {
            $sum: {
              $ifNull: [
                "$subtotalAmount",
                {
                  $add: [
                    "$totalAmount",
                    { $ifNull: ["$discount.amount", 0] },
                  ],
                },
              ],
            },
          },
          totalDiscount: { $sum: { $ifNull: ["$discount.amount", 0] } },
          netSales: { $sum: "$totalAmount" },
          firstUseAt: { $min: "$createdAt" },
          lastUseAt: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "coupons",
          localField: "_id",
          foreignField: "code",
          as: "couponDoc",
        },
      },
      { $sort: { totalDiscount: -1 } },
    ]),
  ]);

  const rows: CouponReportRow[] = agg.map((r) => {
    const doc = r.couponDoc?.[0];
    const netSales = roundToman(r.netSales);
    return {
      code: r._id || "-",
      type: doc?.type || "",
      value: doc?.value ?? 0,
      isActive: doc?.isActive ?? false,
      usedCount: doc?.usedCount ?? 0,
      uses: r.uses,
      orders: r.uses,
      grossSales: roundToman(r.gross),
      totalDiscount: roundToman(r.totalDiscount),
      netSales,
      avgOrderValue: r.uses > 0 ? roundToman(netSales / r.uses) : 0,
      firstUseAt: r.firstUseAt ? r.firstUseAt.toISOString() : null,
      lastUseAt: r.lastUseAt ? r.lastUseAt.toISOString() : null,
      endsAt: doc?.endsAt instanceof Date ? doc.endsAt.toISOString() : null,
    };
  });

  const totals: Record<string, number> = {
    uses: rows.reduce((a, r) => a + r.uses, 0),
    grossSales: rows.reduce((a, r) => a + r.grossSales, 0),
    totalDiscount: rows.reduce((a, r) => a + r.totalDiscount, 0),
    netSales: rows.reduce((a, r) => a + r.netSales, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "coupons",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Customer sales report
// ---------------------------------------------------------------------------

interface CustomerOrderAgg {
  _id: mongoose.Types.ObjectId;
  orders: number;
  netSales: number;
  couponDiscount: number;
  refunds: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

interface CustomerLineAgg {
  _id: mongoose.Types.ObjectId;
  units: number;
  grossSales: number;
  productDiscount: number;
}

export async function getCustomerSalesReport(filters: ReportFilters) {
  const match = await buildOrderMatch(filters);
  const [summary, orderAgg, lineAgg] = await Promise.all([
    computeSummary(match).then((s) => withRange(s, filters)),
    Order.aggregate<CustomerOrderAgg>([
      { $match: match },
      {
        $group: {
          _id: "$customer",
          orders: { $sum: 1 },
          netSales: { $sum: "$totalAmount" },
          couponDiscount: { $sum: { $ifNull: ["$discount.amount", 0] } },
          refunds: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "refunded"] }, "$totalAmount", 0],
            },
          },
          firstOrderAt: { $min: "$createdAt" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
    ]),
    Order.aggregate<CustomerLineAgg>([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$customer",
          units: { $sum: "$items.quantity" },
          grossSales: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.originalPrice", "$items.price"] },
                "$items.quantity",
              ],
            },
          },
          productDiscount: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.discountAmount", 0] },
                "$items.quantity",
              ],
            },
          },
        },
      },
    ]),
  ]);

  const lineById = new Map(lineAgg.map((l) => [String(l._id), l]));
  const userMap = new Map<string, { name?: string; phone?: string }>();
  const userIds = orderAgg.map((o) => o._id).filter((id) => id);
  if (userIds.length > 0) {
    const users = await User.find({ _id: { $in: userIds } })
      .select("name phone")
      .lean();
    for (const u of users) {
      userMap.set(String(u._id), { name: u.name, phone: u.phone });
    }
  }

  const rows: CustomerSalesRow[] = orderAgg
    .map((o) => {
      const line = lineById.get(String(o._id));
      const user = userMap.get(String(o._id));
      const netSales = roundToman(o.netSales);
      const refunds = roundToman(o.refunds);
      return {
        customerId: String(o._id),
        name: user?.name || "نامشخص",
        phone: user?.phone || "",
        orders: o.orders,
        units: line?.units ?? 0,
        grossSales: roundToman(line?.grossSales ?? 0),
        discounts: roundToman((line?.productDiscount ?? 0) + (o.couponDiscount ?? 0)),
        netSales,
        refunds,
        netRevenue: roundToman(netSales - refunds),
        avgOrderValue: o.orders > 0 ? roundToman(netSales / o.orders) : 0,
        firstOrderAt: o.firstOrderAt ? o.firstOrderAt.toISOString() : null,
        lastOrderAt: o.lastOrderAt ? o.lastOrderAt.toISOString() : null,
      };
    })
    .sort((a, b) => b.netSales - a.netSales);

  const totals: Record<string, number> = {
    orders: rows.reduce((a, r) => a + r.orders, 0),
    units: rows.reduce((a, r) => a + r.units, 0),
    grossSales: rows.reduce((a, r) => a + r.grossSales, 0),
    discounts: rows.reduce((a, r) => a + r.discounts, 0),
    netSales: rows.reduce((a, r) => a + r.netSales, 0),
    refunds: rows.reduce((a, r) => a + r.refunds, 0),
    netRevenue: rows.reduce((a, r) => a + r.netRevenue, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "customers",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Inventory report
// ---------------------------------------------------------------------------

export async function getInventoryReport(filters: ReportFilters) {
  const { from, to } = windowDates(filters);

  const productQuery: Record<string, unknown> = {};
  if (filters.productId) productQuery._id = new ObjectId(filters.productId);
  if (filters.categoryId) productQuery.category = new ObjectId(filters.categoryId);
  if (filters.q) productQuery.name = new RegExp(escapeRegExp(filters.q), "i");

  const [products, salesAgg, summaryMatch] = await Promise.all([
    Product.find(productQuery)
      .populate("category", "name")
      .select(
        "name sku price supplierPrice stock hasVariants variants.sku variants.stock variants.supplierPrice variants.price isActive category"
      )
      .lean(),
    Order.aggregate<{ _id: mongoose.Types.ObjectId; sold: number; returned: number; lastSale: Date | null }>([
      {
        $match: {
          status: { $ne: "cancelled" },
          createdAt: { $gte: from, $lt: to },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          sold: { $sum: "$items.quantity" },
          returned: {
            $sum: {
              $cond: [{ $eq: ["$payment.status", "refunded"] }, "$items.quantity", 0],
            },
          },
          lastSale: { $max: "$createdAt" },
        },
      },
    ]),
    buildOrderMatch(filters),
  ]);

  const salesById = new Map(salesAgg.map((s) => [String(s._id), s]));
  const { summary } = await computeSummary(summaryMatch).then((s) => ({
    summary: withRange(s, filters),
  }));

  const rows: InventoryReportRow[] = products.map((p) => {
    const sales = salesById.get(String(p._id));
    const variants = (p.variants ?? []) as Array<{
      sku?: string;
      stock?: number;
      supplierPrice?: number;
      price?: number;
    }>;
    const hasVariants = p.hasVariants && variants.length > 0;
    const totalStock = hasVariants
      ? variants.reduce((a, v) => a + (v.stock || 0), 0)
      : (p.stock ?? 0);
    const weightedCost =
      hasVariants && totalStock > 0
        ? variants.reduce(
            (a, v) => a + (v.supplierPrice || 0) * (v.stock || 0),
            0
          ) / totalStock
        : p.supplierPrice;
    const unitCost = roundToman(weightedCost || 0);
    const sold = sales?.sold ?? 0;
    const returned = sales?.returned ?? 0;
    const retailValue = hasVariants
      ? variants.reduce((a, v) => a + (v.price || 0) * (v.stock || 0), 0)
      : (p.price || 0) * (p.stock ?? 0);
    return {
      productId: String(p._id),
      sku: hasVariants
        ? variants.map((v) => v.sku || "").join("/")
        : p.sku || "",
      name: p.name,
      category:
        (p.category as { name?: string } | null)?.name || "نامشخص",
      currentStock: totalStock,
      salesQuantity: sold,
      returnedQuantity: returned,
      openingStock: totalStock + sold - returned,
      unitCost,
      inventoryValue: roundToman(totalStock * unitCost),
      retailValue: roundToman(retailValue),
      stockStatus:
        totalStock <= 0
          ? "out_of_stock"
          : totalStock <= LOW_STOCK_THRESHOLD
            ? "low_stock"
            : "in_stock",
      movement:
        sold >= 5 ? "fast" : sold >= 1 ? "slow" : "no_movement",
      lastSaleAt: sales?.lastSale ? sales.lastSale.toISOString() : null,
    };
  });

  rows.sort((a, b) => b.inventoryValue - a.inventoryValue);

  const totals: Record<string, number> = {
    currentStock: rows.reduce((a, r) => a + r.currentStock, 0),
    salesQuantity: rows.reduce((a, r) => a + r.salesQuantity, 0),
    returnedQuantity: rows.reduce((a, r) => a + r.returnedQuantity, 0),
    inventoryValue: rows.reduce((a, r) => a + r.inventoryValue, 0),
    retailValue: rows.reduce((a, r) => a + r.retailValue, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "inventory",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Profit & Loss (current window + previous equal-length window)
// ---------------------------------------------------------------------------

export async function getProfitLossReport(
  filters: ReportFilters
): Promise<ProfitLossReport> {
  const { from, to } = windowDates(filters);
  const windowLen = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - windowLen);
  const prevTo = new Date(from.getTime());

  const prevFilters: ReportFilters = {
    ...filters,
    from: dateParam(prevFrom),
    to: dateParam(new Date(prevTo.getTime() - 1)),
  };
  const [current, previous, inventory] = await Promise.all([
    computeSummary(await buildOrderMatch(filters)).then((s) => withRange(s, filters)),
    computeSummary(await buildOrderMatch(prevFilters)).then((s) =>
      withRange(s, prevFilters)
    ),
    computeInventoryValue(),
  ]);

  const { inventoryValue } = inventory;
  const rows = buildStatementRows(current, inventoryValue);
  const prevRows =
    previous.orders > 0 ? buildStatementRows(previous, inventoryValue) : null;

  return {
    current: { summary: current, rows },
    previous: prevRows ? { summary: previous, rows: prevRows } : null,
    change: {
      netSales:
        previous.netSales > 0
          ? safePct(current.netSales - previous.netSales, previous.netSales)
          : null,
      grossProfit:
        previous.grossProfit !== 0
          ? safePct(
              current.grossProfit - previous.grossProfit,
              Math.abs(previous.grossProfit)
            )
          : null,
      orders:
        previous.orders > 0
          ? Math.round(((current.orders - previous.orders) / previous.orders) * 1000) / 10
          : null,
    },
  };
}

/** Build the P&L statement lines (amounts + % of gross, then % of net). */
export function buildStatementRows(
  summary: ReportSummary,
  inventoryValue: number
): Array<{ key: string; label: string; amount: number | null; percent: number | null; unavailable?: boolean }> {
  const gross = summary.grossSales;
  const net = summary.netSales;
  return [
    { key: "gross", label: "فروش ناخالص", amount: gross, percent: gross > 0 ? 100 : null },
    { key: "productDiscount", label: "تخفیف محصول", amount: -summary.productDiscount, percent: safePct(summary.productDiscount, gross) },
    { key: "couponDiscount", label: "تخفیف کوپن", amount: -summary.couponDiscount, percent: safePct(summary.couponDiscount, gross) },
    { key: "net", label: "فروش خالص", amount: net, percent: gross > 0 ? safePct(net, gross) : null },
    { key: "cogs", label: "بهای تمام‌شده (COGS)", amount: -summary.cogs, percent: safePct(summary.cogs, net) },
    { key: "grossProfit", label: "سود ناخالص", amount: summary.grossProfit, percent: safePct(summary.grossProfit, net) },
    { key: "margin", label: "حاشیه سود ناخالص", amount: null, percent: summary.grossMargin, unavailable: summary.grossMargin === null },
    { key: "refunds", label: "بازپرداخت‌ها", amount: -summary.refunds, percent: safePct(summary.refunds, net) },
    { key: "netProfit", label: "سود خالص", amount: null, percent: null, unavailable: true },
    { key: "inventory", label: "ارزش موجودی (به بهای تمام‌شده)", amount: inventoryValue, percent: null },
  ];
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getDashboardReport(filters: ReportFilters): Promise<DashboardReport> {
  const match = await buildOrderMatch(filters);
  const { from, to } = windowDates(filters);

  const [summary, byDayAgg, statusAgg, paymentsAgg, sales] = await Promise.all([
    computeSummary(match).then((s) => withRange(s, filters)),
    Order.aggregate<{ _id: string; orders: number; netSales: number }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          netSales: { $sum: "$totalAmount" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate<{ _id: string; count: number; amount: number }>([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$totalAmount" },
        },
      },
    ]),
    Order.aggregate<{ _id: string; count: number; amount: number }>([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: "$payment.status",
          count: { $sum: 1 },
          amount: { $sum: "$totalAmount" },
        },
      },
    ]),
    getSalesReport({ ...filters, page: 1, limit: 10 }),
  ]);

  // Zero-filled day series over the window (bounded: ≤ 366 points).
  const byDayMap = new Map(byDayAgg.map((b) => [b._id, b]));
  const byDay: DashboardReport["byDay"] = [];
  for (let cursor = new Date(from); cursor.getTime() < to.getTime(); cursor = addDays(cursor, 1)) {
    const key = dateParam(cursor);
    const hit = byDayMap.get(key);
    byDay.push({
      date: key,
      orders: hit?.orders ?? 0,
      netSales: roundToman(hit?.netSales ?? 0),
    });
  }

  const STATUS_LABELS: Record<string, string> = {
    pending_payment: "در انتظار پرداخت",
    processing: "در حال پردازش",
    confirmed: "تأیید شده",
    shipped: "ارسال شده",
    delivered: "تحویل شده",
    cancelled: "لغو شده",
  };
  const PAYMENT_LABELS: Record<string, string> = {
    pending: "در انتظار پرداخت",
    paid: "پرداخت شده",
    failed: "ناموفق",
    canceled: "لغو شده",
    refunded: "بازپرداخت شده",
  };

  const pnl = await getProfitLossReport(filters);

  return {
    summary,
    byDay,
    topProducts: (sales as { rows: SalesReportRow[] }).rows.map((r) => ({
      name: r.name,
      quantity: r.quantity,
      netSales: r.netSales,
    })),
    ordersByStatus: statusAgg
      .map((s) => ({
        status: s._id,
        label: STATUS_LABELS[s._id] || s._id,
        count: s.count,
        amount: roundToman(s.amount),
      }))
      .sort((a, b) => b.count - a.count),
    paymentsSplit: paymentsAgg
      .map((s) => ({
        status: s._id,
        label: PAYMENT_LABELS[s._id] || s._id,
        count: s.count,
        amount: roundToman(s.amount),
      }))
      .sort((a, b) => b.amount - a.amount),
    pnl,
    reportLinks: [
      { report: "sales", title: "گزارش فروش" },
      { report: "orders", title: "گزارش سفارش‌ها" },
      { report: "payments", title: "گزارش پرداخت‌ها" },
      { report: "refunds", title: "گزارش بازپرداخت‌ها" },
      { report: "coupons", title: "گزارش کوپن‌ها" },
      { report: "customers", title: "گزارش مشتریان" },
      { report: "inventory", title: "گزارش موجودی" },
      { report: "pnl", title: "سود و زیان" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Purchases report (Session 82 Phase B) — procurement, not sales
// ---------------------------------------------------------------------------

/**
 * Purchases report. Filters on the purchaseDate window + purchase status +
 * payment status (purchase-specific enums). Every money figure comes from the
 * PurchaseOrder totals — never from current Product prices. The summary uses
 * purchase semantics (subtotal/discount/additional costs/total/paid) and the
 * UI renders purchase-labeled cards, NOT the order-labeled generic cards.
 */
export async function getPurchasesReport(filters: ReportFilters) {
  const { from, to } = windowDates(filters);
  const match: Record<string, unknown> = {
    purchaseDate: { $gte: from, $lt: to },
  };
  if (filters.purchaseStatus) match.status = filters.purchaseStatus;
  if (filters.paymentStatus) match.paymentStatus = filters.paymentStatus;
  if (filters.q) {
    // Search by purchase number OR supplier business name.
    const needle = escapeRegExp(filters.q);
    const suppliers = await Supplier.find({
      businessName: new RegExp(needle, "i"),
    })
      .select("_id")
      .lean();
    const supplierIds = suppliers.map((s) => s._id);
    const conditions: Array<Record<string, unknown>> = [
      { number: new RegExp(needle, "i") },
    ];
    if (supplierIds.length > 0) conditions.push({ supplier: { $in: supplierIds } });
    match.$or = conditions;
  }

  const [docs] = await Promise.all([
    PurchaseOrder.find(match)
      .populate("supplier", "businessName")
      .sort({ purchaseDate: -1, createdAt: -1 })
      .lean(),
  ]);

  const rows: PurchasesReportRow[] = docs.map((p) => {
    const supplier = p.supplier as unknown as
      | { businessName?: string }
      | string
      | null;
    const items = (p.items as Array<Record<string, unknown>>) || [];
    const totalOrdered = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
    const totalReceived = items.reduce(
      (s, it) => s + Number(it.receivedQuantity || 0),
      0
    );
    const totalAmount = Number(p.total || 0);
    const amountPaid = Number(p.amountPaid || 0);
    return {
      purchaseId: String(p._id),
      number: String(p.number || ""),
      supplierName:
        typeof supplier === "object" && supplier ? supplier.businessName || "" : "",
      purchaseDate: p.purchaseDate
        ? new Date(p.purchaseDate as Date).toISOString()
        : "",
      status: String(p.status || "draft"),
      paymentStatus: String(p.paymentStatus || "unpaid"),
      totalOrdered,
      totalReceived,
      totalOutstanding: Math.max(0, totalOrdered - totalReceived),
      subtotal: roundToman(Number(p.subtotal || 0)),
      discount: roundToman(Number(p.discount || 0)),
      additionalCosts: roundToman(Number(p.additionalCosts || 0)),
      total: roundToman(totalAmount),
      amountPaid: roundToman(amountPaid),
      amountOutstanding: roundToman(Math.max(0, totalAmount - amountPaid)),
    };
  });

  // Purchase-specific summary — the UI renders purchase-labeled cards from
  // these fields (not the order-labeled generic summary cards).
  const summary: ReportSummary = withRange(
    {
      from: "",
      to: "",
      preset: null,
      orders: rows.length,
      unitsSold: rows.reduce((a, r) => a + r.totalOrdered, 0),
      grossSales: rows.reduce((a, r) => a + r.subtotal, 0),
      productDiscount: rows.reduce((a, r) => a + r.discount, 0),
      couponDiscount: 0,
      netSales: rows.reduce((a, r) => a + r.total, 0),
      cogs: 0,
      grossProfit: 0,
      grossMargin: null,
      refundedOrders: 0,
      refunds: 0,
      paidAmount: rows.reduce((a, r) => a + r.amountPaid, 0),
      pendingAmount: 0,
      outstandingAmount: rows.reduce((a, r) => a + r.amountOutstanding, 0),
      avgOrderValue: 0,
      inventoryValue: 0,
      inventoryCost: 0,
    },
    filters
  );

  const totals: Record<string, number> = {
    totalOrdered: rows.reduce((a, r) => a + r.totalOrdered, 0),
    totalReceived: rows.reduce((a, r) => a + r.totalReceived, 0),
    totalOutstanding: rows.reduce((a, r) => a + r.totalOutstanding, 0),
    subtotal: rows.reduce((a, r) => a + r.subtotal, 0),
    discount: rows.reduce((a, r) => a + r.discount, 0),
    additionalCosts: rows.reduce((a, r) => a + r.additionalCosts, 0),
    total: rows.reduce((a, r) => a + r.total, 0),
    amountPaid: rows.reduce((a, r) => a + r.amountPaid, 0),
    amountOutstanding: rows.reduce((a, r) => a + r.amountOutstanding, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "purchases",
    filters,
    summary,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    totals,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

/** Registry used by the API routes + UI (valid report slugs). */
export const REPORT_SLUGS = [
  "dashboard",
  "sales",
  "orders",
  "payments",
  "refunds",
  "coupons",
  "customers",
  "inventory",
  "pnl",
  "purchases",
] as const;

export type ReportSlug = (typeof REPORT_SLUGS)[number];

export async function getReportData(slug: ReportSlug, filters: ReportFilters) {
  switch (slug) {
    case "dashboard":
      return getDashboardReport(filters);
    case "sales":
      return getSalesReport(filters);
    case "orders":
      return getOrdersReport(filters);
    case "payments":
      return getPaymentsReport(filters);
    case "refunds":
      return getRefundsReport(filters);
    case "coupons":
      return getCouponReport(filters);
    case "customers":
      return getCustomerSalesReport(filters);
    case "inventory":
      return getInventoryReport(filters);
    case "pnl":
      return getProfitLossReport(filters);
    case "purchases":
      return getPurchasesReport(filters);
  }
}


