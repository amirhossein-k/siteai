import { describe, it, expect } from "vitest";
import { parseReportFilters } from "@/lib/report-utils";
import { validateExpenseBody } from "@/app/api/admin/expenses/route";
import { buildStatementRows } from "@/lib/reports";
import type { ReportSummary } from "@/types";

/** Minimal order-summary fixture (only the fields buildStatementRows reads). */
function makeSummary(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    from: "2026-08-01",
    to: "2026-08-31",
    preset: "month",
    orders: 3,
    unitsSold: 5,
    grossSales: 1_000_000,
    productDiscount: 50_000,
    couponDiscount: 30_000,
    netSales: 920_000,
    cogs: 400_000,
    grossProfit: 520_000,
    grossMargin: 56.5,
    refundedOrders: 0,
    refunds: 0,
    paidAmount: 920_000,
    pendingAmount: 0,
    outstandingAmount: 0,
    avgOrderValue: 306_666,
    inventoryValue: 250_000,
    inventoryCost: 250_000,
    ...overrides,
  };
}

describe("parseReportFilters — expense kind (Session 82 Phase E)", () => {
  it("parses expense status + category for kind: expense", () => {
    const res = parseReportFilters(
      { preset: "month", status: "pending", category: "gateway_fees", q: "درگاه" },
      { kind: "expense" }
    );
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.filters.expenseStatus).toBe("pending");
    expect(res.filters.expenseCategory).toBe("gateway_fees");
    expect(res.filters.orderStatus).toBeUndefined();
    expect(res.filters.q).toBe("درگاه");
  });

  it("rejects an invalid expense status", () => {
    const res = parseReportFilters(
      { preset: "month", status: "bogus" },
      { kind: "expense" }
    );
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("وضعیت هزینه");
  });

  it("rejects an invalid expense category", () => {
    const res = parseReportFilters(
      { preset: "month", category: "not-a-category" },
      { kind: "expense" }
    );
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("دسته‌بندی هزینه");
  });

  it("does not treat an expense category as a product ObjectId", () => {
    const res = parseReportFilters(
      { preset: "month", category: "rent" },
      { kind: "expense" }
    );
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.filters.expenseCategory).toBe("rent");
    expect(res.filters.categoryId).toBeUndefined();
  });

  it("keeps the order kind semantics unchanged (status → orderStatus)", () => {
    const res = parseReportFilters({ preset: "month", status: "shipped" });
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.filters.orderStatus).toBe("shipped");
    expect(res.filters.expenseStatus).toBeUndefined();
  });
});

describe("validateExpenseBody (Session 82 Phase E)", () => {
  it("accepts a valid full body", () => {
    const res = validateExpenseBody({
      category: "advertising",
      description: "تبلیغات اینستاگرام",
      amount: 2_500_000,
      expenseDate: "2026-08-10",
      paymentMethod: "bank",
      reference: "INV-1",
      payee: "آژانس تبلیغاتی",
      notes: "کمپین مرداد",
      status: "pending",
    });
    expect(res.error).toBeUndefined();
    expect(res.data?.category).toBe("advertising");
    expect(res.data?.amount).toBe(2_500_000);
    expect(res.data?.paymentMethod).toBe("bank");
  });

  it("rejects an unknown category", () => {
    const res = validateExpenseBody({ category: "nope", description: "x", amount: 1000 });
    expect(res.error).toContain("دسته‌بندی هزینه");
  });

  it("rejects a non-integer / negative amount", () => {
    expect(validateExpenseBody({ amount: 1000.5 })?.error).toContain("مبلغ");
    expect(validateExpenseBody({ amount: -5 })?.error).toContain("مبلغ");
  });

  it("rejects a too-short description", () => {
    const res = validateExpenseBody({ description: "x" });
    expect(res.error).toContain("شرح");
  });

  it("rejects a status of void at creation/update (void only via the void flow)", () => {
    const res = validateExpenseBody({ status: "void" });
    expect(res.error).toContain("باطل");
  });

  it("rejects an invalid date", () => {
    const res = validateExpenseBody({ expenseDate: "not-a-date" });
    expect(res.error).toContain("تاریخ");
  });

  it("partial mode allows empty strings for optional fields", () => {
    const res = validateExpenseBody(
      { reference: "", payee: "", notes: "" },
      { partial: true }
    );
    expect(res.error).toBeUndefined();
    expect(res.data?.reference).toBe("");
  });
});

describe("buildStatementRows — P&L V2 net profit (Session 82 Phase E)", () => {
  it("computes netProfit = grossProfit − operatingExpenses", () => {
    const rows = buildStatementRows(makeSummary(), 250_000, 120_000);
    const netProfit = rows.find((r) => r.key === "netProfit");
    const expenses = rows.find((r) => r.key === "operatingExpenses");
    expect(expenses?.amount).toBe(-120_000);
    expect(netProfit?.amount).toBe(520_000 - 120_000);
    expect(netProfit?.unavailable).toBeUndefined();
  });

  it("netProfit equals grossProfit when no expenses recorded (real zero, not fake)", () => {
    const rows = buildStatementRows(makeSummary(), 250_000, 0);
    const netProfit = rows.find((r) => r.key === "netProfit");
    expect(netProfit?.amount).toBe(520_000);
  });

  it("keeps the order of the statement lines", () => {
    const rows = buildStatementRows(makeSummary(), 250_000, 100);
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([
      "gross",
      "productDiscount",
      "couponDiscount",
      "net",
      "cogs",
      "grossProfit",
      "margin",
      "refunds",
      "operatingExpenses",
      "netProfit",
      "inventory",
    ]);
  });

  it("percent is null-safe for a zero-net window", () => {
    const rows = buildStatementRows(makeSummary({ netSales: 0, grossProfit: 0 }), 0, 0);
    const netProfit = rows.find((r) => r.key === "netProfit");
    expect(netProfit?.amount).toBe(0);
    expect(netProfit?.percent).toBeNull();
  });
});
