import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Review from "@/models/Review";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * GET /api/supplier/reviews?status=&page=&limit=
 * Supplier only (requireRoleOrError → 401/403).
 *
 * Reviews on the supplier's OWN products (reviews the supplier can reply to),
 * newest first. Scoped server-side via the denormalized Review.supplier —
 * never trusts a client-supplied supplier id. The supplier identity is
 * resolved from the token (Supplier.findOne({ user: token.id })) exactly like
 * the supplier products route.
 *
 * Query params:
 *   status=pending|approved|rejected (optional)
 *   page / limit — Session 27 pagination shape
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    // NOTE: no `.lean()` here — Mongoose's findOne+lean union type breaks
    // `supplier._id` access (same convention as the supplier products route).
    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter: Record<string, unknown> = { supplier: supplier._id };
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, reviews] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("customer", "name")
        .populate("product", "name slug images isActive")
        .populate("reply.author", "name")
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(reviews, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching supplier reviews:", error);
    return serverError();
  }
}
