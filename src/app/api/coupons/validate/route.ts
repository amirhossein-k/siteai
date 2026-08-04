import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/rate-limiter";
import { validateCoupon } from "@/lib/coupons";

/**
 * POST /api/coupons/validate — { code } → coupon rules preview (customer only).
 *
 * Returns the coupon's static rules ONLY (type/value/maxDiscount/minSubtotal/
 * usageLimit/perUserLimit). The discount is never computed here — the server
 * has no cart; checkout recomputes authoritatively at order time.
 *
 * Rate limited (10/15min per customer) to prevent code brute-forcing.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const rawCode = body?.code;

    // --- Payload validation BEFORE the rate limiter (Session 34 convention) ---
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json(
        { error: "کد تخفیف را وارد کنید" },
        { status: 400 }
      );
    }

    const limit = await rateLimit(`coupon:validate:${token!.id}`, {
      max: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (limit.limited) {
      return NextResponse.json(
        { error: "تلاش‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: limit.headers }
      );
    }

    // Session 55 — pass the authenticated user so a valid-but-not-for-you
    // coupon returns the distinct eligibility error instead of the rules
    // (a non-eligible user must never be told the coupon is "invalid").
    const result = await validateCoupon(rawCode, token!.id);
    if (!result.ok || !result.coupon) {
      return NextResponse.json(
        { error: result.error || "کد تخفیف معتبر نیست" },
        { status: 400 }
      );
    }

    const c = result.coupon;
    return NextResponse.json({
      valid: true,
      code: c.code,
      type: c.type,
      value: c.value,
      maxDiscount: c.maxDiscount || 0,
      minSubtotal: c.minSubtotal || 0,
      usageLimit: c.usageLimit || 0,
      perUserLimit: c.perUserLimit || 0,
    });
  } catch (err) {
    console.error("Error validating coupon:", err);
    return serverError();
  }
}
