import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized } from "@/lib/auth-utils";
import Notification from "@/models/Notification";

/**
 * GET /api/notifications/unread-count
 *
 * Lightweight unread badge count for the header bell. Single indexed query
 * ({ recipient, isRead }), no full-list fetch.
 */
export async function GET(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();
    const count = await Notification.countDocuments({
      recipient: token.id,
      isRead: false,
    });
    return NextResponse.json({ count });
  } catch (error) {
    // The unread badge is cosmetic UI state. When the DB is unavailable (e.g.
    // a transient outage or right after a machine restart), fail SILENT with
    // count 0 instead of 500-ing the header bell's 30s polling. Isolated to
    // this endpoint only — the notification facade and inbox routes are
    // untouched, and the polling hook keeps working with a zero badge.
    console.error("Error counting notifications (fallback to 0):", error);
    return NextResponse.json({ count: 0 });
  }
}
