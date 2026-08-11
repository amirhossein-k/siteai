/**
 * Product Discount / Sale Pricing — SINGLE SOURCE OF TRUTH.
 *
 * Owns the product-discount math, time semantics, public metadata shape and
 * admin payload validation. Every consumer (public products API, product page
 * Server Component, checkout, homepage discounted rail, admin form) must call
 * `getEffectivePrice` — discount mathematics is NEVER duplicated across
 * routes/components.
 *
 * Money conventions mirror src/lib/coupons.ts (integer Toman, no decimals):
 *   - percent → discountAmount = Math.floor(price × value / 100)
 *   - fixed   → discountAmount = Math.min(value, price)  (clamped)
 *   - finalPrice = originalPrice − discountAmount (never negative)
 *
 * Time semantics mirror Coupon.isCouponUsable:
 *   - Dates are stored as UTC (Mongo Date); evaluation is server-side only.
 *   - start boundary INCLUSIVE (startsAt <= now), end boundary EXCLUSIVE
 *     (now < endsAt).
 *   - startsAt == null → active immediately when enabled.
 *   - endsAt   == null → no expiration.
 *   - isActive === false → never active (master switch).
 *
 * The client is never authoritative: `parseProductDiscount` validates the
 * admin payload server-side, and checkout re-computes the effective price
 * from the freshly read DB product (never from a client number).
 */

// --- Public metadata (the ONLY discount data ever exposed on public shapes) ---
export interface PublicDiscountMetadata {
  type: "percent" | "fixed";
  value: number;
  /** Percentage shown on badges: configured value for percent, computed for fixed. */
  percent: number;
  /** Absolute toman reduction on the relevant unit price. */
  amount: number;
  startsAt: string | null;
  endsAt: string | null;
}

export type ProductDiscountType = "percent" | "fixed";

/** Raw stored/admin-submitted discount (Dates may be Date | ISO string). */
export interface ProductDiscountInput {
  type?: ProductDiscountType;
  value?: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  isActive?: boolean;
}

/** Normalized discount as persisted on Product.discount. */
export interface StoredProductDiscount {
  type: ProductDiscountType;
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export interface EffectivePrice {
  /** Is the discount currently active (enabled + in-window) at `now`? */
  active: boolean;
  originalPrice: number;
  discountType: ProductDiscountType | null;
  discountValue: number;
  discountAmount: number;
  finalPrice: number;
  discountPercent: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

export const DISCOUNT_PERCENT_MIN = 1;
export const DISCOUNT_PERCENT_MAX = 90;

const NONE = (originalPrice: number): EffectivePrice => ({
  active: false,
  originalPrice,
  discountType: null,
  discountValue: 0,
  discountAmount: 0,
  finalPrice: Math.max(0, originalPrice),
  discountPercent: 0,
  startsAt: null,
  endsAt: null,
});

function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The authoritative effective-price computation. Pure + clock-injectable for
 * deterministic tests. Returns `active: false` (finalPrice = originalPrice)
 * for: missing discount, disabled discount, future discount (now < startsAt),
 * expired discount (now >= endsAt). Never returns a negative finalPrice.
 */
export function getEffectivePrice(
  originalPrice: number,
  discount: ProductDiscountInput | null | undefined,
  now: Date = new Date()
): EffectivePrice {
  const safePrice = Math.max(0, originalPrice);
  if (!discount || typeof discount !== "object") return NONE(safePrice);
  if (discount.isActive === false) return NONE(safePrice);

  const startsAt = normalizeDate(discount.startsAt);
  const endsAt = normalizeDate(discount.endsAt);
  if (startsAt && now < startsAt) return NONE(safePrice);
  if (endsAt && !(now < endsAt)) return NONE(safePrice);

  const type: ProductDiscountType = discount.type === "fixed" ? "fixed" : "percent";
  const value = Math.max(0, Number(discount.value) || 0);

  const discountAmount =
    type === "fixed"
      ? Math.min(value, safePrice)
      : Math.floor((safePrice * value) / 100);
  const finalPrice = Math.max(0, safePrice - discountAmount);
  const discountPercent =
    type === "fixed"
      ? safePrice > 0
        ? Math.round((discountAmount / safePrice) * 100)
        : 0
      : value;

  return {
    active: true,
    originalPrice: safePrice,
    discountType: type,
    discountValue: value,
    discountAmount,
    finalPrice,
    discountPercent,
    startsAt,
    endsAt,
  };
}

/** Active-only public metadata (null for inactive/future/expired — never leaks
 *  the stored future/expired configuration to public consumers). */
export function toPublicDiscount(
  effective: EffectivePrice
): PublicDiscountMetadata | null {
  if (!effective.active || !effective.discountType) return null;
  return {
    type: effective.discountType,
    value: effective.discountValue,
    percent: effective.discountPercent,
    amount: effective.discountAmount,
    startsAt: effective.startsAt ? effective.startsAt.toISOString() : null,
    endsAt: effective.endsAt ? effective.endsAt.toISOString() : null,
  };
}

/** Enrich a public/API product row with effectivePrice + active-only discount
 *  metadata (used by list + detail paths; does NOT touch variants). */
export function applyEffectivePricing<T extends { price: number }>(
  product: T & { discount?: unknown }
): T & { effectivePrice: number; discount: PublicDiscountMetadata | null } {
  const effective = getEffectivePrice(product.price, product.discount as ProductDiscountInput | undefined);
  return {
    ...product,
    effectivePrice: effective.finalPrice,
    discount: toPublicDiscount(effective),
  };
}

/**
 * Validate + normalize an admin-submitted discount payload (POST/PUT).
 *
 * Discriminated result (matches the project's `{ ok, error }` convention):
 *   - ok:true  with `value: undefined`  → field omitted (PUT partial update —
 *     the caller must leave the stored discount untouched);
 *   - ok:true  with `value: null`       → explicitly cleared (discount removed);
 *   - ok:true  with `value: StoredProductDiscount` → valid config;
 *   - ok:false with a Persian `error`   → 400-ready.
 *
 * `basePrice` is the product's applicable unit price (the min active variant
 * price for variant products) — the fixed-discount «must be less than price»
 * rule is enforced against it.
 */
export function parseProductDiscount(
  input: unknown,
  basePrice: number
):
  | { ok: true; value: StoredProductDiscount | null | undefined }
  | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: undefined };
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "مقدار تخفیف نامعتبر است" };
  }
  const body = input as Record<string, unknown>;

  const type = body.type;
  if (type !== "percent" && type !== "fixed") {
    return { ok: false, error: "نوع تخفیف باید درصدی یا مبلغ ثابت باشد" };
  }

  const rawValue = body.value;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return { ok: false, error: "مقدار تخفیف نامعتبر است" };
  }
  const value = Math.floor(rawValue);

  if (type === "percent") {
    if (!Number.isInteger(rawValue) || value < DISCOUNT_PERCENT_MIN || value > DISCOUNT_PERCENT_MAX) {
      return { ok: false, error: `درصد تخفیف باید بین ${DISCOUNT_PERCENT_MIN} تا ${DISCOUNT_PERCENT_MAX} باشد` };
    }
  } else {
    // fixed: positive whole Toman, strictly less than the applicable price
    if (!Number.isInteger(rawValue) || value < 1) {
      return { ok: false, error: "مبلغ تخفیف باید عدد صحیح بزرگ‌تر از صفر باشد" };
    }
    if (!(value < basePrice)) {
      return { ok: false, error: "مبلغ تخفیف باید کمتر از قیمت محصول باشد" };
    }
  }

  const parseDate = (key: string): Date | null => {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === "") return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    if (typeof raw !== "string") return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const startsAt = parseDate("startsAt");
  const endsAt = parseDate("endsAt");
  if (body.startsAt !== undefined && body.startsAt !== null && body.startsAt !== "" && !startsAt) {
    return { ok: false, error: "تاریخ شروع تخفیف نامعتبر است" };
  }
  if (body.endsAt !== undefined && body.endsAt !== null && body.endsAt !== "" && !endsAt) {
    return { ok: false, error: "تاریخ پایان تخفیف نامعتبر است" };
  }
  if (startsAt && endsAt && !(startsAt < endsAt)) {
    return { ok: false, error: "تاریخ پایان باید بعد از شروع باشد" };
  }

  return {
    ok: true as const,
    value: {
      type,
      value,
      startsAt,
      endsAt,
      isActive: typeof body.isActive === "boolean" ? body.isActive : true,
    },
  };
}
