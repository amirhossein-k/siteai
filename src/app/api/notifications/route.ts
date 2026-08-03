import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import Notification from "@/models/Notification";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * GET /api/notifications
 *
 * Authenticated user's inbox (customer / supplier / admin — self-scoped).
 * Query params:
 *   page / limit   — pagination (Session 27 shape)
 *   unreadOnly=1   — only unread notifications
 *   category=...   — "order" | "payment" | "payout" | "system"
 *
 * Response: { ...PaginatedResponse, unreadCount }
 */
export async function GET(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unreadOnly") === "1";
    const category = searchParams.get("category");

    const filter: Record<string, unknown> = { recipient: token.id };
    if (unreadOnly) filter.isRead = false;
    if (category) filter.category = category;

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, unreadCount, data] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: token.id, isRead: false }),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json({
      ...buildPaginatedResponse(data, total, page, limit),
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return serverError();
  }
}
