import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Review from "@/models/Review";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * GET /api/admin/reviews?status=pending|approved|rejected&page=&limit=
 * Admin only (requireRoleOrError → 401/403). Moderation queue with product
 * (name/slug/image) + customer (name/phone) populated, newest first.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter: Record<string, unknown> = {};
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
        .populate("customer", "name phone")
        .populate("product", "name slug images isActive")
        .populate("reviewedBy", "name")
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(reviews, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching admin reviews:", error);
    return serverError();
  }
}
