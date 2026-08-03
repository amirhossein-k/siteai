import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/rate-limiter";
import Notification from "@/models/Notification";

/**
 * PUT /api/notifications/read-all
 *
 * Marks ALL of the caller's unread notifications as read (self-scoped to
 * recipient: token.id). Idempotent — a second call marks nothing.
 * Rate-limited (validated payload is trivial; limiter guards spam).
 */
export async function PUT(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    const rl = await rateLimit(`notif:readall:${token.id}`, {
      max: 30,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌ها زیاد است. لطفاً کمی بعد تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const res = await Notification.updateMany(
      { recipient: token.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return NextResponse.json({ modifiedCount: res.modifiedCount });
  } catch (error) {
    console.error("Error marking all notifications read:", error);
    return serverError();
  }
}
