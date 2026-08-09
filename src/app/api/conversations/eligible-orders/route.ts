import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import SupplierOrder from "@/models/SupplierOrder";

/**
 * GET /api/conversations/eligible-orders — customer-only.
 *
 * Returns the customer's PURCHASED orders (payment.status ∈ paid/refunded —
 * the Session 68 eligibility rule) with their supplier-orders, so the
 * conversation-creation picker can offer exactly the (order, supplier)
 * combinations the server will accept. Server-authoritative: the create route
 * re-validates everything; this endpoint only shapes the picker.
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders: any[] = await Order.find({
      customer: token!.id,
      "payment.status": { $in: ["paid", "refunded"] },
    })
      .select("_id totalAmount status payment.status createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    if (orders.length === 0) {
      return NextResponse.json([]);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplierOrders: any[] = await SupplierOrder.find({
      order: { $in: orders.map((o) => o._id) },
    })
      .select("order supplier amountOwed status")
      .populate("supplier", "businessName")
      .lean();

    const byOrder = new Map<string, unknown[]>();
    for (const so of supplierOrders) {
      const key = String(so.order?._id || so.order || "");
      if (!key) continue;
      if (!byOrder.has(key)) byOrder.set(key, []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supplier: any = (so as any).supplier;
      byOrder.get(key)!.push({
        supplierOrderId: String(so._id),
        supplierId: supplier?._id ? String(supplier._id) : String(so.supplier || ""),
        businessName: supplier?.businessName || "فروشنده",
        amountOwed: so.amountOwed || 0,
        status: so.status || "pending",
      });
    }

    const rows = orders
      .filter((o) => byOrder.has(String(o._id)))
      .map((o) => ({
        orderId: String(o._id),
        orderShortId: String(o._id).slice(-8),
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        suppliers: (byOrder.get(String(o._id)) as any[]) || [],
      }));

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching eligible orders:", error);
    return serverError();
  }
}
