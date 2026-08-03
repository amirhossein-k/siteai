import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Coupon from "@/models/Coupon";
import CouponUsage from "@/models/CouponUsage";
import { normalizeCouponCode, COUPON_CODE_REGEX } from "@/lib/coupons";

/** Parse an optional date field; returns Invalid Date for bad strings. */
function parseDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
}

/**
 * PUT /api/admin/coupons/[id] — update a coupon (admin only).
 *
 * Validates against the EFFECTIVE values (new body ?? existing doc), so
 * `{ value: 150 }` alone on a percent coupon — or `{ type: "percent" }` alone
 * on a fixed coupon with a large value — cannot store an invalid >100% coupon.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "شناسه کد تخفیف الزامی است" },
        { status: 400 }
      );
    }

    const existing = await Coupon.findById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "کد تخفیف یافت نشد" },
        { status: 404 }
      );
    }

    const body = await req.json();

    // --- Code validation ---
    if (body.code !== undefined) {
      const code = normalizeCouponCode(String(body.code || ""));
      if (!COUPON_CODE_REGEX.test(code)) {
        return NextResponse.json(
          { error: "کد تخفیف باید ۳ تا ۵۰ کاراکتر (حروف، عدد، _ یا -) باشد" },
          { status: 400 }
        );
      }
    }

    // --- Type validation ---
    let effectiveType = existing.type;
    if (body.type !== undefined) {
      if (body.type !== "percent" && body.type !== "fixed") {
        return NextResponse.json(
          { error: "نوع تخفیف باید درصدی یا مبلغی باشد" },
          { status: 400 }
        );
      }
      effectiveType = body.type;
    }

    // --- Value validation against the EFFECTIVE type/value ---
    let effectiveValue = existing.value;
    if (body.value !== undefined) {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json(
          { error: "مقدار تخفیف باید عددی مثبت باشد" },
          { status: 400 }
        );
      }
      effectiveValue = value;
    }
    if (effectiveType === "percent" && effectiveValue > 100) {
      return NextResponse.json(
        { error: "درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد" },
        { status: 400 }
      );
    }

    // --- Numeric limits ---
    for (const key of ["minSubtotal", "maxDiscount", "usageLimit", "perUserLimit"]) {
      if (body[key] !== undefined) {
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "مقدار وارد شده نامعتبر است" },
            { status: 400 }
          );
        }
      }
    }

    // --- Dates ---
    const startsAt = parseDate(body.startsAt);
    const endsAt = parseDate(body.endsAt);
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      return NextResponse.json(
        { error: "تاریخ شروع معتبر نیست" },
        { status: 400 }
      );
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      return NextResponse.json(
        { error: "تاریخ پایان معتبر نیست" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {};
    if (body.code !== undefined)
      update.code = normalizeCouponCode(String(body.code));
    if (body.type !== undefined) update.type = body.type;
    if (body.value !== undefined) update.value = Number(body.value);
    if (body.minSubtotal !== undefined)
      update.minSubtotal = Number(body.minSubtotal);
    if (body.maxDiscount !== undefined)
      update.maxDiscount = Number(body.maxDiscount);
    if (body.startsAt !== undefined) update.startsAt = startsAt;
    if (body.endsAt !== undefined) update.endsAt = endsAt;
    if (body.isActive !== undefined) update.isActive = !!body.isActive;
    // Strict boolean check (Session 44): a string "false" must not coerce to
    // true and silently publish a private coupon.
    if (body.isPublic !== undefined) update.isPublic = body.isPublic === true;
    if (body.usageLimit !== undefined) update.usageLimit = Number(body.usageLimit);
    if (body.perUserLimit !== undefined)
      update.perUserLimit = Number(body.perUserLimit);

    // Duplicate code check (excluding self)
    if (update.code) {
      const dup = await Coupon.findOne({ code: update.code, _id: { $ne: id } });
      if (dup) {
        return NextResponse.json(
          { error: "کدی با این نام قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    }

    const updated = await Coupon.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean();

    // TOCTOU guard: the coupon could be deleted between the existence check
    // above and this update
    if (!updated) {
      return NextResponse.json(
        { error: "کد تخفیف یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (err: unknown) {
    console.error("Error updating coupon:", err);
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: "شناسه کد تخفیف الزامی است" },
        { status: 400 }
      );
    }

    const deleted = await Coupon.findByIdAndDelete(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "کد تخفیف یافت نشد" },
        { status: 404 }
      );
    }

    // Clean up per-user usage rows for the deleted coupon
    await CouponUsage.deleteMany({ coupon: id });

    return NextResponse.json({ message: "کد تخفیف با موفقیت حذف شد" });
  } catch (err) {
    console.error("Error deleting coupon:", err);
    return serverError();
  }
}
