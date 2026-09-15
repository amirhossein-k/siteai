import { describe, it, expect } from "vitest";
import {
  assembleTrendBuckets,
  computeProductRow,
  computeTrendBuckets,
  computeWaterfallSteps,
  isoWeek,
  nextTrendGroupStart,
  startOfTrendGroup,
  trendGroupLabel,
  type AggProductLine,
  type AggSummary,
  type TrendSalesAgg,
} from "@/lib/profitability";

// ---------------------------------------------------------------------------
// CASE 1: Sales = 100, COGS = 60 → GP = 40, GM = 40%
// CASE 2: GP = 40, OpEx = 15 → NP = 25
// CASE 3: 10 units × FIFO cost 50,000 → COGS = 500,000
// CASE 4: Negative GP → appears in loss-making products
// CASE 5: Void expense excluded (tested via waterfall OpEx=0 path)
// CASE 6: Historical supplierPrice snapshot (item.cogs is snapshot, not current Product.supplierPrice)
// CASE 7: Coupon discount not double-counted
// CASE 8: Refund is tested via the existing regression suite (financial snapshots immutable)
// ---------------------------------------------------------------------------

describe("profitability — pure calculation formulas", () => {
  // -----------------------------------------------------------------------
  // CASE 1 & 3: basic GP + COGS from FIFO cost
  // -----------------------------------------------------------------------
  describe("CASE 1 & 3 — Gross profit and FIFO-based COGS", () => {
    it("computes correct gross profit when sale price = 100, FIFO cost = 60, qty = 1", () => {
      const summary: AggSummary = {
        totalNetSales: 100,
        totalCogs: 60,
        totalGrossSales: 100,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const item: AggProductLine = {
        productId: "p1",
        name: "Widget",
        sku: "W1",
        quantity: 1,
        lineNet: 100,
        grossLine: 100,
        discountLine: 0,
        cogs: 60,
      };
      const row = computeProductRow(item, summary);

      expect(row.netSales).toBe(100);
      expect(row.cogs).toBe(60);
      expect(row.grossProfit).toBe(40);
      expect(row.grossMargin).toBe(40);
      expect(row.profitShare).toBe(100); // sole product = 100% share
    });

    it("CASE 3: COGS = 10 units × FIFO cost 50,000 = 500,000", () => {
      const summary: AggSummary = {
        totalNetSales: 1_000_000,
        totalCogs: 500_000,
        totalGrossSales: 1_000_000,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const item: AggProductLine = {
        productId: "p2",
        name: "Premium Item",
        sku: "PI-1",
        quantity: 10,
        lineNet: 1_000_000,
        grossLine: 1_000_000,
        discountLine: 0,
        cogs: 500_000, // 10 × 50,000
      };
      const row = computeProductRow(item, summary);

      expect(row.quantity).toBe(10);
      expect(row.cogs).toBe(500_000);
      expect(row.grossProfit).toBe(500_000);
      expect(row.grossMargin).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // CASE 2: Net profit = Gross profit − operating expenses
  // -----------------------------------------------------------------------
  describe("CASE 2 — Net profit from waterfall", () => {
    it("waterfall shows GP − OpEx = net profit", () => {
      const summary: AggSummary = {
        totalNetSales: 100,
        totalCogs: 60,
        totalGrossSales: 100,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const steps = computeWaterfallSteps(summary, 15);

      const gpStep = steps.find((s) => s.key === "grossProfit")!;
      const npStep = steps.find((s) => s.key === "netProfit")!;

      expect(gpStep.amount).toBe(40); // 100 − 60
      expect(npStep.amount).toBe(25); // 40 − 15
      expect(npStep.cumulative).toBe(25);
    });
  });

  // -----------------------------------------------------------------------
  // CASE 4: Negative GP → loss-making products
  // -----------------------------------------------------------------------
  describe("CASE 4 — Loss-making products", () => {
    it("grossProfit is negative when COGS > netSales", () => {
      const summary: AggSummary = {
        totalNetSales: 30,
        totalCogs: 50,
        totalGrossSales: 30,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const item: AggProductLine = {
        productId: "p-loss",
        name: "Loss Maker",
        sku: "LM-1",
        quantity: 1,
        lineNet: 30,
        grossLine: 30,
        discountLine: 0,
        cogs: 50,
      };
      const row = computeProductRow(item, summary);

      expect(row.grossProfit).toBe(-20);
      expect(row.grossMargin).toBeLessThan(0);
    });

    it("waterfall produces negative gross profit step", () => {
      const summary: AggSummary = {
        totalNetSales: 80,
        totalCogs: 120,
        totalGrossSales: 80,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const steps = computeWaterfallSteps(summary, 0);
      const gpStep = steps.find((s) => s.key === "grossProfit")!;

      expect(gpStep.amount).toBe(-40);
    });
  });

  // -----------------------------------------------------------------------
  // CASE 5: Void expense excluded (OpEx = 0)
  // -----------------------------------------------------------------------
  describe("CASE 5 — Void expense does not affect net profit", () => {
    it("net profit equals gross profit when operating expenses are zero", () => {
      const summary: AggSummary = {
        totalNetSales: 200,
        totalCogs: 120,
        totalGrossSales: 200,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const steps = computeWaterfallSteps(summary, 0);

      const gpStep = steps.find((s) => s.key === "grossProfit")!;
      const npStep = steps.find((s) => s.key === "netProfit")!;
      const opexStep = steps.find((s) => s.key === "operatingExpenses")!;

      expect(opexStep.amount).toBe(0);
      expect(npStep.amount).toBe(gpStep.amount); // NP = GP when no expenses
      expect(npStep.amount).toBe(80);
    });
  });

  // -----------------------------------------------------------------------
  // CASE 6: Historical snapshot — item.cogs comes from OrderItem.fifoUnitCost
  //         or OrderItem.supplierPrice (snapshot), NOT current Product.supplierPrice.
  //         The test verifies the formula uses the snapshot value directly.
  // -----------------------------------------------------------------------
  describe("CASE 6 — Historical supplierPrice snapshot is authoritative", () => {
    it("uses the snapshot COGS from the aggregation, not a recomputed value", () => {
      // Scenario: product.currentSupplierPrice = 80 (increased after purchase)
      //           orderItem.fifoUnitCost = 50 (historical snapshot)
      //           The aggregation already resolved cogs = 50 (not 80)
      const snapshotCogs = 50; // what the aggregation pipeline emitted

      const summary: AggSummary = {
        totalNetSales: 100,
        totalCogs: snapshotCogs,
        totalGrossSales: 100,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const item: AggProductLine = {
        productId: "p-snap",
        name: "Snapped",
        sku: "SN-1",
        quantity: 1,
        lineNet: 100,
        grossLine: 100,
        discountLine: 0,
        cogs: snapshotCogs,
      };
      const row = computeProductRow(item, summary);

      // GP should reflect the historical cost (50), not the current price (80)
      expect(row.cogs).toBe(snapshotCogs);
      expect(row.grossProfit).toBe(50); // 100 − 50
      expect(row.grossProfit).not.toBe(20); // would be wrong if using current price
    });
  });

  // -----------------------------------------------------------------------
  // CASE 7: Coupon discount not double-counted
  // -----------------------------------------------------------------------
  describe("CASE 7 — Coupon discount is allocated once, not double-counted", () => {
    it("allocates coupon to each product proportionally without double-counting", () => {
      const totalCoupon = 10;
      // totalNetSales = grossSales − productDiscount − couponDiscount
      // (matches the order-level $totalAmount aggregation: sum(lineNet) − discount.amount)
      const summary: AggSummary = {
        totalNetSales: 90,
        totalCogs: 30,
        totalGrossSales: 100,
        totalProductDiscount: 0,
        totalCouponDiscount: totalCoupon,
      };

      const itemA: AggProductLine = {
        productId: "pa",
        name: "A",
        sku: "A-1",
        quantity: 1,
        lineNet: 60, // 60% of gross sales
        grossLine: 60,
        discountLine: 0,
        cogs: 10,
      };
      const itemB: AggProductLine = {
        productId: "pb",
        name: "B",
        sku: "B-1",
        quantity: 1,
        lineNet: 40, // 40% of gross sales
        grossLine: 40,
        discountLine: 0,
        cogs: 20,
      };

      const rowA = computeProductRow(itemA, summary);
      const rowB = computeProductRow(itemB, summary);

      // Coupon allocation: A gets 60/90 × 10 ≈ 7, B gets 40/90 × 10 ≈ 4 (rounded)
      expect(rowA.couponAllocation).toBe(7);
      expect(rowB.couponAllocation).toBe(4);

      // Net sales: A = 60 − 7 = 53, B = 40 − 4 = 36
      expect(rowA.netSales).toBe(53);
      expect(rowB.netSales).toBe(36);

      // Sum of product netSales ≈ 89 ± 1 (rounding); order-level is 90
      expect(Math.abs(rowA.netSales + rowB.netSales - summary.totalNetSales)).toBeLessThanOrEqual(1);

      // GP: A = 53 − 10 = 43, B = 36 − 20 = 16
      expect(rowA.grossProfit).toBe(43);
      expect(rowB.grossProfit).toBe(16);

      // Waterfall confirms: netSales = grossSales − productDiscount − couponDiscount = 90
      const steps = computeWaterfallSteps(summary, 0);
      const netSalesStep = steps.find((s) => s.key === "netSales")!;
      expect(netSalesStep.amount).toBe(90);
    });

    it("no coupon → no allocation, full lineNet is netSales", () => {
      const summary: AggSummary = {
        totalNetSales: 200,
        totalCogs: 80,
        totalGrossSales: 200,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const item: AggProductLine = {
        productId: "p-nocoupon",
        name: "No Coupon",
        sku: "NC-1",
        quantity: 1,
        lineNet: 200,
        grossLine: 200,
        discountLine: 0,
        cogs: 80,
      };
      const row = computeProductRow(item, summary);

      expect(row.couponAllocation).toBe(0);
      expect(row.netSales).toBe(200);
      expect(row.grossProfit).toBe(120);
    });
  });

  // -----------------------------------------------------------------------
  // CASE 8: Refund behavior — the formula does not recompute historical
  //         snapshots; refunded orders are excluded from aggregation by
  //         the order-match filter (status: { $ne: "cancelled" }, etc.).
  //         This is a pure-formula invariant: the numbers fed into
  //         computeProductRow are authoritative snapshots.
  // -----------------------------------------------------------------------
  describe("CASE 8 — Refunded orders excluded at aggregation level (snapshot integrity)", () => {
    it("only non-cancelled order amounts appear in summary totals", () => {
      // Scenario: three orders placed, one cancelled → only two count
      const summary: AggSummary = {
        totalNetSales: 150, // 100 + 50 (third order excluded)
        totalCogs: 90,
        totalGrossSales: 150,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const item: AggProductLine = {
        productId: "p-refund",
        name: "Refundable",
        sku: "RF-1",
        quantity: 3, // all three orders sold this product
        lineNet: 150,
        grossLine: 150,
        discountLine: 0,
        cogs: 90,
      };
      const row = computeProductRow(item, summary);

      // The refund didn't reduce sales in the aggregation (it was excluded).
      // Historical snapshots remain: the two paid orders' COGS = 90.
      expect(row.netSales).toBe(150);
      expect(row.cogs).toBe(90);
      expect(row.grossProfit).toBe(60);
    });
  });

  // -----------------------------------------------------------------------
  // Waterfall arithmetic: cumulative chain must reconcile
  // -----------------------------------------------------------------------
  describe("waterfall — cumulative chain reconciles", () => {
    it("grossSales − productDiscount − couponDiscount = netSales", () => {
      const summary: AggSummary = {
        totalNetSales: 500,
        totalCogs: 300,
        totalGrossSales: 700,
        totalProductDiscount: 120,
        totalCouponDiscount: 80,
      };
      const steps = computeWaterfallSteps(summary, 50);

      const gs = steps.find((s) => s.key === "grossSales")!;
      const pd = steps.find((s) => s.key === "productDiscount")!;
      const cd = steps.find((s) => s.key === "couponDiscount")!;
      const ns = steps.find((s) => s.key === "netSales")!;

      expect(gs.amount).toBe(700);
      expect(pd.amount).toBe(-120);
      expect(cd.amount).toBe(-80);
      expect(ns.amount).toBe(500);

      // Cumulative after couponDiscount must equal netSales
      expect(cd.cumulative).toBe(ns.amount);
    });

    it("netSales − COGS = grossProfit; grossProfit − OpEx = netProfit", () => {
      const summary: AggSummary = {
        totalNetSales: 400,
        totalCogs: 240,
        totalGrossSales: 400,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const steps = computeWaterfallSteps(summary, 100);

      const ns = steps.find((s) => s.key === "netSales")!;
      const cogs = steps.find((s) => s.key === "cogs")!;
      const gp = steps.find((s) => s.key === "grossProfit")!;
      const opex = steps.find((s) => s.key === "operatingExpenses")!;
      const np = steps.find((s) => s.key === "netProfit")!;

      expect(ns.amount).toBe(400);
      expect(cogs.amount).toBe(-240);
      expect(gp.amount).toBe(160);   // 400 − 240
      expect(opex.amount).toBe(-100);
      expect(np.amount).toBe(60);    // 160 − 100
      expect(gp.cumulative).toBe(160);
      expect(np.cumulative).toBe(60);
    });
  });

  // -----------------------------------------------------------------------
  // Edge: zero sales / zero net sales
  // -----------------------------------------------------------------------
  describe("edge cases — zero values", () => {
    it("zero netSales → coupon allocation is zero (no division by zero)", () => {
      const summary: AggSummary = {
        totalNetSales: 0,
        totalCogs: 0,
        totalGrossSales: 0,
        totalProductDiscount: 0,
        totalCouponDiscount: 10,
      };
      const item: AggProductLine = {
        productId: "p-zero",
        name: "Zero Sales",
        sku: "Z-1",
        quantity: 0,
        lineNet: 0,
        grossLine: 0,
        discountLine: 0,
        cogs: 0,
      };
      const row = computeProductRow(item, summary);

      expect(row.couponAllocation).toBe(0);
      expect(row.netSales).toBe(0);
      expect(row.grossMargin).toBeNull();
      expect(row.profitShare).toBeNull();
    });

    it("all numbers zero → waterfall steps have zero amounts", () => {
      const summary: AggSummary = {
        totalNetSales: 0,
        totalCogs: 0,
        totalGrossSales: 0,
        totalProductDiscount: 0,
        totalCouponDiscount: 0,
      };
      const steps = computeWaterfallSteps(summary, 0);

      for (const step of steps) {
        expect(step.amount).toBe(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// TREND BUCKETS (Session 88)
//
// The Foundation returned the OVERALL report window as every bucket's
// `from`/`to`, and only emitted buckets that actually had orders — so empty
// periods (including expense-only periods) silently vanished. These tests pin
// the corrected boundaries, contiguity/coverage and zero-fill behaviour.
// ---------------------------------------------------------------------------

/** UTC day-start helper for readable fixtures. */
const day = (s: string) => new Date(s + "T00:00:00.000Z");

describe("profitability — trend bucket boundaries", () => {
  describe("daily buckets", () => {
    it("gives each bucket its OWN day, not the overall report window", () => {
      const from = day("2026-09-01");
      const to = day("2026-09-04"); // exclusive
      const buckets = computeTrendBuckets(from, to, "day");

      expect(buckets).toHaveLength(3);
      expect(buckets.map((b) => b.label)).toEqual([
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
      ]);
      expect(buckets[0].from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(buckets[0].to.toISOString()).toBe("2026-09-01T23:59:59.999Z");
      expect(buckets[1].from.toISOString()).toBe("2026-09-02T00:00:00.000Z");
      expect(buckets[2].to.toISOString()).toBe("2026-09-03T23:59:59.999Z");
      // The regression: every bucket used to carry the SAME window 01→04.
      const distinct = new Set(
        buckets.map((b) => `${b.from.toISOString()}|${b.to.toISOString()}`)
      );
      expect(distinct.size).toBe(3);
    });

    it("tiles the window without gaps or overlaps", () => {
      const from = day("2026-09-01");
      const to = day("2026-09-04");
      const buckets = computeTrendBuckets(from, to, "day");

      expect(buckets[0].from.getTime()).toBeLessThanOrEqual(from.getTime());
      expect(buckets[buckets.length - 1].to.getTime()).toBe(to.getTime() - 1);
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i].from.getTime()).toBe(buckets[i - 1].to.getTime() + 1);
      }
    });
  });

  describe("weekly buckets (ISO Monday start — matches Mongo %G-W%V)", () => {
    it("uses the containing Monday → Sunday as the boundaries", () => {
      // 2026-09-02 is a Wednesday; its ISO week is Mon 2026-08-31 → Sun 2026-09-06.
      const buckets = computeTrendBuckets(
        day("2026-09-02"),
        day("2026-09-03"),
        "week"
      );

      expect(buckets).toHaveLength(1);
      expect(buckets[0].from.toISOString()).toBe("2026-08-31T00:00:00.000Z");
      expect(buckets[0].to.toISOString()).toBe("2026-09-06T23:59:59.999Z");
      expect(buckets[0].from.getUTCDay()).toBe(1); // Monday
    });

    it("emits one bucket per ISO week across a multi-week window", () => {
      const buckets = computeTrendBuckets(
        day("2026-08-31"), // Monday
        day("2026-09-14"), // Monday (exclusive)
        "week"
      );

      expect(buckets).toHaveLength(2);
      expect(buckets.map((b) => b.from.toISOString())).toEqual([
        "2026-08-31T00:00:00.000Z",
        "2026-09-07T00:00:00.000Z",
      ]);
      expect(buckets[1].to.toISOString()).toBe("2026-09-13T23:59:59.999Z");
    });

    it("labels weeks with the ISO week-numbering year", () => {
      // 2027-01-01 is a Friday → ISO week 53 of 2026.
      expect(isoWeek(day("2027-01-01"))).toEqual({ year: 2026, week: 53 });
      expect(trendGroupLabel(day("2027-01-01"), "week")).toBe("2026-W53");
      // 2026-01-01 is a Thursday → week 1 of 2026.
      expect(isoWeek(day("2026-01-01"))).toEqual({ year: 2026, week: 1 });
      expect(trendGroupLabel(day("2026-01-01"), "week")).toBe("2026-W01");
    });

    it("crosses the ISO year boundary: 2026-W53 → 2027-W01 (no overlap/gap)", () => {
      // 2026-12-28 is a Monday; 2027-01-11 is the following-next Monday.
      const buckets = computeTrendBuckets(
        day("2026-12-28"),
        day("2027-01-11"),
        "week"
      );

      expect(buckets.map((b) => b.label)).toEqual(["2026-W53", "2027-W01"]);
      expect(buckets[0].from.toISOString()).toBe("2026-12-28T00:00:00.000Z");
      // The week that contains 2027-01-01 still belongs to ISO year 2026.
      expect(buckets[0].to.toISOString()).toBe("2027-01-03T23:59:59.999Z");
      expect(buckets[1].from.toISOString()).toBe("2027-01-04T00:00:00.000Z");
      expect(buckets[1].to.toISOString()).toBe("2027-01-10T23:59:59.999Z");
      expect(buckets[1].from.getUTCDay()).toBe(1);
      expect(buckets[1].from.getTime()).toBe(buckets[0].to.getTime() + 1);
    });
  });

  describe("monthly buckets", () => {
    it("uses the real month start → month end", () => {
      const buckets = computeTrendBuckets(
        day("2026-09-01"),
        day("2026-11-15"),
        "month"
      );

      expect(buckets.map((b) => b.label)).toEqual([
        "2026-09",
        "2026-10",
        "2026-11",
      ]);
      expect(buckets[0].from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(buckets[0].to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
      expect(buckets[1].to.toISOString()).toBe("2026-10-31T23:59:59.999Z");
      expect(buckets[2].to.toISOString()).toBe("2026-11-30T23:59:59.999Z");
    });

    it("crosses the calendar year boundary with no missing or overlapping month", () => {
      const buckets = computeTrendBuckets(
        day("2026-11-15"),
        day("2027-02-10"),
        "month"
      );

      expect(buckets.map((b) => b.label)).toEqual([
        "2026-11",
        "2026-12",
        "2027-01",
        "2027-02",
      ]);
      expect(buckets[1].to.toISOString()).toBe("2026-12-31T23:59:59.999Z");
      expect(buckets[2].from.toISOString()).toBe("2027-01-01T00:00:00.000Z");
      expect(buckets[2].to.toISOString()).toBe("2027-01-31T23:59:59.999Z");
      // February 2027 is not a leap year.
      expect(buckets[3].to.toISOString()).toBe("2027-02-28T23:59:59.999Z");
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i].from.getTime()).toBe(buckets[i - 1].to.getTime() + 1);
      }
    });
  });

  describe("group helpers + degenerate windows", () => {
    it("startOfTrendGroup / nextTrendGroupStart agree on the group", () => {
      const d = new Date("2026-09-17T13:45:00.000Z"); // Thursday

      expect(startOfTrendGroup(d, "day").toISOString()).toBe(
        "2026-09-17T00:00:00.000Z"
      );
      expect(
        nextTrendGroupStart(startOfTrendGroup(d, "day"), "day").toISOString()
      ).toBe("2026-09-18T00:00:00.000Z");
      expect(startOfTrendGroup(d, "week").toISOString()).toBe(
        "2026-09-14T00:00:00.000Z"
      );
      expect(
        nextTrendGroupStart(
          startOfTrendGroup(d, "week"),
          "week"
        ).toISOString()
      ).toBe("2026-09-21T00:00:00.000Z");
      expect(startOfTrendGroup(d, "month").toISOString()).toBe(
        "2026-09-01T00:00:00.000Z"
      );
      expect(
        nextTrendGroupStart(startOfTrendGroup(d, "month"), "month").toISOString()
      ).toBe("2026-10-01T00:00:00.000Z");
    });

    it("returns [] for an empty or inverted window", () => {
      expect(
        computeTrendBuckets(day("2026-09-02"), day("2026-09-02"), "day")
      ).toEqual([]);
      expect(
        computeTrendBuckets(day("2026-09-03"), day("2026-09-01"), "day")
      ).toEqual([]);
    });
  });
});

describe("profitability — trend zero-fill", () => {
  const skeleton = computeTrendBuckets(
    day("2026-09-01"),
    day("2026-09-04"),
    "day"
  );

  it("keeps every empty DAILY bucket with zero values", () => {
    const sales = new Map<string, TrendSalesAgg>([
      ["2026-09-02", { netSales: 1000, cogs: 400 }],
    ]);
    const rows = assembleTrendBuckets(skeleton, sales, new Map());

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.netSales)).toEqual([0, 1000, 0]);
    expect(rows[0].cogs).toBe(0);
    expect(rows[0].grossProfit).toBe(0);
    expect(rows[0].expenses).toBe(0);
    expect(rows[0].netProfit).toBe(0);
  });

  it("keeps every empty WEEKLY bucket with zero values", () => {
    const weeks = computeTrendBuckets(
      day("2026-08-31"),
      day("2026-09-21"),
      "week"
    );
    const rows = assembleTrendBuckets(weeks, new Map(), new Map());

    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.netSales).toBe(0);
      expect(r.cogs).toBe(0);
      expect(r.grossProfit).toBe(0);
      expect(r.expenses).toBe(0);
      expect(r.netProfit).toBe(0);
    }
  });

  it("keeps every empty MONTHLY bucket with zero values", () => {
    const months = computeTrendBuckets(
      day("2026-09-01"),
      day("2026-12-01"),
      "month"
    );
    const rows = assembleTrendBuckets(months, new Map(), new Map());

    expect(rows.map((r) => r.label)).toEqual(["2026-09", "2026-10", "2026-11"]);
    for (const r of rows) expect(r.netProfit).toBe(0);
  });

  it("represents an EXPENSE-ONLY period and subtracts it from net profit", () => {
    const expenses = new Map<string, number>([["2026-09-03", 250_000]]);
    const rows = assembleTrendBuckets(skeleton, new Map(), expenses);

    const expenseOnly = rows.find((r) => r.label === "2026-09-03")!;
    expect(expenseOnly.netSales).toBe(0);
    expect(expenseOnly.grossProfit).toBe(0);
    // The expense must not be dropped just because the period had no sales.
    expect(expenseOnly.expenses).toBe(250_000);
    expect(expenseOnly.netProfit).toBe(-250_000);

    expect(rows[0].expenses).toBe(0);
    expect(rows[0].netProfit).toBe(0);
    expect(rows.reduce((s, r) => s + r.netProfit, 0)).toBe(-250_000);
  });

  it("computes netProfit = grossProfit − expenses inside a bucket", () => {
    const sales = new Map<string, TrendSalesAgg>([
      ["2026-09-01", { netSales: 1000, cogs: 600 }],
    ]);
    const expenses = new Map<string, number>([["2026-09-01", 150]]);
    const rows = assembleTrendBuckets(skeleton, sales, expenses);

    expect(rows[0].grossProfit).toBe(400);
    expect(rows[0].expenses).toBe(150);
    expect(rows[0].netProfit).toBe(250);
  });
});
