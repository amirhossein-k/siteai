import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import Order from "@/models/Order";
import Product from "@/models/Product";
import { verifyPayment } from "@/lib/zarinpal";
import {
  notifyOrderEvent,
  type NotificationEventInput,
} from "@/lib/notifications";
import { restoreOrderStock } from "@/lib/inventory";
import { releaseCouponUsage } from "@/lib/coupons";
import { recordOrderSales } from "@/lib/product-sales";

/**
 * Best-effort notification dispatch that can NEVER affect the payment flow.
 *
 * notifyOrderEvent() is already non-throwing internally, but this extra guard
 * makes the isolation structural: even if a future change makes it throw, a
 * notification failure can never turn a successful payment into a failed
 * redirect (or vice versa). Callers await it only to keep writes ordered.
 */
async function safeNotifyOrderEvent(input: NotificationEventInput) {
  try {
    await notifyOrderEvent(input);
  } catch (err) {
    console.error(
      "[Payment] notification dispatch failed (non-blocking):",
      err
    );
  }
}

/**
 * Payment Verification Callback (GET)
 *
 * Zarinpal redirects the user here after payment attempt.
 * This endpoint:
 * 1. Cross-checks the authority against the stored order
 * 2. Prevents duplicate verification (already-paid orders)
 * 3. Verifies the transaction server-side with Zarinpal
 * 4. Updates order/payment status accordingly
 * 5. Redirects to the payment result page with the outcome
 *
 * CONCURRENCY SAFETY:
 * - Uses findOneAndUpdate with conditional filters as an atomic claim pattern
 * - Prevents double-stock-restoration via the stockRestored flag on Order
 * - Prevents duplicate payment success processing via payment.status check
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const authority = searchParams.get("Authority");
  const status = searchParams.get("Status");
  const orderId = searchParams.get("orderId");

  // --- Validate required params ---
  if (!authority || !orderId) {
    return NextResponse.redirect(
      new URL(
        "/payment/result?status=failed&message=خطا: اطلاعات ناقص است",
        req.url
      )
    );
  }

  // --- User cancelled the payment at Zarinpal gateway ---
  if (status === "NOK") {
    try {
      await dbConnect();

      // Atomic claim: only process cancellation if order is NOT already in a terminal state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updated: any = await Order.findOneAndUpdate(
        {
          _id: orderId,
          "payment.status": { $nin: ["paid", "canceled", "refunded"] },
        },
        {
          $set: {
            "payment.status": "canceled",
          },
          $push: {
            statusHistory: {
              status: "pending_payment",
              at: new Date(),
              note: "پرداخت توسط کاربر لغو شد — موجودی برگردانده شد",
            },
          },
        },
        { new: true }
      ).lean();

      if (updated) {
        // We were the first to claim this cancellation — restore stock and
        // release the coupon claim (idempotent; no-op when no coupon applied)
        await restoreOrderStock(orderId);
        await releaseCouponUsage(orderId);

        // Notify the customer that payment was cancelled (in-app, best-effort)
        const custId = updated.customer ? String(updated.customer) : null;
        if (custId) {
          await safeNotifyOrderEvent({
            recipient: custId,
            type: "payment_cancelled",
            category: "payment",
            message: `پرداخت سفارش شما #${String(orderId).slice(
              -8
            )} لغو شد و موجودی به انبار برگردانده شد.`,
            relatedOrder: String(orderId),
            link: `/orders/${String(orderId)}`,
            notificationKey: `order_${orderId}_payment_cancelled`,
          });
        }
      }
    } catch (error) {
      // Log but still redirect — don't block the user
      console.error("[Payment] Error updating cancelled order:", error);
    }

    return NextResponse.redirect(
      new URL(
        `/payment/result?status=cancelled&orderId=${orderId}`,
        req.url
      )
    );
  }

  try {
    await dbConnect();

    // --- Fetch the order to verify ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order: any = await Order.findById(orderId)
      .select("totalAmount payment status")
      .lean();

    if (!order) {
      return NextResponse.redirect(
        new URL(
          `/payment/result?status=failed&message=سفارش یافت نشد`,
          req.url
        )
      );
    }

    // --- Security: prevent duplicate verification (already paid) ---
    if (order.payment?.status === "paid") {
      // Order is already paid — redirect to success (no duplicate charge)
      return NextResponse.redirect(
        new URL(
          `/payment/result?status=success&orderId=${orderId}&refId=${order.payment.refId}`,
          req.url
        )
      );
    }

    // --- Security: verify the authority matches what we stored ---
    if (order.payment?.authority && order.payment.authority !== authority) {
      console.error(
        `[Payment] Authority mismatch for order ${orderId}: stored="${order.payment.authority}", received="${authority}"`
      );
      return NextResponse.redirect(
        new URL(
          `/payment/result?status=failed&orderId=${orderId}&message=عدم تطابق شناسه پرداخت`,
          req.url
        )
      );
    }

    // --- Verify payment with Zarinpal server-side ---
    const result = await verifyPayment(order.totalAmount, authority);

    if (!result) {
      // Atomic claim: mark as failed ONLY if not already in a terminal state
      // This prevents double-stock-restoration from concurrent callback retries
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimed: any = await Order.findOneAndUpdate(
        {
          _id: orderId,
          "payment.status": { $nin: ["paid", "canceled", "refunded", "failed"] },
        },
        {
          $set: {
            "payment.status": "failed",
          },
          $push: {
            statusHistory: {
              status: "pending_payment",
              at: new Date(),
              note: "پرداخت تأیید نشد — موجودی برگردانده شد",
            },
          },
        },
        { new: true }
      ).lean();

      if (claimed) {
        // We were the first to claim this failure — restore stock and release
        // the coupon claim (idempotent; no-op when no coupon applied)
        await restoreOrderStock(orderId);
        await releaseCouponUsage(orderId);

        // Notify the customer that payment failed (in-app, best-effort)
        const custId = claimed.customer ? String(claimed.customer) : null;
        if (custId) {
          await safeNotifyOrderEvent({
            recipient: custId,
            type: "payment_failed",
            category: "payment",
            message: `پرداخت سفارش شما #${String(orderId).slice(
              -8
            )} ناموفق بود و موجودی به انبار برگردانده شد.`,
            relatedOrder: String(orderId),
            link: `/orders/${String(orderId)}`,
            notificationKey: `order_${orderId}_payment_failed`,
          });
        }
      }

      return NextResponse.redirect(
        new URL(
          `/payment/result?status=failed&orderId=${orderId}&message=پرداخت تأیید نشد`,
          req.url
        )
      );
    }

    // --- Payment verified successfully — update order ---
    // Atomic claim: only process if payment is still "pending"
    // This prevents duplicate successful verification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const successClaimed: any = await Order.findOneAndUpdate(
      {
        _id: orderId,
        "payment.status": "pending",
      },
      {
        $set: {
          "payment.status": "paid",
          "payment.refId": String(result.refId),
          "payment.cardPan": result.cardPan || "",
          "payment.paidAt": new Date(),
        },
        $push: {
          statusHistory: {
            status: "processing",
            at: new Date(),
            note: `پرداخت آنلاین انجام شد. کد پیگیری: ${result.refId}${
              result.cardPan ? ` — کارت: ****${result.cardPan}` : ""
            }`,
          },
        },
        status: "processing",
      },
      { new: true }
    ).lean();

    if (!successClaimed) {
      // Another request already processed this payment
      // Fetch the current state to redirect appropriately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current: any = await Order.findById(orderId)
        .select("payment.status payment.refId")
        .lean();

      if (current?.payment?.status === "paid") {
        return NextResponse.redirect(
          new URL(
            `/payment/result?status=success&orderId=${orderId}&refId=${current.payment.refId}`,
            req.url
          )
        );
      }

      return NextResponse.redirect(
        new URL(
          `/payment/result?status=failed&orderId=${orderId}&message=پرداخت قبلاً پردازش شده است`,
          req.url
        )
      );
    }

    // Notify the customer that payment succeeded (in-app, best-effort)
    const custId = successClaimed.customer
      ? String(successClaimed.customer)
      : null;

    // Session 56 — best-sellers counter. The pending→paid claim above is
    // exactly-once (duplicate callbacks redirect via !successClaimed above
    // and never reach here), so soldCount accrues exactly once per paid order.
    // Fail-silent — a counter failure can never fail a committed payment.
    await recordOrderSales(orderId);

    if (custId) {
      await safeNotifyOrderEvent({
        recipient: custId,
        type: "payment_paid",
        category: "payment",
        message: `پرداخت سفارش شما #${String(orderId).slice(
          -8
        )} با موفقیت انجام شد. کد پیگیری: ${result.refId}`,
        relatedOrder: String(orderId),
        link: `/orders/${String(orderId)}`,
        notificationKey: `order_${orderId}_payment_paid`,
      });
    }

    return NextResponse.redirect(
      new URL(
        `/payment/result?status=success&orderId=${orderId}&refId=${result.refId}`,
        req.url
      )
    );
  } catch (error) {
    console.error("[Zarinpal] Callback error:", error);
    return NextResponse.redirect(
      new URL(
        `/payment/result?status=failed&orderId=${orderId}&message=خطای سرور`,
        req.url
      )
    );
  }
}

// NOTE: restoreOrderStock() is imported from @/lib/inventory — the shared,
// variant-aware, stockRestored-idempotent restoration helper. No duplicated
// inventory logic lives in this route.
