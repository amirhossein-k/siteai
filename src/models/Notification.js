import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    // گیرنده‌ی نوتیف — می‌تونه مشتری، فروشنده (از طریق user) یا ادمین باشه
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "new_order", // برای فروشنده: سفارش جدید رسید
        "order_confirmed", // برای مشتری/ادمین: فروشنده موجودی رو تأیید کرد
        "order_rejected", // برای فروشنده: سفارش رد شد
        "order_shipped",
        "order_delivered",
        "order_cancelled", // برای مشتری: سفارش لغو شد (ادمین)
        "payment_paid", // برای مشتری: پرداخت موفق
        "payment_failed", // برای مشتری: پرداخت ناموفق
        "payment_cancelled", // برای مشتری: لغو پرداخت در درگاه
        "order_refunded", // برای مشتری: بازپرداخت انجام شد
        "review_replied", // برای مشتری: فروشنده به دیدگاهش پاسخ داد (Session 37)
        "payout_sent", // برای فروشنده: پول واریز شد
        "payout_approved", // برای فروشنده: درخواست تسویه تأیید شد (Session 45)
        "payout_rejected", // برای فروشنده: درخواست تسویه رد شد (Session 45)
        "new_review", // برای فروشنده: دیدگاه جدیدی برای محصولش ثبت شد (Session 45)
      ],
      required: true,
    },
    // دسته‌بندی برای فیلتر/تب‌های صندوق ورودی
    category: {
      type: String,
      enum: ["order", "payment", "payout", "system"],
      default: "order",
    },
    message: {
      type: String,
      required: true,
    },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    // لینک عمیق — مثلاً "/orders/<id>" یا "/supplier/orders/<id>"
    link: {
      type: String,
      default: "",
    },
    // کلید یکتای رویداد برای حذف تکراری: "order_<id>_<event>"
    // ایندکس یکتای جزئی {recipient, notificationKey} اجازه‌ی درج تکراری نمی‌دهد.
    notificationKey: {
      type: String,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
    // آیا از طریق ربات تلگرام هم ارسال شده
    sentToTelegram: {
      type: Boolean,
      default: false,
    },
    // متادیتای اضافه برای کانال‌های آینده (ایمیل/SMS/پوش) و تمپلیت‌ها
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// --- Indexes (Session 36) ---
// صندوق ورودی کاربر (جدیدترین اول)
NotificationSchema.index({ recipient: 1, createdAt: -1 });
// شمارش خوانده‌نشده‌ها
NotificationSchema.index({ recipient: 1, isRead: 1 });
// حذف تکراری: یک نوتیفیکیشن به‌ازای هر (گیرنده، کلید رویداد).
// ایندکس جزئی → اسناد قدیمی بدون notificationKey از قید یکتایی مستثنی هستند.
NotificationSchema.index(
  { recipient: 1, notificationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { notificationKey: { $type: "string" } },
  }
);

export default mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);
