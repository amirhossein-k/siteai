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
 * PATCH /api/conversations/[id]/status — customer resolves or reopens one of
 * their OWN conversations (customer transitions: open|pending → resolved,
 * resolved|closed → open).
 *
 * Atomic claim on the CURRENT status (Session 57 pattern) — a concurrent
 * transition makes the loser get 400.
 */
export async function PATCH(
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

    const body = await req.json();
    const target: unknown = body?.status;
    if (
      target !== "resolved" &&
      target !== "open"
    ) {
      return NextResponse.json(
        { error: "وضعیت نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversation: any = await CustomerConversation.findOne({
      _id: id,
      customer: token!.id,
    })
      .select("_id status")
      .lean();

    if (!conversation) {
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    if (!canTransit(conversation.status, target as string, "customer")) {
      return NextResponse.json(
        {
          error:
            target === "resolved"
              ? "این گفتگو قابل بستن نیست"
              : "این گفتگو قابل بازگشایی نیست",
        },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {
      $set: { status: target as ConversationStatus },
    };
    if (target === "resolved") {
      (update.$set as Record<string, unknown>).resolvedBy = token!.id;
      (update.$set as Record<string, unknown>).resolvedAt = new Date();
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
    console.error("Error updating conversation status:", error);
    return serverError();
  }
}
