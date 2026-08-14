import type { PurchaseOrderView } from "@/types";

/** Map a lean PurchaseOrder document (+populated supplier) to the API view. */
export function toPurchaseView(
  p: Record<string, unknown>
): PurchaseOrderView {
  const items = (p.items as Array<Record<string, unknown>>) || [];
  const receipts = (p.receipts as Array<Record<string, unknown>>) || [];
  const totalOrdered = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const totalReceived = items.reduce(
    (s, it) => s + Number(it.receivedQuantity || 0),
    0
  );
  const total = Number(p.total || 0);
  const amountPaid = Number(p.amountPaid || 0);
  const supplier = p.supplier as unknown as
    | { _id?: string; businessName?: string }
    | string
    | null;
  const supplierName =
    typeof supplier === "object" && supplier
      ? supplier.businessName || ""
      : "";

  return {
    id: String(p._id),
    number: String(p.number || ""),
    supplier:
      typeof supplier === "object" && supplier && supplier._id
        ? String(supplier._id)
        : String(supplier || ""),
    supplierName,
    purchaseDate: p.purchaseDate
      ? new Date(p.purchaseDate as string).toISOString()
      : "",
    reference: String(p.reference || ""),
    notes: String(p.notes || ""),
    status: String(p.status || "draft") as PurchaseOrderView["status"],
    subtotal: Number(p.subtotal || 0),
    discount: Number(p.discount || 0),
    additionalCosts: Number(p.additionalCosts || 0),
    total,
    paymentStatus: String(p.paymentStatus || "unpaid") as PurchaseOrderView["paymentStatus"],
    amountPaid,
    amountOutstanding: Math.max(0, total - amountPaid),
    items: items.map((it) => ({
      id: String(it._id),
      product: String(it.product || ""),
      variantId: it.variantId ? String(it.variantId) : null,
      name: String(it.name || ""),
      variantLabel: String(it.variantLabel || ""),
      quantity: Number(it.quantity || 0),
      receivedQuantity: Number(it.receivedQuantity || 0),
      outstanding: Math.max(
        0,
        Number(it.quantity || 0) - Number(it.receivedQuantity || 0)
      ),
      unitCost: Number(it.unitCost || 0),
      lineTotal: Number(it.quantity || 0) * Number(it.unitCost || 0),
    })),
    totalOrdered,
    totalReceived,
    totalOutstanding: totalOrdered - totalReceived,
    receipts: receipts.map((r) => ({
      key: String(r.key || ""),
      items: (r.items as Array<Record<string, unknown>>).map((ri) => ({
        itemId: String(ri.itemId || ""),
        quantity: Number(ri.quantity || 0),
      })),
      receivedAt: r.receivedAt
        ? new Date(r.receivedAt as string).toISOString()
        : "",
      receivedBy: r.receivedBy ? String(r.receivedBy) : null,
    })),
    cancelledAt: p.cancelledAt
      ? new Date(p.cancelledAt as string).toISOString()
      : null,
    cancellationReason: String(p.cancellationReason || ""),
    createdAt: p.createdAt
      ? new Date(p.createdAt as string).toISOString()
      : "",
  };
}
