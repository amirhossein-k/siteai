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

import mongoose from "mongoose";
import Coupon from "@/models/Coupon";
import CouponUsage from "@/models/CouponUsage";
import Order from "@/models/Order";
import { sanitizePlainText } from "@/lib/sanitize";

// Code format: 3–50 chars of A-Za-z0-9_- (uppercased before storage/validation)
export const COUPON_CODE_REGEX = /^[A-Za-z0-9_-]{3,50}$/;

// --- Session 55: coupon audience (eligibility) ---

export type CouponEligibilityMode = "public" | "assigned_users" | "user_groups";

/**
 * Who may redeem the coupon. Embedded on the coupon doc — the claim path
 * already fetches the coupon by code, so eligibility is checked as pure JS on
 * that doc (zero extra DB round-trips).
 *   - mode "public"         → anyone (default; missing eligibility = public)
 *   - mode "assigned_users" → users in assignedUsers (ObjectId strings)
 *   - mode "user_groups"    → users in any group slug (groups not implemented
 *     yet — userGroupsOf() returns [], so group coupons are ineligible for
 *     everyone: FAIL-CLOSED).
 */
export interface CouponEligibility {
  mode: CouponEligibilityMode;
  assignedUsers: string[];
  groups: string[];
}

export const ELIGIBILITY_MODES: CouponEligibilityMode[] = [
  "public",
  "assigned_users",
  "user_groups",
];

/** Hard cap on assignedUsers — doubles as an admin-usability + scan-cost guard. */
export const ELIGIBILITY_ASSIGNED_USERS_MAX = 1000;
export const ELIGIBILITY_GROUPS_MAX = 50;
export const ELIGIBILITY_GROUP_MAX_LENGTH = 32;

const PUBLIC_ELIGIBILITY: CouponEligibility = {
  mode: "public",
  assignedUsers: [],
  groups: [],
};

/** Distinct Persian error for a valid-but-not-for-you coupon (never "invalid"). */
export function couponEligibilityErrorMessage(): string {
  return "این کد تخفیف برای شما قابل استفاده نیست";
}

/** Persian error when the global usage quota is exhausted. */
export function couponExhaustedErrorMessage(): string {
  return "سهمیه استفاده از این کد تخفیف تمام شده است";
}

/** Missing/invalid eligibility (old coupons, manual DB edits) → public. */
export function getCouponEligibility(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coupon: any
): CouponEligibility {
  const e = coupon?.eligibility;
  if (!e || !e.mode || !ELIGIBILITY_MODES.includes(e.mode)) {
    return PUBLIC_ELIGIBILITY;
  }
  return {
    mode: e.mode as CouponEligibilityMode,
    assignedUsers: Array.isArray(e.assignedUsers)
      ? e.assignedUsers.map(String)
      : [],
    groups: Array.isArray(e.groups) ? e.groups.map(String) : [],
  };
}

/**
 * Resolve the user's group slugs. NOT IMPLEMENTED YET (Session 55): returns []
 * so user_groups coupons are ineligible for everyone (fail-closed — a group
 * coupon can never be silently granted). Future sessions plug a real group
 * source (User field / separate Group collection / segment resolver) here;
 * no other coupon code changes are needed. Contract: return LOWERCASE slugs.
 */
export async function userGroupsOf(_userId: string): Promise<string[]> {
  void _userId; // keep the seam signature — a future group source consumes it
  return [];
}

/** Is `userId` (if any) allowed to redeem `coupon`? Pure JS + one resolver call. */
export async function isUserEligibleForCoupon(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coupon: any,
  userId: string | null | undefined
): Promise<boolean> {
  const e = getCouponEligibility(coupon);
  if (e.mode === "public") return true;
  if (!userId) return false; // non-public coupon without a user context → deny
  if (e.mode === "assigned_users") {
    return e.assignedUsers.some((id) => String(id) === String(userId));
  }
  if (e.mode === "user_groups") {
    const userGroups = await userGroupsOf(userId);
    return e.groups.some((g) => userGroups.includes(g));
  }
  return false; // unknown mode → fail-closed
}

/**
 * Validate + normalize an admin-submitted eligibility payload (POST/PUT).
 * Additive-only: `{ value: undefined }` when the field was omitted (PUT
 * partial update). Returns a 400-ready Persian error on invalid input.
 */
export function parseCouponEligibility(
  input: unknown
): { value: CouponEligibility | undefined } | { error: string } {
  if (input === undefined || input === null) return { value: undefined };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "شرایط استفاده از کد تخفیف نامعتبر است" };
  }
  const body = input as Record<string, unknown>;
  const { mode } = body;
  if (mode !== "public" && mode !== "assigned_users" && mode !== "user_groups") {
    return { error: "نوع مخاطب کد تخفیف نامعتبر است" };
  }

  // --- assignedUsers: array of valid ObjectIds, deduped, capped ---
  let assignedUsers: string[] = [];
  if (body.assignedUsers !== undefined) {
    if (!Array.isArray(body.assignedUsers)) {
      return { error: "لیست کاربران نامعتبر است" };
    }
    if (body.assignedUsers.length > ELIGIBILITY_ASSIGNED_USERS_MAX) {
      return {
        error: `لیست کاربران نمی‌تواند بیشتر از ${ELIGIBILITY_ASSIGNED_USERS_MAX} نفر باشد`,
      };
    }
    const seen = new Set<string>();
    for (const u of body.assignedUsers) {
      const s = String(u);
      if (!mongoose.Types.ObjectId.isValid(s)) {
        return { error: "شناسه کاربر انتخاب‌شده نامعتبر است" };
      }
      seen.add(s);
    }
    assignedUsers = [...seen];
  }

  // --- groups: array of lowercase slug strings, sanitized, deduped, capped ---
  let groups: string[] = [];
  if (body.groups !== undefined) {
    if (!Array.isArray(body.groups)) {
      return { error: "لیست گروه‌ها نامعتبر است" };
    }
    if (body.groups.length > ELIGIBILITY_GROUPS_MAX) {
      return {
        error: `لیست گروه‌ها نمی‌تواند بیشتر از ${ELIGIBILITY_GROUPS_MAX} مورد باشد`,
      };
    }
    const seen = new Set<string>();
    for (const g of body.groups) {
      const slug = sanitizePlainText(String(g))
        .trim()
        .toLowerCase()
        .slice(0, ELIGIBILITY_GROUP_MAX_LENGTH);
      if (!slug) return { error: "نام گروه نامعتبر است" };
      seen.add(slug);
    }
    groups = [...seen];
  }

  return { value: { mode, assignedUsers, groups } };
}

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
  eligibility?: CouponEligibility;
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
 *
 * `userId` (Session 55) — when provided and the coupon is NOT public, the
 * audience check runs here so the preview is eligibility-aware: a valid-but-
 * not-for-you coupon returns the distinct eligibility error instead of the
 * rules (a non-eligible user must never be told the coupon is "invalid" —
 * the coupon exists, it just isn't theirs). No userId (anonymous context)
 * skips the audience check.
 */
export async function validateCoupon(
  rawCode: string,
  userId?: string | null
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
  if (userId && !(await isUserEligibleForCoupon(coupon, userId))) {
    return { ok: false, error: couponEligibilityErrorMessage() };
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

  // --- Global usage pre-check (pure JS on the fetched doc; Session 55 flow:
  // usage-limit BEFORE eligibility, so an exhausted coupon never leaks its
  // audience). The authoritative enforcement stays the atomic claim below. ---
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, error: couponExhaustedErrorMessage() };
  }

  // --- Eligibility (Session 55): sits between usage-limit and minSubtotal per
  // the approved validation flow. Distinct error — never "invalid coupon".
  // Sub-second audience races (user just removed from a list) are accepted,
  // mirroring the documented startsAt/endsAt window race. ---
  if (!(await isUserEligibleForCoupon(coupon, userId))) {
    return { ok: false, error: couponEligibilityErrorMessage() };
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
      : couponExhaustedErrorMessage();
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
