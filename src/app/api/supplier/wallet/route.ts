import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Transaction from "@/models/Transaction";
import SupplierOrder from "@/models/SupplierOrder";
import User from "@/models/User";
import { notifyOrderEvent } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier: any = await Supplier.findOne({ user: token!.id }).lean();
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactions: any[] = await Transaction.find({
      supplier: supplier._id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const pendingPayouts = await SupplierOrder.countDocuments({
      supplier: supplier._id,
      status: "delivered",
      isPaidOut: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payoutResult: any[] = await Transaction.aggregate([
      {
        $match: {
          supplier: supplier._id,
          type: "payout",
          status: { $in: ["approved", null] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalPaidOut = payoutResult.length > 0 ? Math.abs(payoutResult[0].total) : 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const earningsResult: any[] = await Transaction.aggregate([
      { $match: { supplier: supplier._id, type: "order_credit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalEarnings = earningsResult.length > 0 ? earningsResult[0].total : 0;

    const balance = supplier.balance || 0;
    const pendingReserve = supplier.pendingReserve || 0;
    // پول قابل درخواست = موجودی کل منهای رزرو درخواست‌های در انتظار تأیید
    const availableBalance = Math.max(0, balance - pendingReserve);

    const walletInfo = {
      balance,
      availableBalance,
      pendingReserve,
      totalEarnings,
      totalPaidOut,
      pendingPayouts,
      bankAccount: supplier.bankAccount || {
        cardNumber: "",
        iban: "",
        ownerName: "",
      },
      businessName: supplier.businessName || "",
      contactPhone: supplier.contactPhone || "",
      recentTransactions: transactions,
    };

    return NextResponse.json(walletInfo);
  } catch (error) {
    console.error("Error fetching wallet info:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { amount, note } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: "مبلغ تسویه باید بیشتر از صفر باشد" },
        { status: 400 }
      );
    }

    // --- Validate bank account before reserving ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freshSupplier: any = await Supplier.findById(supplier._id).lean();
    if (!freshSupplier?.bankAccount?.iban && !freshSupplier?.bankAccount?.cardNumber) {
      return NextResponse.json(
        { error: "لطفاً ابتدا اطلاعات بانکی خود را در پروفایل تکمیل کنید" },
        { status: 400 }
      );
    }

    // --- Atomic reserve claim ---
    // Only increment pendingReserve if the supplier still has enough available
    // balance (balance - pendingReserve >= amount). The $expr guard makes this
    // race-safe: two concurrent requests can never over-reserve.
    const claimed = await Supplier.findOneAndUpdate(
      {
        _id: supplier._id,
        $expr: {
          $lte: [{ $add: ["$pendingReserve", amount] }, "$balance"],
        },
      },
      { $inc: { pendingReserve: amount } },
      { new: true }
    );

    if (!claimed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current: any = await Supplier.findById(supplier._id)
        .select("balance pendingReserve")
        .lean();
      const available = Math.max(
        0,
        (current?.balance || 0) - (current?.pendingReserve || 0)
      );
      return NextResponse.json(
        {
          error: `موجودی قابل برداشت کافی نیست. موجودی قابل برداشت: ${available.toLocaleString("fa-IR")} تومان`,
        },
        { status: 400 }
      );
    }

    const balance = claimed.balance || 0;

    let payoutTxn: { _id: unknown } | null = null;
    try {
      // Create a PENDING payout request (balance NOT debited yet — an admin
      // must approve it). balanceAfter snapshots the CURRENT balance (pre-approval).
      payoutTxn = await Transaction.create({
        supplier: supplier._id,
        type: "payout",
        amount: -amount,
        note: note || "درخواست تسویه حساب",
        balanceAfter: balance,
        status: "pending",
      });
    } catch (err) {
      // Roll back the reserve if transaction creation fails
      await Supplier.updateOne(
        { _id: supplier._id },
        { $inc: { pendingReserve: -amount } }
      );
      throw err;
    }

    // Session 80 — notify every active admin about the new payout request
    // (the sole approver). Best-effort and AFTER the pending transaction
    // committed; a notification failure can never fail the payout request.
    try {
      const admins = await User.find({ role: "admin", isActive: true })
        .select("_id")
        .lean();
      for (const admin of admins) {
        await notifyOrderEvent({
          recipient: String(admin._id),
          type: "payout_requested",
          category: "payout",
          message: `درخواست تسویه جدید از «${
            supplier.businessName || "فروشنده"
          }» به مبلغ ${new Intl.NumberFormat("fa-IR").format(amount)} تومان`,
          link: "/admin/payouts",
          notificationKey: `payout_${String(payoutTxn?._id)}_requested`,
        });
      }
    } catch (err) {
      console.error(
        "[Wallet] Admin payout notification failed (non-blocking):",
        err
      );
    }

    // claimed has { new: true } → pendingReserve ALREADY includes amount
    const reserveAfter = claimed.pendingReserve || 0;
    return NextResponse.json({
      message: "درخواست تسویه ثبت شد و در انتظار تأیید مدیر است",
      pendingReserve: reserveAfter,
      availableBalance: Math.max(0, balance - reserveAfter),
    });
  } catch (error) {
    console.error("Error processing payout:", error);
    return serverError();
  }
}