import mongoose from "mongoose";

/**
 * AccountingConfig — single-document store-level accounting settings (Session 82).
 *
 * The document is a singleton (one row, `_id: "accounting"`):
 *  - cutoverDate: the Accounting Cutover Date — the point where the new
 *    accounting-grade costing becomes authoritative. Orders created before it
 *    keep the Session 81 immutable snapshot COGS; layers created on/after it
 *    are authoritative FIFO layers.
 *  - valuationMethod: locked to "fifo" in v1 (per the approved Session 82
 *    decision — no weighted average).
 *  - inventoryInitialized: set to true exactly once by the initialization
 *    wizard, which creates the confirmed opening-balance cost layers.
 *  - initializedAt / initializedBy: audit trail of that event.
 */
const AccountingConfigSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: "accounting",
    },
    cutoverDate: {
      type: Date,
      default: null,
    },
    valuationMethod: {
      type: String,
      enum: ["fifo"],
      default: "fifo",
    },
    inventoryInitialized: {
      type: Boolean,
      default: false,
    },
    initializedAt: {
      type: Date,
      default: null,
    },
    initializedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.AccountingConfig ||
  mongoose.model("AccountingConfig", AccountingConfigSchema);
