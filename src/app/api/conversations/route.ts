import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import SupplierOrder from "@/models/SupplierOrder";
import Supplier from "@/models/Supplier";
import CustomerConversation from "@/models/CustomerConversation";
import {
  parseSubject,
  parseCategory,
  parseMessageText,
  isEligibleOrderPayment,
  formatMessagePreview,
  notifyConversationMessage,
} from "@/lib/conversations";
import {
  rateLimit,
  CONVERSATION_CREATE_LIMIT,
} from "@/lib/rate-limiter";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * Customer conversations (Session 68) — customer-only.
 *
 * POST  create a conversation for one of the customer's own PAID orders
 *       (order ownership + purchase eligibility validated server-side).
 *       One ACTIVE conversation per SupplierOrder (unique partial index →
 *       E11000 → 409).
 * GET   list own conversations (paginated, optional status filter).
 *
 * SECURITY: order ownership is validated via Order.findOne({_id, customer:
 * token.id}) — a foreign order returns the SAME 404 as a missing one; the
 * sender identity is always the session; supplierOrder.supplier (never the
 * body) becomes the conversation's supplier.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();
    const {
      orderId,
      supplierOrderId,
      productId,
      category: categoryRaw,
      subject: subjectRaw,
      message: messageRaw,
    } = body;

    // --- Validate payload BEFORE the rate limiter (codebase convention) ---
    if (!mongoose.isValidObjectId(orderId)) {
      return NextResponse.json(
        { error: "شناسه سفارش نامعتبر است" },
        { status: 400 }
      );
    }
    if (!mongoose.isValidObjectId(supplierOrderId)) {
      return NextResponse.json(
        { error: "شناسه زیرسفارش نامعتبر است" },
        { status: 400 }
      );
    }
    if (
      productId !== undefined &&
      productId !== null &&
      productId !== "" &&
      !mongoose.isValidObjectId(productId)
    ) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }

    const subject = parseSubject(subjectRaw);
    if (!subject) {
      return NextResponse.json(
        { error: "عنوان گفتگو باید بین ۱ تا ۱۲۰ کاراکتر باشد" },
        { status: 400 }
      );
    }
    const category = parseCategory(categoryRaw) ?? "general";
    const message = parseMessageText(messageRaw);
    if (!message) {
      return NextResponse.json(
        { error: "متن اولین پیام باید بین ۱ تا ۲۰۰۰ کاراکتر باشد" },
        { status: 400 }
      );
    }

    // --- Rate limit (after validation) ---
    const rl = await rateLimit(
      "conversation-create:" + token!.id,
      CONVERSATION_CREATE_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // --- Order ownership + purchase eligibility (server-validated) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order: any = await Order.findOne({
      _id: orderId,
      customer: token!.id,
    })
      .select("_id customer payment.status")
      .lean();

    if (!order) {
      // Same message for not-found and not-owned (no existence leak).
      return NextResponse.json(
        { error: "سفارش یافت نشد" },
        { status: 404 }
      );
    }
    if (!isEligibleOrderPayment(order.payment?.status)) {
      return NextResponse.json(
        { error: "گفتگو فقط برای سفارش‌های پرداخت‌شده قابل ایجاد است" },
        { status: 400 }
      );
    }

    // --- SupplierOrder must belong to the order ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplierOrder: any = await SupplierOrder.findOne({
      _id: supplierOrderId,
      order: orderId,
    }).lean();

    if (!supplierOrder) {
      return NextResponse.json(
        { error: "زیرسفارش یافت نشد" },
        { status: 404 }
      );
    }

    // --- Optional product must belong to the supplier order's items ---
    let product: string | null = null;
    if (productId) {
      const inItems = (supplierOrder.items || []).some(
        (i: { product?: unknown }) => String(i.product) === String(productId)
      );
      if (!inItems) {
        return NextResponse.json(
          { error: "محصول انتخابی متعلق به این سفارش نیست" },
          { status: 400 }
        );
      }
      product = String(productId);
    }

    // --- Atomic create (unique partial index {supplierOrder} where active) ---
    const now = new Date();
    let conversation: unknown;
    try {
      conversation = await CustomerConversation.create({
        customer: token!.id,
        order: orderId,
        supplierOrder: supplierOrderId,
        // The supplier comes from the SupplierOrder — NEVER from the body.
        supplier: supplierOrder.supplier,
        product,
        category,
        subject,
        status: "open",
        customerUnread: false,
        staffUnread: true,
        lastMessageAt: now,
        lastMessagePreview: formatMessagePreview(message),
        lastMessageFrom: "customer",
        messages: [
          {
            sender: token!.id,
            senderRole: "customer",
            text: message,
            createdAt: now,
          },
        ],
      });
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        return NextResponse.json(
          { error: "برای این سفارش گفتگوی فعالی وجود دارد" },
          { status: 409 }
        );
      }
      throw err;
    }

    // --- Notify the conversation's supplier (fail-silent, post-commit) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created: any = conversation;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplierDoc: any = supplierOrder.supplier
      ? await Supplier.findById(supplierOrder.supplier).select("user").lean()
      : null;

    await notifyConversationMessage({
      conversationId: String(created._id),
      orderId: String(orderId),
      senderRole: "customer",
      messageId: String(created.messages?.[0]?._id || ""),
      customerUserId: token!.id,
      supplierUserId: supplierDoc?.user ? String(supplierDoc.user) : undefined,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Error creating conversation:", error);
    return serverError();
  }
}

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter: Record<string, unknown> = { customer: token!.id };
    if (status) {
      filter.status = status;
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, rows] = await Promise.all([
      CustomerConversation.countDocuments(filter),
      CustomerConversation.find(filter)
        .populate("supplier", "businessName")
        .select(
          "_id order supplierOrder supplier product category subject status customerUnread staffUnread lastMessageAt lastMessagePreview lastMessageFrom createdAt updatedAt"
        )
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(rows, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return serverError();
  }
}
