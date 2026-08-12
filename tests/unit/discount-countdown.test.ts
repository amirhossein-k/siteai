import { describe, it, expect } from "vitest";
import {
  formatPersianRemaining,
  findNearestDiscountEndsAt,
} from "@/lib/discount-countdown";
import type { CountdownParts } from "@/hooks/use-countdown";

/** Build CountdownParts. `hours` is the TOTAL hour count (53 = 2d5h). */
function parts(
  hours: number,
  minutes: number,
  seconds: number,
  overrides: Partial<Pick<CountdownParts, "expired" | "ready">> = {}
): CountdownParts {
  return {
    hours,
    minutes,
    seconds,
    expired: overrides.expired ?? false,
    ready: overrides.ready ?? true,
  };
}

describe("formatPersianRemaining", () => {
  it("2 days + 5 hours → «۲ روز و ۵ ساعت باقی مانده»", () => {
    expect(formatPersianRemaining(parts(53, 0, 0))).toBe(
      "۲ روز و ۵ ساعت باقی مانده"
    );
  });

  it("2 days + 0 hours → «۲ روز باقی مانده»", () => {
    expect(formatPersianRemaining(parts(48, 0, 0))).toBe("۲ روز باقی مانده");
  });

  it("5 hours + 12 minutes → «۵ ساعت و ۱۲ دقیقه باقی مانده»", () => {
    expect(formatPersianRemaining(parts(5, 12, 0))).toBe(
      "۵ ساعت و ۱۲ دقیقه باقی مانده"
    );
  });

  it("12 minutes + 30 seconds → «۱۲ دقیقه و ۳۰ ثانیه باقی مانده»", () => {
    expect(formatPersianRemaining(parts(0, 12, 30))).toBe(
      "۱۲ دقیقه و ۳۰ ثانیه باقی مانده"
    );
  });

  it("30 seconds → «۳۰ ثانیه باقی مانده»", () => {
    expect(formatPersianRemaining(parts(0, 0, 30))).toBe(
      "۳۰ ثانیه باقی مانده"
    );
  });

  it("1 day + 1 hour → «۱ روز و ۱ ساعت باقی مانده»", () => {
    expect(formatPersianRemaining(parts(25, 0, 0))).toBe(
      "۱ روز و ۱ ساعت باقی مانده"
    );
  });

  it("5 hours + 0 minutes → «۵ ساعت باقی مانده»", () => {
    expect(formatPersianRemaining(parts(5, 0, 0))).toBe("۵ ساعت باقی مانده");
  });

  it("5 minutes + 0 seconds → «۵ دقیقه باقی مانده»", () => {
    expect(formatPersianRemaining(parts(0, 5, 0))).toBe("۵ دقیقه باقی مانده");
  });

  it("expired → empty string", () => {
    expect(formatPersianRemaining(parts(0, 0, 0, { expired: true }))).toBe("");
  });

  it("zero remaining → empty string", () => {
    expect(formatPersianRemaining(parts(0, 0, 0))).toBe("");
  });

  it("not ready (SSR first paint) → empty string", () => {
    expect(
      formatPersianRemaining(parts(5, 12, 0, { ready: false }))
    ).toBe("");
  });

  it("emits fa-IR Persian digits, never ASCII or hand-written conversion", () => {
    // Hours+minutes pair (no day decomposition): ۵ and ۱۲ in the phrase.
    const text = formatPersianRemaining(parts(5, 12, 30));
    expect(text).toContain("۵");
    expect(text).toContain("۱۲");
    expect(text).not.toMatch(/[0-9]/);
    // Day-decomposed phrase: ۲ and ۵ still Persian digits.
    const daysText = formatPersianRemaining(parts(53, 0, 0));
    expect(daysText).toContain("۲");
    expect(daysText).toContain("۵");
    expect(daysText).not.toMatch(/[0-9]/);
  });

  it("drops sub-units below the coarsest pair (2d5h hides minutes/seconds)", () => {
    expect(formatPersianRemaining(parts(53, 45, 20))).toBe(
      "۲ روز و ۵ ساعت باقی مانده"
    );
    expect(formatPersianRemaining(parts(5, 12, 40))).toBe(
      "۵ ساعت و ۱۲ دقیقه باقی مانده"
    );
  });
});

describe("findNearestDiscountEndsAt", () => {
  const NOW = new Date("2026-08-15T12:00:00.000Z");
  const inOneHour = new Date(NOW.getTime() + 3_600_000).toISOString();
  const inTwoHours = new Date(NOW.getTime() + 7_200_000).toISOString();
  const inTenMin = new Date(NOW.getTime() + 600_000).toISOString();
  const past = new Date(NOW.getTime() - 60_000).toISOString();

  it("returns the earliest finite future endsAt among mixed products", () => {
    const products = [
      { discount: { endsAt: inTwoHours } },
      { discount: { endsAt: null } },
      { discount: { endsAt: inOneHour } },
      { discount: null },
      {},
    ];
    expect(findNearestDiscountEndsAt(products, NOW)).toBe(
      new Date(inOneHour).getTime()
    );
  });

  it("multiple expiries → earliest wins", () => {
    const products = [
      { discount: { endsAt: inOneHour } },
      { discount: { endsAt: inTenMin } },
      { discount: { endsAt: inTwoHours } },
    ];
    expect(findNearestDiscountEndsAt(products, NOW)).toBe(
      new Date(inTenMin).getTime()
    );
  });

  it("all endsAt null → null (open-ended discounts schedule no countdown)", () => {
    const products = [
      { discount: { endsAt: null } },
      { discount: { endsAt: null } },
      { discount: null },
    ];
    expect(findNearestDiscountEndsAt(products, NOW)).toBeNull();
  });

  it("empty list → null", () => {
    expect(findNearestDiscountEndsAt([], NOW)).toBeNull();
  });

  it("skips already-expired timestamps (defensive — server never sends them)", () => {
    const products = [
      { discount: { endsAt: past } },
      { discount: { endsAt: inOneHour } },
    ];
    expect(findNearestDiscountEndsAt(products, NOW)).toBe(
      new Date(inOneHour).getTime()
    );
  });

  it("skips malformed timestamp strings", () => {
    const products = [
      { discount: { endsAt: "not-a-date" } },
      { discount: { endsAt: inOneHour } },
    ];
    expect(findNearestDiscountEndsAt(products, NOW)).toBe(
      new Date(inOneHour).getTime()
    );
  });

  it("respects an injected `now` (past deadlines are ignored)", () => {
    const products = [{ discount: { endsAt: inTenMin } }];
    const after = new Date(NOW.getTime() + 20 * 60_000); // 10min past the deadline
    expect(findNearestDiscountEndsAt(products, after)).toBeNull();
    expect(findNearestDiscountEndsAt(products, NOW)).not.toBeNull();
  });
});
