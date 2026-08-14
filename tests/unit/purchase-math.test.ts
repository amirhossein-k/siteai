import { describe, it, expect } from "vitest";
import {
  computeSubtotal,
  computeTotal,
  derivePaymentStatus,
  deriveStatus,
  lineTotal,
  outstandingOf,
  receiveDeltaOk,
  totalOrdered,
  totalOutstanding,
  totalReceived,
  type PurchaseLine,
} from "@/lib/purchase-math";

const line = (quantity: number, unitCost: number, receivedQuantity = 0): PurchaseLine => ({
  quantity,
  unitCost,
  receivedQuantity,
});

describe("line totals", () => {
  it("lineTotal = quantity × unitCost", () => {
    expect(lineTotal(line(3, 120000))).toBe(360000);
  });

  it("computeSubtotal sums lines", () => {
    expect(computeSubtotal([line(2, 1000), line(3, 2000)])).toBe(8000);
  });

  it("computeTotal = subtotal − discount + additionalCosts", () => {
    expect(computeTotal(8000, 1000, 500)).toBe(7500);
    expect(computeTotal(8000, 0, 0)).toBe(8000);
  });

  it("computeTotal never below zero (discount clamp)", () => {
    expect(computeTotal(500, 900, 0)).toBe(0);
  });
});

describe("outstanding / status derivation", () => {
  it("outstanding = ordered − received", () => {
    expect(outstandingOf(line(10, 100, 4))).toBe(6);
    expect(outstandingOf(line(10, 100, 10))).toBe(0);
    expect(outstandingOf(line(10, 100, 12))).toBe(0); // clamp, never negative
  });

  it("full receipt → received", () => {
    const items = [line(10, 100, 10), line(5, 200, 5)];
    expect(deriveStatus(items, "ordered")).toBe("received");
  });

  it("partial receipt → partially_received", () => {
    const items = [line(10, 100, 4), line(5, 200, 5)];
    expect(deriveStatus(items, "ordered")).toBe("partially_received");
    expect(totalOutstanding(items)).toBe(6);
  });

  it("no receipt keeps draft/ordered", () => {
    const items = [line(10, 100, 0)];
    expect(deriveStatus(items, "draft")).toBe("draft");
    expect(deriveStatus(items, "ordered")).toBe("ordered");
  });

  it("cancelled is never derived away", () => {
    expect(deriveStatus([line(10, 100, 0)], "cancelled")).toBe("cancelled");
  });

  it("mixed totals", () => {
    const items = [line(10, 100, 4), line(5, 200, 5)];
    expect(totalOrdered(items)).toBe(15);
    expect(totalReceived(items)).toBe(9);
  });
});

describe("payment status", () => {
  it("unpaid → partial → paid", () => {
    expect(derivePaymentStatus(0, 1000)).toBe("unpaid");
    expect(derivePaymentStatus(400, 1000)).toBe("partial");
    expect(derivePaymentStatus(1000, 1000)).toBe("paid");
  });

  it("overpay clamps to paid", () => {
    expect(derivePaymentStatus(1200, 1000)).toBe("paid");
  });
});

describe("receive validation", () => {
  const l = line(10, 100, 4); // outstanding 6

  it("accepts a valid delta", () => {
    expect(receiveDeltaOk(l, 6)).toBe(true);
  });

  it("rejects zero / negative / fractional", () => {
    expect(receiveDeltaOk(l, 0)).toBe(false);
    expect(receiveDeltaOk(l, -1)).toBe(false);
    expect(receiveDeltaOk(l, 2.5)).toBe(false);
  });

  it("rejects over-receive", () => {
    expect(receiveDeltaOk(l, 7)).toBe(false);
    expect(receiveDeltaOk(l, 999)).toBe(false);
  });
});
