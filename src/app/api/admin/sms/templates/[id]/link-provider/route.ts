import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, SMS_TEMPLATE_WRITE_LIMIT } from "@/lib/rate-limiter";
import SmsTemplate from "@/models/SmsTemplate";
import { getSmsIrTemplate } from "@/lib/sms-ir-admin";

/**
 * Phase 2A — Link a local SmsTemplate to an SMS.ir provider template (POST only).
 *
 * POST /api/admin/sms/templates/:id/link-provider
 *   Admin-only. Rate-limited with SMS_TEMPLATE_WRITE_LIMIT.
 *   Body: { providerTemplateId: string } (digits only, max 12, not empty).
 *
 * Calls GET /v1/templates/:providerTemplateId (read-only, no SMS sent).
 * Provider response handling:
 *   status 1 → pending, status 2 → approved, status 3 → rejected,
 *   404 / code 113 → not_found.
 *   Network / timeout / malformed / 5xx → previous state preserved,
 *     providerLastCheckError recorded, providerTemplateId NOT saved.
 *
 * The response never includes the API key or raw provider bodies.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const rl = await rateLimit(
      `sms-template-write:${token!.id}`,
      SMS_TEMPLATE_WRITE_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد عملیات بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();
    const { id: idParam } = await params;
    if (!/^[0-9a-fA-F]{24}$/.test(idParam)) {
      return NextResponse.json(
        { error: "شناسه قالب نامعتبر است" },
        { status: 400 }
      );
    }

    const body = (await req.json()) as { providerTemplateId?: unknown };
    const providerTemplateId =
      typeof body.providerTemplateId === "string"
        ? body.providerTemplateId.trim()
        : "";

    if (!providerTemplateId) {
      return NextResponse.json(
        { error: "شناسه قالب سرویس‌دهنده الزامی است" },
        { status: 400 }
      );
    }
    if (!/^\d{1,12}$/.test(providerTemplateId)) {
      return NextResponse.json(
        { error: "شناسه قالب سرویس‌دهنده باید عددی و حداکثر ۱۲ رقم باشد" },
        { status: 400 }
      );
    }

    const template = await SmsTemplate.findById(idParam).lean();
    if (!template) {
      return NextResponse.json({ error: "قالب یافت نشد" }, { status: 404 });
    }

    // Read-only provider check — no SMS sent, no credit consumed.
    const result = await getSmsIrTemplate(providerTemplateId, {
      env: process.env,
    });

    if (!result.ok) {
      // Provider explicitly reported template_not_found (HTTP 400 / code 113)
      if (result.kind === "template_not_found") {
        const now = new Date();
        await SmsTemplate.findByIdAndUpdate(idParam, {
          providerTemplateId,
          providerStatus: "not_found",
          providerVerifiedAt: now,
          providerLastCheckedAt: now,
          providerLastCheckError: "",
          providerRejectionReason: "",
        });
        return NextResponse.json({
          ok: true,
          providerTemplateId,
          providerStatus: "not_found",
          providerVerifiedAt: now,
        });
      }

      // Network / timeout / malformed / 5xx / auth error — preserve state,
      // record the error, do NOT save providerTemplateId.
      const errorMessage =
        result.messageFa || "خطا در بررسی قالب از سرویس‌دهنده";
      await SmsTemplate.findByIdAndUpdate(idParam, {
        providerLastCheckError: errorMessage.slice(0, 300),
      });
      return NextResponse.json(
        { error: errorMessage, kind: result.kind },
        { status: 502 }
      );
    }

    const providerStatusCode = result.template.status; // 1, 2, or 3
    const now = new Date();
    let providerStatus: "pending" | "approved" | "rejected";
    let providerRejectionReason = "";

    switch (providerStatusCode) {
      case 1:
        providerStatus = "pending";
        break;
      case 2:
        providerStatus = "approved";
        break;
      case 3:
        providerStatus = "rejected";
        providerRejectionReason = result.template.rejectionReason || "";
        break;
      default:
        // Defensive: any other conclusive status is treated as pending.
        providerStatus = "pending";
        break;
    }

    await SmsTemplate.findByIdAndUpdate(idParam, {
      providerTemplateId,
      providerStatus,
      providerVerifiedAt: now,
      providerLastCheckedAt: now,
      providerLastCheckError: "",
      providerRejectionReason,
    });

    return NextResponse.json({
      ok: true,
      providerTemplateId,
      providerStatus,
      providerVerifiedAt: now,
      providerRejectionReason,
    });
  } catch (error) {
    console.error("Error linking SMS provider template:", error);
    return serverError();
  }
}
