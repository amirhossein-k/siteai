/**
 * Purchase-order math — PURE helpers (Session 82 Phase B), no I/O.
 *
 * Single source of truth for line totals, order totals, outstanding
 * quantities, and status/payment-status derivation. Unit-tested in isolation;
 * the API routes and UI both use these so the numbers can never drift.
 *
 * Money is whole Toman. total = subtotal − discount + additionalCosts,
 * clamped at 0 (a discount may never make the order negative).
 */

export interface PurchaseLine {
  quantity: number;
  receivedQuantity?: number;
  unitCost: number;
}

export interface PurchaseOrderLike {
  items: PurchaseLine[];
  subtotal: number;
  discount?: number;
  additionalCosts?: number;
  total?: number;
  status?: string;
  amountPaid?: number;
  paymentStatus?: string;
}

export function roundToman(n: number): number {
  return Math.max(0, Math.round(n));
}

/** Line total = quantity × unitCost (whole Toman). */
export function lineTotal(line: PurchaseLine): number {
  return roundToman(line.quantity * line.unitCost);
}

/** Subtotal = Σ (quantity × unitCost). */
export function computeSubtotal(items: PurchaseLine[]): number {
  return roundToman(items.reduce((s, it) => s + it.quantity * it.unitCost, 0));
}

/** Total = subtotal − discount + additionalCosts (never below 0). */
export function computeTotal(
  subtotal: number,
  discount = 0,
  additionalCosts = 0
): number {
  return roundToman(subtotal - discount + additionalCosts);
}

/** Outstanding units for a line (ordered − received, never below 0). */
export function outstandingOf(line: PurchaseLine): number {
  return Math.max(0, line.quantity - (line.receivedQuantity || 0));
}

/** Total outstanding units across a purchase. */
export function totalOutstanding(items: PurchaseLine[]): number {
  return items.reduce((s, it) => s + outstandingOf(it), 0);
}

/** Total received units across a purchase. */
export function totalReceived(items: PurchaseLine[]): number {
  return items.reduce((s, it) => s + (it.receivedQuantity || 0), 0);
}

/** Total ordered units across a purchase. */
export function totalOrdered(items: PurchaseLine[]): number {
  return items.reduce((s, it) => s + it.quantity, 0);
}

/**
 * Derive the inventory status from item received-quantities:
 *  - every line fully received      → "received"
 *  - some line received > 0         → "partially_received"
 *  - nothing received               → keep the current "draft"|"ordered"
 * Cancelled is never derived (explicitly set).
 */
export function deriveStatus(
  items: PurchaseLine[],
  currentStatus: string
): string {
  if (currentStatus === "cancelled") return "cancelled";
  const total = totalReceived(items);
  if (total === 0) return currentStatus === "received" ? "ordered" : currentStatus;
  if (total >= totalOrdered(items)) return "received";
  return "partially_received";
}

/** Derive payment status from amountPaid vs total. */
export function derivePaymentStatus(
  amountPaid: number,
  total: number
): "unpaid" | "partial" | "paid" {
  if (total <= 0 || amountPaid >= total) return "paid";
  if (amountPaid > 0) return "partial";
  return "unpaid";
}

/** Validate a receive line: positive integer within the outstanding quantity. */
export function receiveDeltaOk(
  line: PurchaseLine,
  requested: number
): boolean {
  return (
    Number.isInteger(requested) &&
    requested > 0 &&
    requested <= outstandingOf(line)
  );
}

/** Build a purchase number: P-YYYY-NNNNNN (unique via the model + retry). */
export function buildPurchaseNumber(date = new Date()): string {
  const year = date.getUTCFullYear();
  const suffix = String(Date.now()).slice(-6);
  return `P-${year}-${suffix}`;
}
