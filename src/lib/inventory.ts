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

export interface ReservedItem {
  product: Record<string, unknown>;
  variant?: Record<string, unknown> | null;
}

/**
 * Atomically reserve stock for a single product/variant.
 *
 * For a simple product (no variantId):
 *   matches { _id, stock: { $gte: qty }, stockVersion: current }
 *   $inc { stock: -qty, stockVersion: 1 }
 *
 * For a variant (variantId provided):
 *   matches { _id, "variants._id": variantId, "variants.$.stock": { $gte: qty },
 *             "variants.$.stockVersion": current, "variants.$.isActive": true }
 *   $inc { "variants.$.stock": -qty, "variants.$.stockVersion": 1, stock: -qty }
 *
 * Returns the updated product document (or null if the reservation failed).
 * The caller is responsible for checking product/variant price + isActive and
 * rolling back on any failure.
 */
export async function reserveStock(
  productId: string,
  quantity: number,
  variantId?: string
): Promise<Record<string, unknown> | null> {
  if (variantId) {
    // Step 1: read the variant's current stockVersion (optimistic lock token)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: any = await Product.findOne(
      { _id: productId, "variants._id": variantId },
      { "variants.$": 1 }
    ).lean();

    if (!current) return null;
    const variant = current.variants?.[0];
    if (!variant) return null;
    if (variant.stock < quantity) return null;
    if (variant.isActive === false) return null;

    const currentVersion = variant.stockVersion ?? 0;

    // Step 2: atomically reserve ONLY if the variant version still matches.
    // IMPORTANT: $elemMatch is required here — MongoDB does NOT allow the
    // positional $ operator in the QUERY filter, so plain "variants.$.stock"
    // predicates never match. $elemMatch binds ALL conditions to the SAME
    // array element (the target variant), then "variants.$" in the update
    // operates on that matched element. This preserves the exact optimistic
    // concurrency semantics as the simple-product path.
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

  // --- Simple product (unchanged behavior) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current: any = await Product.findById(productId)
    .select("stock stockVersion")
    .lean();

  if (!current) return null;
  if (current.stock < quantity) return null;

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
 */
export async function restoreStock(
  productId: string,
  quantity: number,
  variantId?: string
): Promise<void> {
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

/**
 * Restore stock for an entire order (failed/cancelled payment, admin cancel).
 *
 * Uses the Order.stockRestored atomic claim for idempotency — only the first
 * caller actually restores; concurrent/duplicate calls see stockRestored=true
 * and skip. Variant-aware: each item's variantId (if present) routes the
 * restoration to the variant stock.
 */
export async function restoreOrderStock(orderId: string): Promise<void> {
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

    const stockUpdates = claimed.items.map(
      (item: {
        product: string;
        quantity: number;
        variantId?: string;
      }) => restoreStock(item.product, item.quantity, item.variantId)
    );

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
