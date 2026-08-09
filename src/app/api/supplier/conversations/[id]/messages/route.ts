import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import CustomerConversation from "@/models/CustomerConversation";
import {
  parseMessageText,
  appendConversationMessage,
  notifyConversationMessage,
} from "@/lib/conversations";
import {
  rateLimit,
  CONVERSATION_MESSAGE_LIMIT,
} from "@/lib/rate-limiter";

/**
 * POST /api/supplier/conversations/[id]/messages — supplier reply (reply-only
 * in v1: suppliers never change conversation status). Ownership verified
 * server-side via conversation.supplier === own Supplier doc → same 404 for
 * not-found and not-owned. Notifies the customer (fail-silent).
 */
export async function POST(
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

    const body = await req.json();
    const text = parseMessageText(body?.text);
    if (!text) {
      return NextResponse.json(
        { error: "متن پیام باید بین ۱ تا ۲۰۰۰ کاراکتر باشد" },
        { status: 400 }
      );
    }

    const rl = await rateLimit(
      "conversation-msg:" + token!.id,
      CONVERSATION_MESSAGE_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد پیام‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversation: any = await CustomerConversation.findOne({
      _id: id,
      supplier: supplier._id,
    })
      .select("_id status order customer")
      .lean();

    if (!conversation) {
      // Same message for not-found and not-owned.
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    const updated = await appendConversationMessage({
      conversationId: String(conversation._id),
      currentStatus: conversation.status,
      senderUserId: token!.id,
      senderRole: "supplier",
      text,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "امکان ارسال پیام در وضعیت فعلی گفتگو وجود ندارد" },
        { status: 400 }
      );
    }

    const lastMessage = updated.messages?.[updated.messages.length - 1];
    await notifyConversationMessage({
      conversationId: String(conversation._id),
      orderId: conversation.order ? String(conversation.order) : null,
      senderRole: "supplier",
      messageId: lastMessage?._id ? String(lastMessage._id) : "",
      customerUserId: conversation.customer
        ? String(conversation.customer)
        : "",
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error sending supplier conversation message:", error);
    return serverError();
  }
}
