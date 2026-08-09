import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import CustomerConversation from "@/models/CustomerConversation";

/**
 * GET /api/admin/conversations/[id] — admin-only detail of ANY conversation.
 * Marks staffUnread=false (staff = admin ∪ the conversation's supplier — the
 * shared staff-read flag, per the approved Session 68 unread design).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه گفتگو نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Mark read FIRST so the response carries the fresh staffUnread state.
    await CustomerConversation.updateOne(
      { _id: id, staffUnread: true },
      { $set: { staffUnread: false } }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversation: any = await CustomerConversation.findById(id)
      .populate("customer", "name phone")
      .populate("order", "_id totalAmount status")
      .populate("supplier", "businessName")
      .populate("product", "name")
      .populate("messages.sender", "name")
      .lean();

    if (!conversation) {
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Error fetching admin conversation:", error);
    return serverError();
  }
}
