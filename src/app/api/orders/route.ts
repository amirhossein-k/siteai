import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import {
  parsePaginationParams,
  buildPaginatedResponse,
  escapeRegex,
} from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // --- Single order detail ---
    if (id) {
      const order = await Order.findOne({
        _id: id,
        customer: token.id,
      })
        .populate("customer", "name phone")
        .lean();

      if (!order) {
        return NextResponse.json(
          { error: "سفارش مورد نظر یافت نشد" },
          { status: 404 }
        );
      }

      return NextResponse.json(order);
    }

    // --- List customer orders (paginated) ---
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const filter: Record<string, unknown> = { customer: token.id };

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Search by order id (matches the short id shown in the UI)
    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$expr = {
        $regexMatch: {
          input: { $toString: "$_id" },
          regex: safeSearch,
          options: "i",
        },
      };
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .select(
          "_id totalAmount status payment.status createdAt items shippingAddress"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(orders, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching customer orders:", error);
    return serverError();
  }
}
