/**
 * Accounting Workbook V2 — server-side data service (Session 82 Phase F).
 *
 * The V2 accounting workbook is an additive, export-only report (`accounting`)
 * that gives an accountant the complete 17-sheet picture:
 *
 *   خلاصه · فروش · سفارش‌ها · اقلام فروش · پرداخت‌ها · مرجوعی‌ها · مشتریان ·
 *   کوپن‌ها · خریدها · اقلام خرید · هزینه‌ها · موجودی · گردش موجودی ·
 *   لایه‌های FIFO · بهای تمام‌شده · سود و زیان · خلاصه حسابداری
 *
 * EVERY figure is server-computed from the authoritative sources:
 *  - historical sales/COGS from the IMMUTABLE order-item snapshots
 *    (fifoUnitCost when present — post-cutover purchased FIFO — else the
 *    supplierPrice snapshot), never current product prices,
 *  - purchases/line items from the PurchaseOrder docs (unit cost from the
 *    PurchaseItem, never current supplierPrice),
 *  - movements from the append-only InventoryMovement ledger,
 *  - FIFO layers from the embedded Product/variant costLayers,
 *  - operating expenses from the non-void Expense ledger rows,
 *  - net profit = gross profit − operating expenses.
 *
 * Nothing is fabricated: unavailable data is marked «در دسترس نیست» (never
 * shown as zero). Existing Session 81/Phase E exports are untouched — this
 * service is used only by the additive `accounting` report.
 */

import mongoose from "mongoose";
import Order from "@/models/Order";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";
import InventoryMovement from "@/models/InventoryMovement";
import AccountingConfig from "@/models/AccountingConfig";
import {
  buildLineMatch,
  buildOrderMatch,
  windowDates,
} from "@/lib/report-matches";
import {
  EXPORT_MAX_ROWS,
  roundToman,
  safePct,
} from "@/lib/report-utils";
import type {
  InventoryCostLayerView,
  ReportFilters,
  ReportSummary,
} from "@/types";

const { ObjectId } = mongoose.Types;

// ---------------------------------------------------------------------------
// Persian labels (shared with the workbook builder + tests)
// ---------------------------------------------------------------------------

/** Human-readable Persian labels for InventoryMovement types. */
export const MOVEMENT_LABELS: Record<string, string> = {
  opening_balance: "موجودی اولیه",
  receipt: "دریافت خرید",
  sale: "فروش",
  return_restock: "برگشت به موجودی",
  cancellation_restock: "لغو سفارش",
  purchase_return: "برگشت خرید",
  adjustment: "تعدیل",
  sourcing_change: "اصلاح",
};

/** Human-readable Persian labels for FIFO layer sources. */
export const LAYER_SOURCE_LABELS: Record<string, string> = {
  opening: "موجودی اولیه",
  receipt: "دریافت خرید",
  adjustment: "تعدیل",
};

/**
 * Classify an order item's COGS source for the بهای تمام‌شده sheet:
 *  - `fifo` when the item carries the post-cutover FIFO snapshot,
 *  - `snapshot` when it falls back to the immutable supplierPrice snapshot
 *    (consignment or pre-cutover).
 */
export function cogsSource(
  fifoUnitCost: number | null | undefined
): "fifo" | "snapshot" {
  return typeof fifoUnitCost === "number" && Number.isFinite(fifoUnitCost)
    ? "fifo"
    : "snapshot";
}

export const COGS_SOURCE_LABELS: Record<"fifo" | "snapshot", string> = {
  fifo: "FIFO (پس از تاریخ انتقال)",
  snapshot: "اسنپ‌شات (قبل از انتقال / امانی)",
};

// ---------------------------------------------------------------------------
// Order items — one row per order line with COGS + gross profit (per item)
// ---------------------------------------------------------------------------

export interface AccountingOrderItemRow {
  orderId: string;
  orderNo: string;
  createdAt: string;
  orderStatus: string;
  paymentStatus: string;
  productId: string;
  sku: string;
  name: string;
  variantId: string;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  originalPrice: number;
  productDiscount: number;
  couponAllocation: number;
  netSales: number;
  fifoUnitCost: number | null;
  supplierPrice: number;
  cogs: number;
  cogsSource: "fifo" | "snapshot";
  cogsSourceLabel: string;
  grossProfit: number;
  grossMargin: number | null;
}

/** Per order line: historical snapshot fields + FIFO COGS + gross profit. */
export async function getOrderItemsReport(filters: ReportFilters) {
  const orderMatch = await buildOrderMatch(filters, { excludeLineScoped: true });
  const lineMatch = await buildLineMatch(filters);
  const stages: mongoose.PipelineStage[] = [
    { $match: orderMatch as unknown as mongoose.PipelineStage.Match },
    { $unwind: "$items" },
  ];
  if (lineMatch) stages.push({ $match: lineMatch as unknown as mongoose.PipelineStage.Match });

  const docs = await Order.aggregate([
    ...stages,
    {
      $project: {
        orderId: "$_id",
        createdAt: 1,
        orderStatus: "$status",
        paymentStatus: "$payment.status",
        productId: "$items.product",
        sku: { $ifNull: ["$items.sku", ""] },
        name: "$items.name",
        variantId: { $ifNull: ["$items.variantId", null] },
        variantLabel: { $ifNull: ["$items.variantLabel", ""] },
        quantity: "$items.quantity",
        unitPrice: "$items.price",
        originalPrice: { $ifNull: ["$items.originalPrice", "$items.price"] },
        discountAmount: { $ifNull: ["$items.discountAmount", 0] },
        supplierPrice: "$items.supplierPrice",
        fifoUnitCost: { $ifNull: ["$items.fifoUnitCost", null] },
        lineNet: { $multiply: ["$items.price", "$items.quantity"] },
        subtotalAmount: { $ifNull: ["$subtotalAmount", 0] },
        couponAmount: { $ifNull: ["$discount.amount", 0] },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);

  const rows: AccountingOrderItemRow[] = docs.map((d) => {
    const qty = d.quantity ?? 0;
    const lineNet = roundToman(d.lineNet ?? 0);
    const couponAllocation =
      d.couponAmount > 0 && d.subtotalAmount > 0
        ? roundToman(lineNet * (d.couponAmount / d.subtotalAmount))
        : 0;
    const netSales = lineNet - couponAllocation;
    const unitCost =
      d.fifoUnitCost !== null && d.fifoUnitCost !== undefined
        ? Number(d.fifoUnitCost)
        : Number(d.supplierPrice ?? 0);
    const cogs = roundToman(unitCost * qty);
    const grossProfit = netSales - cogs;
    const source = cogsSource(d.fifoUnitCost);
    return {
      orderId: String(d.orderId),
      orderNo: String(d.orderId).slice(-8),
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : "",
      orderStatus: d.orderStatus,
      paymentStatus: d.paymentStatus,
      productId: String(d.productId),
      sku: d.sku || "",
      name: d.name || "نامشخص",
      variantId: d.variantId ? String(d.variantId) : "",
      variantLabel: d.variantLabel || "",
      quantity: qty,
      unitPrice: roundToman(d.unitPrice ?? 0),
      originalPrice: roundToman(d.originalPrice ?? 0),
      productDiscount: roundToman((d.discountAmount ?? 0) * qty),
      couponAllocation,
      netSales,
      fifoUnitCost: d.fifoUnitCost !== null && d.fifoUnitCost !== undefined ? unitCost : null,
      supplierPrice: roundToman(d.supplierPrice ?? 0),
      cogs,
      cogsSource: source,
      cogsSourceLabel: COGS_SOURCE_LABELS[source],
      grossProfit,
      grossMargin: netSales > 0 ? safePct(grossProfit, netSales) : null,
    };
  });

  const totals: Record<string, number> = {
    quantity: rows.reduce((a, r) => a + r.quantity, 0),
    netSales: rows.reduce((a, r) => a + r.netSales, 0),
    cogs: rows.reduce((a, r) => a + r.cogs, 0),
    grossProfit: rows.reduce((a, r) => a + r.grossProfit, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "order-items",
    filters,
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
// Purchase items — one row per purchase line (ordered / received / remaining)
// ---------------------------------------------------------------------------

export interface AccountingPurchaseItemRow {
  purchaseId: string;
  number: string;
  purchaseDate: string;
  supplierName: string;
  productId: string;
  name: string;
  variantId: string;
  variantLabel: string;
  sku: string;
  ordered: number;
  received: number;
  remaining: number;
  unitCost: number;
  lineTotal: number;
  status: string;
  paymentStatus: string;
  amountPaid: number;
  amountOutstanding: number;
  reference: string;
}

/** One row per purchase line — unit cost from the PurchaseItem, never supplierPrice. */
export async function getPurchaseItemsReport(filters: ReportFilters) {
  const { from, to } = windowDates(filters);
  const match: Record<string, unknown> = {
    purchaseDate: { $gte: from, $lt: to },
  };
  if (filters.purchaseStatus) match.status = filters.purchaseStatus;
  if (filters.paymentStatus) match.paymentStatus = filters.paymentStatus;

  const docs = await PurchaseOrder.find(match)
    .populate("supplier", "businessName")
    .sort({ purchaseDate: -1, createdAt: -1 })
    .lean();

  // SKU resolution (PurchaseItem snapshots don't carry sku).
  const productIds = [
    ...new Set(
      docs.flatMap((p) =>
        ((p.items as Array<Record<string, unknown>>) || [])
          .map((it) => String(it.product))
          .filter(Boolean)
      )
    ),
  ];
  const skuMap = new Map<string, string>();
  if (productIds.length > 0) {
    const products = await Product.find({ _id: { $in: productIds } })
      .select("sku")
      .lean();
    for (const p of products) skuMap.set(String(p._id), p.sku || "");
  }

  const rows: AccountingPurchaseItemRow[] = [];
  for (const p of docs) {
    const supplier = p.supplier as unknown as
      | { businessName?: string }
      | string
      | null;
    const items = (p.items as Array<Record<string, unknown>>) || [];
    for (const it of items) {
      const ordered = Number(it.quantity || 0);
      const received = Number(it.receivedQuantity || 0);
      const unitCost = Number(it.unitCost || 0);
      const total = Number(p.total || 0);
      const amountPaid = Number(p.amountPaid || 0);
      rows.push({
        purchaseId: String(p._id),
        number: String(p.number || ""),
        purchaseDate: p.purchaseDate
          ? new Date(p.purchaseDate as Date).toISOString()
          : "",
        supplierName:
          typeof supplier === "object" && supplier ? supplier.businessName || "" : "",
        productId: String(it.product || ""),
        name: String(it.name || "نامشخص"),
        variantId: it.variantId ? String(it.variantId) : "",
        variantLabel: String(it.variantLabel || ""),
        sku: skuMap.get(String(it.product)) || "",
        ordered,
        received,
        remaining: Math.max(0, ordered - received),
        unitCost: roundToman(unitCost),
        lineTotal: roundToman(unitCost * ordered),
        status: String(p.status || "draft"),
        paymentStatus: String(p.paymentStatus || "unpaid"),
        amountPaid: roundToman(amountPaid),
        amountOutstanding: roundToman(Math.max(0, total - amountPaid)),
        reference: String(p.reference || ""),
      });
    }
  }

  const totals: Record<string, number> = {
    ordered: rows.reduce((a, r) => a + r.ordered, 0),
    received: rows.reduce((a, r) => a + r.received, 0),
    remaining: rows.reduce((a, r) => a + r.remaining, 0),
    lineTotal: rows.reduce((a, r) => a + r.lineTotal, 0),
    amountOutstanding: rows.reduce((a, r) => a + r.amountOutstanding, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "purchase-items",
    filters,
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
// Inventory movements — append-only ledger rows (audit-friendly)
// ---------------------------------------------------------------------------

export interface AccountingMovementRow {
  id: string;
  createdAt: string;
  productId: string;
  name: string;
  sku: string;
  variantId: string;
  variantLabel: string;
  type: string;
  typeLabel: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  sourceRef: string;
  description: string;
  createdByName: string;
}

/** Movement sheet rows with human-readable Persian type labels. */
export async function getInventoryMovementsReport(filters: ReportFilters) {
  const { from, to } = windowDates(filters);
  const match: Record<string, unknown> = {
    createdAt: { $gte: from, $lt: to },
  };
  if (filters.productId) match.product = new ObjectId(filters.productId);
  if (filters.q) {
    const needle = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.$or = [{ sourceRef: needle }, { description: needle }];
  }

  const docs = await InventoryMovement.find(match)
    .populate("product", "name sku")
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .lean();

  // Variant labels for audit readability. Movements may reference a deleted
  // product (`product: null` after a populate miss) — never feed "null" into
  // an ObjectId $in.
  const variantLabels = new Map<string, string>();
  const productIds = [...new Set(
    docs
      .map((m) => {
        const ref =
          typeof m.product === "object" && m.product
            ? m.product._id ?? m.product
            : m.product;
        return ref ? String(ref) : "";
      })
      .filter((id) => id && mongoose.isValidObjectId(id))
  )];
  if (productIds.length > 0) {
    const products = await Product.find({ _id: { $in: productIds } })
      .select("variants._id variants.label variants.name")
      .lean();
    for (const p of products) {
      for (const v of (p.variants ?? []) as Array<{ _id?: unknown; label?: string; name?: string }>) {
        variantLabels.set(String(v._id), v.label || v.name || "");
      }
    }
  }

  const rows: AccountingMovementRow[] = docs.map((m) => {
    const product = m.product as unknown as
      | { _id?: unknown; name?: string; sku?: string }
      | string
      | null;
    const createdBy = m.createdBy as unknown as
      | { name?: string }
      | string
      | null;
    const productRef =
      typeof product === "object" && product ? product._id ?? m.product : m.product;
    return {
      id: String(m._id),
      createdAt: m.createdAt ? new Date(m.createdAt as Date).toISOString() : "",
      productId: productRef ? String(productRef) : "",
      name:
        typeof product === "object" && product ? product.name || "نامشخص" : "نامشخص",
      sku: typeof product === "object" && product ? product.sku || "" : "",
      variantId: m.variantId ? String(m.variantId) : "",
      variantLabel: m.variantId ? variantLabels.get(String(m.variantId)) || "" : "",
      type: String(m.type || ""),
      typeLabel: MOVEMENT_LABELS[String(m.type || "")] || String(m.type || ""),
      quantity: Number(m.quantity || 0),
      unitCost: roundToman(m.unitCost || 0),
      totalCost: roundToman(m.totalCost || 0),
      sourceRef: String(m.sourceRef || ""),
      description: String(m.description || ""),
      createdByName:
        typeof createdBy === "object" && createdBy ? createdBy.name || "" : "",
    };
  });

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "movements",
    filters,
    rows: bounded.slice(start, start + filters.limit),
    total: fullCount,
    page: filters.page,
    limit: filters.limit,
    truncated: fullCount > EXPORT_MAX_ROWS,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cost layers — active FIFO layers (remaining > 0) + layer value
// ---------------------------------------------------------------------------

export interface AccountingLayerRow {
  productId: string;
  name: string;
  sku: string;
  variantId: string;
  variantLabel: string;
  source: string;
  sourceLabel: string;
  ref: string;
  acquiredAt: string;
  originalQty: number;
  remaining: number;
  unitCost: number;
  remainingValue: number;
}

/** Active FIFO cost layers — allows reconciling inventory value (Σ remaining × unitCost). */
export async function getCostLayersReport(filters: ReportFilters) {
  const query: Record<string, unknown> = {};
  if (filters.productId) query._id = new ObjectId(filters.productId);
  if (filters.q) query.name = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const products = await Product.find(query)
    .select(
      "name sku hasVariants costLayers variants.label variants.name variants.sku variants.costLayers"
    )
    .lean();

  const rows: AccountingLayerRow[] = [];
  for (const p of products) {
    if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
      for (const v of p.variants as Array<{
        _id?: unknown;
        label?: string;
        name?: string;
        sku?: string;
        costLayers?: InventoryCostLayerView[];
      }>) {
        for (const layer of v.costLayers ?? []) {
          if (!layer || Number(layer.remaining) <= 0) continue;
          rows.push({
            productId: String(p._id),
            name: p.name,
            sku: v.sku || p.sku || "",
            variantId: v._id ? String(v._id) : "",
            variantLabel: v.label || v.name || "",
            source: String(layer.source || ""),
            sourceLabel: LAYER_SOURCE_LABELS[String(layer.source || "")] || String(layer.source || ""),
            ref: String(layer.ref || ""),
            acquiredAt: layer.acquiredAt
              ? new Date(layer.acquiredAt).toISOString()
              : "",
            originalQty: Number(layer.qty || 0),
            remaining: Number(layer.remaining || 0),
            unitCost: roundToman(layer.unitCost || 0),
            remainingValue: roundToman(Number(layer.remaining || 0) * Number(layer.unitCost || 0)),
          });
        }
      }
    } else {
      for (const layer of (p.costLayers ?? []) as InventoryCostLayerView[]) {
        if (!layer || Number(layer.remaining) <= 0) continue;
        rows.push({
          productId: String(p._id),
          name: p.name,
          sku: p.sku || "",
          variantId: "",
          variantLabel: "",
          source: String(layer.source || ""),
          sourceLabel: LAYER_SOURCE_LABELS[String(layer.source || "")] || String(layer.source || ""),
          ref: String(layer.ref || ""),
          acquiredAt: layer.acquiredAt
            ? new Date(layer.acquiredAt).toISOString()
            : "",
          originalQty: Number(layer.qty || 0),
          remaining: Number(layer.remaining || 0),
          unitCost: roundToman(layer.unitCost || 0),
          remainingValue: roundToman(Number(layer.remaining || 0) * Number(layer.unitCost || 0)),
        });
      }
    }
  }

  const totals: Record<string, number> = {
    remaining: rows.reduce((a, r) => a + r.remaining, 0),
    remainingValue: rows.reduce((a, r) => a + r.remainingValue, 0),
  };

  const fullCount = rows.length;
  const bounded = rows.slice(0, EXPORT_MAX_ROWS);
  const start = (filters.page - 1) * filters.limit;
  return {
    report: "layers",
    filters,
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
// COGS rows — per order line, cost source labelled (FIFO vs snapshot)
// ---------------------------------------------------------------------------

export interface AccountingCogsRow {
  orderId: string;
  orderNo: string;
  createdAt: string;
  productId: string;
  name: string;
  sku: string;
  variantId: string;
  variantLabel: string;
  quantity: number;
  fifoUnitCost: number | null;
  cogs: number;
  cogsSource: "fifo" | "snapshot";
  cogsSourceLabel: string;
  sourceRef: string;
}

/** COGS sheet — one row per sold line with its authoritative cost source. */
export async function getCogsReport(filters: ReportFilters) {
  const items = await getOrderItemsReport(filters);
  const rows: AccountingCogsRow[] = items.rows.map((r) => ({
    orderId: r.orderId,
    orderNo: r.orderNo,
    createdAt: r.createdAt,
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    variantId: r.variantId,
    variantLabel: r.variantLabel,
    quantity: r.quantity,
    fifoUnitCost: r.fifoUnitCost,
    cogs: r.cogs,
    cogsSource: r.cogsSource,
    cogsSourceLabel: r.cogsSourceLabel,
    sourceRef: `sale-${r.orderId}-${r.productId}${r.variantId ? "-" + r.variantId : ""}`,
  }));
  return {
    report: "cogs",
    filters,
    rows,
    total: rows.length,
    totals: { cogs: rows.reduce((a, r) => a + r.cogs, 0), quantity: rows.reduce((a, r) => a + r.quantity, 0) },
    page: filters.page,
    limit: filters.limit,
    truncated: items.truncated,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Accounting summary — the concise accountant-facing KPIs + valuation basis
// ---------------------------------------------------------------------------

export interface AccountingSummaryRow {
  key: string;
  label: string;
  value: number | null;
  numFmt: "money" | "count" | "percent" | "text";
  note?: string;
}

export interface AccountingValuationInfo {
  cutoverDate: string | null;
  valuationMethod: "fifo";
  inventoryInitialized: boolean;
  valuationBasisLabel: string;
  historicalNote: string;
}

/**
 * The accountant-facing summary. `summary` is the order-level ReportSummary
 * (sales window); `operatingExpenses` from the P&L; `inventoryValue`/
 * `inventoryUnits` from the cost-layer state; purchases from the purchase
 * report; paid/pending expenses from the expense report rows.
 */
export async function getAccountingSummary(
  filters: ReportFilters,
  summary: ReportSummary,
  operatingExpenses: number,
  inventoryValue: number,
  inventoryUnits: number,
  purchaseTotal: number,
  purchasePaid: number,
  purchaseOutstanding: number,
  expensePaid: number,
  expenseOutstanding: number
): Promise<{
  rows: AccountingSummaryRow[];
  valuation: AccountingValuationInfo;
}> {
  const grossProfit = summary.grossProfit ?? 0;
  const netProfit = grossProfit - operatingExpenses;

  const config = (await AccountingConfig.findById("accounting").lean()) as unknown as
    | {
        cutoverDate?: Date | null;
        inventoryInitialized?: boolean;
        valuationMethod?: "fifo";
      }
    | null;
  const cutoverDate = config?.cutoverDate
    ? new Date(config.cutoverDate).toISOString()
    : null;
  const inventoryInitialized = config?.inventoryInitialized ?? false;
  const valuationBasisLabel = inventoryInitialized
    ? "ارزش موجودی بر اساس لایه‌های FIFO"
    : "ارزش موجودی بر اساس بهای تمام‌شده فعلی (پیش از انتقال حسابداری)";
  const historicalNote = cutoverDate
    ? `اطلاعات تاریخی قبل از تاریخ انتقال حسابداری (${cutoverDate.slice(0, 10)}) بر اساس snapshot ثبت‌شده محاسبه شده است.`
    : "اطلاعات تاریخی بر اساس snapshot ثبت‌شده محاسبه شده است.";

  const rows: AccountingSummaryRow[] = [
    { key: "grossSales", label: "فروش ناخالص", value: summary.grossSales ?? 0, numFmt: "money" },
    { key: "discounts", label: "تخفیف‌ها (محصول + کوپن)", value: (summary.productDiscount ?? 0) + (summary.couponDiscount ?? 0), numFmt: "money" },
    { key: "netSales", label: "فروش خالص", value: summary.netSales ?? 0, numFmt: "money" },
    { key: "cogs", label: "بهای تمام‌شده (COGS)", value: summary.cogs ?? 0, numFmt: "money" },
    { key: "grossProfit", label: "سود ناخالص", value: grossProfit, numFmt: "money" },
    { key: "grossMargin", label: "حاشیه سود ناخالص", value: summary.grossMargin, numFmt: "percent" },
    { key: "operatingExpenses", label: "هزینه‌های عملیاتی", value: operatingExpenses, numFmt: "money" },
    { key: "netProfit", label: "سود خالص", value: netProfit, numFmt: "money" },
    { key: "inventoryValue", label: "ارزش موجودی", value: inventoryValue, numFmt: "money", note: valuationBasisLabel },
    { key: "inventoryUnits", label: "واحدهای موجودی (لایه‌های فعال)", value: inventoryUnits, numFmt: "count" },
    { key: "purchases", label: "خریدها (جمع کل)", value: purchaseTotal, numFmt: "money" },
    { key: "purchasePaid", label: "پرداخت‌شده برای خریدها", value: purchasePaid, numFmt: "money" },
    { key: "purchaseOutstanding", label: "معوق خریدها", value: purchaseOutstanding, numFmt: "money" },
    { key: "expensePaid", label: "هزینه‌های پرداخت‌شده", value: expensePaid, numFmt: "money" },
    { key: "expenseOutstanding", label: "هزینه‌های در انتظار پرداخت", value: expenseOutstanding, numFmt: "money" },
    { key: "refunds", label: "بازپرداخت‌ها", value: summary.refunds ?? 0, numFmt: "money" },
  ];

  return {
    rows,
    valuation: {
      cutoverDate,
      valuationMethod: "fifo",
      inventoryInitialized,
      valuationBasisLabel,
      historicalNote,
    },
  };
}

// ---------------------------------------------------------------------------
// Assembly — everything the 17-sheet workbook needs
// ---------------------------------------------------------------------------

export interface AccountingExportData {
  report: "accounting";
  filters: ReportFilters;
  summary: ReportSummary;
  orderItems: Awaited<ReturnType<typeof getOrderItemsReport>>;
  purchaseItems: Awaited<ReturnType<typeof getPurchaseItemsReport>>;
  movements: Awaited<ReturnType<typeof getInventoryMovementsReport>>;
  layers: Awaited<ReturnType<typeof getCostLayersReport>>;
  cogs: Awaited<ReturnType<typeof getCogsReport>>;
  accounting: Awaited<ReturnType<typeof getAccountingSummary>>;
  generatedAt: string;
}

/**
 * Assemble the accounting workbook datasets. Reuses the existing report
 * services (sales/orders/payments/refunds/coupons/customers/inventory/pnl/
 * purchases/expenses) through the caller — the export route passes the JSON
 * report envelope pieces it already fetched.
 */
export async function getAccountingExportData(
  filters: ReportFilters,
  pieces: {
    summary: ReportSummary;
    sales: { totals?: Record<string, number> };
    pnl: { current: { summary: ReportSummary; rows: Array<{ key?: string; amount?: number | null }> } };
    inventory: { totals?: Record<string, number>; rows?: Array<{ currentStock?: number }> };
    purchases: { rows?: Array<{ total?: number; amountPaid?: number; amountOutstanding?: number }>; totals?: Record<string, number> };
    expenses: { rows?: Array<{ status?: string; amount?: number }> };
  }
): Promise<AccountingExportData> {
  const [
    orderItems,
    purchaseItems,
    movements,
    layers,
  ] = await Promise.all([
    getOrderItemsReport(filters),
    getPurchaseItemsReport(filters),
    getInventoryMovementsReport(filters),
    getCostLayersReport(filters),
  ]);
  const cogs = await getCogsReport(filters);

  const operatingExpensesRow = (pieces.pnl.current.rows ?? []).find(
    (r) => r.key === "operatingExpenses"
  );
  const operatingExpenses = Math.max(
    0,
    Math.abs(typeof operatingExpensesRow?.amount === "number" ? operatingExpensesRow.amount : 0)
  );

  const inventoryValue = pieces.inventory.totals?.inventoryValue ?? 0;
  const inventoryUnits = (pieces.inventory.rows ?? []).reduce(
    (a, r) => a + (r.currentStock ?? 0),
    0
  );

  const purchaseRows = pieces.purchases.rows ?? [];
  const purchaseTotal = purchaseRows.reduce((a, r) => a + (r.total ?? 0), 0);
  const purchasePaid = purchaseRows.reduce((a, r) => a + (r.amountPaid ?? 0), 0);
  const purchaseOutstanding = purchaseRows.reduce(
    (a, r) => a + (r.amountOutstanding ?? 0),
    0
  );

  const expenseRows = pieces.expenses.rows ?? [];
  const expensePaid = expenseRows
    .filter((r) => r.status === "paid")
    .reduce((a, r) => a + (r.amount ?? 0), 0);
  const expenseOutstanding = expenseRows
    .filter((r) => r.status === "pending")
    .reduce((a, r) => a + (r.amount ?? 0), 0);

  const accounting = await getAccountingSummary(
    filters,
    pieces.summary,
    operatingExpenses,
    inventoryValue,
    inventoryUnits,
    purchaseTotal,
    purchasePaid,
    purchaseOutstanding,
    expensePaid,
    expenseOutstanding
  );

  return {
    report: "accounting",
    filters,
    summary: pieces.summary,
    orderItems,
    purchaseItems,
    movements,
    layers,
    cogs,
    accounting,
    generatedAt: new Date().toISOString(),
  };
}
