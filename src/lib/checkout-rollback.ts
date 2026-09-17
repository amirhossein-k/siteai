import Order from "@/models/Order";
import { restoreOrderStock } from "@/lib/inventory";
import { releaseCouponUsage } from "@/lib/coupons";

/**
 * Gateway-Failure Checkout Rollback
 *
 * SINGLE SOURCE OF TRUTH for rolling back a checkout that was committed but
 * could not obtain a payment authority from the gateway
 * (`requestPayment(...)` → null, i.e. the 502 "payment unavailable" response).
 * Used by:
 *  - POST /api/checkout
 *
 * Why the order is CANCELLED and never deleted: by the time the gateway call
 * runs, the order, its SupplierOrders, the FIFO sale movements (append-only
 * ledger) and the stock reservation are ALL committed, and the admin/supplier
 * notifications have already been dispatched. Deleting the order would orphan
 * its committed sale movements (breaking COGS/sales reconciliation) and strand
 * those notifications — so the rollback uses the SAME lifecycle every other
 * payment-failure path already uses (payment-cleanup, /api/orders/[id]/cancel,
 * payment/verify NOK, admin cancel):
 *
 *   1. atomic cancellation claim: pending_payment → cancelled
 *      (payment.status → canceled + a statusHistory note),
 *   2. restoreOrderStock() — the shared variant-aware/FIFO-aware helper. It
 *      returns the consumed layers at their snapshot cost and records the
 *      compensating `cancellation_restock` movements, and it is idempotent via
 *      the Order.stockRestored claim,
 *   3. releaseCouponUsage() — the idempotent release of the coupon claim this
 *      checkout made (flips `discount.released` exactly once, so a later
 *      cancellation/cleanup can never double-release).
 *
 * Failure handling: the caller still returns its 502 gateway response, so this
 * function must never throw. Each step is guarded SEPARATELY (one failure can
 * never skip the remaining steps) and a failure is logged with the order id and
 * the failed step only — never credentials, merchant ids, authorities or tokens.
 */
export async function rollbackUnavailablePaymentCheckout(
  orderId: string
): Promise<void> {
  // 1) Atomic cancellation claim — mirrors cleanupAbandonedPayments(): only an
  //    order still awaiting payment may be cancelled here, so a concurrent
  //    successful verify() can never be clobbered by this rollback.
  try {
    await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: "pending_payment",
        "payment.status": { $in: ["pending", "failed", "canceled"] },
      },
      {
        $set: { status: "cancelled", "payment.status": "canceled" },
        $push: {
          statusHistory: {
            status: "cancelled",
            at: new Date(),
            note: "درگاه پرداخت پاسخ نداد — سفارش لغو و موجودی رزرو‌شده آزاد شد",
          },
        },
      }
    );
  } catch (err) {
    console.error(
      `[Checkout] Gateway-failure rollback: cancelling order ${orderId} failed:`,
      err
    );
  }

  // 2) Return every reserved unit to stock (and to its FIFO layer at the
  //    snapshot cost). Idempotent — a duplicate call restores nothing twice.
  try {
    await restoreOrderStock(orderId);
  } catch (err) {
    console.error(
      `[Checkout] Gateway-failure rollback: stock restore failed for order ${orderId} — inventory may need reconciliation:`,
      err
    );
  }

  // 3) Release the coupon claim (idempotent; a no-op when no coupon was used).
  try {
    await releaseCouponUsage(orderId);
  } catch (err) {
    console.error(
      `[Checkout] Gateway-failure rollback: coupon release failed for order ${orderId} — coupon usage may need reconciliation:`,
      err
    );
  }
}
