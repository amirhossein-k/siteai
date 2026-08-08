import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import SupplierApplication from "@/models/SupplierApplication";

/**
 * Session 67 — GET /api/supplier-applications/me
 *
 * The applicant's own latest application (+ status / admin note). Drives the
 * «فروشنده شوید» page state (form vs status card). CUSTOMER ONLY. Returns
 * null when the user has never applied.
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();
    const app = (await SupplierApplication.findOne({ user: token!.id })
      .sort({ createdAt: -1 })
      .lean()) as {
      _id: unknown;
      status: string;
      businessName: string;
      description?: string;
      contactPhone?: string;
      adminNote?: string;
      decidedAt?: Date | null;
      createdAt: Date;
    } | null;

    if (!app) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      _id: String(app._id),
      status: app.status,
      businessName: app.businessName,
      description: app.description || "",
      contactPhone: app.contactPhone || "",
      adminNote: app.adminNote || "",
      decidedAt: app.decidedAt ? app.decidedAt.toISOString() : null,
      createdAt: app.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Error fetching own supplier application:", error);
    return serverError();
  }
}
