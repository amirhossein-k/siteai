import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import CustomerConversation from "@/models/CustomerConversation";

/**
 * GET /api/supplier/conversations/[id] — supplier-only detail.
 *
 * Ownership: conversation.supplier must equal the requesting supplier's OWN
 * Supplier doc. A foreign conversation returns the SAME 404 as a missing one
 * (no existence leak — Supplier B cannot probe Supplier A's threads). Marks
 * staffUnread=false.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier: any = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    // Mark read FIRST (ownership-scoped so a foreign supplier can never flip
    // another supplier's flag before the 404 below), then fetch — the response
    // carries the fresh staffUnread state.
    await CustomerConversation.updateOne(
      { _id: id, supplier: supplier._id, staffUnread: true },
      { $set: { staffUnread: false } }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversation: any = await CustomerConversation.findOne({
      _id: id,
      supplier: supplier._id,
    })
      .populate("customer", "name phone")
      .populate("order", "_id totalAmount status")
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
    console.error("Error fetching supplier conversation:", error);
    return serverError();
  }
}
