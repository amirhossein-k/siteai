import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Review from "@/models/Review";
import Order from "@/models/Order";

/**
 * GET /api/reviews/mine?product=<id>
 * Customer only. Returns:
 *   { reviews: [...my reviews for this product (any status)],
 *     eligibleOrders: [...delivered+paid orders containing the product that
 *                      have NO review yet — i.e. where the customer can still
 *                      write a review] }
 *
 * Used by the storefront to gate the "ثبت دیدگاه" form: if eligibleOrders is
 * empty the customer either hasn't purchased (delivered) or already reviewed
 * every purchase of this product.
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const product = searchParams.get("product");

    if (!product || !mongoose.isValidObjectId(product)) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }

    // My reviews for this product (any moderation status)
    const reviews = await Review.find({ customer: token!.id, product })
      .sort({ createdAt: -1 })
      .lean();

    // Delivered orders containing this product
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders: any[] = await Order.find({
      customer: token!.id,
      "payment.status": "paid",
      status: "delivered",
      items: { $elemMatch: { product } },
    })
      .select("_id createdAt totalAmount items")
      .sort({ createdAt: -1 })
      .lean();

    const reviewedOrderIds = new Set(reviews.map((r) => String(r.order)));

    // Eligible = delivered order with no review yet (one review per order-item)
    const eligibleOrders = orders
      .filter((o) => !reviewedOrderIds.has(String(o._id)))
      .map((o) => ({
        _id: o._id,
        createdAt: o.createdAt,
        totalAmount: o.totalAmount,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        itemName: (o.items || []).find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (i: any) => String(i.product) === String(product)
        )?.name,
      }));

    return NextResponse.json({ reviews, eligibleOrders });
  } catch (error) {
    console.error("Error fetching my reviews:", error);
    return serverError();
  }
}
