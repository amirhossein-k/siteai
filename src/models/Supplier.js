import mongoose from "mongoose";

const SupplierSchema = new mongoose.Schema(
  {
    // کاربری که با نقش "supplier" لاگین می‌کنه
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    // پروفایل عمومی فروشگاه (Session 42) — این فیلدها به‌همراه businessName
    // تنها فیلدهایی هستند که در API عمومی /api/suppliers افشا می‌شوند.
    // بقیه فیلدها (contactPhone, bankAccount, telegramChatId, balance,
    // pendingReserve, user) هرگز نباید عمومی شوند.
    logo: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    contactPhone: {
      type: String,
      required: true,
    },
    // شماره کارت یا شبا برای واریز
    bankAccount: {
      cardNumber: { type: String, default: "" },
      iban: { type: String, default: "" },
      ownerName: { type: String, default: "" },
    },
    // آی‌دی چت تلگرام برای نوتیف سفارش جدید
    telegramChatId: {
      type: String,
      default: "",
    },
    // مانده‌ی حساب: مثبت یعنی تو (فروشگاه) به فروشنده بدهکاری
    balance: {
      type: Number,
      default: 0,
    },
    // مبلغ درخواست‌های تسویه‌ی در انتظار تأیید ادمین (رزرو شده، قابل برداشت نیست)
    // Invariant: pendingReserve <= balance. Released on approve (balance -=
    // amount) or reject (no balance change).
    pendingReserve: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.models.Supplier ||
  mongoose.model("Supplier", SupplierSchema);
