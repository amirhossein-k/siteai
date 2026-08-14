/**
 * Shared Atomic Inventory Helpers
 *
 * SINGLE SOURCE OF TRUTH for stock reservation and restoration.
 * Used by:
 *  - /api/checkout (reserve stock before order creation)
 *  - /api/payment/verify (restore stock on failed/cancelled payment)
 *  - /api/admin/orders (restore stock on admin cancellation)
 *
 * Concurrency model (unchanged from Session 26):
 *  - Optimistic locking via stockVersion (top-level for simple products,
 *    per-variant stockVersion for variant products)
 *  - Single-document atomic findOneAndUpdate (no multi-doc transactions)
 *  - Idempotent restoration via the Order.stockRestored atomic claim
 *
 * Variant products also keep the top-level `stock` summary in sync atomically
 * so list filters (`stock > 0`) and badges stay accurate.
 */

import Product from "@/models/Product";
import Order from "@/models/Order";
import InventoryMovement from "@/models/InventoryMovement";
import {
  consumeFifoLayers,
  restoreLayers,
  type ConsumeFifoLayersResult,
  type InventoryCostLayer,
} from "@/lib/inventory-layers";

export interface ReservedItem {
  product: Record<string, unknown>;
  variant?: Record<string, unknown> | null;
}

/**
 * FIFO consumption snapshot attached to a successfully reserved product doc
 * (purchased sourcing only). `null`/absent on consignment reservations.
 * Checkout reads it to snapshot OrderItem.fifoUnitCost and to drive the sale
 * movement ledger.
 */
export interface FifoConsumption extends ConsumeFifoLayersResult {
  /** Exact weighted unit cost = consumedCost / quantity (whole toman rounding in reports). */
  fifoUnitCost: number;
}

/** Number of optimistic-lock retries for the FIFO consumption path. */
const FIFO_RESERVE_MAX_ATTEMPTS = 5;

/**
 * Atomically reserve stock for a single product/variant.
 *
 * Session 82 Phase C: FIFO cost-layer consumption is folded into the SAME
 * single-document atomic update for `sourcing: "purchased"` products — stock
 * and layers move together, so a concurrent checkout can never consume the
 * same FIFO quantity twice (Mongo serializes per-document writes; the
 * stockVersion optimistic lock re-reads on conflict). Consignment products
 * keep the EXACT pre-Phase-C path (stock-only $inc).
 *
 * For a simple product (no variantId):
 *   matches { _id, stock: { $gte: qty }, stockVersion: current }
 *   $inc { stock: -qty, stockVersion: 1 }
 *   [+ $set costLayers for purchased products]
 *
 * For a variant (variantId provided):
 *   matches { _id, variants: { $elemMatch: { _id, isActive, stock: { $gte: qty },
 *             stockVersion: current } } }
 *   $inc { "variants.$.stock": -qty, "variants.$.stockVersion": 1, stock: -qty }
 *   [+ $set "variants.$.costLayers" for purchased products]
 *
 * Returns the updated product document (or null if the reservation failed).
 * For purchased products the returned doc carries `__fifoConsumption` (a
 * FifoConsumption snapshot: consumed layers + fifoUnitCost). The caller is
 * responsible for checking product/variant price + isActive and rolling back
 * on any failure.
 */
export async function reserveStock(
  productId: string,
  quantity: number,
  variantId?: string
): Promise<Record<string, unknown> | null> {
  if (variantId) return reserveVariant(productId, quantity, variantId);
  return reserveSimple(productId, quantity);
}

/** Simple-product reservation (consignment byte-identical; purchased adds FIFO). */
async function reserveSimple(
  productId: string,
  quantity: number
): Promise<Record<string, unknown> | null> {
  // Step 1: read current stockVersion + sourcing + layers (optimistic lock token)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current: any = await Product.findById(productId)
    .select("stock stockVersion sourcing costLayers")
    .lean();

  if (!current) return null;
  if (current.stock < quantity) return null;

  // Purchased → consume FIFO layers in the SAME atomic update (retry loop so
  // two simultaneous checkouts each get their own layer — never oversold).
  if (current.sourcing === "purchased") {
    return reserveSimplePurchased(productId, quantity, current);
  }

  // --- Consignment: exact pre-Phase-C behavior ---
  const currentVersion = current.stockVersion ?? 0;
  const reserved = await Product.findOneAndUpdate(
    {
      _id: productId,
      stock: { $gte: quantity },
      stockVersion: currentVersion,
    },
    {
      $inc: { stock: -quantity, stockVersion: 1 },
    },
    { new: true }
  ).lean();

  return reserved as Record<string, unknown> | null;
}

/** Purchased simple product — consume FIFO layers atomically with stock. */
async function reserveSimplePurchased(
  productId: string,
  quantity: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initial: any
): Promise<Record<string, unknown> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = initial;
  for (let attempt = 0; attempt < FIFO_RESERVE_MAX_ATTEMPTS; attempt++) {
    const consumption = consumeFifoLayers(
      (current.costLayers ?? []) as InventoryCostLayer[],
      quantity
    );
    // Insufficient FIFO layers → fail SAFELY (never invent cost from
    // supplierPrice; the stock/layers invariant should make this unreachable).
    if (!consumption) return null;

    const fifo: FifoConsumption = {
      ...consumption,
      fifoUnitCost: consumption.consumedCost / quantity,
    };
    const currentVersion = current.stockVersion ?? 0;

    const reserved = await Product.findOneAndUpdate(
      {
        _id: productId,
        stock: { $gte: quantity },
        stockVersion: currentVersion,
      },
      {
        $inc: { stock: -quantity, stockVersion: 1 },
        $set: { costLayers: consumption.layers },
      },
      { new: true }
    ).lean();

    if (reserved) {
      return {
        ...(reserved as Record<string, unknown>),
        __fifoConsumption: fifo,
      };
    }

    // Version conflict (concurrent sale) → re-read fresh layers + retry.
    current = await Product.findById(productId)
      .select("stock stockVersion sourcing costLayers")
      .lean();
    if (!current || current.stock < quantity) return null;
  }
  return null;
}

/** Variant reservation (consignment byte-identical; purchased adds FIFO). */
async function reserveVariant(
  productId: string,
  quantity: number,
  variantId: string
): Promise<Record<string, unknown> | null> {
  // Step 1: read the variant's current stockVersion + product sourcing + layers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current: any = await Product.findOne(
    { _id: productId, "variants._id": variantId },
    { sourcing: 1, "variants.$": 1 }
  ).lean();

  if (!current) return null;
  const variant = current.variants?.[0];
  if (!variant) return null;
  if (variant.stock < quantity) return null;
  if (variant.isActive === false) return null;

  // Purchased → consume the variant's own FIFO layers in the SAME atomic
  // update (per-variant layers — one variant can never consume another's).
  if (current.sourcing === "purchased") {
    return reserveVariantPurchased(productId, quantity, variantId, variant);
  }

  // --- Consignment: exact pre-Phase-C behavior ---
  const currentVersion = variant.stockVersion ?? 0;
  const reserved = await Product.findOneAndUpdate(
    {
      _id: productId,
      variants: {
        $elemMatch: {
          _id: variantId,
          isActive: true,
          stock: { $gte: quantity },
          stockVersion: currentVersion,
        },
      },
    },
    {
      $inc: {
        "variants.$.stock": -quantity,
        "variants.$.stockVersion": 1,
        stock: -quantity, // keep top-level summary in sync atomically
      },
    },
    { new: true }
  ).lean();

  return reserved as Record<string, unknown> | null;
}

/** Purchased variant — consume that variant's FIFO layers atomically with stock. */
async function reserveVariantPurchased(
  productId: string,
  quantity: number,
  variantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialVariant: any
): Promise<Record<string, unknown> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let variant: any = initialVariant;
  for (let attempt = 0; attempt < FIFO_RESERVE_MAX_ATTEMPTS; attempt++) {
    const consumption = consumeFifoLayers(
      (variant.costLayers ?? []) as InventoryCostLayer[],
      quantity
    );
    if (!consumption) return null;

    const fifo: FifoConsumption = {
      ...consumption,
      fifoUnitCost: consumption.consumedCost / quantity,
    };
    const currentVersion = variant.stockVersion ?? 0;

    const reserved = await Product.findOneAndUpdate(
      {
        _id: productId,
        variants: {
          $elemMatch: {
            _id: variantId,
            isActive: true,
            stock: { $gte: quantity },
            stockVersion: currentVersion,
          },
        },
      },
      {
        $inc: {
          "variants.$.stock": -quantity,
          "variants.$.stockVersion": 1,
          stock: -quantity,
        },
        $set: { "variants.$.costLayers": consumption.layers },
      },
      { new: true }
    ).lean();

    if (reserved) {
      return {
        ...(reserved as Record<string, unknown>),
        __fifoConsumption: fifo,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh: any = await Product.findOne(
      { _id: productId, "variants._id": variantId },
      { sourcing: 1, "variants.$": 1 }
    ).lean();
    if (!fresh) return null;
    variant = fresh.variants?.[0];
    if (!variant || variant.stock < quantity || variant.isActive === false) {
      return null;
    }
  }
  return null;
}

/**
 * Atomically set a variant's stock to an absolute value (supplier quick-edit).
 *
 * Same optimistic-lock pattern as reserveStock():
 *   - Reads the target variant's current stockVersion
 *   - Atomically $set the new stock ONLY if the version still matches
 *     ($elemMatch binds _id + stockVersion to the same array element)
 *   - Keeps the top-level summary `stock` in sync by applying the delta
 *     atomically in the same update
 *   - $inc the variant's stockVersion + the top-level stockVersion
 *     (top-level version is auto-incremented by the Product pre-hook)
 *
 * Returns the updated product document, or null if the variant doesn't
 * exist / is inactive / stock would go negative / concurrent modification
 * (version mismatch → caller returns 409).
 */
export async function setVariantStock(
  productId: string,
  variantId: string,
  newStock: number
): Promise<Record<string, unknown> | null> {
  if (!Number.isFinite(newStock) || newStock < 0 || !Number.isInteger(newStock)) {
    return null;
  }

  // Step 1: read the variant's current stockVersion + stock (optimistic lock token)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current: any = await Product.findOne(
    { _id: productId, "variants._id": variantId },
    { "variants.$": 1 }
  ).lean();

  if (!current) return null;
  const variant = current.variants?.[0];
  if (!variant) return null;
  if (variant.isActive === false) return null;

  const currentVersion = variant.stockVersion ?? 0;
  const currentStock = variant.stock ?? 0;
  const delta = newStock - currentStock;

  // Step 2: atomically $set the new stock ONLY if the version still matches,
  // and apply the delta to the top-level summary in the same atomic update.
  const updated = await Product.findOneAndUpdate(
    {
      _id: productId,
      variants: {
        $elemMatch: {
          _id: variantId,
          isActive: true,
          stockVersion: currentVersion,
        },
      },
    },
    {
      $set: {
        "variants.$.stock": newStock,
      },
      $inc: {
        stock: delta, // keep top-level summary in sync atomically
        "variants.$.stockVersion": 1,
      },
    },
    { new: true }
  ).lean();

  return updated as Record<string, unknown> | null;
}

/**
 * Restore stock for a single product/variant (used during rollback).
 * Simple: $inc { stock: +qty, stockVersion: 1 }
 * Variant: $inc { "variants.$.stock": +qty, "variants.$.stockVersion": 1, stock: +qty }
 *
 * Session 82 Phase C: when `fifoUnitCost` is provided (a purchased-sourcing
 * item whose sale consumed FIFO layers), the units are returned to the layers
 * at their ORIGINAL unit cost via restoreLayers() — never at the current
 * supplierPrice. The layer restore is folded into the same single-document
 * update as the stock $inc (version-guarded re-read on conflict).
 */
export async function restoreStock(
  productId: string,
  quantity: number,
  variantId?: string,
  fifoUnitCost?: number
): Promise<void> {
  if (fifoUnitCost !== undefined && fifoUnitCost > 0) {
    await restoreStockWithLayers(productId, quantity, variantId, fifoUnitCost);
    return;
  }
  if (variantId) {
    await Product.findOneAndUpdate(
      { _id: productId, "variants._id": variantId },
      {
        $inc: {
          "variants.$.stock": quantity,
          "variants.$.stockVersion": 1,
          stock: quantity,
        },
      }
    );
    return;
  }
  await Product.findByIdAndUpdate(productId, {
    $inc: { stock: quantity, stockVersion: 1 },
  });
}

/** Restore stock AND return units to their FIFO layer at the snapshot cost. */
async function restoreStockWithLayers(
  productId: string,
  quantity: number,
  variantId: string | undefined,
  fifoUnitCost: number
): Promise<void> {
  const MAX_ATTEMPTS = 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // The snapshot fifoUnitCost can be fractional (multi-layer sale); the
    // layer model requires whole-toman costs — round to the nearest toman
    // (matches the movement ledger's unitCost rounding).
    const roundedCost = Math.round(fifoUnitCost);
    if (variantId) {
      current = await Product.findOne(
        { _id: productId, "variants._id": variantId },
        { "variants.$": 1 }
      ).lean();
      const variant = current?.variants?.[0];
      if (!variant) return;
      const currentVersion = variant.stockVersion ?? 0;
      const newLayers = restoreLayers(
        (variant.costLayers ?? []) as InventoryCostLayer[],
        quantity,
        roundedCost,
        { source: "adjustment" }
      );
      const updated = await Product.findOneAndUpdate(
        {
          _id: productId,
          variants: {
            $elemMatch: { _id: variantId, stockVersion: currentVersion },
          },
        },
        {
          $inc: {
            "variants.$.stock": quantity,
            "variants.$.stockVersion": 1,
            stock: quantity,
          },
          $set: { "variants.$.costLayers": newLayers },
        },
        { new: true }
      ).lean();
      if (updated) return;
    } else {
      current = await Product.findById(productId)
        .select("stock stockVersion costLayers")
        .lean();
      if (!current) return;
      const currentVersion = current.stockVersion ?? 0;
      const newLayers = restoreLayers(
        (current.costLayers ?? []) as InventoryCostLayer[],
        quantity,
        roundedCost,
        { source: "adjustment" }
      );
      const updated = await Product.findOneAndUpdate(
        {
          _id: productId,
          stockVersion: currentVersion,
        },
        {
          $inc: { stock: quantity, stockVersion: 1 },
          $set: { costLayers: newLayers },
        },
        { new: true }
      ).lean();
      if (updated) return;
    }
    // Version conflict → re-read + retry.
  }
  console.error(
    `[Inventory] Failed to restore FIFO layers for ${productId}${variantId ? " v" + variantId : ""} after ${MAX_ATTEMPTS} attempts`
  );
}

/**
 * Restore stock for an entire order (failed/cancelled payment, admin cancel).
 *
 * Uses the Order.stockRestored atomic claim for idempotency — only the first
 * caller actually restores; concurrent/duplicate calls see stockRestored=true
 * and skip. Variant-aware: each item's variantId (if present) routes the
 * restoration to the variant stock.
 */
export async function restoreOrderStock(
  orderId: string,
  movementType: "cancellation_restock" | "return_restock" = "cancellation_restock"
): Promise<void> {
  try {
    // Atomic claim: only restore if stockRestored is still false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Order.findOneAndUpdate(
      {
        _id: orderId,
        stockRestored: false,
      },
      {
        $set: { stockRestored: true },
      },
      { new: true }
    )
      .select("items")
      .lean();

    if (!claimed || !claimed.items?.length) return;

    const stockUpdates = claimed.items.map((item: {
      product: string;
      quantity: number;
      variantId?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [k: string]: any;
    }) => {
      // Phase C: purchased items carry fifoUnitCost (snapshot at checkout) —
      // restore stock AND the exact FIFO cost; record the compensating
      // movement. Consignment/pre-cutover items (no fifoUnitCost) keep the
      // stock-only restore (byte-identical behavior).
      const fifoUnitCost =
        typeof item.fifoUnitCost === "number" ? item.fifoUnitCost : undefined;
      void recordRestoreMovement(
        orderId,
        item,
        fifoUnitCost,
        movementType
      );
      return restoreStock(
        item.product,
        item.quantity,
        item.variantId,
        fifoUnitCost
      );
    });

    await Promise.all(stockUpdates);
    console.log(
      `[Inventory] Stock restored for ${claimed.items.length} item(s) on order ${orderId}`
    );
  } catch (error) {
    console.error(
      `[Inventory] Failed to restore stock for order ${orderId}:`,
      error
    );
  }
}

/** Append-only restock movement for a FIFO restore (unique per order+item). */
async function recordRestoreMovement(
  orderId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  fifoUnitCost: number | undefined,
  movementType: "cancellation_restock" | "return_restock"
): Promise<void> {
  if (fifoUnitCost === undefined) return; // consignment/pre-cutover — no layer restore
  try {
    const sourceRef = `${movementType}-${orderId}-${String(item.product)}${item.variantId ? "-" + String(item.variantId) : ""}`;
    const exists = await InventoryMovement.exists({ sourceRef });
    if (exists) return;
    await InventoryMovement.create({
      product: item.product,
      variantId: item.variantId ?? null,
      type: movementType,
      quantity: item.quantity,
      unitCost: Math.round(fifoUnitCost),
      totalCost: Math.round(fifoUnitCost * item.quantity),
      sourceRef,
      description:
        movementType === "return_restock"
          ? `بازگشت کالا به انبار (بازپرداخت سفارش ${String(orderId).slice(-8)})`
          : `بازگشت موجودی به انبار (لغو/عدم پرداخت سفارش ${String(orderId).slice(-8)})`,
    });
  } catch (err) {
    // Fail-silent: a ledger write must never break a committed restoration.
    if ((err as { code?: number })?.code !== 11000) {
      console.error("[Inventory] Restock movement failed:", err);
    }
  }
}
