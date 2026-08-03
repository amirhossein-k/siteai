import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
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