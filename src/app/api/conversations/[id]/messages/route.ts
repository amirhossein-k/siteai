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
 * POST /api/conversations/[id]/messages — customer sends a message to one of
 * their OWN conversations.
 *
 * Ownership: CustomerConversation.findOne({_id, customer: token.id}) → 404.
 * The atomic append claims on the current status set — a CLOSED conversation
 * rejects (400, reopen first), a resolved one auto-reopens to open.
 * senderRole is the session role, never the body.
 */
export async function POST(
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

    // --- Validate text BEFORE the rate limiter ---
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
    const conversation: any = await CustomerConversation.findOne({
      _id: id,
      customer: token!.id,
    })
      .select("_id status order supplier")
      .lean();

    if (!conversation) {
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplierDoc: any = conversation.supplier
      ? await Supplier.findById(conversation.supplier).select("user").lean()
      : null;

    const updated = await appendConversationMessage({
      conversationId: String(conversation._id),
      currentStatus: conversation.status,
      senderUserId: token!.id,
      senderRole: "customer",
      text,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "امکان ارسال پیام در وضعیت فعلی گفتگو وجود ندارد" },
        { status: 400 }
      );
    }

    // Notify the supplier (fail-silent, post-commit).
    const lastMessage = updated.messages?.[updated.messages.length - 1];
    await notifyConversationMessage({
      conversationId: String(conversation._id),
      orderId: conversation.order ? String(conversation.order) : null,
      senderRole: "customer",
      messageId: lastMessage?._id ? String(lastMessage._id) : "",
      customerUserId: token!.id,
      supplierUserId: supplierDoc?.user ? String(supplierDoc.user) : undefined,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error sending conversation message:", error);
    return serverError();
  }
}
