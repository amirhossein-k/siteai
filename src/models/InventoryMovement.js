import mongoose from "mongoose";

/**
 * Inventory Movement — IMMUTABLE, APPEND-ONLY audit ledger (Session 82).
 *
 * Every physical/ownership change to inventory is recorded here and can be
 * traced to its source. Product.stock stays as the fast-access cache; this
 * collection is the historical source of truth for inventory movement and
 * cost.
 *
 * Movement types:
 *  - opening_balance      — cutover initialization (confirmed opening cost)
 *  - receipt              — purchase receipt (creates cost layers)
 *  - sale                 — checkout consumed FIFO cost layers
 *  - return_restock       — customer refund restored units to their layers
 *  - cancellation_restock — cancelled/failed order restored units
 *  - purchase_return      — store returned goods to the supplier
 *  - adjustment           — manual stock adjustment (post-cutover, required)
 *  - sourcing_change      — consignment↔purchased ownership conversion
 *
 * INVARIANT: rows are never updated or deleted. Corrections are new rows
 * (adjustment/correction) referencing the original via sourceRef.
 */
const InventoryMovementSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: [
        "opening_balance",
        "receipt",
        "sale",
        "return_restock",
        "cancellation_restock",
        "purchase_return",
        "adjustment",
        "sourcing_change",
      ],
      required: true,
    },
    // Signed quantity moved (+receipt / -sale). Never 0.
    quantity: {
      type: Number,
      required: true,
    },
    // Unit cost of the layer(s) involved (Toman, whole numbers).
    unitCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    // totalCost = |quantity| × unitCost (snapshot for audit).
    totalCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Source identifier: order item id, purchase item id, adjustment id, or
    // the opening-balance key. Keeps every movement traceable.
    sourceRef: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
      maxlength: 500,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Per-product history (movements query + FIFO audit), type filters, source lookups
InventoryMovementSchema.index({ product: 1, createdAt: 1 });
InventoryMovementSchema.index({ type: 1, createdAt: -1 });
InventoryMovementSchema.index({ sourceRef: 1 });

export default mongoose.models.InventoryMovement ||
  mongoose.model("InventoryMovement", InventoryMovementSchema);
