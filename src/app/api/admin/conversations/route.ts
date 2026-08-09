import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import User from "@/models/User";
import CustomerConversation from "@/models/CustomerConversation";
import {
  parsePaginationParams,
  buildPaginatedResponse,
  escapeRegex,
} from "@/lib/pagination";

/**
 * GET /api/admin/conversations — admin-only support queue.
 *
 * Filters: ?status= (open|pending|resolved|closed) + ?search= (order id,
 * customer name/phone — resolved via User id set — or conversation subject)
 * + pagination, sorted by lastMessageAt desc. Mirrors the admin orders list
 * search idiom (Session 57).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const filter: Record<string, unknown> = {};

    if (status) {
      filter.status = status;
    }

    if (search) {
      const safeSearch = escapeRegex(search);
      const regex = new RegExp(safeSearch, "i");
      const customerIds = await User.find({
        $or: [{ name: regex }, { phone: regex }],
      }).distinct("_id");
      filter.$or = [
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: safeSearch,
              options: "i",
            },
          },
        },
        { customer: { $in: customerIds } },
        { subject: regex },
      ];
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, rows] = await Promise.all([
      CustomerConversation.countDocuments(filter),
      CustomerConversation.find(filter)
        .populate("customer", "name phone")
        .populate("supplier", "businessName")
        .select(
          "_id customer order supplierOrder supplier product category subject status customerUnread staffUnread lastMessageAt lastMessagePreview lastMessageFrom resolvedAt closedAt createdAt updatedAt"
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
    console.error("Error fetching admin conversations:", error);
    return serverError();
  }
}
