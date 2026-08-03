import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import Notification from "@/models/Notification";

/**
 * PUT /api/notifications/[id]/read
 *
 * Marks ONE notification as read — OWNER-SCOPED to recipient: token.id.
 * - Invalid id → 400
 * - Not found OR not owned → 404 (cross-user isolation)
 * - Already read → 200 with current state (idempotent, readAt preserved)
 * - First read → sets isRead + readAt
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    const { id } = await params;

    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه اعلان نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Owner-scoped read: mark only if unread (idempotent for already-read).
    const updated = await Notification.findOneAndUpdate(
      { _id: id, recipient: token.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();

    if (updated) return NextResponse.json(updated);

    // Already read OR not found/not owned — distinguish for a correct 404.
    const exists = await Notification.findOne({
      _id: id,
      recipient: token.id,
    }).lean();
    if (!exists) {
      return NextResponse.json(
        { error: "اعلان یافت نشد" },
        { status: 404 }
      );
    }

    // Already read → idempotent 200 with current state.
    return NextResponse.json(exists);
  } catch (error) {
    console.error("Error marking notification read:", error);
    return serverError();
  }
}
