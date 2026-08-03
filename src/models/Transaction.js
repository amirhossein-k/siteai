import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    type: {
      type: String,
      enum: ["payout", "adjustment", "order_credit"],
      required: true,
      // payout: واریز پول به فروشنده (balance کم می‌شه)
      // order_credit: بابت یه سفارش جدید به فروشنده بدهکار می‌شی (balance زیاد می‌شه)
      // adjustment: اصلاح دستی توسط ادمین
    },
    amount: {
      type: Number,
      required: true,
    },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierOrder",
      default: null,
    },
    note: {
      type: String,
      default: "",
    },
    // مانده‌ی حساب فروشنده بعد از این تراکنش (اسنپ‌شات، برای تاریخچه‌ی دقیق)
    balanceAfter: {
      type: Number,
      required: true,
    },
    // --- Payout approval workflow (Session 33) ---
    // Only meaningful for type="payout". A payout request is created as
    // "pending" (amount reserved on the supplier via pendingReserve, balance
    // NOT debited yet), then an admin approves (balance debited + reserve
    // released) or rejects (reserve released, balance untouched).
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // Admin who reviewed this payout request
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    // Reason for rejection (audit trail)
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);
