import mongoose from "mongoose";

/**
 * PurchaseOrder — store procurement (Session 82 Phase B).
 *
 * CRITICAL ACCOUNTING RULES (server-enforced):
 *  - Creating or paying a purchase NEVER creates inventory.
 *  - ONLY receiving creates stock + FIFO cost layers + an append-only
 *    InventoryMovement (type "receipt").
 *  - Payment is financially separate from receiving (amountPaid/paymentStatus
 *    on this doc; no separate AP ledger in v1 — designed so one can be added
 *    later without rewriting this schema).
 *  - Items are received against `quantity` (ordered); receivedQuantity can
 *    never exceed quantity (per-item atomic claim). Partial receiving is
 *    supported via `status: partially_received`.
 *  - A purchase may only be created against `sourcing: "purchased"` products —
 *    receiving NEVER silently converts a consignment product (Phase A
 *    invariant).
 *  - Unit cost comes from the PurchaseItem (admin-confirmed at order time),
 *    NEVER substituted from the current Product.supplierPrice.
 *  - Cancellation is only allowed with zero received inventory (received
 *    history is never destroyed; purchase returns are a later phase).
 *
 * Status machine:
 *   draft → ordered → partially_received → received
 *   draft/ordered → cancelled   (only when no item has receivedQuantity > 0)
 *
 * Concurrency: every inventory-relevant transition is a single-document atomic
 * findOneAndUpdate (standalone Mongo — no multi-document transactions). The
 * receive operation is idempotent via a per-operation `receiptKey` and each
 * product/layer update is guarded by its cost-layer `ref`.
 */
const PurchaseItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Snapshot at order time (products may be renamed later).
    name: { type: String, required: true },
    variantLabel: { type: String, default: "" },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    // Ordered − received = outstanding. Never exceeds quantity.
    receivedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    // CONFIRMED unit cost (admin-entered, never substituted from supplierPrice).
    unitCost: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const ReceiptSchema = new mongoose.Schema(
  {
    // Client-supplied idempotency key — one per logical receive operation.
    key: { type: String, required: true },
    items: [
      {
        itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
        quantity: { type: Number, required: true, min: 1 },
      },
      { _id: false },
    ],
    receivedAt: { type: Date, default: () => new Date() },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { _id: false }
);

const PurchaseOrderSchema = new mongoose.Schema(
  {
    number: {
      type: String,
      required: true,
      unique: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    purchaseDate: {
      type: Date,
      required: true,
    },
    reference: {
      type: String,
      default: "",
      maxlength: 200,
    },
    notes: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["draft", "ordered", "partially_received", "received", "cancelled"],
      default: "draft",
    },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    additionalCosts: { type: Number, default: 0, min: 0 },
    // total = subtotal − discount + additionalCosts
    total: { type: Number, required: true, min: 0 },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
    },
    amountPaid: { type: Number, default: 0, min: 0 },
    items: {
      type: [PurchaseItemSchema],
      required: true,
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    // Append-only receive journal — the idempotency + audit trail for receipts.
    receipts: {
      type: [ReceiptSchema],
      default: [],
    },
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReason: { type: String, default: "", maxlength: 500 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Purchase list filters + uniqueness
PurchaseOrderSchema.index({ supplier: 1, createdAt: -1 });
PurchaseOrderSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.PurchaseOrder ||
  mongoose.model("PurchaseOrder", PurchaseOrderSchema);
