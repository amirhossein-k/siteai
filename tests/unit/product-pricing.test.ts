import { describe, it, expect } from "vitest";
import {
  getEffectivePrice,
  parseProductDiscount,
  toPublicDiscount,
  applyEffectivePricing,
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
} from "@/lib/product-pricing";

const NOW = new Date("2026-08-15T12:00:00.000Z");

describe("getEffectivePrice — no discount / inactive", () => {
  it("returns original price when no discount", () => {
    const r = getEffectivePrice(1_000_000, undefined, NOW);
    expect(r.active).toBe(false);
    expect(r.finalPrice).toBe(1_000_000);
    expect(r.discountAmount).toBe(0);
  });

  it("returns original price when discount is null", () => {
    const r = getEffectivePrice(1_000_000, null, NOW);
    expect(r.active).toBe(false);
    expect(r.finalPrice).toBe(1_000_000);
  });

  it("is inactive when isActive=false", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 20, isActive: false }, NOW);
    expect(r.active).toBe(false);
    expect(r.finalPrice).toBe(1_000_000);
  });

  it("never returns a negative final price", () => {
    const r = getEffectivePrice(0, { type: "fixed", value: 5000 }, NOW);
    expect(r.finalPrice).toBe(0);
    expect(r.discountAmount).toBe(0);
  });
});

describe("getEffectivePrice — percent", () => {
  it("computes floor(price * value / 100)", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 20 }, NOW);
    expect(r.active).toBe(true);
    expect(r.discountAmount).toBe(200_000);
    expect(r.finalPrice).toBe(800_000);
    expect(r.discountPercent).toBe(20);
  });

  it("1% boundary", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 1 }, NOW);
    expect(r.discountAmount).toBe(10_000);
    expect(r.finalPrice).toBe(990_000);
  });

  it("90% boundary", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 90 }, NOW);
    expect(r.discountAmount).toBe(900_000);
    expect(r.finalPrice).toBe(100_000);
  });

  it("floors the discount amount (integer Toman)", () => {
    const r = getEffectivePrice(99_999, { type: "percent", value: 33 }, NOW);
    expect(r.discountAmount).toBe(Math.floor((99_999 * 33) / 100));
    expect(Number.isInteger(r.finalPrice)).toBe(true);
  });
});

describe("getEffectivePrice — fixed", () => {
  it("subtracts the flat amount", () => {
    const r = getEffectivePrice(1_000_000, { type: "fixed", value: 150_000 }, NOW);
    expect(r.discountAmount).toBe(150_000);
    expect(r.finalPrice).toBe(850_000);
  });

  it("clamps to the price (never negative)", () => {
    const r = getEffectivePrice(100_000, { type: "fixed", value: 500_000 }, NOW);
    expect(r.discountAmount).toBe(100_000);
    expect(r.finalPrice).toBe(0);
  });

  it("computes a display percentage for fixed", () => {
    const r = getEffectivePrice(2_000_000, { type: "fixed", value: 400_000 }, NOW);
    expect(r.discountPercent).toBe(20);
  });
});

describe("getEffectivePrice — time windows", () => {
  it("start boundary is inclusive (startsAt === now)", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, startsAt: NOW }, NOW);
    expect(r.active).toBe(true);
  });

  it("future discount is inactive", () => {
    const future = new Date(NOW.getTime() + 60_000);
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, startsAt: future }, NOW);
    expect(r.active).toBe(false);
    expect(r.finalPrice).toBe(1_000_000);
  });

  it("end boundary is exclusive (now === endsAt → expired)", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, endsAt: NOW }, NOW);
    expect(r.active).toBe(false);
  });

  it("expired discount is inactive", () => {
    const past = new Date(NOW.getTime() - 60_000);
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, endsAt: past }, NOW);
    expect(r.active).toBe(false);
  });

  it("no start = active immediately when enabled", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, endsAt: null }, NOW);
    expect(r.active).toBe(true);
  });

  it("no end = no expiration", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, startsAt: null }, NOW);
    expect(r.active).toBe(true);
  });

  it("active inside a bounded window", () => {
    const r = getEffectivePrice(
      1_000_000,
      {
        type: "percent",
        value: 10,
        startsAt: new Date(NOW.getTime() - 3_600_000),
        endsAt: new Date(NOW.getTime() + 3_600_000),
      },
      NOW
    );
    expect(r.active).toBe(true);
    expect(r.finalPrice).toBe(900_000);
  });
});

describe("parseProductDiscount — validation", () => {
  it("omitted field → undefined (PUT partial: leave unchanged)", () => {
    const r = parseProductDiscount(undefined, 1_000_000) as { value?: unknown };
    expect(r.value).toBeUndefined();
  });

  it("null → cleared", () => {
    const r = parseProductDiscount(null, 1_000_000) as { value: unknown };
    expect(r.value).toBeNull();
  });

  it("accepts a valid percent discount", () => {
    const r = parseProductDiscount(
      { type: "percent", value: 20, startsAt: null, endsAt: null, isActive: true },
      1_000_000
    );
    expect((r as { error?: string }).error).toBeUndefined();
    const v = (r as { value: unknown }).value as { type: string; value: number };
    expect(v.type).toBe("percent");
    expect(v.value).toBe(20);
  });

  it("accepts a valid fixed discount below the price", () => {
    const r = parseProductDiscount({ type: "fixed", value: 150_000 }, 1_000_000);
    expect((r as { error?: string }).error).toBeUndefined();
  });

  it("rejects percent below minimum", () => {
    const r = parseProductDiscount({ type: "percent", value: 0 }, 1_000_000);
    expect((r as { error?: string }).error).toContain("بین");
  });

  it("rejects percent above 90", () => {
    const r = parseProductDiscount({ type: "percent", value: 91 }, 1_000_000);
    expect((r as { error?: string }).error).toContain("بین");
  });

  it("accepts exactly 90", () => {
    const r = parseProductDiscount({ type: "percent", value: 90 }, 1_000_000);
    expect((r as { error?: string }).error).toBeUndefined();
  });

  it("rejects non-integer percent", () => {
    const r = parseProductDiscount({ type: "percent", value: 20.5 }, 1_000_000);
    expect((r as { error?: string }).error).toContain("بین");
  });

  it("rejects non-integer fixed", () => {
    const r = parseProductDiscount({ type: "fixed", value: 100.5 }, 1_000_000);
    expect((r as { error?: string }).error).toBeTruthy();
  });

  it("rejects fixed >= price", () => {
    const r = parseProductDiscount({ type: "fixed", value: 1_000_000 }, 1_000_000);
    expect((r as { error?: string }).error).toContain("کمتر از قیمت");
  });

  it("rejects zero/negative values", () => {
    expect((parseProductDiscount({ type: "percent", value: -5 }, 1_000_000) as { error?: string }).error).toBeTruthy();
    expect((parseProductDiscount({ type: "fixed", value: 0 }, 1_000_000) as { error?: string }).error).toBeTruthy();
  });

  it("rejects an invalid date range (startsAt >= endsAt)", () => {
    const r = parseProductDiscount(
      { type: "percent", value: 10, startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-08-01T00:00:00.000Z" },
      1_000_000
    );
    expect((r as { error?: string }).error).toContain("بعد از شروع");
  });

  it("rejects malformed dates", () => {
    const r = parseProductDiscount(
      { type: "percent", value: 10, startsAt: "not-a-date" },
      1_000_000
    );
    expect((r as { error?: string }).error).toContain("تاریخ");
  });

  it("rejects unknown type", () => {
    const r = parseProductDiscount({ type: "other", value: 10 }, 1_000_000);
    expect((r as { error?: string }).error).toBeTruthy();
  });
});

describe("toPublicDiscount / applyEffectivePricing", () => {
  it("returns null metadata when inactive (never leaks future/expired config)", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 10, startsAt: new Date(NOW.getTime() + 86_400_000) }, NOW);
    expect(toPublicDiscount(r)).toBeNull();
    const expired = getEffectivePrice(1_000_000, { type: "percent", value: 10, endsAt: new Date(NOW.getTime() - 86_400_000) }, NOW);
    expect(toPublicDiscount(expired)).toBeNull();
  });

  it("returns full metadata when active", () => {
    const r = getEffectivePrice(1_000_000, { type: "percent", value: 20, startsAt: null, endsAt: new Date(NOW.getTime() + 86_400_000) }, NOW);
    const pub = toPublicDiscount(r);
    expect(pub).toMatchObject({
      type: "percent",
      value: 20,
      percent: 20,
      amount: 200_000,
      startsAt: null,
    });
    expect(pub?.endsAt).toBeTruthy();
  });

  it("applyEffectivePricing enriches a product row AND each variant (per-variant effectivePrice)", () => {
    const row: { _id: string; price: number; variants: { price: number }[]; discount: { type: "percent"; value: number; startsAt: null; endsAt: null; isActive: boolean } } = {
      _id: "p1",
      price: 2_000_000,
      variants: [{ price: 3_000_000 }],
      discount: { type: "percent", value: 25, startsAt: null, endsAt: null, isActive: true },
    };
    const out = applyEffectivePricing(row);
    expect(out.effectivePrice).toBe(1_500_000);
    expect(out.discount?.amount).toBe(500_000);
    // per-variant: same discount, independent math (percent of the variant price)
    expect(out.variants[0].price).toBe(3_000_000); // original untouched
    expect(out.variants[0].effectivePrice).toBe(2_250_000);
  });

  it("applyEffectivePricing on a product without discount returns effectivePrice === price and discount null", () => {
    const out = applyEffectivePricing({ price: 1_000_000 });
    expect(out.effectivePrice).toBe(1_000_000);
    expect(out.discount).toBeNull();
  });

  it("applyEffectivePricing never leaks future/expired discount configuration", () => {
    const future = {
      price: 1_000_000,
      discount: {
        type: "percent" as const,
        value: 50,
        startsAt: new Date(NOW.getTime() + 86_400_000), // tomorrow
        endsAt: null,
        isActive: true,
      },
    };
    const out = applyEffectivePricing(future, NOW);
    expect(out.effectivePrice).toBe(1_000_000);
    expect(out.discount).toBeNull();
  });

  it("variant pricing: the product-level discount applies to every variant price", () => {
    const discount = { type: "percent" as const, value: 20, isActive: true };
    const variantPrices = [1_000_000, 2_000_000, 500_000];
    const effective = variantPrices.map((p) => getEffectivePrice(p, discount, NOW).finalPrice);
    expect(effective).toEqual([800_000, 1_600_000, 400_000]);
    // product-level effective price = min over active variants
    expect(Math.min(...effective)).toBe(400_000);
  });

  it("bounds constants are consistent", () => {
    expect(DISCOUNT_PERCENT_MIN).toBe(1);
    expect(DISCOUNT_PERCENT_MAX).toBe(90);
  });
});
