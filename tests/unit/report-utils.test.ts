import { describe, expect, it } from "vitest";
import {
  addDays,
  allocateCouponToLines,
  dateParam,
  dateRangeFromPreset,
  parseDateParam,
  parseReportFilters,
  roundToman,
  safePct,
  startOfUtcDay,
} from "@/lib/report-utils";

describe("dateRangeFromPreset (UTC day semantics)", () => {
  const now = new Date("2026-08-13T10:30:00.000Z"); // Thursday

  it("today = [startOfDay, +1d)", () => {
    const r = dateRangeFromPreset("today", now);
    expect(r).toEqual({
      from: new Date("2026-08-13T00:00:00.000Z"),
      to: new Date("2026-08-14T00:00:00.000Z"),
    });
  });

  it("yesterday = [startOfDay-1d, startOfDay)", () => {
    const r = dateRangeFromPreset("yesterday", now);
    expect(r).toEqual({
      from: new Date("2026-08-12T00:00:00.000Z"),
      to: new Date("2026-08-13T00:00:00.000Z"),
    });
  });

  it("week starts on Monday (2026-08-10) and spans 7 days", () => {
    const r = dateRangeFromPreset("week", now);
    expect(r).toEqual({
      from: new Date("2026-08-10T00:00:00.000Z"),
      to: new Date("2026-08-17T00:00:00.000Z"),
    });
  });

  it("Sunday rolls back 6 days to the previous Monday", () => {
    const sunday = new Date("2026-08-16T09:00:00.000Z");
    const r = dateRangeFromPreset("week", sunday);
    expect(r?.from).toEqual(new Date("2026-08-10T00:00:00.000Z"));
  });

  it("month = UTC calendar month", () => {
    const r = dateRangeFromPreset("month", now);
    expect(r).toEqual({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("lastMonth = the previous UTC calendar month", () => {
    const r = dateRangeFromPreset("lastMonth", now);
    expect(r).toEqual({
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  it("year = UTC calendar year", () => {
    const r = dateRangeFromPreset("year", now);
    expect(r).toEqual({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
  });

  it("custom has no intrinsic range", () => {
    expect(dateRangeFromPreset("custom", now)).toBeNull();
  });

  it("month boundary across year end", () => {
    const jan15 = new Date("2026-01-15T12:00:00.000Z");
    const r = dateRangeFromPreset("lastMonth", jan15);
    expect(r).toEqual({
      from: new Date("2025-12-01T00:00:00.000Z"),
      to: new Date("2026-01-01T00:00:00.000Z"),
    });
  });
});

describe("parseDateParam", () => {
  it("parses a valid YYYY-MM-DD to UTC start of day", () => {
    expect(parseDateParam("2026-08-13")).toEqual(
      new Date("2026-08-13T00:00:00.000Z")
    );
  });

  it("rejects malformed, rolled-over and empty values", () => {
    expect(parseDateParam("2026-13-01")).toBeNull(); // month 13
    expect(parseDateParam("2026-02-31")).toBeNull(); // rollover
    expect(parseDateParam("13/08/2026")).toBeNull();
    expect(parseDateParam("")).toBeNull();
    expect(parseDateParam(undefined)).toBeNull();
    expect(parseDateParam("2026-08-1")).toBeNull();
  });
});

describe("dateParam round-trip", () => {
  it("formats a Date back to YYYY-MM-DD", () => {
    expect(dateParam(new Date("2026-08-13T23:59:00.000Z"))).toBe("2026-08-13");
  });
});

describe("parseReportFilters", () => {
  it("resolves presets to concrete from/to", () => {
    const res = parseReportFilters({ preset: "today" });
    expect("error" in res).toBe(false);
    const f = ("filters" in res ? res.filters : null)!;
    expect(f.preset).toBe("today");
    expect(f.from).toBe(dateParam(startOfUtcDay(new Date())));
    expect(f.to).toBe(dateParam(addDays(startOfUtcDay(new Date()), -1 + 1)));
  });

  it("accepts a valid custom range", () => {
    const res = parseReportFilters({ preset: "custom", from: "2026-08-01", to: "2026-08-13" });
    expect("error" in res).toBe(false);
  });

  it("rejects custom without both dates", () => {
    const res = parseReportFilters({ preset: "custom", from: "2026-08-01" });
    expect("error" in res).toBe(true);
  });

  it("rejects from > to", () => {
    const res = parseReportFilters({ preset: "custom", from: "2026-08-13", to: "2026-08-01" });
    expect("error" in res).toBe(true);
  });

  it("rejects unknown preset / status / paymentStatus / method", () => {
    expect("error" in parseReportFilters({ preset: "forever" })).toBe(true);
    expect(
      "error" in parseReportFilters({ preset: "today", status: "weird" })
    ).toBe(true);
    expect(
      "error" in parseReportFilters({ preset: "today", paymentStatus: "paidx" })
    ).toBe(true);
    expect(
      "error" in parseReportFilters({ preset: "today", method: "cash" })
    ).toBe(true);
  });

  it("validates ids and paging", () => {
    const badId = parseReportFilters({
      preset: "today",
      product: "not-an-id",
    });
    expect("filters" in badId && badId.filters.productId).toBeUndefined();

    const okId = parseReportFilters({ preset: "today", product: "507f1f77bcf86cd799439011" });
    expect("filters" in okId && okId.filters.productId).toBe("507f1f77bcf86cd799439011");

    expect("error" in parseReportFilters({ preset: "today", page: "0" })).toBe(true);
    expect("error" in parseReportFilters({ preset: "today", page: "-1" })).toBe(true);
    expect("error" in parseReportFilters({ preset: "today", page: "abc" })).toBe(true);
    expect("error" in parseReportFilters({ preset: "today", limit: "99999" })).toBe(true);

    const okPage = parseReportFilters({ preset: "today", page: "3", limit: "200" });
    expect("filters" in okPage && okPage.filters.page).toBe(3);
    expect("filters" in okPage && okPage.filters.limit).toBe(200);
  });

  it("defaults page/limit", () => {
    const res = parseReportFilters({ preset: "today" });
    expect("filters" in res && res.filters.page).toBe(1);
    expect("filters" in res && res.filters.limit).toBe(100);
  });

  // --- Session 88: trend grouping (`group` query parameter) ---
  describe("trendGroup (group param)", () => {
    it("accepts day / week / month", () => {
      for (const group of ["day", "week", "month"] as const) {
        const res = parseReportFilters({ preset: "today", group });
        expect("error" in res).toBe(false);
        expect("filters" in res && res.filters.trendGroup).toBe(group);
      }
    });

    it("leaves trendGroup undefined when group is absent", () => {
      const res = parseReportFilters({ preset: "today" });
      expect("filters" in res && res.filters.trendGroup).toBeUndefined();
    });

    it("leaves trendGroup undefined for an empty group (not an error)", () => {
      const res = parseReportFilters({ preset: "today", group: "" });
      expect("error" in res).toBe(false);
      expect("filters" in res && res.filters.trendGroup).toBeUndefined();
    });

    it("rejects an unknown group (the API maps this to HTTP 400)", () => {
      const res = parseReportFilters({ preset: "today", group: "yearly" });
      expect("error" in res).toBe(true);
      expect("error" in res && res.error).toContain("گروه‌بندی");
    });

    it("is case-sensitive (matching the Mongo $dateToString contract)", () => {
      expect(
        "error" in parseReportFilters({ preset: "today", group: "DAY" })
      ).toBe(true);
      expect(
        "error" in parseReportFilters({ preset: "today", group: "Week" })
      ).toBe(true);
    });

    it("rejects an over-long group (truncated, then fails the whitelist)", () => {
      const res = parseReportFilters({
        preset: "today",
        group: "day".padEnd(50, "x"),
      });
      expect("error" in res).toBe(true);
    });

    it("does not disturb the other filters", () => {
      const res = parseReportFilters({
        preset: "custom",
        from: "2026-08-01",
        to: "2026-08-13",
        group: "week",
        status: "confirmed",
      });
      expect("error" in res).toBe(false);
      expect("filters" in res && res.filters.trendGroup).toBe("week");
      expect("filters" in res && res.filters.orderStatus).toBe("confirmed");
      expect("filters" in res && res.filters.from).toBe("2026-08-01");
      expect("filters" in res && res.filters.to).toBe("2026-08-13");
    });
  });
});

describe("allocateCouponToLines", () => {
  it("allocates proportionally and reconciles to the coupon amount", () => {
    const lines = [1000, 3000, 6000]; // total 10000
    const coupon = 1000;
    const allocated = allocateCouponToLines(lines, coupon);
    expect(allocated).toEqual([100, 300, 600]);
    expect(allocated.reduce((a, b) => a + b, 0)).toBe(coupon);
  });

  it("absorbs rounding residuals in the last line", () => {
    const lines = [333, 333, 334]; // total 1000
    const coupon = 100;
    const allocated = allocateCouponToLines(lines, coupon);
    expect(allocated.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("returns zeros when there is no coupon or zero net", () => {
    expect(allocateCouponToLines([100, 200], 0)).toEqual([0, 0]);
    expect(allocateCouponToLines([0, 0], 50)).toEqual([0, 0]);
    expect(allocateCouponToLines([], 50)).toEqual([]);
  });

  it("never exceeds the coupon total", () => {
    const lines = [1, 1, 1];
    const coupon = 2;
    const allocated = allocateCouponToLines(lines, coupon);
    expect(allocated.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
  });
});

describe("money / percentages", () => {
  it("roundToman rounds halves and guards non-finite", () => {
    expect(roundToman(1.4)).toBe(1);
    expect(roundToman(1.5)).toBe(2);
    expect(roundToman(Infinity)).toBe(0);
    expect(roundToman(NaN)).toBe(0);
  });

  it("safePct returns one-decimal percent or null", () => {
    expect(safePct(250, 1000)).toBe(25);
    expect(safePct(333, 1000)).toBe(33.3);
    expect(safePct(10, 0)).toBeNull();
    expect(safePct(10, -5)).toBeNull();
  });
});
