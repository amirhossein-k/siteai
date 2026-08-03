/**
 * Shared Atomic Coupon Helpers (Session 39)
 *
 * SINGLE SOURCE OF TRUTH for coupon validation, discount math, usage claims
 * and usage releases. Used by:
 *  - /api/checkout (validate + claim at order creation)
 *  - /api/coupons/validate (rules preview, no claim)
 *  - /api/admin/coupons (admin CRUD)
 *  - /api/payment/verify (release on NOK / failed payment)
 *  - /api/payment/cleanup (release on abandoned-payment cancel)
 *  - /api/admin/orders (release on admin cancel)
 *
 * Money-path invariants:
 *  - Checkout price revalidation (409) runs BEFORE coupon math, so a stale
 *    cart price can never bypass or inflate a discount.
 *  - totalAmount stays the payable amount → requestPayment/verifyPayment
 *    amounts are untouched.
 *  - SupplierOrder.amountOwed uses supplierPrice only → supplier payouts are
 *    insulated (platform absorbs the discount from its margin).
 *
 * Claim/release model (mirrors inventory reservation):
 *  - CLAIM at order creation (atomic, prevents overselling limited coupons).
 *  - RELEASE only through the payment failure/cancellation paths, idempotently,
 *    and only when a claim actually exists (releaseCouponUsage is a no-op for
 *    orders without a discount or already-released ones).
 */

import Coupon from "@/models/Coupon";
import CouponUsage from "@/models/CouponUsage";
import Order from "@/models/Order";

// Code format: 3–50 chars of A-Za-z0-9_- (uppercased before storage/validation)
export const COUPON_CODE_REGEX = /^[A-Za-z0-9_-]{3,50}$/;

/** Normalize a coupon code: uppercase + trim (done BEFORE validation/storage). */
export function normalizeCouponCode(code: string): string {
  return String(code || "").trim().toUpperCase();
}

export interface CouponDoc {
  _id: unknown;
  code: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotal: number;
  maxDiscount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  usageLimit: number;
  perUserLimit: number;
  usedCount: number;
}

export interface CouponValidateResult {
  ok: boolean;
  error?: string;
  coupon?: CouponDoc;
  /** pre-discount subtotal the discount was computed on */
  subtotal?: number;
  /** absolute toman discount */
  discount?: number;
  /** payable = subtotal − discount (never negative) */
  payable?: number;
}

/** Is the coupon currently within its active window (and active)? */
export function isCouponUsable(coupon: CouponDoc): boolean {
  if (coupon.isActive === false) return false;
  const now = new Date();
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return false;
  if (coupon.endsAt && now > new Date(coupon.endsAt)) return false;
  return true;
}

export function couponUnusableReason(coupon: CouponDoc): string {
  if (coupon.isActive === false) return "این کد تخفیف غیرفعال است";
  const now = new Date();
  if (coupon.startsAt && now < new Date(coupon.startsAt))
    return "این کد تخفیف هنوز فعال نشده است";
  if (coupon.endsAt && now > new Date(coupon.endsAt))
    return "این کد تخفیف منقضی شده است";
  return "این کد تخفیف قابل استفاده نیست";
}

/**
 * Compute the absolute toman discount for a subtotal.
 * percent → floor(subtotal × value / 100), capped by maxDiscount (if > 0)
 * fixed   → min(value, subtotal) — never negative totals
 * Result is always clamped to [0, subtotal].
 */
export function computeCouponDiscount(
  coupon: CouponDoc,
  subtotal: number
): number {
  let discount: number;
  if (coupon.type === "percent") {
    discount = Math.floor((subtotal * coupon.value) / 100);
    if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  } else {
    discount = coupon.value;
  }
  return Math.max(0, Math.min(discount, subtotal));
}

/**
 * Validate a coupon against its rules (no DB state change). Used by the
 * validate endpoint (rules preview). The checkout route calls
 * claimCouponForOrder() instead, which validates + atomically claims.
 */
export async function validateCoupon(
  rawCode: string
): Promise<CouponValidateResult> {
  const code = normalizeCouponCode(rawCode);
  if (!COUPON_CODE_REGEX.test(code)) {
    return { ok: false, error: "کد تخفیف نامعتبر است" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coupon: any = await Coupon.findOne({ code }).lean();
  if (!coupon) return { ok: false, error: "کد تخفیف معتبر نیست" };
  if (!isCouponUsable(coupon)) {
    return { ok: false, error: couponUnusableReason(coupon) };
  }
  return { ok: true, coupon };
}

/**
 * Validate the coupon AND atomically claim one unit of usage (global + per-user).
 * Called at checkout AFTER price revalidation, BEFORE Order.create.
 *
 * - Global claim: findOneAndUpdate({ usedCount < usageLimit }) $inc — atomic.
 * - Per-user claim: conditional upsert on CouponUsage (unique { coupon, user })
 *   with count < perUserLimit; E11000 on a concurrent first-insert retries the
 *   increment without upsert.
 *
 * Returns ok:false with a Persian message when the coupon is invalid, out of
 * quota, or the user has hit their per-user limit. On success the caller MUST
 * persist the order (or release via releaseCouponClaim on rollback).
 */
export async function claimCouponForOrder(
  rawCode: string,
  userId: string,
  subtotal: number
): Promise<CouponValidateResult> {
  const code = normalizeCouponCode(rawCode);
  if (!COUPON_CODE_REGEX.test(code)) {
    return { ok: false, error: "کد تخفیف نامعتبر است" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coupon: any = await Coupon.findOne({ code }).lean();
  if (!coupon) return { ok: false, error: "کد تخفیف معتبر نیست" };
  if (!isCouponUsable(coupon)) {
    return { ok: false, error: couponUnusableReason(coupon) };
  }
  if (coupon.minSubtotal > 0 && subtotal < coupon.minSubtotal) {
    return {
      ok: false,
      error: `حداقل مبلغ سبد خرید برای این کد تخفیف ${coupon.minSubtotal.toLocaleString(
        "fa-IR"
      )} تومان است`,
    };
  }

  // --- Global atomic claim ---
  // isActive is re-checked in the claim query so a deactivation landing between
  // the read above and the claim cannot slip through. (The startsAt/endsAt
  // window is NOT re-checked here — a sub-second expiry race is accepted; the
  // read above already validated the window.)
  const globalQuery: Record<string, unknown> = { _id: coupon._id, isActive: true };
  if (coupon.usageLimit > 0) globalQuery.usedCount = { $lt: coupon.usageLimit };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimed: any = await Coupon.findOneAndUpdate(globalQuery, {
    $inc: { usedCount: 1 },
  });
  if (!claimed) {
    // Distinguish exhausted vs deactivated for an accurate message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh: any = await Coupon.findById(coupon._id).lean();
    const error = fresh && !isCouponUsable(fresh)
      ? couponUnusableReason(fresh)
      : "سهمیه استفاده از این کد تخفیف تمام شده است";
    return { ok: false, error };
  }

  // --- Per-user atomic claim (E11000-safe) ---
  try {
    const usageFilter: Record<string, unknown> = { coupon: coupon._id, user: userId };
    if (coupon.perUserLimit > 0) usageFilter.count = { $lt: coupon.perUserLimit };
    // NOTE: the conditional filter `count < perUserLimit` guarantees the
    // post-increment count is ≤ limit — no post-check needed. If the user is
    // already at their limit (or a concurrent first-insert race occurs), the
    // upsert violates the unique { coupon, user } index → E11000 → catch below.
    await CouponUsage.findOneAndUpdate(
      usageFilter,
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );
  } catch (err) {
    // E11000 on a concurrent first-insert → retry the increment without upsert.
    // Any other error → roll back the global claim and rethrow.
    const isDup =
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: number }).code === 11000;
    if (!isDup) {
      await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: -1 } });
      throw err;
    }
    const retryFilter: Record<string, unknown> = {
      coupon: coupon._id,
      user: userId,
    };
    if (coupon.perUserLimit > 0) retryFilter.count = { $lt: coupon.perUserLimit };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retried: any = await CouponUsage.findOneAndUpdate(
      retryFilter,
      { $inc: { count: 1 } },
      { new: true }
    );
    if (!retried) {
      await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: -1 } });
      return { ok: false, error: "شما قبلاً از این کد تخفیف استفاده کرده‌اید" };
    }
  }

  const discount = computeCouponDiscount(coupon, subtotal);
  return {
    ok: true,
    coupon,
    subtotal,
    discount,
    payable: Math.max(0, subtotal - discount),
  };
}

/**
 * Roll back a claim that was never persisted (checkout internal rollback —
 * e.g., Order.create failed after the claim). NOT idempotent by design; the
 * caller must only invoke it for claims it actually made.
 */
export async function releaseCouponClaim(couponId: string, userId: string) {
  await Coupon.findByIdAndUpdate(couponId, { $inc: { usedCount: -1 } });
  await CouponUsage.updateOne(
    { coupon: couponId, user: userId },
    { $inc: { count: -1 } }
  );
}

/**
 * Release coupon usage for an order. IDEMPOTENT and only acts when a claim
 * actually exists:
 *   - No-op for orders without a discount subdoc (or a released one).
 *   - Atomic claim on Order: only the first caller flips discount.released,
 *     then decrements global usedCount + per-user CouponUsage.
 *
 * Called from the payment failure/cancellation paths (verify NOK/failed,
 * cleanup, admin cancel) — the same flows that restore stock. A REFUNDED order
 * keeps its usage (the coupon was legitimately consumed).
 */
export async function releaseCouponUsage(orderId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order: any = await Order.findById(orderId)
      .select("discount customer")
      .lean();
    if (
      !order ||
      !order.discount ||
      !order.discount.couponId ||
      order.discount.released === true
    ) {
      return; // no claim exists (or already released) — idempotent no-op
    }

    // Atomic claim: only the first caller releases.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Order.findOneAndUpdate(
      { _id: orderId, "discount.released": { $ne: true } },
      { $set: { "discount.released": true } },
      { new: true }
    ).lean();

    if (!claimed || !claimed.discount?.couponId) return;

    await Coupon.findByIdAndUpdate(claimed.discount.couponId, {
      $inc: { usedCount: -1 },
    });
    if (order.customer) {
      await CouponUsage.updateOne(
        { coupon: claimed.discount.couponId, user: order.customer },
        { $inc: { count: -1 } }
      );
    }
    console.log(`[Coupon] Released usage for order ${orderId}`);
  } catch (error) {
    console.error(`[Coupon] Failed to release usage for order ${orderId}:`, error);
  }
}
