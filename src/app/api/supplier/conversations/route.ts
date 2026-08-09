import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import CustomerConversation from "@/models/CustomerConversation";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * GET /api/supplier/conversations — supplier-only.
 *
 * Returns ONLY conversations where conversation.supplier === the requesting
 * supplier's OWN Supplier doc (resolved from the session, never the body).
 * Cross-supplier conversations never appear here — the isolation is
 * structural (the conversation carries exactly one supplier ref).
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier: any = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter: Record<string, unknown> = { supplier: supplier._id };
    if (status) {
      filter.status = status;
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, rows] = await Promise.all([
      CustomerConversation.countDocuments(filter),
      CustomerConversation.find(filter)
        .populate("customer", "name phone")
        .select(
          "_id customer order supplierOrder supplier product category subject status customerUnread staffUnread lastMessageAt lastMessagePreview lastMessageFrom createdAt updatedAt"
        )
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(rows, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching supplier conversations:", error);
    return serverError();
  }
}
