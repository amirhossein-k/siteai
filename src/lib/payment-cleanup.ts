import Order from "@/models/Order";
import { restoreOrderStock } from "@/lib/inventory";
import { releaseCouponUsage } from "@/lib/coupons";

/**
 * Abandoned Payment Cleanup
 *
 * SINGLE SOURCE OF TRUTH for cancelling abandoned pending-payment orders.
 * Used by:
 *  - /api/payment/cleanup (manual trigger / cron webhook)
 *
 * Behavior:
 *  - Finds orders with status="pending_payment" whose updatedAt is older than
 *    maxAgeHours (default 24h). updatedAt (not createdAt) is used so that a
 *    freshly-retried order gets a fresh 24h window — retry bumps updatedAt via
 *    Mongoose timestamps, preventing cleanup from cancelling an order that the
 *    customer is actively re-paying.
 *  - For each, atomically claims the cancellation (status → "cancelled",
 *    payment.status → "canceled") so concurrent/duplicate runs never
 *    double-process an order.
 *  - Restores stock via restoreOrderStock() — the shared, variant-aware,
 *    stockRestored-idempotent helper. No duplicated inventory logic.
 *
 * Returns the number of orders actually cancelled.
 */
export async function cleanupAbandonedPayments(
  maxAgeHours: number = 24
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abandoned: any[] = await Order.find({
    status: "pending_payment",
    updatedAt: { $lt: cutoff },
  })
    .select("_id")
    .lean();

  let cleaned = 0;

  for (const order of abandoned) {
    // Atomic claim: only transition orders still pending payment.
    // This prevents double-cancellation + double-restore from concurrent runs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: "pending_payment",
        "payment.status": { $in: ["pending", "failed", "canceled"] },
      },
      {
        $set: {
          status: "cancelled",
          "payment.status": "canceled",
        },
        $push: {
          statusHistory: {
            status: "cancelled",
            at: new Date(),
            note: "پرداخت رها شده (بیش از ۲۴ ساعت) — سفارش به‌صورت خودکار لغو و موجودی برگردانده شد",
          },
        },
      },
      { new: true }
    ).lean();

    if (!claimed) continue; // another run claimed it (or order moved on)

    // restoreOrderStock() is idempotent via the Order.stockRestored claim —
    // only the first caller actually restores. Release the coupon claim too
    // (idempotent; no-op when no coupon applied).
    await restoreOrderStock(String(order._id));
    await releaseCouponUsage(String(order._id));
    cleaned++;
  }

  return cleaned;
}
