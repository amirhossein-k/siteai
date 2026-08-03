import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import User from "@/models/User";
import Product from "@/models/Product";
import Order from "@/models/Order";

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const [
      totalUsers,
      totalProducts,
      totalOrders,
      pendingOrders,
      lowStockCount,
      revenueResult,
    ] = await Promise.all([
      User.countDocuments({}),
      Product.countDocuments({}),
      Order.countDocuments({}),
      Order.countDocuments({ status: "pending_payment" }),
      Product.countDocuments({ stock: { $lt: 5 }, isActive: true }),
      Order.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthOrders = await Order.countDocuments({
      createdAt: { $lt: lastMonth },
    });
    const growth =
      totalOrders > 0 && lastMonthOrders > 0
        ? Math.round(((totalOrders - lastMonthOrders) / lastMonthOrders) * 100 * 10) / 10
        : 0;

    const stats = {
      totalRevenue,
      totalOrders,
      totalProducts,
      totalUsers,
      pendingOrders,
      lowStock: lowStockCount,
      growth,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    return serverError();
  }
}