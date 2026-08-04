/**
 * Session 56 — Product sales counter helpers (single source of truth).
 *
 * `Product.soldCount` = total units PAID (non-refunded). Both transitions are
 * gated by the route-level atomic claims (payment verify `pending → paid`,
 * admin refund `paid → refunded`), so these helpers run EXACTLY ONCE per
 * transition:
 *   - recordOrderSales(orderId)  — payment verify success (increment)
 *   - reverseOrderSales(orderId) — admin refund (decrement)
 *
 * MongoDB pipeline updates with a floor at 0 keep the counter correct even
 * for LEGACY products (soldCount undefined/0 for orders paid before this
 * field existed) — a refund can never drive a product negative.
 *
 * bulkWrite intentionally bypasses Mongoose middleware — these updates never
 * touch stock/stockVersion (no side effects on the Session 26 optimistic
 * lock). Fail-silent: a sales-counter failure must never break a committed
 * payment/refund.
 *
 * NOTE: variant-level sales tracking is future scope — the counter is the
 * product-level sum across ALL variants (item quantities, regardless of the
 * selected variantId).
 */
import mongoose from "mongoose";
import Product from "@/models/Product";
import Order from "@/models/Order";

/** @internal */
function buildDeltaUpdate(qty: number, direction: 1 | -1) {
  const delta = direction * qty;
  if (direction === 1) {
    // Increment: $add on $ifNull so a legacy (missing) field starts from 0.
    return [
      {
        $set: {
          soldCount: { $add: [{ $ifNull: ["$soldCount", 0] }, delta] },
        },
      },
    ];
  }
  // Decrement: same math, floored at 0 (refunding a legacy sale can't go negative).
  return [
    {
      $set: {
        soldCount: {
          $max: [{ $add: [{ $ifNull: ["$soldCount", 0] }, delta] }, 0],
        },
      },
    },
  ];
}

/**
 * Apply the soldCount delta for every item of an order.
 *
 * @param orderId  The order whose items drive the delta.
 * @param direction 1 = record sales (payment paid), -1 = reverse (refund).
 */
async function applyOrderSalesDelta(
  orderId: string,
  direction: 1 | -1
): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(orderId)) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order: any = await Order.findById(orderId)
      .select("items")
      .lean();
    if (!order || !Array.isArray(order.items) || order.items.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writes: any[] = [];
    for (const item of order.items) {
      if (!item.product) continue; // deleted-product placeholder / legacy row
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      writes.push({
        updateOne: {
          filter: { _id: item.product },
          update: buildDeltaUpdate(qty, direction),
        },
      });
    }

    if (writes.length === 0) return;
    await Product.bulkWrite(writes, { ordered: false });
  } catch (error) {
    // Fail-silent by design — a ranking counter must never fail a payment/refund.
    console.error(
      `[ProductSales] Failed to ${direction === 1 ? "record" : "reverse"} sales for order ${orderId}:`,
      error
    );
  }
}

/** Record paid sales for an order (payment verify success — exactly-once). */
export function recordOrderSales(orderId: string): Promise<void> {
  return applyOrderSalesDelta(orderId, 1);
}

/** Reverse sales for a refunded order (admin refund — exactly-once). */
export function reverseOrderSales(orderId: string): Promise<void> {
  return applyOrderSalesDelta(orderId, -1);
}
