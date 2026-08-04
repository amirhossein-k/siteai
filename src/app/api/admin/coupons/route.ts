import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Coupon from "@/models/Coupon";
import {
  normalizeCouponCode,
  COUPON_CODE_REGEX,
  parseCouponEligibility,
} from "@/lib/coupons";

/**
 * GET /api/admin/coupons — list all coupons (newest first).
 * POST /api/admin/coupons — create a coupon (admin only).
 *
 * Code is normalized to uppercase before storage (Session 39 constraint).
 * GET (Session 55) populates eligibility.assignedUsers (name/phone) so the
 * admin UI can render the assigned-user picker — a SINGLE extra query for the
 * whole list (no N+1).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const coupons = await Coupon.find()
      .sort({ createdAt: -1 })
      .populate("eligibility.assignedUsers", "name phone")
      .lean();
    return NextResponse.json(coupons);
  } catch (err) {
    console.error("Error fetching coupons:", err);
    return serverError();
  }
}

/** Validate + normalize the coupon payload. Returns an error string or null. */
function validatePayload(
  body: Record<string, unknown>
): { error: string } | null {
  const code = normalizeCouponCode(String(body.code || ""));
  if (!COUPON_CODE_REGEX.test(code)) {
    return { error: "کد تخفیف باید ۳ تا ۵۰ کاراکتر (حروف، عدد، _ یا -) باشد" };
  }
  if (body.type !== "percent" && body.type !== "fixed") {
    return { error: "نوع تخفیف باید درصدی یا مبلغی باشد" };
  }
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: "مقدار تخفیف باید عددی مثبت باشد" };
  }
  if (body.type === "percent" && value > 100) {
    return { error: "درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد" };
  }
  const minSubtotal = Number(body.minSubtotal ?? 0);
  if (!Number.isFinite(minSubtotal) || minSubtotal < 0) {
    return { error: "حداقل مبلغ سبد نامعتبر است" };
  }
  const maxDiscount = Number(body.maxDiscount ?? 0);
  if (!Number.isFinite(maxDiscount) || maxDiscount < 0) {
    return { error: "سقف تخفیف نامعتبر است" };
  }
  const usageLimit = Number(body.usageLimit ?? 0);
  if (!Number.isFinite(usageLimit) || usageLimit < 0) {
    return { error: "سقف استفاده نامعتبر است" };
  }
  const perUserLimit = Number(body.perUserLimit ?? 0);
  if (!Number.isFinite(perUserLimit) || perUserLimit < 0) {
    return { error: "سقف استفاده هر کاربر نامعتبر است" };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    const validationError = validatePayload(body);
    if (validationError) {
      return NextResponse.json(
        { error: validationError.error },
        { status: 400 }
      );
    }

    // Session 55 — audience validation (mode whitelist, ObjectId guards → 400)
    const eligibilityResult = parseCouponEligibility(body.eligibility);
    if ("error" in eligibilityResult) {
      return NextResponse.json(
        { error: eligibilityResult.error },
        { status: 400 }
      );
    }

    const code = normalizeCouponCode(String(body.code || ""));

    const existing = await Coupon.findOne({ code });
    if (existing) {
      return NextResponse.json(
        { error: "کدی با این نام قبلاً وجود دارد" },
        { status: 409 }
      );
    }

    const coupon = await Coupon.create({
      code,
      type: body.type,
      value: Number(body.value),
      minSubtotal: Number(body.minSubtotal ?? 0),
      maxDiscount: Number(body.maxDiscount ?? 0),
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      isActive: body.isActive ?? true,
      isPublic: body.isPublic === true, // Session 44 — default false
      // Session 55 — default public when omitted (backward compatible)
      eligibility:
        eligibilityResult.value ?? { mode: "public", assignedUsers: [], groups: [] },
      usageLimit: Number(body.usageLimit ?? 0),
      perUserLimit: Number(body.perUserLimit ?? 0),
    });

    return NextResponse.json(coupon, { status: 201 });
  } catch (err: unknown) {
    console.error("Error creating coupon:", err);
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "کدی با این نام قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}
