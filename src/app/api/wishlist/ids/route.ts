import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Wishlist from "@/models/Wishlist";

/**
 * GET /api/wishlist/ids
 * Customer only. Returns:
 *   { ids: string[], count: number }
 *
 * `ids` powers the heart state on every product card + detail page (one cached
 * React Query fetch, no N+1). With variant-level wishlist rows (Session 43) a
 * product can have MULTIPLE rows (product-level + variants), so `ids` is
 * DEDUPED to unique product ids — a heart is filled whenever ANY row for that
 * product exists. `count` is a dedicated field = TOTAL wishlist rows (matches
 * the wishlist page total), NOT ids.length, and stays correct if pagination
 * or future filtering changes the ids payload.
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const [rows, count] = await Promise.all([
      Wishlist.find({ user: token!.id })
        .select("product")
        .lean(),
      Wishlist.countDocuments({ user: token!.id }),
    ]);

    // Dedupe: hearts are product-level, so one id per product even when
    // product-level + variant rows coexist (Session 43).
    const ids = [...new Set(rows.map((r) => String(r.product)))];

    return NextResponse.json({ ids, count });
  } catch (error) {
    console.error("Error fetching wishlist ids:", error);
    return serverError();
  }
}
