import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import CustomerConversation from "@/models/CustomerConversation";
import {
  canTransit,
  type ConversationStatus,
} from "@/lib/conversations";

/**
 * PATCH /api/admin/conversations/[id]/status — admin transitions: any →
 * resolved · any → closed · resolved|closed → open (reopen).
 *
 * Atomic claim on the CURRENT status — a concurrent transition makes the
 * loser get 400 (Session 57 pattern).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه گفتگو نامعتبر است" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const target: unknown = body?.status;
    if (
      target !== "resolved" &&
      target !== "closed" &&
      target !== "open"
    ) {
      return NextResponse.json(
        { error: "وضعیت نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversation: any = await CustomerConversation.findById(id)
      .select("_id status")
      .lean();

    if (!conversation) {
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    if (!canTransit(conversation.status, target as string, "admin")) {
      return NextResponse.json(
        { error: "امکان تغییر وضعیت گفتگو وجود ندارد" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {
      $set: { status: target as ConversationStatus },
    };
    if (target === "resolved") {
      (update.$set as Record<string, unknown>).resolvedBy = token!.id;
      (update.$set as Record<string, unknown>).resolvedAt = new Date();
      update.$unset = { closedBy: 1, closedAt: 1 };
    } else if (target === "closed") {
      (update.$set as Record<string, unknown>).closedBy = token!.id;
      (update.$set as Record<string, unknown>).closedAt = new Date();
      update.$unset = { resolvedBy: 1, resolvedAt: 1 };
    } else {
      // Reopen — clear the conclusion metadata.
      update.$unset = { resolvedBy: 1, resolvedAt: 1, closedBy: 1, closedAt: 1 };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await CustomerConversation.findOneAndUpdate(
      { _id: id, status: conversation.status },
      update,
      { new: true }
    )
      .populate("customer", "name phone")
      .populate("supplier", "businessName")
      .lean();

    if (!claimed) {
      return NextResponse.json(
        { error: "وضعیت گفتگو همزمان تغییر کرده است؛ لطفاً دوباره تلاش کنید" },
        { status: 400 }
      );
    }

    return NextResponse.json(claimed);
  } catch (error) {
    console.error("Error updating admin conversation status:", error);
    return serverError();
  }
}
