import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";

/**
 * Admin suppliers API.
 *
 * GET /api/admin/suppliers             — ACTIVE suppliers only (dropdown
 *                                         shape: businessName + user.name).
 *                                         Used by product forms (admin +
 *                                         supplier) via useSuppliers.
 * GET /api/admin/suppliers?all=true    — ALL suppliers (active + inactive)
 *                                         with the management shape: business
 *                                         profile + wallet figures + populated
 *                                         user (name/phone/isActive/role).
 *                                         Used by /admin/suppliers (Session 66).
 *
 * Session 66 — the default (no-param) response is byte-for-byte unchanged so
 * the existing dropdown consumers are untouched; the management shape is a
 * strictly additive query-param branch. Authorization: admin only.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all") === "true";

    if (all) {
      // Session 66 — management list: every supplier (incl. inactive), with
      // wallet/contact/profile fields + the linked user for status display.
      const suppliers = await Supplier.find({})
        .select(
          "businessName logo description contactPhone balance pendingReserve isActive createdAt"
        )
        .populate("user", "name phone isActive role")
        .sort({ createdAt: -1 })
        .lean();
      return NextResponse.json(suppliers);
    }

    const suppliers = await Supplier.find({ isActive: true })
      .select("businessName user")
      .populate("user", "name")
      .sort({ businessName: 1 })
      .lean();

    return NextResponse.json(suppliers);
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return serverError();
  }
}
