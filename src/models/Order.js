import mongoose from "mongoose";

const OrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    // --- Immutable variant snapshot (present only for variant orders) ---
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    sku: { type: String, default: "" },
    variantLabel: { type: String, default: "" },
    // Variant/product image snapshot for display (best-effort, empty for old orders)
    image: { type: String, default: "" },
    // اسنپ‌شات از اطلاعات لحظه‌ی خرید، تا اگه بعدا محصول تغییر کرد سفارش قدیمی خراب نشه
    name: { type: String, required: true },
    // قیمت واحدی که مشتری واقعاً پرداخت کرده (برای تخفیف‌دارها = قیمت نهایی بعد از تخفیف)
    price: { type: Number, required: true },
    // --- Discount snapshot (Session 77 — additive, absent on old orders) ---
    // price = ACTUAL effective unit price paid; originalPrice = pre-discount
    // unit price (== price when no discount was active); discountAmount =
    // originalPrice − price (0 when no discount). Immutable — later discount
    // changes or expiration never alter existing orders.
    originalPrice: { type: Number, default: null },
    discountAmount: { type: Number, default: 0 },
    supplierPrice: { type: Number, required: true }, // قیمت واحد از فروشنده
    // --- FIFO unit cost snapshot (Session 82 Phase C — additive, absent on
    // pre-cutover and consignment orders) ---
    // For purchased-sourcing products sold AFTER the accounting cutover, this
    // is the authoritative COGS snapshot: the exact weighted FIFO cost consumed
    // from the inventory layers at checkout (consumedCost / quantity).
    // supplierPrice stays untouched for historical compatibility. Reports use
    // fifoUnitCost when present, else the supplierPrice snapshot. Immutable —
    // later purchases/receipts never alter an existing order.
    fifoUnitCost: { type: Number, default: null },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Pre-discount subtotal (Session 39 — absent on old orders).
    subtotalAmount: {
      type: Number,
      default: null,
      min: 0,
    },
    // Coupon applied at order creation (Session 39 — absent on old orders).
    // amount = absolute toman discount; totalAmount = subtotal − amount.
    // `released` flips to true only via the idempotent releaseCouponUsage().
    discount: {
      type: new mongoose.Schema(
        {
          code: { type: String, default: "" },
          couponId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Coupon",
            default: null,
          },
          type: { type: String, enum: ["percent", "fixed"], default: "percent" },
          value: { type: Number, default: 0 },
          amount: { type: Number, default: 0 },
          released: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: null,
    },
    shippingAddress: {
      fullName: String,
      phone: String,
      address: String,
      postalCode: String,
    },
    // --- Shipping fulfillment metadata (Session 57) ---
    // Additive — old orders render without tracking (all fields defaulted).
    // `shipping.*At` are denormalized convenience timestamps; statusHistory
    // remains the immutable source of truth for transitions. `provider` is
    // the courier name — the future courier-integration seam.
    shipping: {
      provider: { type: String, default: "" },
      trackingCode: { type: String, default: "" },
      shippedAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
      note: { type: String, default: "" },
    },
    payment: {
      status: {
        type: String,
        enum: ["pending", "paid", "failed", "canceled", "refunded"],
        default: "pending",
      },
      method: {
        type: String,
        enum: ["zarinpal", "manual"],
        default: "zarinpal",
      },
      authority: { type: String, default: "" }, // شناسه authority از زرین‌پال
      refId: { type: String, default: "" }, // کد پیگری تراکنش از زرین‌پال
      cardPan: { type: String, default: "" }, // چهار رقم آخر کارت
      paidAt: { type: Date, default: null },
      // Transient claim token for in-flight payment retries (serializes
      // concurrent retries of the same order — see /api/payment/retry).
      // Present only while a retry is being processed; $unset on completion.
      retryToken: { type: String },
    },
    // وضعیت کلی سفارش، مطابق جریانی که تعریف کردیم
    status: {
      type: String,
      enum: [
        "pending_payment", // ثبت شده، منتظر پرداخت
        "processing", // پرداخت شده، در حال ارسال به فروشنده(ها)
        "confirmed", // همه‌ی فروشنده‌ها موجودی رو تأیید کردن
        "shipped", // جنس ارسال شده
        "delivered", // تحویل مشتری
        "cancelled",
      ],
      default: "pending_payment",
    },
    // آیا موجودی برای این سفارش بازگردانی شده؟ (جلوگیری از بازگردانی دوباره)
    stockRestored: {
      type: Boolean,
      default: false,
    },
    // اطلاعات بازپرداخت (فقط برای سفارش‌های با payment.status=refunded)
    refund: {
      reason: { type: String, default: "" },
      refundedAt: { type: Date, default: null },
      refundedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    // تاریخچه‌ی کامل تغییر وضعیت، برای پیگیری دقیق سفارش
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        note: String,
        // Actor who performed the transition (customer/admin/supplier/system).
        // Session 46: customer self-cancellation records actor: "customer" with
        // the machine-readable note "customer_cancelled" (raw customer input is
        // never stored here). Additive — old entries render as absent.
        actor: String,
      },
    ],
  },
  { timestamps: true }
);

// Admin orders list: status-filtered, newest-first (Session 57).
OrderSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.Order || mongoose.model("Order", OrderSchema);
