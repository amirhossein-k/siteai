import mongoose from "mongoose";

const SupplierOrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
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
    name: { type: String, required: true },
    supplierPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const SupplierOrderSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    items: {
      type: [SupplierOrderItemSchema],
      required: true,
    },
    // جمع کل مبلغی که باید به این فروشنده بابت این زیرسفارش پرداخت بشه
    amountOwed: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "pending", // منتظر تأیید موجودی فروشنده
        "confirmed", // فروشنده موجودی رو تأیید کرد
        "rejected", // فروشنده موجودی نداشت
        "shipped", // فروشنده جنس رو ارسال کرد
        "delivered",
      ],
      default: "pending",
    },
    confirmedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    // آیا مبلغ این زیرسفارش به فروشنده واریز شده یا نه
    isPaidOut: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default mongoose.models.SupplierOrder ||
  mongoose.model("SupplierOrder", SupplierOrderSchema);
