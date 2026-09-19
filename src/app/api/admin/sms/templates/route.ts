import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, SMS_TEMPLATE_WRITE_LIMIT } from "@/lib/rate-limiter";
import SmsTemplate from "@/models/SmsTemplate";
import { sanitizePlainText } from "@/lib/sanitize";
import {
  extractTemplateVariables,
  BUSINESS_SMS_MAX_LENGTH,
} from "@/lib/sms-business";

/**
 * Session 90 — Admin business-SMS template management (Phase 1b).
 *
 * GET    /api/admin/sms/templates            — list (newest first)
 * POST   /api/admin/sms/templates            — create (409 on duplicate name)
 * PUT    /api/admin/sms/templates?id=X       — update (partial, runValidators)
 * DELETE /api/admin/sms/templates?id=X       — delete
 *
 * Admin-only (requireRoleOrError(req, ["admin"])) on every verb. Write verbs
 * are rate-limited with the independent SMS_TEMPLATE_WRITE_LIMIT key namespace
 * (30/admin/15min) — the OTP limiter keys are never touched.
 *
 * Template semantics:
 *   - `variables` is always SERVER-DERIVED from `body` placeholders
 *     (extractTemplateVariables) — a client can never declare variables that
 *     do not exist in the body.
 *   - `providerTemplateId` is optional in Phase 1 (mock-first); when present
 *     it must be digits only.
 *   - Templates are soft-disabled via isActive — an inactive template can
 *     never be used by the manual-send endpoint (server-enforced there).
 */

const TEMPLATE_TYPES = [
  "order_confirmation",
  "shipping_update",
  "tracking_code",
  "delivery_followup",
  "custom",
] as const;
type TemplateType = (typeof TEMPLATE_TYPES)[number];

function isTemplateType(v: unknown): v is TemplateType {
  return typeof v === "string" && (TEMPLATE_TYPES as readonly string[]).includes(v);
}

const NAME_MAX = 100;

function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/** Validate the shared template payload; returns Persian error or null. */
function validateTemplatePayload(body: {
  name?: unknown;
  type?: unknown;
  providerTemplateId?: unknown;
  body?: unknown;
  isActive?: unknown;
}): { error?: string; name?: string; type?: TemplateType; providerTemplateId?: string; text?: string } {
  if (body.name !== undefined) {
    const name = sanitizePlainText(String(body.name).trim());
    if (name.length < 2 || name.length > NAME_MAX) {
      return { error: "نام قالب باید بین ۲ تا ۱۰۰ کاراکتر باشد" };
    }
  }
  if (body.type !== undefined && !isTemplateType(body.type)) {
    return { error: "نوع قالب نامعتبر است" };
  }
  if (body.providerTemplateId !== undefined) {
    const id = String(body.providerTemplateId).trim();
    if (id && !/^\d{1,12}$/.test(id)) {
      return { error: "شناسه قالب سرویس‌دهنده باید عددی باشد" };
    }
  }
  if (body.body !== undefined) {
    const text = sanitizePlainText(String(body.body));
    if (text.length > BUSINESS_SMS_MAX_LENGTH) {
      return { error: `متن قالب حداکثر ${BUSINESS_SMS_MAX_LENGTH} کاراکتر است` };
    }
  }
  return {};
}

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const active = searchParams.get("active");

    const filter: Record<string, unknown> = {};
    if (active === "true") filter.isActive = true;

    const templates: any[] = await SmsTemplate.find(filter)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
      .lean();

    return NextResponse.json(
      templates.map((t) => ({
        _id: String(t._id),
        name: t.name,
        type: t.type,
        providerTemplateId: t.providerTemplateId || "",
        variables: t.variables || [],
        body: t.body || "",
        isActive: t.isActive,
        createdBy: t.createdBy
          ? { _id: String((t.createdBy as { _id: unknown })._id), name: (t.createdBy as { name: string }).name }
          : null,
        updatedBy: t.updatedBy
          ? { _id: String((t.updatedBy as { _id: unknown })._id), name: (t.updatedBy as { name: string }).name }
          : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error("Error fetching SMS templates:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
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
    const body = (await req.json()) as Record<string, unknown>;

    const validation = validateTemplatePayload(body);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const name = sanitizePlainText(String(body.name ?? "").trim());
    if (!name) {
      return NextResponse.json({ error: "نام قالب الزامی است" }, { status: 400 });
    }
    const type = isTemplateType(body.type) ? body.type : "custom";
    const providerTemplateId = String(body.providerTemplateId ?? "").trim();
    const text = sanitizePlainText(String(body.body ?? ""));

    const existing = await SmsTemplate.findOne({ name });
    if (existing) {
      return NextResponse.json(
        { error: "قالبی با این نام قبلاً وجود دارد" },
        { status: 409 }
      );
    }

    const created = await SmsTemplate.create({
      name,
      type,
      providerTemplateId,
      // Server-derived from the body — never client-declared.
      variables: extractTemplateVariables(text),
      body: text,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      createdBy: token!.id,
      updatedBy: token!.id,
    });

    return NextResponse.json(
      { _id: String(created._id), name: created.name },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating SMS template:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "قالبی با این نام قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id || !isValidObjectId(id)) {
      return NextResponse.json({ error: "شناسه قالب نامعتبر است" }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validation = validateTemplatePayload(body);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { updatedBy: token!.id };
    if (body.name !== undefined) {
      const name = sanitizePlainText(String(body.name).trim());
      if (!name) {
        return NextResponse.json({ error: "نام قالب الزامی است" }, { status: 400 });
      }
      const existing = await SmsTemplate.findOne({ name, _id: { $ne: id } });
      if (existing) {
        return NextResponse.json(
          { error: "قالبی با این نام قبلاً وجود دارد" },
          { status: 409 }
        );
      }
      updateData.name = name;
    }
    if (body.type !== undefined) updateData.type = body.type;
    if (body.providerTemplateId !== undefined) {
      updateData.providerTemplateId = String(body.providerTemplateId).trim();
    }
    if (body.body !== undefined) {
      const text = sanitizePlainText(String(body.body));
      updateData.body = text;
      // Body edits re-derive the declared variables server-side.
      updateData.variables = extractTemplateVariables(text);
    }
    if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

    const updated: any = await SmsTemplate.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return NextResponse.json({ error: "قالب یافت نشد" }, { status: 404 });
    }

    return NextResponse.json({
      _id: String(updated._id),
      name: updated.name,
      type: updated.type,
      isActive: updated.isActive,
    });
  } catch (error: unknown) {
    console.error("Error updating SMS template:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "قالبی با این نام قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

export async function DELETE(req: NextRequest) {
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
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id || !isValidObjectId(id)) {
      return NextResponse.json({ error: "شناسه قالب نامعتبر است" }, { status: 400 });
    }

    const deleted = await SmsTemplate.findByIdAndDelete(id).lean();
    if (!deleted) {
      return NextResponse.json({ error: "قالب یافت نشد" }, { status: 404 });
    }

    // SmsLog rows keep their templateName snapshot — history stays readable.
    return NextResponse.json({ message: "قالب با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting SMS template:", error);
    return serverError();
  }
}
