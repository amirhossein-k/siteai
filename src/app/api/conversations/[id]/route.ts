import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import CustomerConversation from "@/models/CustomerConversation";

/**
 * GET /api/conversations/[id] — customer-only conversation detail.
 *
 * Ownership: CustomerConversation.findOne({_id, customer: token.id}) — a
 * foreign conversation returns the SAME 404 as a missing one. The detail GET
 * also marks customerUnread=false (the read-marker for the customer side).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
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

    // Mark read FIRST (ownership-scoped so a foreign GET can never flip
    // another user's flag before the 404 below), then fetch — the response
    // carries the fresh unread state.
    await CustomerConversation.updateOne(
      { _id: id, customer: token!.id, customerUnread: true },
      { $set: { customerUnread: false } }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversation: any = await CustomerConversation.findOne({
      _id: id,
      customer: token!.id,
    })
      .populate("order", "_id totalAmount status")
      .populate("supplier", "businessName")
      .populate("product", "name")
      .populate("messages.sender", "name")
      .lean();

    if (!conversation) {
      // Same message for not-found and not-owned.
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Error fetching conversation:", error);
    return serverError();
  }
}
