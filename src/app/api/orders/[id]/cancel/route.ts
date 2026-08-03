import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import { restoreOrderStock } from "@/lib/inventory";
import { releaseCouponUsage } from "@/lib/coupons";
import { notifyOrderEvent } from "@/lib/notifications";

/**
 * POST /api/orders/[id]/cancel — Customer Self-Service Cancellation (Session 46)
 *
 * Cancellable ONLY while the order is awaiting payment:
 *   order.status === "pending_payment" AND payment.status === "pending".
 *
 * CONCURRENCY SAFETY (atomic claim, mirrors refund/payout/moderation):
 *   - Claim: findOneAndUpdate({ _id, customer, status: "pending_payment",
 *     "payment.status": "pending" }) → { status: "cancelled",
 *     "payment.status": "canceled" } + statusHistory push.
 *   - The payment-verify SUCCESS claim also gates on payment.status ===
 *     "pending" — MongoDB serializes per-document writes, so EXACTLY ONE of
 *     cancel vs verify wins:
 *       * verify wins first → this claim matches nothing → 409
 *       * cancel wins first → verify's success claim fails (payment no longer
 *         pending) AND the verify NOK branch ($nin terminal) fails → no paid
 *         order with restored stock, no double restoration.
 *   - Ownership-scoped (customer: token.id): cross-user → 404 (no IDOR).
 *   - 404 = not found OR not owned; 409 = exists but no longer cancellable.
 *
 * AUDIT (machine-readable, per locked design):
 *   statusHistory entry = { status: "cancelled", actor: "customer",
 *   note: "customer_cancelled" }. Raw customer input is NEVER stored in the
 *   note field. A future optional customer message would go in a separate
 *   sanitized `customerNote` field (not part of this milestone).
 *
 * POST-COMMIT (strictly AFTER the claim succeeds, all in local try/catch so a
 * side-effect failure can never turn a committed cancel into a 500):
 *   restoreOrderStock(id)  — stockRestored-idempotent (inventory.ts authority)
 *   releaseCouponUsage(id) — idempotent release (coupons.ts, untouched)
 *   notifyOrderEvent(...)  — order_cancelled (REUSED type, no enum change)
 *
 * Invariants preserved: inventory.ts stays the only stock authority; checkout
 * remains the only reservation point (this endpoint only RELEASES); no refund
 * path is introduced; payment verification logic untouched.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Customer-only: unauth → 401, supplier/admin → 403 (locked design).
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    const { id } = await params;

    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه سفارش نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Distinguish "not found / not owned" (404) from "already processed" (409)
    const exists = await Order.exists({ _id: id, customer: token!.id });
    if (!exists) {
      return NextResponse.json(
        { error: "سفارش مورد نظر یافت نشد" },
        { status: 404 }
      );
    }

    // --- Atomic claim: pending_payment + payment pending → cancelled ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Order.findOneAndUpdate(
      {
        _id: id,
        customer: token!.id,
        status: "pending_payment",
        "payment.status": "pending",
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
            note: "customer_cancelled", // machine-readable, NOT raw input
            actor: "customer",
          },
        },
      },
      { new: true }
    )
      .select("_id customer status")
      .lean();

    if (!claimed) {
      return NextResponse.json(
        { error: "این سفارش قابل لغو نیست (پرداخت در حال انجام است یا سفارش لغو شده)" },
        { status: 409 }
      );
    }

    // --- Post-commit side-effects (never before the claim; fail-silent) ---
    try {
      await restoreOrderStock(id);
      await releaseCouponUsage(id);
      await notifyOrderEvent({
        recipient: String(claimed.customer),
        type: "order_cancelled",
        category: "order",
        message: `سفارش شما #${String(id).slice(-8)} توسط شما لغو شد و موجودی به انبار برگردانده شد.`,
        relatedOrder: String(id),
        link: `/orders/${String(id)}`,
        notificationKey: `order_${id}_order_cancelled`,
      });
    } catch (err) {
      console.error(
        "[orders/cancel] post-commit side-effect failed (cancel already committed):",
        err
      );
    }

    return NextResponse.json({
      orderId: String(id),
      status: "cancelled",
      cancelled: true,
    });
  } catch (error) {
    console.error("Error cancelling order:", error);
    return serverError();
  }
}
