import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError, unauthorized } from "@/lib/auth-utils";
import {
  rateLimit,
  SUPPLIER_APPLICATION_LIMIT,
  SUPPLIER_APPLICATION_IP_LIMIT,
} from "@/lib/rate-limiter";
import User from "@/models/User";
import SupplierApplication from "@/models/SupplierApplication";
import {
  validateSupplierApplicationInput,
  normalizeContactPhone,
  isValidContactPhone,
} from "@/lib/supplier-application";
import { sanitizePlainText } from "@/lib/sanitize";
import { notifyOrderEvent } from "@/lib/notifications";

/**
 * Session 67 — PUBLIC supplier application submission.
 *
 * POST /api/supplier-applications — CUSTOMER ONLY. This endpoint ONLY
 * creates a "pending" application row. It can NEVER change the applicant's
 * role and NEVER touches the Supplier collection — self-role-assignment is
 * impossible by construction (the role/supplier write happens exclusively in
 * the admin-only approval endpoint, which reuses the Session 66 change-role
 * provisioning semantics).
 *
 * Guards: per-user (2/15min) + per-IP (5/15min) rate limits, one open
 * "pending" application per user (unique partial index → 409), sanitized +
 * capped fields, optional contactPhone validated when provided (defaults to
 * the applicant's registered phone).
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    // Rate limits (validation-free, like the register flow) — per user + per IP.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const rlUser = await rateLimit(
      `supplier-apply:${token!.id}`,
      SUPPLIER_APPLICATION_LIMIT
    );
    if (rlUser.limited) {
      return NextResponse.json(
        {
          error:
            "تعداد درخواست‌های فروشندگی بیش از حد مجاز است. لطفاً بعداً تلاش کنید.",
        },
        { status: 429, headers: rlUser.headers }
      );
    }
    const rlIp = await rateLimit(
      `supplier-apply:ip:${ip}`,
      SUPPLIER_APPLICATION_IP_LIMIT
    );
    if (rlIp.limited) {
      return NextResponse.json(
        {
          error:
            "تعداد درخواست‌های فروشندگی بیش از حد مجاز است. لطفاً بعداً تلاش کنید.",
        },
        { status: 429, headers: rlIp.headers }
      );
    }

    const body = await req.json();
    const { businessName, description, contactPhone } = body as {
      businessName?: string;
      description?: string;
      contactPhone?: string;
    };

    const validation = validateSupplierApplicationInput({
      businessName: businessName || "",
      description: description || "",
      contactPhone,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    await dbConnect();

    const user = await User.findById(token!.id);
    if (!user) return unauthorized();
    if (user.isActive === false) {
      return NextResponse.json(
        { error: "حساب شما غیرفعال است و امکان ارسال درخواست ندارد" },
        { status: 403 }
      );
    }

    // Friendly pre-check for the one-open-application invariant (the unique
    // partial index is the hard guarantee — E11000 handled below).
    const existing = await SupplierApplication.findOne({
      user: user._id,
      status: "pending",
    }).lean();
    if (existing) {
      return NextResponse.json(
        { error: "درخواست قبلی شما هنوز در انتظار بررسی است" },
        { status: 409 }
      );
    }

    const trimmedPhone =
      contactPhone !== undefined && contactPhone !== null
        ? normalizeContactPhone(contactPhone)
        : "";
    const effectivePhone =
      isValidContactPhone(trimmedPhone) ? trimmedPhone : user.phone;

    try {
      const app = await SupplierApplication.create({
        user: user._id,
        businessName: sanitizePlainText(businessName!.trim()),
        description: sanitizePlainText((description || "").trim()),
        contactPhone: effectivePhone,
        status: "pending",
      });

      // Notify every active admin — best-effort, never blocks the response.
      const admins = await User.find({ role: "admin", isActive: true })
        .select("_id")
        .lean();
      for (const admin of admins) {
        await notifyOrderEvent({
          recipient: String(admin._id),
          type: "supplier_application",
          category: "system",
          message: `درخواست فروشندگی جدید از «${businessName!.trim()}»`,
          link: "/admin/suppliers?tab=applications",
          notificationKey: `supplier_application_${app._id}`,
        });
      }

      return NextResponse.json(
        { id: app._id.toString(), status: app.status },
        { status: 201 }
      );
    } catch (err) {
      // Unique partial index { user, status: "pending" } → one open application.
      if ((err as { code?: number })?.code === 11000) {
        return NextResponse.json(
          { error: "درخواست قبلی شما هنوز در انتظار بررسی است" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("Error submitting supplier application:", error);
    return serverError();
  }
}
