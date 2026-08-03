import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
  forbidden,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Product from "@/models/Product";
import Order from "@/models/Order";

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const [totalProducts, ordersWithSupplier, lowStockCount] =
      await Promise.all([
        Product.countDocuments({ supplier: supplier._id }),
        Order.find({
          "items.supplier": supplier._id,
        }).lean(),
        Product.countDocuments({
          supplier: supplier._id,
          stock: { $lt: 5 },
          isActive: true,
        }),
      ]);

    const totalOrders = ordersWithSupplier.length;
    const pendingOrders = ordersWithSupplier.filter(
      (o) => o.status === "pending_payment" || o.status === "processing"
    ).length;

    let totalEarnings = 0;
    for (const order of ordersWithSupplier) {
      if (order.status !== "cancelled") {
        for (const item of order.items) {
          if (item.supplier.toString() === supplier._id.toString()) {
            totalEarnings += item.supplierPrice * item.quantity;
          }
        }
      }
    }

    const stats = {
      totalProducts,
      totalOrders,
      pendingOrders,
      balance: supplier.balance,
      totalEarnings,
      lowStock: lowStockCount,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching supplier stats:", error);
    return serverError();
  }
}