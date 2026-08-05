import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  couponFindOne,
  couponFindOneAndUpdate,
  couponFindById,
  couponFindByIdAndUpdate,
  usageFindOneAndUpdate,
  usageUpdateOne,
  orderFindById,
  orderFindOneAndUpdate,
} = vi.hoisted(() => ({
  couponFindOne: vi.fn(),
  couponFindOneAndUpdate: vi.fn(),
  couponFindById: vi.fn(),
  couponFindByIdAndUpdate: vi.fn(),
  usageFindOneAndUpdate: vi.fn(),
  usageUpdateOne: vi.fn(),
  orderFindById: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/models/Coupon", () => ({
  default: {
    findOne: couponFindOne,
    findOneAndUpdate: couponFindOneAndUpdate,
    findById: couponFindById,
    findByIdAndUpdate: couponFindByIdAndUpdate,
  },
}));
vi.mock("@/models/CouponUsage", () => ({
  default: { findOneAndUpdate: usageFindOneAndUpdate, updateOne: usageUpdateOne },
}));
vi.mock("@/models/Order", () => ({
  default: { findById: orderFindById, findOneAndUpdate: orderFindOneAndUpdate },
}));

import type { CouponDoc } from "@/lib/coupons";
import {
  claimCouponForOrder,
  computeCouponDiscount,
  couponEligibilityErrorMessage,
  couponExhaustedErrorMessage,
  couponUnusableReason,
  COUPON_CODE_REGEX,
  getCouponEligibility,
  isCouponUsable,
  isUserEligibleForCoupon,
  normalizeCouponCode,
  parseCouponEligibility,
  releaseCouponUsage,
  validateCoupon,
} from "@/lib/coupons";

const COUPON_ID = "c".repeat(24);
const USER_ID = "f".repeat(24); // must be valid hex (used in ObjectId validation)

function makeCoupon(overrides: Partial<CouponDoc> = {}): CouponDoc {
  return {
    _id: COUPON_ID,
    code: "SAVE10",
    type: "percent",
    value: 10,
    minSubtotal: 0,
    maxDiscount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    usageLimit: 0,
    perUserLimit: 0,
    usedCount: 0,
    ...overrides,
  };
}

/** Query-like stub for `.lean()`-chained model calls. */
function leanOf(value: unknown) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

/** Query-like stub for `.select(...).lean()` chains. */
function selectOf(query: unknown) {
  return { select: () => query };
}

beforeEach(() => {
  vi.clearAllMocks();
  // releaseCouponUsage logs on success; keep the suite output readable.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("normalizeCouponCode + COUPON_CODE_REGEX", () => {
  it("trims and uppercases codes", () => {
    expect(normalizeCouponCode(" save10 ")).toBe("SAVE10");
    expect(normalizeCouponCode("")).toBe("");
  });

  it("validates the code format (3-50 of A-Za-z0-9_-)", () => {
    expect(COUPON_CODE_REGEX.test("SAVE10")).toBe(true);
    expect(COUPON_CODE_REGEX.test("a_b-c")).toBe(true);
    expect(COUPON_CODE_REGEX.test("AB")).toBe(false);
    expect(COUPON_CODE_REGEX.test("has space")).toBe(false);
    expect(COUPON_CODE_REGEX.test("کد")).toBe(false);
    expect(COUPON_CODE_REGEX.test("a".repeat(51))).toBe(false);
  });
});

describe("isCouponUsable + couponUnusableReason", () => {
  it("is usable when active with no window", () => {
    expect(isCouponUsable(makeCoupon())).toBe(true);
  });

  it("is unusable when inactive", () => {
    expect(isCouponUsable(makeCoupon({ isActive: false }))).toBe(false);
    expect(couponUnusableReason(makeCoupon({ isActive: false }))).toBe(
      "این کد تخفیف غیرفعال است"
    );
  });

  it("is unusable before startsAt", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isCouponUsable(makeCoupon({ startsAt: future }))).toBe(false);
    expect(couponUnusableReason(makeCoupon({ startsAt: future }))).toBe(
      "این کد تخفیف هنوز فعال نشده است"
    );
  });

  it("is unusable after endsAt", () => {
    const past = new Date(Date.now() - 60_000);
    expect(isCouponUsable(makeCoupon({ endsAt: past }))).toBe(false);
    expect(couponUnusableReason(makeCoupon({ endsAt: past }))).toBe(
      "این کد تخفیف منقضی شده است"
    );
  });

  it("falls back to a generic reason", () => {
    expect(couponUnusableReason(makeCoupon())).toBe(
      "این کد تخفیف قابل استفاده نیست"
    );
  });
});

describe("computeCouponDiscount", () => {
  it("applies percent with floor", () => {
    expect(computeCouponDiscount(makeCoupon({ value: 10 }), 100000)).toBe(10000);
    expect(computeCouponDiscount(makeCoupon({ value: 10 }), 999)).toBe(99);
  });

  it("caps percent discount at maxDiscount", () => {
    const coupon = makeCoupon({ value: 50, maxDiscount: 20000 });
    expect(computeCouponDiscount(coupon, 100000)).toBe(20000);
  });

  it("applies fixed discount clamped to the subtotal", () => {
    const coupon = makeCoupon({ type: "fixed", value: 3000 });
    expect(computeCouponDiscount(coupon, 5000)).toBe(3000);
    expect(computeCouponDiscount(coupon, 2000)).toBe(2000);
  });

  it("never returns a negative or over-subtotal discount", () => {
    expect(computeCouponDiscount(makeCoupon({ type: "fixed", value: 9999 }), 100)).toBe(100);
    expect(computeCouponDiscount(makeCoupon(), 0)).toBe(0);
  });
});

describe("error message helpers", () => {
  it("distinguishes eligibility from exhaustion", () => {
    expect(couponEligibilityErrorMessage()).toBe(
      "این کد تخفیف برای شما قابل استفاده نیست"
    );
    expect(couponExhaustedErrorMessage()).toBe(
      "سهمیه استفاده از این کد تخفیف تمام شده است"
    );
  });
});

describe("getCouponEligibility", () => {
  it("defaults missing/invalid eligibility to public", () => {
    expect(getCouponEligibility({})).toEqual({
      mode: "public",
      assignedUsers: [],
      groups: [],
    });
    expect(
      getCouponEligibility({ eligibility: { mode: "superadmin" } }).mode
    ).toBe("public");
  });

  it("passes through valid eligibility with stringified arrays", () => {
    const e = getCouponEligibility({
      eligibility: {
        mode: "assigned_users",
        assignedUsers: [USER_ID, 123],
        groups: ["vip"],
      },
    });
    expect(e.mode).toBe("assigned_users");
    expect(e.assignedUsers).toEqual([USER_ID, "123"]);
    expect(e.groups).toEqual(["vip"]);
  });

  it("normalizes non-array fields to []", () => {
    const e = getCouponEligibility({
      eligibility: { mode: "user_groups", assignedUsers: "nope", groups: "nope" },
    });
    expect(e.assignedUsers).toEqual([]);
    expect(e.groups).toEqual([]);
  });
});

describe("isUserEligibleForCoupon", () => {
  it("lets everyone use public coupons, even without a user", async () => {
    expect(await isUserEligibleForCoupon(makeCoupon(), null)).toBe(true);
  });

  it("denies non-public coupons without a user context", async () => {
    const coupon = makeCoupon({
      eligibility: { mode: "assigned_users", assignedUsers: [USER_ID], groups: [] },
    });
    expect(await isUserEligibleForCoupon(coupon, null)).toBe(false);
  });

  it("checks assigned_users membership", async () => {
    const coupon = makeCoupon({
      eligibility: { mode: "assigned_users", assignedUsers: [USER_ID], groups: [] },
    });
    expect(await isUserEligibleForCoupon(coupon, USER_ID)).toBe(true);
    expect(await isUserEligibleForCoupon(coupon, "x".repeat(24))).toBe(false);
  });

  it("is fail-closed for user_groups until a group source exists", async () => {
    const coupon = makeCoupon({
      eligibility: { mode: "user_groups", assignedUsers: [], groups: ["vip"] },
    });
    expect(await isUserEligibleForCoupon(coupon, USER_ID)).toBe(false);
  });
});

describe("parseCouponEligibility", () => {
  it("returns undefined value when the field is omitted", () => {
    expect(parseCouponEligibility(undefined)).toEqual({ value: undefined });
    expect(parseCouponEligibility(null)).toEqual({ value: undefined });
  });

  it("rejects non-object input", () => {
    expect(parseCouponEligibility("x")).toHaveProperty("error");
    expect(parseCouponEligibility([])).toHaveProperty("error");
  });

  it("rejects an invalid mode", () => {
    expect(parseCouponEligibility({ mode: "everyone" })).toHaveProperty("error");
  });

  it("accepts a public payload with defaults", () => {
    expect(parseCouponEligibility({ mode: "public" })).toEqual({
      value: { mode: "public", assignedUsers: [], groups: [] },
    });
  });

  it("validates + dedupes assignedUsers", () => {
    const ok = parseCouponEligibility({
      mode: "assigned_users",
      assignedUsers: [USER_ID, USER_ID, "b".repeat(24)],
    });
    expect(ok).toEqual({
      value: {
        mode: "assigned_users",
        assignedUsers: [USER_ID, "b".repeat(24)],
        groups: [],
      },
    });

    expect(
      parseCouponEligibility({ mode: "assigned_users", assignedUsers: ["bad"] })
    ).toHaveProperty("error");
    expect(
      parseCouponEligibility({ mode: "assigned_users", assignedUsers: "nope" })
    ).toHaveProperty("error");
  });

  it("caps assignedUsers at 1000", () => {
    const big = Array.from({ length: 1001 }, (_, i) =>
      i.toString(16).padStart(24, "0")
    );
    expect(
      parseCouponEligibility({ mode: "assigned_users", assignedUsers: big })
    ).toHaveProperty("error");
  });

  it("sanitizes, lowercases, dedupes and caps groups", () => {
    const ok = parseCouponEligibility({
      mode: "user_groups",
      groups: [" VIP ", "vip", "مشتری"],
    });
    expect(ok).toHaveProperty("value");
    if (!("value" in ok)) return;
    expect(ok.value!.groups).toEqual(["vip", "مشتری"]);

    const long = parseCouponEligibility({ mode: "user_groups", groups: ["g".repeat(40)] });
    if (!("value" in long)) return;
    expect(long.value!.groups[0].length).toBe(32);

    expect(
      parseCouponEligibility({ mode: "user_groups", groups: ["   "] })
    ).toHaveProperty("error");
    expect(
      parseCouponEligibility({ mode: "user_groups", groups: Array(51).fill("g") })
    ).toHaveProperty("error");
  });
});

describe("validateCoupon", () => {
  it("rejects an invalid code without hitting the DB", async () => {
    const result = await validateCoupon("AB");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("کد تخفیف نامعتبر است");
    expect(couponFindOne).not.toHaveBeenCalled();
  });

  it("rejects an unknown code", async () => {
    couponFindOne.mockReturnValue(leanOf(null));
    const result = await validateCoupon("NOPE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("کد تخفیف معتبر نیست");
  });

  it("returns the usability reason for an unusable coupon", async () => {
    const expired = makeCoupon({ endsAt: new Date(Date.now() - 1000) });
    couponFindOne.mockReturnValue(leanOf(expired));
    const result = await validateCoupon("SAVE10");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("این کد تخفیف منقضی شده است");
  });

  it("returns the eligibility error for a valid-but-not-yours coupon", async () => {
    const coupon = makeCoupon({
      eligibility: { mode: "assigned_users", assignedUsers: ["z".repeat(24)], groups: [] },
    });
    couponFindOne.mockReturnValue(leanOf(coupon));
    const result = await validateCoupon("SAVE10", USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(couponEligibilityErrorMessage());
  });

  it("returns the coupon for an eligible user", async () => {
    const coupon = makeCoupon({
      eligibility: { mode: "assigned_users", assignedUsers: [USER_ID], groups: [] },
    });
    couponFindOne.mockReturnValue(leanOf(coupon));
    const result = await validateCoupon("SAVE10", USER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.coupon).toEqual(coupon);
  });

  it("skips the audience check without a userId", async () => {
    const coupon = makeCoupon({
      eligibility: { mode: "assigned_users", assignedUsers: [USER_ID], groups: [] },
    });
    couponFindOne.mockReturnValue(leanOf(coupon));
    expect((await validateCoupon("SAVE10")).ok).toBe(true);
  });
});

describe("claimCouponForOrder", () => {
  it("claims and computes the discount on the happy path", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon()));
    couponFindOneAndUpdate.mockResolvedValue(makeCoupon());
    usageFindOneAndUpdate.mockResolvedValue({});

    const result = await claimCouponForOrder("save10", USER_ID, 50000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount).toBe(5000);
    expect(result.payable).toBe(45000);
    expect(result.subtotal).toBe(50000);

    // Global claim query: _id + isActive re-check (no usedCount when unlimited).
    const [claimQuery] = couponFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(claimQuery._id).toBe(COUPON_ID);
    expect(claimQuery.isActive).toBe(true);
    expect(claimQuery.usedCount).toBeUndefined();

    // Per-user claim upsert.
    const [usageFilter, , usageOpts] = usageFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(usageFilter.coupon).toBe(COUPON_ID);
    expect(usageFilter.user).toBe(USER_ID);
    expect(usageOpts.upsert).toBe(true);
  });

  it("includes the usedCount guard when a usage limit is set", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon({ usageLimit: 100, usedCount: 5 })));
    couponFindOneAndUpdate.mockResolvedValue(makeCoupon());
    usageFindOneAndUpdate.mockResolvedValue({});

    await claimCouponForOrder("SAVE10", USER_ID, 1000);

    const [claimQuery] = couponFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(claimQuery.usedCount).toEqual({ $lt: 100 });
  });

  it("fails fast when the global quota is exhausted", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon({ usageLimit: 1, usedCount: 1 })));
    const result = await claimCouponForOrder("SAVE10", USER_ID, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(couponExhaustedErrorMessage());
    expect(couponFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("denies a non-eligible user before claiming", async () => {
    couponFindOne.mockReturnValue(
      leanOf(
        makeCoupon({
          eligibility: { mode: "assigned_users", assignedUsers: ["z".repeat(24)], groups: [] },
        })
      )
    );
    const result = await claimCouponForOrder("SAVE10", USER_ID, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(couponEligibilityErrorMessage());
    expect(couponFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("enforces minSubtotal", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon({ minSubtotal: 100000 })));
    const result = await claimCouponForOrder("SAVE10", USER_ID, 50000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("حداقل مبلغ سبد خرید");
    expect(couponFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports exhaustion when the atomic global claim fails and the coupon is unchanged", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon({ usageLimit: 1, usedCount: 1 })));
    couponFindOneAndUpdate.mockResolvedValue(null);
    couponFindById.mockReturnValue(leanOf(makeCoupon({ usageLimit: 1, usedCount: 1 })));

    const result = await claimCouponForOrder("SAVE10", USER_ID, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(couponExhaustedErrorMessage());
  });

  it("reports the deactivation reason when the claim fails on an inactive coupon", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon()));
    couponFindOneAndUpdate.mockResolvedValue(null);
    couponFindById.mockReturnValue(leanOf(makeCoupon({ isActive: false })));

    const result = await claimCouponForOrder("SAVE10", USER_ID, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("این کد تخفیف غیرفعال است");
  });

  it("retries the per-user claim on an E11000 race", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon()));
    couponFindOneAndUpdate.mockResolvedValue(makeCoupon());
    usageFindOneAndUpdate
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await claimCouponForOrder("SAVE10", USER_ID, 1000);
    expect(result.ok).toBe(true);
    expect(usageFindOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(couponFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("rolls back the global claim and reports per-user limit when the retry also fails", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon()));
    couponFindOneAndUpdate.mockResolvedValue(makeCoupon());
    usageFindOneAndUpdate
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce(null);

    const result = await claimCouponForOrder("SAVE10", USER_ID, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("قبلاً از این کد تخفیف استفاده");
    expect(couponFindByIdAndUpdate).toHaveBeenCalledWith(COUPON_ID, {
      $inc: { usedCount: -1 },
    });
  });

  it("rolls back and rethrows on a non-duplicate error", async () => {
    couponFindOne.mockReturnValue(leanOf(makeCoupon()));
    couponFindOneAndUpdate.mockResolvedValue(makeCoupon());
    usageFindOneAndUpdate.mockRejectedValueOnce(new Error("db down"));

    await expect(claimCouponForOrder("SAVE10", USER_ID, 1000)).rejects.toThrow(
      "db down"
    );
    expect(couponFindByIdAndUpdate).toHaveBeenCalledWith(COUPON_ID, {
      $inc: { usedCount: -1 },
    });
  });
});

describe("releaseCouponUsage", () => {
  it("is a no-op when the order has no discount", async () => {
    orderFindById.mockReturnValue(
      selectOf(leanOf({ _id: "o".repeat(24), discount: undefined, customer: USER_ID }))
    );
    await releaseCouponUsage("o".repeat(24));
    expect(orderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(couponFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when already released", async () => {
    orderFindById.mockReturnValue(
      selectOf(leanOf({ _id: "o".repeat(24), discount: { couponId: COUPON_ID, released: true } }))
    );
    await releaseCouponUsage("o".repeat(24));
    expect(orderFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("releases the global + per-user usage exactly once", async () => {
    const orderId = "o".repeat(24);
    orderFindById.mockReturnValue(
      selectOf(leanOf({ _id: orderId, discount: { couponId: COUPON_ID }, customer: USER_ID }))
    );
    orderFindOneAndUpdate.mockReturnValue(
      leanOf({ _id: orderId, discount: { couponId: COUPON_ID }, customer: USER_ID })
    );

    await releaseCouponUsage(orderId);

    expect(couponFindByIdAndUpdate).toHaveBeenCalledWith(COUPON_ID, {
      $inc: { usedCount: -1 },
    });
    expect(usageUpdateOne).toHaveBeenCalledWith(
      { coupon: COUPON_ID, user: USER_ID },
      { $inc: { count: -1 } }
    );
  });

  it("skips the per-user decrement when the order has no customer", async () => {
    orderFindById.mockReturnValue(
      selectOf(leanOf({ _id: "o".repeat(24), discount: { couponId: COUPON_ID }, customer: null }))
    );
    orderFindOneAndUpdate.mockReturnValue(
      leanOf({ _id: "o".repeat(24), discount: { couponId: COUPON_ID } })
    );

    await releaseCouponUsage("o".repeat(24));
    expect(usageUpdateOne).not.toHaveBeenCalled();
  });

  it("does nothing when another caller already claimed the release", async () => {
    orderFindById.mockReturnValue(
      selectOf(leanOf({ _id: "o".repeat(24), discount: { couponId: COUPON_ID } }))
    );
    orderFindOneAndUpdate.mockReturnValue(leanOf(null));

    await releaseCouponUsage("o".repeat(24));
    expect(couponFindByIdAndUpdate).not.toHaveBeenCalled();
  });
});
