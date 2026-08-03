import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Product from "@/models/Product";
import Review from "@/models/Review";
import { sanitizePlainText } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limiter";
import {
  notifyOrderEvent,
  type NotificationEventInput,
} from "@/lib/notifications";

/**
 * Structurally fail-silent notification dispatch (mirrors the Session 36
 * safeNotifyOrderEvent pattern): notifyOrderEvent is already non-throwing
 * internally, but this local guard guarantees a notification failure can
 * never turn a committed reply into a 500 response.
 */
async function safeNotifyOrderEvent(input: NotificationEventInput) {
  try {
    await notifyOrderEvent(input);
  } catch (err) {
    console.error(
      "[Supplier reply] notification dispatch failed (non-blocking):",
      err
    );
  }
}

/**
 * POST /api/supplier/reviews/[id]/reply
 * Supplier only (requireRoleOrError → 401/403).
 * Body: { text }
 *
 * Design (approved Session 37):
 *  - ONE reply per review — atomic claim on `reply: null` makes a second reply
 *    impossible (loser → 400).
 *  - Ownership verified server-side: Review.product → Product.supplier === the
 *    requesting supplier's OWN Supplier doc. Never trusts a client supplier id.
 *  - Reply allowed ONLY for approved reviews (pending/rejected → 400).
 *  - No admin moderation for replies — sanitized + rate-limited at write time.
 *  - On success the review author is notified with a `review_replied` in-app
 *    notification (fail-silent via notifyOrderEvent — never blocks the reply).
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
        { error: "شناسه دیدگاه نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Resolve the supplier's own document from the token (never from the body)
    // NOTE: no `.lean()` — Mongoose findOne+lean union type breaks
    // `supplier._id` access (same convention as the supplier products route).
    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const textRaw: unknown = body?.text;

    // --- Validate payload BEFORE the rate limiter (Session 34 convention) ---
    if (typeof textRaw !== "string" || textRaw.trim().length === 0) {
      return NextResponse.json(
        { error: "متن پاسخ نمی‌تواند خالی باشد" },
        { status: 400 }
      );
    }
    if (textRaw.length > 1000) {
      return NextResponse.json(
        { error: "متن پاسخ حداکثر ۱۰۰۰ کاراکتر می‌تواند باشد" },
        { status: 400 }
      );
    }
    const text = sanitizePlainText(textRaw);
    if (!text) {
      return NextResponse.json(
        { error: "متن پاسخ نامعتبر است" },
        { status: 400 }
      );
    }

    // --- Load the review ---
    const review = await Review.findById(id).lean();
    if (!review) {
      return NextResponse.json(
        { error: "دیدگاه یافت نشد" },
        { status: 404 }
      );
    }

    // --- Ownership: the review's product must belong to THIS supplier ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product: any = await Product.findOne({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _id: (review as any).product,
      supplier: supplier._id,
    })
      .select("_id slug name")
      .lean();

    if (!product) {
      // Don't leak existence — same message for not-found and not-owned
      return NextResponse.json(
        { error: "دیدگاه یافت نشد یا متعلق به محصول شما نیست" },
        { status: 404 }
      );
    }

    // --- Approved-only ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((review as any).status !== "approved") {
      return NextResponse.json(
        { error: "فقط به دیدگاه‌های تأییدشده می‌توان پاسخ داد" },
        { status: 400 }
      );
    }

    // --- Spam protection (after validation — invalid payloads don't burn quota) ---
    const rl = await rateLimit("supplierreply:" + token!.id, {
      max: 30,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // --- Atomic claim: reply: null → reply set (one reply per review) ---
    // MongoDB matches a missing `reply` subdoc with `reply: null` equality, so
    // only the first caller can flip it. A second call gets null → 400.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Review.findOneAndUpdate(
      { _id: id, status: "approved", reply: null },
      {
        $set: {
          reply: {
            author: token!.id,
            text,
            at: new Date(),
          },
        },
      },
      { new: true }
    )
      .populate("reply.author", "name")
      .lean();

    if (!claimed) {
      return NextResponse.json(
        { error: "قبلاً به این دیدگاه پاسخ داده شده است" },
        { status: 400 }
      );
    }

    // --- Notify the review author (fail-silent, never blocks the reply) ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customerId = (review as any).customer
      ? String((review as any).customer)
      : null;
    if (customerId) {
      await safeNotifyOrderEvent({
        recipient: customerId,
        type: "review_replied",
        category: "order",
        message: `فروشنده به دیدگاه شما درباره «${product.name}» پاسخ داد.`,
        relatedOrder: null,
        link: `/products/${product.slug}`,
        notificationKey: `review_${id}_review_replied`,
      });
    }

    return NextResponse.json(claimed);
  } catch (error) {
    console.error("Error replying to review:", error);
    return serverError();
  }
}
