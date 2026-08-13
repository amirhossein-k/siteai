import { describe, it, expect } from "vitest";
import {
  addLayer,
  buildOpeningLayer,
  consumeFifoLayers,
  layersRemaining,
  layersValue,
  restoreLayers,
  type InventoryCostLayer,
} from "@/lib/inventory-layers";

const d = (n: number) => new Date(`2026-08-0${n}T00:00:00.000Z`);

function layer(partial: Partial<InventoryCostLayer> & { unitCost: number }): InventoryCostLayer {
  return {
    qty: partial.qty ?? partial.remaining ?? 1,
    remaining: partial.remaining ?? partial.qty ?? 1,
    unitCost: partial.unitCost,
    acquiredAt: partial.acquiredAt ?? d(1),
    source: partial.source ?? "receipt",
    ref: partial.ref ?? "",
  };
}

describe("buildOpeningLayer", () => {
  it("creates a full remaining opening layer", () => {
    const l = buildOpeningLayer(100, 120000, d(1), "opening-P1");
    expect(l).toMatchObject({
      qty: 100,
      remaining: 100,
      unitCost: 120000,
      source: "opening",
      ref: "opening-P1",
    });
  });

  it("rejects zero/negative quantity and negative cost", () => {
    expect(() => buildOpeningLayer(0, 1000, d(1))).toThrow();
    expect(() => buildOpeningLayer(-1, 1000, d(1))).toThrow();
    expect(() => buildOpeningLayer(10, -1, d(1))).toThrow();
    expect(() => buildOpeningLayer(1.5, 1000, d(1))).toThrow();
  });
});

describe("consumeFifoLayers", () => {
  it("consumes entirely from the single oldest layer", () => {
    const layers = [layer({ unitCost: 100, remaining: 10 }), layer({ unitCost: 200, remaining: 5, acquiredAt: d(2) })];
    const r = consumeFifoLayers(layers, 3);
    expect(r).not.toBeNull();
    expect(r!.consumedCost).toBe(300);
    expect(r!.consumed).toEqual([{ unitCost: 100, qty: 3, totalCost: 300 }]);
    expect(r!.layers).toHaveLength(2);
    expect(r!.layers[0].remaining).toBe(7);
    expect(r!.layers[1].remaining).toBe(5);
  });

  it("spans multiple layers oldest-first", () => {
    const layers = [
      layer({ unitCost: 100, remaining: 5, acquiredAt: d(1) }),
      layer({ unitCost: 200, remaining: 5, acquiredAt: d(2) }),
      layer({ unitCost: 300, remaining: 5, acquiredAt: d(3) }),
    ];
    const r = consumeFifoLayers(layers, 12);
    expect(r).not.toBeNull();
    expect(r!.consumed).toEqual([
      { unitCost: 100, qty: 5, totalCost: 500 },
      { unitCost: 200, qty: 5, totalCost: 1000 },
      { unitCost: 300, qty: 2, totalCost: 600 },
    ]);
    expect(r!.consumedCost).toBe(2100);
    // First two layers fully consumed (removed), third partially left
    expect(r!.layers).toHaveLength(1);
    expect(r!.layers[0].unitCost).toBe(300);
    expect(r!.layers[0].remaining).toBe(3);
  });

  it("exact consumption removes the layer", () => {
    const layers = [layer({ unitCost: 100, remaining: 4 })];
    const r = consumeFifoLayers(layers, 4);
    expect(r).not.toBeNull();
    expect(r!.layers).toHaveLength(0);
    expect(r!.consumedCost).toBe(400);
  });

  it("returns null when quantity exceeds available remaining", () => {
    const layers = [layer({ unitCost: 100, remaining: 4 })];
    expect(consumeFifoLayers(layers, 5)).toBeNull();
  });

  it("returns null for invalid quantity", () => {
    const layers = [layer({ unitCost: 100, remaining: 4 })];
    expect(consumeFifoLayers(layers, 0)).toBeNull();
    expect(consumeFifoLayers(layers, -3)).toBeNull();
    expect(consumeFifoLayers(layers, 2.5)).toBeNull();
  });

  it("empty layers return null for any positive quantity", () => {
    expect(consumeFifoLayers([], 1)).toBeNull();
  });

  it("is deterministic regardless of array order (FIFO by acquiredAt)", () => {
    const shuffled = [
      layer({ unitCost: 300, remaining: 5, acquiredAt: d(3) }),
      layer({ unitCost: 100, remaining: 5, acquiredAt: d(1) }),
      layer({ unitCost: 200, remaining: 5, acquiredAt: d(2) }),
    ];
    const r = consumeFifoLayers(shuffled, 12);
    expect(r!.consumed.map((c) => c.unitCost)).toEqual([100, 200, 300]);
    expect(r!.consumedCost).toBe(2100);
  });
});

describe("restoreLayers", () => {
  it("restores into an existing layer of the same unit cost AND source", () => {
    const layers = [layer({ unitCost: 100, remaining: 5, source: "adjustment" })];
    const out = restoreLayers(layers, 3, 100);
    expect(out).toHaveLength(1);
    expect(out[0].remaining).toBe(8);
    expect(out[0].qty).toBe(8);
  });

  it("appends a new layer when no matching cost exists (original cost preserved)", () => {
    const layers = [layer({ unitCost: 100, remaining: 5 })];
    const out = restoreLayers(layers, 2, 250);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ unitCost: 250, remaining: 2, source: "adjustment" });
    expect(out[1].acquiredAt).toBeInstanceOf(Date);
  });

  it("FIFO order is preserved after restore (restored layer stays at its cost)", () => {
    const layers = [
      layer({ unitCost: 100, remaining: 2, acquiredAt: d(1) }),
      layer({ unitCost: 200, remaining: 2, acquiredAt: d(2) }),
    ];
    const out = restoreLayers(layers, 1, 100);
    // Consumption still hits the 100 layer first
    const r = consumeFifoLayers(out, 3);
    expect(r!.consumed.map((c) => c.unitCost)).toEqual([100, 200]);
  });

  it("rejects invalid restore inputs", () => {
    expect(() => restoreLayers([], 0, 100)).toThrow();
    expect(() => restoreLayers([], 2, -5)).toThrow();
    expect(() => restoreLayers([], 1.5, 100)).toThrow();
  });
});

describe("addLayer / value helpers", () => {
  it("addLayer appends distinct receipts and dedupes the same ref", () => {
    const a = buildOpeningLayer(10, 100, d(1), "opening-P1");
    const b = layer({ unitCost: 200, remaining: 5, ref: "rcpt-1" });
    let layers = addLayer([], a);
    layers = addLayer(layers, b);
    expect(layers).toHaveLength(2);
    layers = addLayer(layers, b); // same ref → no duplicate
    expect(layers).toHaveLength(2);
  });

  it("layersValue sums remaining × unitCost", () => {
    const layers = [
      layer({ unitCost: 100, remaining: 3 }),
      layer({ unitCost: 200, remaining: 2 }),
    ];
    expect(layersValue(layers)).toBe(700);
  });

  it("layersRemaining sums remaining quantities", () => {
    const layers = [
      layer({ unitCost: 100, remaining: 3 }),
      layer({ unitCost: 200, remaining: 2 }),
    ];
    expect(layersRemaining(layers)).toBe(5);
  });
});
