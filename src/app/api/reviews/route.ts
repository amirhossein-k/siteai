import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Review from "@/models/Review";
import Product from "@/models/Product";
import Order from "@/models/Order";
import Supplier from "@/models/Supplier";
import { sanitizePlainText } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limiter";
import { notifyOrderEvent } from "@/lib/notifications";
import { sendNewReviewNotification } from "@/lib/telegram";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * Customer Reviews (Session 34).
 *
 * GET  /api/reviews?product=<id>&page=&limit=
 *   Public. Returns APPROVED reviews only (paginated) + ratingSummary
 *   { average, count } aggregated from approved reviews for the product.
 *   Never exposes pending/rejected reviews or reviewer contact info.
 *
 * POST /api/reviews
 *   Customer only (requireRoleOrError → 401/403), rate-limited.
 *   Body: { productId, orderId, rating, text }
 *   Verified-purchase gate: the order must belong to the customer, be DELIVERED
 *   (not merely paid) and contain the product. One review per order-item:
 *   the unique index { customer, product, order } blocks duplicates atomically
 *   (E11000 → 409). Creates with status "pending".
 */
export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const product = searchParams.get("product");

    if (!product || !mongoose.isValidObjectId(product)) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const filter = { product, status: "approved" };

    const [total, reviews, aggregate] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("customer", "name")
        // Session 37: supplier reply shown on the storefront (author name only)
        .populate("reply.author", "name")
        .lean(),
      Review.aggregate([
        { $match: { product: new mongoose.Types.ObjectId(product), status: "approved" } },
        {
          $group: {
            _id: null,
            average: { $avg: "$rating" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const ratingSummary =
      aggregate.length > 0
        ? {
            average: Math.round(aggregate[0].average * 10) / 10,
            count: aggregate[0].count,
          }
        : { average: 0, count: 0 };

    return NextResponse.json({
      ...buildPaginatedResponse(reviews, total, page, limit),
      ratingSummary,
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const productId: unknown = body?.productId;
    const orderId: unknown = body?.orderId;
    const rating: unknown = body?.rating;
    const textRaw: unknown = body?.text;

    // --- Validate payload BEFORE the rate limiter so invalid submissions
    // --- don't burn a legit customer's review quota ---
    if (
      typeof productId !== "string" ||
      !mongoose.isValidObjectId(productId)
    ) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }
    if (
      typeof orderId !== "string" ||
      !mongoose.isValidObjectId(orderId)
    ) {
      return NextResponse.json(
        { error: "شناسه سفارش نامعتبر است" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
      return NextResponse.json(
        { error: "امتیاز باید عددی بین ۱ تا ۵ باشد" },
        { status: 400 }
      );
    }
    if (typeof textRaw !== "string" || textRaw.trim().length === 0) {
      return NextResponse.json(
        { error: "متن دیدگاه نمی‌تواند خالی باشد" },
        { status: 400 }
      );
    }
    if (textRaw.length > 1000) {
      return NextResponse.json(
        { error: "متن دیدگاه حداکثر ۱۰۰۰ کاراکتر می‌تواند باشد" },
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

    // Spam protection: max 20 valid review submissions per 15 minutes per
    // customer — generous enough for reviewing several delivered products at
    // once, but still stops bots spamming reviews.
    const rl = await rateLimit("review:" + token!.id, {
      max: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // --- Product must exist & be active ---
    const product = await Product.findOne({ _id: productId, isActive: true })
      .select("_id supplier")
      .lean();
    if (!product) {
      return NextResponse.json(
        { error: "محصول یافت نشد" },
        { status: 404 }
      );
    }

    // --- Verified-purchase gate: the order must belong to THIS customer,
    // --- be DELIVERED and contain the product (requirement: delivered, not only paid)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order: any = await Order.findOne({
      _id: orderId,
      customer: token!.id,
      "payment.status": "paid",
      status: "delivered",
      items: { $elemMatch: { product: productId } },
    }).lean();

    if (!order) {
      return NextResponse.json(
        { error: "فقط خریداران این محصول (پس از تحویل سفارش) می‌توانند دیدگاه ثبت کنند" },
        { status: 403 }
      );
    }

    // --- Duplicate gate: one review per order-item (unique index backstop) ---
    const existing = await Review.findOne({
      customer: token!.id,
      product: productId,
      order: orderId,
    }).lean();
    if (existing) {
      return NextResponse.json(
        { error: "شما قبلاً برای این محصول دیدگاه ثبت کرده‌اید" },
        { status: 409 }
      );
    }

    // --- Immutable order-item snapshot for audit ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderItem: any = (order.items || []).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (i: any) => String(i.product) === String(productId)
    );

    const review = await Review.create({
      customer: token!.id,
      product: productId,
      order: orderId,
      // Denormalized supplier snapshot (stable ownership for the reply queue)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supplier: (product as any)?.supplier || null,
      itemSnapshot: {
        name: orderItem?.name || "",
        sku: orderItem?.sku || "",
        variantId: orderItem?.variantId || null,
        variantLabel: orderItem?.variantLabel || "",
        image: orderItem?.image || "",
        price: orderItem?.price || 0,
        quantity: orderItem?.quantity || 0,
      },
      rating,
      text,
      status: "pending",
    });

    // Session 45: notify the review's supplier AFTER the review commits.
    // The supplier is the denormalized Session 37 snapshot; we fetch the
    // Supplier to resolve its user account (recipient) + telegramChatId.
    // notifyOrderEvent() never throws and telegram dispatch is fire-and-forget
    // — a delivery failure can never fail the review write. The whole block is
    // additionally wrapped so a notification-side throw can never convert an
    // already-committed review into a 500.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reviewSupplierId: any = (product as any)?.supplier;
      if (reviewSupplierId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reviewSupplier: any = await Supplier.findById(reviewSupplierId)
          .select("user telegramChatId")
          .lean();
        if (reviewSupplier?.user) {
          await notifyOrderEvent({
            recipient: String(reviewSupplier.user),
            type: "new_review",
            category: "system",
            message: `دیدگاه جدیدی برای «${orderItem?.name || ""}» ثبت شد`,
            link: "/supplier/reviews",
            notificationKey: `new_review_${review._id}`,
            telegram: reviewSupplier.telegramChatId
              ? () =>
                  sendNewReviewNotification(
                    reviewSupplier.telegramChatId,
                    orderItem?.name || "محصول",
                    rating as number
                  )
              : undefined,
          });
        }
      }
    } catch (notifyErr) {
      console.error("[reviews] new_review notification failed (already committed):", notifyErr);
    }

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    // Unique index E11000 → duplicate race backstop
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (error && (error as any).code === 11000) {
      return NextResponse.json(
        { error: "شما قبلاً برای این محصول دیدگاه ثبت کرده‌اید" },
        { status: 409 }
      );
    }
    console.error("Error creating review:", error);
    return serverError();
  }
}
