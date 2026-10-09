import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Review from "@/models/Review";
import { sanitizePlainText } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limiter";

/**
 * PATCH /api/reviews/[id]
 * Customer only (requireRoleOrError → 401/403), rate-limited.
 * Body: { rating, text } — the ONLY editable fields.
 *
 * Editable only while the review is still PENDING moderation. The update is a
 * single atomic `updateOne` filtered by { _id, customer, status: "pending" }:
 * ownership and editability are enforced in the database, so a moderation that
 * lands concurrently makes the update match nothing → 409 (no lost-update race).
 * Product, order, supplier, item snapshot, status and seller reply are never
 * written here.
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
        { error: "شناسه دیدگاه نامعتبر است" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const rating: unknown = body?.rating;
    const textRaw: unknown = body?.text;

    // Validate BEFORE the rate limiter so bad payloads don't burn quota
    // (same rules as POST /api/reviews).
    if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
      return NextResponse.json(
        { error: "امتیاز باید عددی بین ۱ تا ۵ باشد" },
        { status: 400 }
      );
    }
    if (typeof textRaw !== "string" || textRaw.trim().length === 0) {
      return NextResponse.json(
        { error: "متن دیدگاه نمیتواند خالی باشد" },
        { status: 400 }
      );
    }
    if (textRaw.length > 1000) {
      return NextResponse.json(
        { error: "متن دیدگاه حداکثر ۱۰۰۰ کاراکتر میتواند باشد" },
        { status: 400 }
      );
    }
    const text = sanitizePlainText(textRaw);
    if (!text) {
      return NextResponse.json(
        { error: "متن دیدگاه نامعتبر است" },
        { status: 400 }
      );
    }

    const rl = await rateLimit("review:" + token!.id, {
      max: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواستهای شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const result = await Review.updateOne(
      { _id: id, customer: token!.id, status: "pending" },
      { $set: { rating, text } }
    );

    if (result.matchedCount === 0) {
      // Not found / not owned → 404. Otherwise the review exists but was
      // already moderated (or changed concurrently) → 409.
      const exists = await Review.exists({ _id: id, customer: token!.id });
      if (!exists) {
        return NextResponse.json(
          { error: "دیدگاه یافت نشد" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "این دیدگاه دیگر قابل ویرایش نیست" },
        { status: 409 }
      );
    }

    const updated = await Review.findById(id).lean();
    return NextResponse.json(JSON.parse(JSON.stringify(updated)));
  } catch (error) {
    console.error("Error updating review:", error);
    return serverError();
  }
}
