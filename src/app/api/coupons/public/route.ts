import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import Coupon from "@/models/Coupon";
import { rateLimit } from "@/lib/rate-limiter";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * GET /api/coupons/public — public marketing coupon list (Session 44).
 *
 * PUBLIC (no auth): returns ONLY coupons that are:
 *   - isPublic: true        (admin opted the code into the marketing surface)
 *   - isActive: true
 *   - currently in-window   (startsAt <= now, endsAt > now — same window rules
 *     as isCouponUsable() in src/lib/coupons.ts, expressed as a Mongo query)
 *
 * Projection is STRICT — only marketing-safe fields are returned:
 *   { _id, code, type, value, minSubtotal, maxDiscount, endsAt }
 * Internal limits (usageLimit / perUserLimit / usedCount / startsAt) are NEVER
 * exposed. Private coupons (isPublic: false) are never returned — the storefront
 * page and checkout picker can only ever surface opted-in public codes.
 *
 * This endpoint does NOT validate, claim, or compute discounts — it is a pure
 * read. The checkout coupon flow (validateCoupon → claimCouponForOrder) is
 * UNCHANGED; the picker only pre-fills the code the customer submits.
 *
 * Paginated with the Session 27 shape (parsePaginationParams +
 * buildPaginatedResponse).
 *
 * Rate-limited per client IP (unauthenticated public endpoint — same
 * IP-keyed pattern as register).
 */
export async function GET(req: NextRequest) {
  try {
    // Rate limit by client IP (x-forwarded-for fallback — register precedent)
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const rl = await rateLimit(`coupons:public:${ip}`, {
      max: 60,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = parsePaginationParams(searchParams);

    const now = new Date();
    const filter = {
      isPublic: true,
      isActive: true,
      // Same active-window semantics as isCouponUsable() (no upper bound on
      // startsAt, no lower bound on endsAt — the window is startsAt..endsAt).
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      ],
    };

    const [total, coupons] = await Promise.all([
      Coupon.countDocuments(filter),
      Coupon.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("code type value minSubtotal maxDiscount endsAt")
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(coupons, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching public coupons:", error);
    return NextResponse.json(
      { error: "خطا در دریافت کدهای تخفیف" },
      { status: 500 }
    );
  }
}
