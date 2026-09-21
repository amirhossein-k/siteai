import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import { notifyOrderEvent } from "@/lib/notifications";
import { restoreOrderStock } from "@/lib/inventory";
import { reverseOrderSales } from "@/lib/product-sales";
import { sanitizePlainText } from "@/lib/sanitize";
import { buildSmsEventMarker, fireOrderSmsEvent } from "@/lib/sms-order-events";

/**
 * POST /api/admin/orders/refund
 *
 * Admin refund workflow for PAID orders.
 *
 * Authorization: admin only (requireRoleOrError → 401 unauth / 403 wrong role).
 *
 * Allowed:  payment.status === "paid"
 * Forbidden: pending / failed / canceled / refunded (anything but paid)
 *
 * Behavior:
 *  - Atomic claim: only the first concurrent request can flip
 *    payment.status "paid" → "refunded" (second caller sees null → 400),
 *    so a refunded order can never be refunded twice.
 *  - Stores refund metadata: reason, refundedAt, refundedBy (admin user id).
 *  - Pushes an immutable "refunded" event onto the order statusHistory.
 *  - Restores stock via restoreOrderStock() — the shared, variant-aware,
 *    stockRestored-idempotent helper. If stock was already restored the
 *    claim no-ops, so a refund never increases stock twice.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const orderId: unknown = body?.orderId;
    const reasonRaw: unknown = body?.reason;

    if (typeof orderId !== "string" || !mongoose.isValidObjectId(orderId)) {
      return NextResponse.json(
        { error: "شناسه سفارش نامعتبر است" },
        { status: 400 }
      );
    }

    const reason =
      typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";
    if (!reason) {
      return NextResponse.json(
        { error: "دلیل بازپرداخت الزامی است" },
        { status: 400 }
      );
    }

    // --- Atomic claim: paid → refunded (only the first caller wins) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Order.findOneAndUpdate(
      {
        _id: orderId,
        "payment.status": "paid",
      },
      {
        $set: {
          "payment.status": "refunded",
          refund: {
            reason: sanitizePlainText(reason),
            refundedAt: new Date(),
            refundedBy: token!.id,
          },
        },
        $push: {
          // Session 91 — durable REFUND_COMPLETED marker committed in the SAME
          // atomic claim that flips paid→refunded, so the SMS event survives a
          // crash between the refund commit and its processing.
          smsEvents: buildSmsEventMarker(orderId, "REFUND_COMPLETED"),
          statusHistory: {
            status: "refunded",
            at: new Date(),
            note: `بازپرداخت سفارش — ${sanitizePlainText(reason)}`,
          },
        },
      },
      { new: true }
    ).lean();

    if (!claimed) {
      // Distinguish "not found" from "not refundable"
      const exists = await Order.findById(orderId).select("_id").lean();
      if (!exists) {
        return NextResponse.json(
          { error: "سفارش یافت نشد" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "فقط سفارش‌های پرداخت‌شده قابل بازپرداخت هستند" },
        { status: 400 }
      );
    }

    // --- Restore stock exactly once (idempotent via the stockRestored claim) ---
    // If stock was already restored, restoreOrderStock() no-ops — a refund
    // never increases stock twice. Variant items restore via their variantId.
    // Phase C: `return_restock` movement type — purchased items also restore
    // their exact FIFO layers at the snapshot cost (fifoUnitCost).
    await restoreOrderStock(orderId, "return_restock");

    // Session 56 — reverse the best-sellers counter. The paid→refunded claim
    // above is exactly-once (double refund → 400), so refunded units are
    // decremented exactly once and can never go below 0 (pipeline floor).
    // Fail-silent — never blocks the refund itself.
    await reverseOrderSales(orderId);

    // Notify the customer about the refund (in-app, best-effort — never
    // blocks the refund itself).
    const updatedOrder = await Order.findById(orderId)
      .populate("customer", "name phone")
      .lean();

    // `customer` is populated ({ _id, name, phone }) or null — extract the id
    // with a single typed access; no nested casts needed.
    const customer =
      (updatedOrder as { customer?: { _id?: unknown } | null } | null)
        ?.customer ?? null;
    const customerId =
      customer && typeof customer === "object" && customer._id
        ? String(customer._id)
        : null;

    // Session 91 — REFUND_COMPLETED business SMS (best-effort, non-blocking).
    // The durable marker was pushed in the SAME atomic refund claim above;
    // this fires the send. Never throws; a failure cannot fail the refund.
    // Phone/name come from the server-side populated customer record.
    void fireOrderSmsEvent({
      orderId,
      event: "REFUND_COMPLETED",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      order: updatedOrder as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      phone: (customer as any)?.phone || "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customerName: (customer as any)?.name || "",
    });

    if (customerId) {
      await notifyOrderEvent({
        recipient: customerId,
        type: "order_refunded",
        category: "order",
        message: `سفارش شما #${String(orderId).slice(-8)} بازپرداخت شد.`,
        relatedOrder: String(orderId),
        link: `/orders/${String(orderId)}`,
        notificationKey: `order_${orderId}_order_refunded`,
      });
    }

    return NextResponse.json(updatedOrder);
  } catch (err) {
    console.error("Error refunding order:", err);
    return serverError();
  }
}
