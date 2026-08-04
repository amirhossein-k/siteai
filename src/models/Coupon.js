import mongoose from "mongoose";

/**
 * Coupon — order-level discount code (Session 39; Session 55 — audience).
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
 * Audience (Session 55) — WHO may redeem the code, embedded `eligibility`:
 *   - mode "public"        → anyone (default; existing coupons need NO
 *     migration — the checker treats a missing eligibility as public).
 *   - mode "assigned_users" → only the users listed in `assignedUsers`
 *     (ObjectId refs). Everyone else gets a distinct eligibility error, never
 *     "invalid coupon".
 *   - mode "user_groups"   → users belonging to any listed group slug. Groups
 *     are NOT implemented yet: the resolver (userGroupsOf in src/lib/coupons.ts)
 *     returns [] so a group coupon is ineligible for everyone — FAIL-CLOSED,
 *     never a silent grant. `groups` is stored as lowercase slug strings.
 *
 * The multikey indexes on eligibility.assignedUsers / eligibility.groups exist
 * ONLY for list/admin lookups (e.g. a future GET /api/coupons/mine). They are
 * never on the claim hot path — the claim already identifies the coupon by
 * code and the membership check is pure JS on the fetched doc.
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
    // Session 55: coupon audience (who may redeem the code).
    eligibility: {
      mode: {
        type: String,
        enum: ["public", "assigned_users", "user_groups"],
        default: "public",
      },
      assignedUsers: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        default: [],
      },
      groups: {
        type: [String],
        default: [],
      },
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

// Admin/list lookups only (e.g. "who can use this code"). Not on the claim path.
CouponSchema.index({ "eligibility.assignedUsers": 1 });
CouponSchema.index({ "eligibility.groups": 1 });

export default mongoose.models.Coupon || mongoose.model("Coupon", CouponSchema);
