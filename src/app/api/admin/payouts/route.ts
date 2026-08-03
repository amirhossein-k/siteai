import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Transaction from "@/models/Transaction";
import { sanitizePlainText } from "@/lib/sanitize";
import { notifyOrderEvent } from "@/lib/notifications";
import { sendPayoutStatusNotification } from "@/lib/telegram";

/**
 * Admin payout approval queue (Session 33).
 *
 * GET  /api/admin/payouts?status=pending   — list payout requests (supplier +
 *                                            bank account populated), newest first
 * POST /api/admin/payouts                  — { transactionId, action: "approve"|"reject", reason? }
 *
 * Authorization: admin only (requireRoleOrError → 401/403).
 *
 * Approve flow (atomic claims, mirrors the refund/retry pattern):
 *   1. Claim the payout request: findOneAndUpdate({ _id, type: "payout",
 *      status: "pending" }, { $set: { status: "approved", reviewedBy,
 *      reviewedAt } }) → only ONE admin can ever approve a request (loser → 400).
 *   2. Debit the supplier balance + release the reserve in one atomic update:
 *      Supplier.findOneAndUpdate({ _id, pendingReserve: { $gte: amount } },
 *      { $inc: { balance: -amount, pendingReserve: -amount } }).
 *      If this fails (reserve already released), roll the claim back to pending.
 *   3. Update the transaction's balanceAfter to the post-approval balance.
 *
 * Reject flow:
 *   1. Claim the request: status "pending" → "rejected" + rejectionReason +
 *      reviewedBy/reviewedAt (loser → 400).
 *   2. Release the reserve: Supplier $inc pendingReserve -= amount (balance
 *      untouched — the money was never debited).
 *
 * Invariants preserved: pendingReserve <= balance always; balance never goes
 * negative; a request is processed exactly once; audit trail immutable.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter: Record<string, unknown> = { type: "payout" };
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }

    const requests = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate({
        path: "supplier",
        select: "businessName user bankAccount balance pendingReserve",
        populate: { path: "user", select: "name phone" },
      })
      .lean();

    return NextResponse.json(requests);
  } catch (error) {
    console.error("Error fetching payouts:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const transactionId: unknown = body?.transactionId;
    const action: unknown = body?.action;

    if (
      typeof transactionId !== "string" ||
      !mongoose.isValidObjectId(transactionId)
    ) {
      return NextResponse.json(
        { error: "شناسه درخواست تسویه نامعتبر است" },
        { status: 400 }
      );
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "عملیات باید approve یا reject باشد" },
        { status: 400 }
      );
    }

    const reasonRaw: unknown = body?.reason;
    const reason =
      typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";

    if (action === "reject" && !reason) {
      return NextResponse.json(
        { error: "دلیل رد درخواست تسویه الزامی است" },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request: any = await Transaction.findById(transactionId).lean();
    if (!request) {
      return NextResponse.json(
        { error: "درخواست تسویه یافت نشد" },
        { status: 404 }
      );
    }

    if (request.type !== "payout") {
      return NextResponse.json(
        { error: "این تراکنش یک درخواست تسویه نیست" },
        { status: 400 }
      );
    }

    const amount = Math.abs(request.amount || 0);
    const supplierId = String(request.supplier);

    // --- REJECT ---
    if (action === "reject") {
      const sanitizedReason = sanitizePlainText(reason);
      // Atomic claim: only one admin can process this request
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimed: any = await Transaction.findOneAndUpdate(
        {
          _id: transactionId,
          type: "payout",
          status: "pending",
        },
        {
          $set: {
            status: "rejected",
            reviewedBy: token!.id,
            reviewedAt: new Date(),
            rejectionReason: sanitizedReason,
          },
        },
        { new: true }
      ).lean();

      if (!claimed) {
        return NextResponse.json(
          { error: "این درخواست قبلاً پردازش شده است" },
          { status: 400 }
        );
      }

      // Release the reserve (balance was never debited for a pending request)
      await Supplier.updateOne(
        { _id: supplierId },
        { $inc: { pendingReserve: -amount } }
      );

      // Session 45: notify the supplier AFTER the reject commit (claim + reserve
      // release both done above). notifyOrderEvent() never throws and the
      // telegram callback is fire-and-forget — a delivery failure can never
      // fail the payout operation. No money state is touched here. The whole
      // block is additionally wrapped so a notification-side throw can never
      // convert an already-committed reject into a 500.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rejectSupplier: any = await Supplier.findById(supplierId)
          .select("user telegramChatId")
          .lean();
        if (rejectSupplier?.user) {
          await notifyOrderEvent({
            recipient: String(rejectSupplier.user),
            type: "payout_rejected",
            category: "payout",
            message: `درخواست تسویه ${amount} تومان شما رد شد${sanitizedReason ? " — " + sanitizedReason : ""}`,
            link: "/supplier/wallet",
            notificationKey: `payout_${transactionId}_rejected`,
            telegram: rejectSupplier.telegramChatId
              ? () =>
                  sendPayoutStatusNotification(
                    rejectSupplier.telegramChatId,
                    amount,
                    "rejected",
                    sanitizedReason || undefined
                  )
              : undefined,
          });
        }
      } catch (notifyErr) {
        console.error("[payouts] reject notification failed (already committed):", notifyErr);
      }

      return NextResponse.json(claimed);
    }

    // --- APPROVE ---
    // Step 1: atomic claim (pending → approved)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Transaction.findOneAndUpdate(
      {
        _id: transactionId,
        type: "payout",
        status: "pending",
      },
      {
        $set: {
          status: "approved",
          reviewedBy: token!.id,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!claimed) {
      return NextResponse.json(
        { error: "این درخواست قبلاً پردازش شده است" },
        { status: 400 }
      );
    }

    // Step 2: debit balance + release reserve atomically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedSupplier: any = await Supplier.findOneAndUpdate(
      {
        _id: supplierId,
        pendingReserve: { $gte: amount },
      },
      {
        $inc: {
          balance: -amount,
          pendingReserve: -amount,
        },
      },
      { new: true }
    ).lean();

    if (!updatedSupplier) {
      // Roll the claim back so the request stays processable
      await Transaction.updateOne(
        { _id: transactionId },
        {
          $set: {
            status: "pending",
            reviewedBy: null,
            reviewedAt: null,
          },
        }
      );
      return NextResponse.json(
        { error: "موجودی رزرو شده برای این درخواست یافت نشد" },
        { status: 409 }
      );
    }

    // Step 3: record the post-approval balance on the transaction
    await Transaction.updateOne(
      { _id: transactionId },
      { $set: { balanceAfter: updatedSupplier.balance || 0 } }
    );

    const finalTx = await Transaction.findById(transactionId)
      .populate({
        path: "supplier",
        select:
          "businessName user bankAccount balance pendingReserve telegramChatId",
        populate: { path: "user", select: "name phone" },
      })
      .lean();

    // Session 45: notify the supplier AFTER the approve commit (claim + debit +
    // balanceAfter all done above). notifyOrderEvent() never throws and the
    // telegram callback is fire-and-forget — a delivery failure can never fail
    // the payout operation. No money state is touched here. The whole block is
    // additionally wrapped so a notification-side throw can never convert an
    // already-committed approve into a 500.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const approveSupplier: any = (finalTx as any)?.supplier;
      if (approveSupplier?.user) {
        await notifyOrderEvent({
          recipient: String(approveSupplier.user._id),
          type: "payout_approved",
          category: "payout",
          message: `درخواست تسویه ${amount} تومان شما تأیید شد`,
          link: "/supplier/wallet",
          notificationKey: `payout_${transactionId}_approved`,
          telegram: approveSupplier.telegramChatId
            ? () =>
                sendPayoutStatusNotification(
                  approveSupplier.telegramChatId,
                  amount,
                  "approved"
                )
            : undefined,
        });
      }
    } catch (notifyErr) {
      console.error("[payouts] approve notification failed (already committed):", notifyErr);
    }

    return NextResponse.json(finalTx);
  } catch (error) {
    console.error("Error processing payout review:", error);
    return serverError();
  }
}
