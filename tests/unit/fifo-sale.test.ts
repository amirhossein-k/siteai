import { describe, it, expect } from "vitest";
import {
  consumeFifoLayers,
  layersValue,
  layersRemaining,
  restoreLayers,
  type InventoryCostLayer,
} from "@/lib/inventory-layers";

const d = (n: number) => new Date(`2026-08-0${n}T00:00:00.000Z`);

function layer(
  unitCost: number,
  remaining: number,
  acquiredAt: Date = d(1)
): InventoryCostLayer {
  return {
    qty: remaining,
    remaining,
    unitCost,
    acquiredAt,
    source: "receipt",
    ref: "",
  };
}

/** The exact fifoUnitCost formula the checkout route snapshots. */
function fifoUnitCost(
  consumedCost: number,
  quantity: number
): number {
  return consumedCost / quantity;
}

describe("FIFO sale consumption (Session 82 Phase C)", () => {
  it("sale of 15 across two receipts computes exact FIFO COGS + remaining layer", () => {
    // Receive 10 × 100 then 10 × 200, sell 15 → COGS = 10×100 + 5×200
    const layers = [layer(100, 10, d(1)), layer(200, 10, d(2))];
    const r = consumeFifoLayers(layers, 15);
    expect(r).not.toBeNull();
    expect(r!.consumedCost).toBe(2000);
    expect(r!.consumed).toEqual([
      { unitCost: 100, qty: 10, totalCost: 1000 },
      { unitCost: 200, qty: 5, totalCost: 1000 },
    ]);
    // Remaining: 5 × 200 → inventory valuation = 1000
    expect(layersRemaining(r!.layers)).toBe(5);
    expect(layersValue(r!.layers)).toBe(1000);
    // fifoUnitCost snapshot = 2000 / 15
    expect(fifoUnitCost(r!.consumedCost, 15)).toBeCloseTo(133.333, 3);
  });

  it("changing Product.supplierPrice NEVER changes layer-based COGS", () => {
    // Receive 10 × 100. The product's supplierPrice later becomes 500 —
    // the sale's cost comes from the layer, not the current supplierPrice.
    const layers = [layer(100, 10, d(1))];
    const r = consumeFifoLayers(layers, 5);
    expect(r!.consumedCost).toBe(500); // 5 × 100, NOT 5 × 500
    expect(fifoUnitCost(r!.consumedCost, 5)).toBe(100);
    // Remaining layers still valued at their original cost
    expect(layersValue(r!.layers)).toBe(500);
  });

  it("partial layer consumption keeps the remainder at its original cost", () => {
    const layers = [layer(100, 4, d(1)), layer(200, 6, d(2))];
    const r = consumeFifoLayers(layers, 6);
    expect(r!.consumedCost).toBe(800); // 4×100 + 2×200
    expect(r!.layers).toHaveLength(1);
    expect(r!.layers[0]).toMatchObject({ unitCost: 200, remaining: 4 });
    expect(layersValue(r!.layers)).toBe(800);
  });

  it("consume → restore at the SAME original cost → consume again (roundtrip)", () => {
    // Receive 10×100 + 5×200, sell 12 → COGS 1400 (10×100 + 2×200)
    const layers = [layer(100, 10, d(1)), layer(200, 5, d(2))];
    const r = consumeFifoLayers(layers, 12);
    expect(r!.consumedCost).toBe(1400);
    expect(layersRemaining(r!.layers)).toBe(3); // 3 × 200
    // A refund/cancel restores units at the snapshot FIFO unit cost — the
    // route passes Math.round(fifoUnitCost); the pure helper validates ints.
    const restored = restoreLayers(r!.layers, 12, 117); // ≈ 1400/12
    expect(layersRemaining(restored)).toBe(15);
    expect(layersValue(restored)).toBe(600 + 12 * 117);
  });

  it("restoring the exact consumed layers keeps FIFO ordering", () => {
    const layers = [layer(100, 5, d(1)), layer(200, 5, d(2))];
    const r = consumeFifoLayers(layers, 8);
    expect(r!.consumed.map((c) => c.unitCost)).toEqual([100, 200]);
    // Remaining: 2×200. Restore 4 units at cost 100 → a new layer at that
    // cost (the original 100 layer was fully consumed).
    const out = restoreLayers(r!.layers, 4, 100);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ unitCost: 200, remaining: 2 });
    expect(out[1]).toMatchObject({ unitCost: 100, remaining: 4 });
    // FIFO by acquiredAt: the restored 100 layer is newest → consumed last
    const again = consumeFifoLayers(out, 3);
    expect(again!.consumed.map((c) => c.unitCost)).toEqual([200, 100]);
    expect(again!.consumedCost).toBe(500); // 2×200 + 1×100
  });

  it("variant isolation: each variant consumes ONLY its own layers", () => {
    // Variant A: 10 × 100 — Variant B: 10 × 200 (separate arrays)
    const variantA = [layer(100, 10, d(1))];
    const variantB = [layer(200, 10, d(1))];
    const a = consumeFifoLayers(variantA, 6);
    const b = consumeFifoLayers(variantB, 3);
    expect(a!.consumedCost).toBe(600);
    expect(b!.consumedCost).toBe(600); // 3 × 200
    expect(layersRemaining(a!.layers)).toBe(4);
    expect(layersRemaining(b!.layers)).toBe(7);
    // One variant can never consume another's layers
    expect(layersValue(a!.layers)).toBe(400);
    expect(layersValue(b!.layers)).toBe(1400);
  });

  it("insufficient FIFO layers → null (fail-safe, never invents cost)", () => {
    // stock says 10 but layers only cover 4 → the sale MUST fail
    const layers = [layer(100, 4, d(1))];
    expect(consumeFifoLayers(layers, 5)).toBeNull();
    // Empty layers (purchased product with no opening/receipt) → fail-safe too
    expect(consumeFifoLayers([], 1)).toBeNull();
  });

  it("fifoUnitCost is the exact weighted average (10×100 + 5×200 over 15)", () => {
    const r = consumeFifoLayers([layer(100, 10, d(1)), layer(200, 5, d(2))], 15);
    expect(r!.consumedCost).toBe(2000);
    const unit = fifoUnitCost(r!.consumedCost, 15);
    expect(unit).toBeCloseTo(133.333, 3);
  });

  it("exact-boundary sale fully consumes the oldest layer", () => {
    const layers = [layer(100, 5, d(1)), layer(200, 5, d(2))];
    const r = consumeFifoLayers(layers, 5);
    expect(r!.consumedCost).toBe(500);
    expect(r!.consumed).toEqual([{ unitCost: 100, qty: 5, totalCost: 500 }]);
    expect(r!.layers).toHaveLength(1);
    expect(r!.layers[0].unitCost).toBe(200);
  });
});
