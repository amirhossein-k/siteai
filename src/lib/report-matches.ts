/**
 * Reports — shared order/line match builders (Session 81, extracted Session 82
 * Phase F so both `reports.ts` and `accounting-v2.ts` import them without a
 * circular dependency).
 *
 * Pure-ish query builders: no report aggregation here — only the ORDER-level
 * and LINE-level Mongo match objects used by every order-based report.
 */

import mongoose from "mongoose";
import Product from "@/models/Product";
import User from "@/models/User";
import {
  addDays,
  parseDateParam,
  startOfUtcDay,
} from "@/lib/report-utils";
import type { ReportFilters } from "@/types";

const { ObjectId } = mongoose.Types;

/** Escape a user string for use inside a RegExp constructor. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve the inclusive-exclusive Mongo window for the filters. */
export function windowDates(filters: ReportFilters): { from: Date; to: Date } {
  const from = parseDateParam(filters.from ?? "");
  const to = parseDateParam(filters.to ?? "");
  return {
    from: from ?? startOfUtcDay(new Date()),
    to: to ? addDays(to, 1) : addDays(startOfUtcDay(new Date()), 1),
  };
}

async function productIdsInCategory(categoryId: string) {
  const productIds = await Product.find({ category: new ObjectId(categoryId) })
    .select("_id")
    .lean();
  return productIds.map((p) => p._id);
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
export async function buildOrderMatch(
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

/**
 * LINE-level match (applied after $unwind in the sales report): product,
 * category and q now scope to the individual line, so a matched order never
 * drags its non-matching lines into the report.
 *
 * NOTE: after `$unwind: "$items"` the line fields are nested under `items`
 * (e.g. `items.product`, `items.name`), so the match keys MUST be prefixed
 * with `items.` — a bare `{ product: ... }` matches nothing.
 */
export async function buildLineMatch(filters: ReportFilters) {
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
