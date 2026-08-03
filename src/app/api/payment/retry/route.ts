import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import { requestPayment } from "@/lib/zarinpal";
import { reserveStock, restoreStock } from "@/lib/inventory";

/**
 * POST /api/payment/retry
 *
 * Lets a customer re-attempt payment for their own order.
 *
 * Allowed when the order is still awaiting payment AND the payment is not in
 * a terminal success/refund state:
 *   - order.status must be "pending_payment"
 *   - payment.method must be "zarinpal"
 *   - payment.status must be one of: pending | failed | canceled
 *
 * STOCK SEMANTICS (critical):
 *   - pending + stockRestored=false  → the checkout reservation is STILL HELD.
 *     Retry issues a fresh Zarinpal authority WITHOUT touching stock.
 *   - failed/canceled + stockRestored=true → the verify callback ALREADY
 *     restored the stock via restoreOrderStock(). Retry therefore atomically
 *     RE-RESERVES every item (shared reserveStock()) before creating a new
 *     authority, so a successful retried payment always has reserved stock.
 *
 * Concurrency + crash safety:
 *   - The `stockRestored=true` → `payment.status` transition is used as the
 *     ATOMIC CLAIM that serializes concurrent retries of the SAME order
 *     (reserveStock() alone cannot prevent a second retry from reserving the
 *     same items again — the optimistic lock only protects against other
 *     buyers). Only the first retry wins the claim; later ones get 409.
 *   - The `stockRestored=false` (still-pending) path uses a transient
 *     `payment.retryToken` claim for the same reason: without it, two
 *     concurrent retries would both issue a Zarinpal authority and both write
 *     `payment.authority` (last-write-wins) — a customer paying the first
 *     authority would then fail the verify callback's authority cross-check
 *     despite having paid. The token is set atomically (only the first retry
 *     succeeds; later ones get 409) and $unset on completion or failure.
 *   - `stockRestored` is NEVER flipped to false before the reservation
 *     completes. It is only set false in the FINAL update, together with the
 *     new authority. This guarantees the invariant
 *     "stockRestored === false ⟺ stock is currently reserved", so a crash at
 *     any point can never lead to double restoration (stock inflation).
 *   - On ANY failure the re-reserved items are rolled back and the order is
 *     restored to its previous payment.status — no authority is persisted.
 */
export async function POST(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();
    const body = await req.json();
    const orderId: unknown = body?.orderId;

    if (typeof orderId !== "string" || !mongoose.isValidObjectId(orderId)) {
      return NextResponse.json(
        { error: "شناسه سفارش نامعتبر است" },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order: any = await Order.findOne({
      _id: orderId,
      customer: token.id,
    }).lean();

    if (!order) {
      return NextResponse.json(
        { error: "سفارش مورد نظر یافت نشد" },
        { status: 404 }
      );
    }

    // --- Retryability validation ---
    if (order.status !== "pending_payment") {
      return NextResponse.json(
        { error: "وضعیت سفارش اجازه پرداخت مجدد را نمی‌دهد" },
        { status: 400 }
      );
    }

    if (order.payment?.method !== "zarinpal") {
      return NextResponse.json(
        { error: "این سفارش از طریق درگاه آنلاین پرداخت نشده است" },
        { status: 400 }
      );
    }

    const paymentStatus: string = order.payment?.status || "";
    const retryableStatuses = ["pending", "failed", "canceled"];
    if (!retryableStatuses.includes(paymentStatus)) {
      return NextResponse.json(
        { error: "این سفارش قابل پرداخت مجدد نیست" },
        { status: 400 }
      );
    }

    // --- Stock handling ---
    const items = order.items || [];
    const reserved: Array<{ product: string; quantity: number; variantId?: string }> = [];

    const rollbackReserved = async () => {
      await Promise.all(
        reserved.map((r) => restoreStock(r.product, r.quantity, r.variantId))
      );
    };

    // pending + stockRestored=false → reservation still held → no stock change.
    // failed/canceled + stockRestored=true → stock was restored → re-reserve.
    if (order.stockRestored === true) {
      // ATOMIC CLAIM — serializes concurrent retries of this same order.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimed: any = await Order.findOneAndUpdate(
        {
          _id: orderId,
          customer: token.id,
          status: "pending_payment",
          "payment.status": { $in: ["failed", "canceled"] },
          stockRestored: true,
        },
        { $set: { "payment.status": "pending" } }
      ).lean();

      if (!claimed) {
        return NextResponse.json(
          { error: "پرداخت مجدد در حال پردازش است" },
          { status: 409 }
        );
      }

      // Re-reserve every item; roll back everything on any failure and restore
      // the previous payment.status so a later retry can try again.
      try {
        for (const item of items) {
          const reservedProduct = await reserveStock(
            String(item.product),
            item.quantity,
            item.variantId || undefined
          );
          if (!reservedProduct) {
            await rollbackReserved();
            await Order.findByIdAndUpdate(orderId, {
              $set: { "payment.status": paymentStatus }, // back to failed/canceled
            });
            return NextResponse.json(
              { error: "موجودی کافی برای پرداخت مجدد در دسترس نیست" },
              { status: 409 }
            );
          }
          reserved.push({
            product: String(item.product),
            quantity: item.quantity,
            variantId: item.variantId || undefined,
          });
        }
      } catch (err) {
        await rollbackReserved();
        await Order.findByIdAndUpdate(orderId, {
          $set: { "payment.status": paymentStatus },
        });
        throw err;
      }
    } else {
      // pending + stockRestored=false → reservation still held → no stock
      // change. But claim a transient retryToken so concurrent retries of the
      // SAME order cannot both issue authorities (duplicate Zarinpal
      // authorities + last-write-wins on payment.authority → the first paid
      // authority would mismatch in the verify callback). Only the first retry
      // wins the claim; later ones get 409.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimed: any = await Order.findOneAndUpdate(
        {
          _id: orderId,
          customer: token.id,
          status: "pending_payment",
          "payment.status": { $in: retryableStatuses },
          stockRestored: false,
          "payment.retryToken": { $exists: false },
        },
        { $set: { "payment.retryToken": crypto.randomUUID() } }
      ).lean();

      if (!claimed) {
        return NextResponse.json(
          { error: "پرداخت مجدد در حال پردازش است" },
          { status: 409 }
        );
      }
    }

    // --- Request a fresh Zarinpal authority ---
    const orderDesc = `سفارش #${orderId.slice(-8)}`;
    const customerMobile = (token as unknown as { phone?: string })?.phone || "";
    const paymentResult = await requestPayment(
      order.totalAmount,
      orderDesc,
      orderId,
      customerMobile
    );

    if (!paymentResult) {
      // Roll back the re-reservation so stock is not left decremented.
      if (reserved.length > 0) await rollbackReserved();
      if (order.stockRestored === true) {
        await Order.findByIdAndUpdate(orderId, {
          $set: { "payment.status": paymentStatus },
        });
      } else {
        // Release the retryToken claim so the order stays retryable.
        await Order.findByIdAndUpdate(orderId, {
          $unset: { "payment.retryToken": "" },
        });
      }
      return NextResponse.json(
        {
          error:
            "درگاه پرداخت موقتاً در دسترس نیست. لطفاً دقایقی بعد تلاش کنید.",
        },
        { status: 502 }
      );
    }

    // --- FINAL ATOMIC UPDATE: only here is stockRestored set to false,
    // together with the new authority. payment.status is already "pending"
    // (set by the claim), which the verify callback's success path requires.
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        "payment.status": "pending",
        "payment.authority": paymentResult.authority,
        stockRestored: false,
      },
      // Release the retryToken claim (harmless $unset if not present).
      $unset: { "payment.retryToken": "" },
      $push: {
        statusHistory: {
          status: "pending_payment",
          at: new Date(),
          note: "درخواست پرداخت مجدد — شناسه پرداخت جدید صادر شد",
        },
      },
    });

    return NextResponse.json(
      {
        message: "در حال انتقال به درگاه پرداخت...",
        orderId,
        paymentUrl: paymentResult.redirectUrl,
        authority: paymentResult.authority,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error retrying payment:", error);
    return serverError();
  }
}
