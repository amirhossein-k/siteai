import mongoose from "mongoose";

/**
 * CouponUsage — per-user coupon usage counter (Session 39).
 *
 * A row is { coupon, user, count }. The unique { coupon, user } index makes the
 * first-use upsert E11000-atomic (mirrors the Wishlist/Notification dedupe
 * pattern): concurrent first claims can't double-insert, and limit enforcement
 * is a conditional findOneAndUpdate on `count < perUserLimit`.
 */
const CouponUsageSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

CouponUsageSchema.index({ coupon: 1, user: 1 }, { unique: true });

export default mongoose.models.CouponUsage ||
  mongoose.model("CouponUsage", CouponUsageSchema);
