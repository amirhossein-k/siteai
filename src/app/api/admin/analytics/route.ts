import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Order from "@/models/Order";
import Coupon from "@/models/Coupon";
import Transaction from "@/models/Transaction";
import Supplier from "@/models/Supplier";
import User from "@/models/User";

/**
 * GET /api/admin/analytics?range=30
 *
 * Admin-only READ-ONLY reporting endpoint (Session 41).
 *
 * Produces, for the selected trailing window (7 / 30 / 90 days, default 30):
 *   - summary:      revenue, orders, avg order value, coupon savings, new customers
 *   - timeSeries:   per-day { date, orders, revenue } (zero-filled, no gaps)
 *   - topProducts:  top 10 items by revenue (from order item snapshots)
 *   - topCategories:top 10 categories by revenue (joined via Product → Category)
 *   - couponStats:  coupon count / activity / usage + total discount applied
 *   - supplierStats:earnings credited, payouts approved/pending, outstanding balance
 *   - ordersByStatus:current status funnel for the window
 *
 * NOTES:
 *  - Day bucketing is UTC (matches $dateToString without a timezone). For a
 *    Persian-market storefront (UTC+3:30) an order placed at 23:30 local lands
 *    in the next UTC day — a known, acceptable v1 limitation.
 *  - supplierStats are ALL-TIME ledger sums (window-independent by design).
 *    outstandingBalance includes inactive suppliers' balances: money owed to a
 *    deactivated supplier is still owed.
 *  - discountedOrders/totalDiscount are computed from an UNBOUNDED aggregation
 *    (not the top-5 list) so they never undercount when >5 codes are used.
 *
 * SAFETY: this route performs aggregations ONLY — no writes. It never touches
 * inventory, checkout, payment, coupon claim/release, wishlist, or order
 * business logic. Revenue excludes cancelled orders (same rule as /admin/stats).
 */
export const dynamic = "force-dynamic";

const VALID_RANGES = [7, 30, 90];
const STATUS_LABELS: Record<string, string> = {
  pending_payment: "در انتظار پرداخت",
  processing: "در حال پردازش",
  confirmed: "تأیید شده",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  cancelled: "لغو شده",
};

/** UTC start-of-day N days ago. */
function rangeStart(range: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (range - 1));
  return d;
}

/** "YYYY-MM-DD" for a Date (UTC). */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build a zero-filled continuous day series over the window. */
function buildSeries(
  range: number,
  buckets: Array<{ _id: string; orders: number; revenue: number }>
): Array<{ date: string; orders: number; revenue: number }> {
  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const b of buckets) {
    byDay.set(b._id, { orders: b.orders, revenue: b.revenue });
  }
  const series: Array<{ date: string; orders: number; revenue: number }> = [];
  const cursor = new Date(rangeStart(range));
  for (let i = 0; i < range; i++) {
    const key = dayKey(cursor);
    const hit = byDay.get(key);
    series.push({
      date: key,
      orders: hit ? hit.orders : 0,
      revenue: hit ? hit.revenue : 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

/** In-window, non-cancelled orders that actually applied a discount. */
const DISCOUNT_MATCH = {
  "discount.couponId": { $ne: null },
  "discount.amount": { $gt: 0 },
  status: { $ne: "cancelled" },
};

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  const rawRange = req.nextUrl.searchParams.get("range");
  let range = 30;
  if (rawRange) {
    const parsed = Number(rawRange);
    if (!VALID_RANGES.includes(parsed)) {
      return NextResponse.json(
        { error: "بازه نامعتبر (بازه‌های مجاز: 7، 30، 90)" },
        { status: 400 }
      );
    }
    range = parsed;
  }

  try {
    await dbConnect();
    const start = rangeStart(range);
    const matchWindow = {
      status: { $ne: "cancelled" },
      createdAt: { $gte: start },
    };

    const [
      revenueAgg,
      timeBuckets,
      topProducts,
      topCategories,
      couponSummary,
      topCoupons,
      supplierEarnings,
      paidOut,
      pendingPayouts,
      supplierTotals,
      newCustomers,
      orderStatuses,
      discountSummary,
    ] = await Promise.all([
      // --- Summary revenue / orders ---
      Order.aggregate([
        { $match: matchWindow },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            revenue: { $sum: "$totalAmount" },
            discount: { $sum: { $ifNull: ["$discount.amount", 0] } },
          },
        },
      ]),
      // --- Time series ---
      Order.aggregate([
        { $match: matchWindow },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            orders: { $sum: 1 },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // --- Top products (from immutable item snapshots) ---
      Order.aggregate([
        { $match: matchWindow },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.name",
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      // --- Top categories (Order.items.product → Product.category → Category) ---
      Order.aggregate([
        { $match: matchWindow },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "products",
            localField: "items.product",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "categories",
            localField: "product.category",
            foreignField: "_id",
            as: "category",
          },
        },
        { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$category.name", "نامشخص"] },
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      // --- Coupon document stats ---
      Coupon.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ["$isActive", 1, 0] } },
            totalUses: { $sum: "$usedCount" },
          },
        },
      ]),
      // --- Top coupons by order usage in window (display list, top 5 only) ---
      Order.aggregate([
        { $match: { ...DISCOUNT_MATCH, createdAt: { $gte: start } } },
        {
          $group: {
            _id: "$discount.code",
            uses: { $sum: 1 },
            discount: { $sum: "$discount.amount" },
          },
        },
        { $sort: { discount: -1 } },
        { $limit: 5 },
      ]),
      // --- Supplier earnings credited (order_credit ledger) ---
      Transaction.aggregate([
        { $match: { type: "order_credit" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      // --- Approved payouts ---
      Transaction.aggregate([
        { $match: { type: "payout", status: "approved" } },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      // --- Pending payout requests ---
      Transaction.aggregate([
        { $match: { type: "payout", status: "pending" } },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      // --- Outstanding supplier balances + reserves ---
      Supplier.aggregate([
        {
          $group: {
            _id: null,
            outstanding: { $sum: "$balance" },
            reserved: { $sum: "$pendingReserve" },
          },
        },
      ]),
      // --- New customers in window ---
      User.countDocuments({ createdAt: { $gte: start } }),
      // --- Status funnel (all statuses, including cancelled, for the funnel) ---
      Order.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      // --- In-window discount totals (UNBOUNDED — never capped by top-5 list) ---
      Order.aggregate([
        { $match: { ...DISCOUNT_MATCH, createdAt: { $gte: start } } },
        {
          $group: {
            _id: null,
            discountedOrders: { $sum: 1 },
            totalDiscount: { $sum: "$discount.amount" },
          },
        },
      ]),
    ]);

    const summaryRow = revenueAgg[0];
    const couponRow = couponSummary[0];
    const discountRow = discountSummary[0];
    const earningsRow = supplierEarnings[0];
    const paidOutRow = paidOut[0];
    const pendingRow = pendingPayouts[0];
    const supplierRow = supplierTotals[0];

    const revenue = summaryRow?.revenue ?? 0;
    const orders = summaryRow?.orders ?? 0;

    const analytics = {
      range,
      from: dayKey(start),
      to: dayKey(new Date()),
      summary: {
        revenue,
        orders,
        avgOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
        couponSavings: summaryRow?.discount ?? 0,
        newCustomers,
      },
      timeSeries: buildSeries(range, timeBuckets),
      topProducts: topProducts.map((t: { _id: string; quantity: number; revenue: number }) => ({
        name: t._id,
        quantity: t.quantity,
        revenue: t.revenue,
      })),
      topCategories: topCategories.map(
        (t: { _id: string; quantity: number; revenue: number }) => ({
          name: t._id,
          quantity: t.quantity,
          revenue: t.revenue,
        })
      ),
      couponStats: {
        total: couponRow?.total ?? 0,
        active: couponRow?.active ?? 0,
        totalUses: couponRow?.totalUses ?? 0,
        // Unbounded aggregation — counts ALL in-window discounted orders
        // (not just the top-5 display list).
        discountedOrders: discountRow?.discountedOrders ?? 0,
        totalDiscount: discountRow?.totalDiscount ?? 0,
        topCoupons: topCoupons.map(
          (c: { _id: string; uses: number; discount: number }) => ({
            code: c._id,
            uses: c.uses,
            discount: c.discount,
          })
        ),
      },
      supplierStats: {
        totalEarnings: earningsRow?.total ?? 0,
        totalPaidOut: paidOutRow?.total ?? 0,
        paidOutCount: paidOutRow?.count ?? 0,
        pendingPayoutAmount: pendingRow?.total ?? 0,
        pendingPayoutCount: pendingRow?.count ?? 0,
        outstandingBalance: supplierRow?.outstanding ?? 0,
        pendingReserve: supplierRow?.reserved ?? 0,
      },
      ordersByStatus: orderStatuses
        .map((s: { _id: string; count: number }) => ({
          status: s._id,
          label: STATUS_LABELS[s._id] || s._id,
          count: s.count,
        }))
        .sort((a, b) => b.count - a.count),
    };

    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return serverError();
  }
}
