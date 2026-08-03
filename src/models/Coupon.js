import mongoose from "mongoose";

/**
 * Coupon — order-level discount code (Session 39).
 *
 * Scope: applies to the entire validated checkout subtotal (no per-product /
 * per-category scoping — deferred to a future marketing rules engine).
 *
 * Types:
 *   - percent: value = discount percent (1–100); maxDiscount (toman) caps the
 *     absolute discount amount (0 = no cap).
 *   - fixed:   value = flat toman amount off the subtotal (never negative
 *     totals — clamped to the subtotal at apply time).
 *
 * Usage accounting:
 *   - `usedCount` = global atomic counter (incremented on claim, decremented
 *     on release). usageLimit 0 = unlimited.
 *   - Per-user limits are tracked in the separate CouponUsage collection
 *     ({ coupon, user, count }, unique { coupon, user }) with E11000-based
 *     atomic upserts.
 *
 * A coupon is CLAIMED at order creation (same reservation model as inventory)
 * and RELEASED only through the payment failure/cancellation paths (verify NOK,
 * verify failed, 24h cleanup, admin cancel) via the idempotent
 * releaseCouponUsage() helper in src/lib/coupons.ts.
 */
const CouponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 50,
      match: /^[A-Za-z0-9_-]{3,50}$/,
    },
    type: {
      type: String,
      enum: ["percent", "fixed"],
      required: true,
    },
    // percent → discount percent; fixed → toman amount
    value: {
      type: Number,
      required: true,
      min: 1,
    },
    // minimum pre-discount subtotal required (0 = no minimum)
    minSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    // absolute cap for percent coupons (0 = no cap)
    maxDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Session 44: public marketing coupons (shown on the storefront + checkout
    // picker). Private coupons (default) stay hidden — only isPublic coupons
    // are ever exposed via GET /api/coupons/public.
    isPublic: {
      type: Boolean,
      default: false,
    },
    // total allowed uses (0 = unlimited)
    usageLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    // max uses per customer (0 = unlimited)
    perUserLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    // global usage counter (atomic claim/release)
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.models.Coupon || mongoose.model("Coupon", CouponSchema);
