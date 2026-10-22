import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, SMS_TEMPLATE_READ_LIMIT } from "@/lib/rate-limiter";
import {
  getSmsIrTemplate,
  mapSmsIrTemplateStatus,
} from "@/lib/sms-ir-admin";
import type { SmsIrTemplateResult } from "@/types";

/**
 * Phase 1 — Read-only SMS.ir template detail (GET only).
 *
 * GET /api/admin/sms/provider/templates/:templateId
 *   Admin-only. Fetches a single template from SMS.ir (GET /v1/templates/:id).
 *   No SMS is sent, no credit is consumed.
 *
 * Provider template status codes are mapped to our client-facing statuses:
 *   1 = pending, 2 = approved, 3 = rejected.
 *   If the provider reports template_not_found (status 113) or any other
 *   non-success code, it is mapped accordingly.
 *
 * The response never includes the API key or raw provider bodies.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { templateId: string } }
) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const rl = await rateLimit(
      `sms-provider-template:${token!.id}`,
      SMS_TEMPLATE_READ_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const templateId = parseInt(params.templateId, 10);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      return NextResponse.json(
        { error: "شناسه قالب نامعتبر است" },
        { status: 400 }
      );
    }

    const result: SmsIrTemplateResult = await getSmsIrTemplate(templateId, {
      env: process.env,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.messageFa || "قالب در سرویس‌دهنده یافت نشد",
          kind: result.kind,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      template: {
        id: result.template.id,
        title: result.template.title,
        templateText: result.template.templateText,
        type: result.template.type,
        parameters: result.template.parameters,
        status: mapSmsIrTemplateStatus(result.template.status),
        statusNumber: result.template.status,
        rejectionReason: result.template.rejectionReason,
        creationDateTime: result.template.creationDateTime,
      },
    });
  } catch (err) {
    console.error("Error fetching SMS.ir provider template:", err);
    return serverError();
  }
}
