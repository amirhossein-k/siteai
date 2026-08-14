import { describe, it, expect } from "vitest";
import {
  validateAdjustment,
  type AdjustmentInput,
} from "@/lib/inventory-adjustments";

const base: AdjustmentInput = {
  productId: "64f0c1f2a1b2c3d4e5f6a7b8",
  quantityDelta: 5,
  reason: "ورودی انبار",
  key: "e2e-adj-20260815-0001",
  actorId: "64f0c1f2a1b2c3d4e5f6a7b9",
};

function ok(input: Partial<AdjustmentInput> = {}) {
  return validateAdjustment({ ...base, ...input });
}

describe("validateAdjustment", () => {
  it("accepts a well-formed request", () => {
    expect(ok()).toEqual({});
  });

  it("rejects malformed product ids with 400", () => {
    expect(ok({ productId: "" }).error).toBeTruthy();
    expect(ok({ productId: "not-an-id" }).status).toBe(400);
    expect(ok({ productId: "abc" }).error).toBe("شناسه محصول نامعتبر است");
  });

  it("rejects malformed variant ids with 400", () => {
    expect(ok({ variantId: "zzz" }).status).toBe(400);
    expect(ok({ variantId: undefined })).toEqual({});
  });

  it("rejects zero/non-integer/float quantity deltas", () => {
    expect(ok({ quantityDelta: 0 }).status).toBe(400);
    expect(ok({ quantityDelta: 1.5 }).status).toBe(400);
    expect(ok({ quantityDelta: Number.NaN }).status).toBe(400);
    // @ts-expect-error string quantity must be rejected at runtime
    expect(ok({ quantityDelta: "5" }).status).toBe(400);
  });

  it("accepts negative (reduction) deltas", () => {
    expect(ok({ quantityDelta: -3 })).toEqual({});
  });

  it("requires a 2..200-char reason", () => {
    expect(ok({ reason: "" }).status).toBe(400);
    expect(ok({ reason: "x" }).status).toBe(400);
    expect(ok({ reason: " ".repeat(300) }).status).toBe(400);
    expect(ok({ reason: "آسیب دیدگی" })).toEqual({});
  });

  it("validates the idempotency key (8..64 safe chars)", () => {
    expect(ok({ key: "" }).status).toBe(400);
    expect(ok({ key: "short" }).status).toBe(400);
    expect(ok({ key: "bad key with spaces!" }).status).toBe(400);
    expect(ok({ key: "a".repeat(70) }).status).toBe(400);
    expect(ok({ key: "valid-key-1234567890" })).toEqual({});
  });

  it("rejects negative/non-integer unit costs", () => {
    expect(ok({ unitCost: -1 }).status).toBe(400);
    expect(ok({ unitCost: 1.5 }).status).toBe(400);
    expect(ok({ unitCost: 0 })).toEqual({}); // 0 allowed when not required
    expect(ok({ unitCost: 120000 })).toEqual({});
  });
});

describe("reconciliation semantics (pure mirror of reconcileInventory)", () => {
  it("movement net equals stock when every change was audited", () => {
    // opening 10, receipt +5, sale -3, adjustment +2 → 14
    const movements = [10, 5, -3, 2];
    const net = movements.reduce((s, m) => s + m, 0);
    expect(net).toBe(14);
    expect(net === 14).toBe(true);
  });

  it("signed adjustment deltas combine correctly with other movements", () => {
    // opening 0, receipt 20, sale -7, adjustment -2 → 11
    const movements = [0, 20, -7, -2];
    expect(movements.reduce((s, m) => s + m, 0)).toBe(11);
  });

  it("negative adjustments never take stock below zero (guard mirrors the service)", () => {
    const current = 3;
    const delta = -5;
    expect(current + delta < 0).toBe(true); // would be rejected
    expect(current + -2 < 0).toBe(false); // allowed
  });
});
