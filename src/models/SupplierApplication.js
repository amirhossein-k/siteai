import mongoose from "mongoose";

/**
 * Session 67 — Public supplier application.
 *
 * A CUSTOMER requests to become a supplier by submitting an application.
 * The applicant's User role stays "customer" until an admin APPROVES it —
 * the public endpoint only creates this pending row and can NEVER assign
 * roles or touch the Supplier collection (self-role-assignment is impossible
 * by construction). Approval is admin-only and reuses the Session 66
 * change-role provisioning semantics (see src/lib/supplier-provision.ts).
 */
const SupplierApplicationSchema = new mongoose.Schema(
  {
    // The applicant (a customer account).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      // Capped to the Supplier.description maxlength (500) so an approval can
      // seed the Supplier document without a validation failure.
      maxlength: 500,
    },
    contactPhone: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // Admin decision metadata (set only on approve/reject).
    adminNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// ONE open application per user — a second "pending" row is rejected by
// E11000 (mapped to 409 «درخواست قبلی در انتظار بررسی است»). Decided rows
// are free so a rejected applicant may re-apply.
SupplierApplicationSchema.index(
  { user: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

// Admin queue: pending first, newest submitted first.
SupplierApplicationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.SupplierApplication ||
  mongoose.model("SupplierApplication", SupplierApplicationSchema);
