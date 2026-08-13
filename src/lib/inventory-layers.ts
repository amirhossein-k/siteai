/**
 * Inventory Cost-Layer Helpers — SINGLE SOURCE OF TRUTH for FIFO layer math
 * (Session 82). Pure functions, no I/O — unit-testable in isolation and shared
 * by the initialization wizard (Phase A), purchases/receiving (Phase B),
 * checkout/refund (Phase C) and adjustments (Phase D).
 *
 * FIFO semantics:
 *  - Consumption walks layers by acquiredAt (oldest first; stable for ties).
 *  - A layer is removed from the embedded array once remaining hits 0 (it is
 *    archived to the append-only InventoryMovement ledger by the caller).
 *  - Restoration (returns/cancellations) puts units BACK at their original
 *    unitCost — merging into an existing layer of the same cost when present
 *    (keeps the embedded array bounded), else appending a new layer.
 *
 * These helpers never touch the database. Callers own atomicity (single-doc
 * findOneAndUpdate on the Product document — Mongo serializes per-doc writes,
 * and the standalone Mongo deployment has no multi-document transactions).
 */

export type CostLayerSource = "opening" | "receipt" | "adjustment";

export interface InventoryCostLayer {
  qty: number;
  remaining: number;
  unitCost: number;
  acquiredAt: Date;
  source: CostLayerSource;
  ref: string;
}

/** Per-layer consumption detail — the audit answer to "which cost was consumed". */
export interface LayerConsumption {
  unitCost: number;
  qty: number;
  totalCost: number;
}

export interface ConsumeFifoLayersResult {
  /** Layers with remaining > 0 after consumption (fully-consumed layers removed). */
  layers: InventoryCostLayer[];
  /** Exact per-layer breakdown, oldest-first — for the InventoryMovement sale row. */
  consumed: LayerConsumption[];
  /** Sum of consumedCost = Σ qty_i × unitCost_i. */
  consumedCost: number;
}

/** Build an opening-balance layer (cutover wizard). */
export function buildOpeningLayer(
  qty: number,
  unitCost: number,
  acquiredAt: Date,
  ref = ""
): InventoryCostLayer {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Opening layer quantity must be a positive integer");
  }
  if (!Number.isInteger(unitCost) || unitCost < 0) {
    throw new Error("Opening layer unit cost must be a non-negative integer");
  }
  return {
    qty,
    remaining: qty,
    unitCost,
    acquiredAt,
    source: "opening",
    ref,
  };
}

/**
 * FIFO consumption. Returns null when the available remaining quantity is
 * insufficient (caller must reject the sale — stock and layers move together,
 * so this can only happen on an inconsistency). Walks oldest-acquiredAt first.
 */
export function consumeFifoLayers(
  layers: InventoryCostLayer[],
  qty: number
): ConsumeFifoLayersResult | null {
  if (!Number.isInteger(qty) || qty <= 0) return null;

  const ordered = [...layers].sort(
    (a, b) =>
      a.acquiredAt.getTime() - b.acquiredAt.getTime()
  );

  const totalAvailable = ordered.reduce((s, l) => s + l.remaining, 0);
  if (totalAvailable < qty) return null;

  let need = qty;
  const remainingLayers: InventoryCostLayer[] = [];
  const consumed: LayerConsumption[] = [];
  let consumedCost = 0;

  for (const layer of ordered) {
    if (need <= 0) {
      remainingLayers.push(layer);
      continue;
    }
    const take = Math.min(layer.remaining, need);
    need -= take;
    consumedCost += take * layer.unitCost;
    consumed.push({ unitCost: layer.unitCost, qty: take, totalCost: take * layer.unitCost });
    if (layer.remaining > take) {
      remainingLayers.push({ ...layer, remaining: layer.remaining - take });
    }
    // remaining === take → fully consumed → dropped from the embedded array
  }

  // Preserve the original insertion order for the surviving layers.
  return { layers: remainingLayers, consumed, consumedCost };
}

/**
 * Restore units to the inventory at their original unitCost (returns,
 * cancellations, failed payments). FIFO-consistent: the units go back into a
 * layer of the SAME unitCost — merging with an existing matching layer when
 * present (bounded array) or appending a new one. Returns the updated array.
 */
export function restoreLayers(
  layers: InventoryCostLayer[],
  qty: number,
  unitCost: number,
  opts: { acquiredAt?: Date; source?: CostLayerSource; ref?: string } = {}
): InventoryCostLayer[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Restored quantity must be a positive integer");
  }
  if (!Number.isInteger(unitCost) || unitCost < 0) {
    throw new Error("Restored unit cost must be a non-negative integer");
  }
  const acquiredAt = opts.acquiredAt ?? new Date();
  const source = opts.source ?? "adjustment";
  const ref = opts.ref ?? "";

  const merged = layers.map((l) => ({ ...l }));
  const match = merged.find(
    (l) => l.unitCost === unitCost && l.source === source
  );
  if (match) {
    match.qty += qty;
    match.remaining += qty;
    return merged;
  }
  merged.push({
    qty,
    remaining: qty,
    unitCost,
    acquiredAt,
    source,
    ref,
  });
  return merged;
}

/**
 * Add a brand-new layer (purchase receipt, adjustment increase) to the array.
 * Receipts are separate layers (one layer per receipt — auditability) unless
 * a receipt with the exact same source ref already exists (idempotent retry).
 */
export function addLayer(
  layers: InventoryCostLayer[],
  layer: InventoryCostLayer
): InventoryCostLayer[] {
  if (layer.ref && layers.some((l) => l.ref === layer.ref)) {
    return layers;
  }
  return [...layers, layer];
}

/** Total value of the currently-remaining layers (post-cutover inventory value). */
export function layersValue(layers: InventoryCostLayer[]): number {
  return layers.reduce((s, l) => s + l.remaining * l.unitCost, 0);
}

/** Total remaining units across layers. */
export function layersRemaining(layers: InventoryCostLayer[]): number {
  return layers.reduce((s, l) => s + l.remaining, 0);
}
