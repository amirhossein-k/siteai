import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, SMS_TEMPLATE_READ_LIMIT } from "@/lib/rate-limiter";
import {
  getSmsIrTemplates,
  resolveSmsIrConfig,
  mapSmsIrTemplateStatus,
} from "@/lib/sms-ir-admin";
import type {
  SmsIrTemplatesResult,
  SmsIrTemplateStatus,
} from "@/types";

/**
 * Phase 1 — Read-only SMS.ir template listing (GET only).
 *
 * GET /api/admin/sms/provider/templates
 *   Admin-only. Fetches templates from SMS.ir (GET /v1/templates) with
 *   optional pageNumber, pageSize, and status query params forwarded to the
 *   provider. No SMS is sent, no credit is consumed.
 *
 * Provider template status codes are mapped to our client-facing statuses:
 *   1 = pending, 2 = approved, 3 = rejected.
 *   Any other provider status (including template_not_found 113) maps to
 *   not_found or unknown.
 *
 * The response never includes the API key or raw provider bodies.
 */

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const rl = await rateLimit(
      `sms-provider-templates:${token!.id}`,
      SMS_TEMPLATE_READ_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const { searchParams } = new URL(req.url);
    const pageNumber = parseInt(searchParams.get("pageNumber") ?? "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") ?? "10", 10);
    const status = searchParams.get("status");

    const result: SmsIrTemplatesResult = await getSmsIrTemplates({
      env: process.env,
      pageNumber: Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1,
      pageSize:
        Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100
          ? pageSize
          : 10,
      status: status ? parseInt(status, 10) : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.messageFa || "خطا در دریافت قالب‌ها از سرویس‌دهنده",
          kind: result.kind,
        },
        { status: 502 }
      );
    }

    const mappedTemplates = result.templates.map((t) => ({
      id: t.id,
      title: t.title,
      templateText: t.templateText,
      type: t.type,
      parameters: t.parameters,
      status: mapSmsIrTemplateStatus(t.status),
      statusNumber: t.status,
      rejectionReason: t.rejectionReason,
      creationDateTime: t.creationDateTime,
    }));

    return NextResponse.json({
      ok: true,
      templates: mappedTemplates,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    console.error("Error fetching SMS.ir provider templates:", err);
    return serverError();
  }
}
