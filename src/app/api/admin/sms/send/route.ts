import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, SMS_SEND_LIMIT } from "@/lib/rate-limiter";
import SmsTemplate from "@/models/SmsTemplate";
import SmsLog from "@/models/SmsLog";
import User from "@/models/User";
import { normalizePhone } from "@/lib/otp";
import { sanitizePlainText } from "@/lib/sanitize";
import { renderTemplate, sendBusinessSms } from "@/lib/sms-business";

/**
 * Session 90 — Admin manual business-SMS send (Phase 1b).
 *
 * POST /api/admin/sms/send
 *   body: {
 *     phone: string              — recipient (normalized server-side to 09…)
 *     templateId?: string        — template-based send (variables required)
 *     variables?: object         — values for the template's declared vars
 *     message?: string           — free-form send (no template)
 *     userId?: string            — optional link to a user (customer)
 *     orderId?: string           — optional link to an order (context only)
 *   }
 *
 * Exactly one of templateId / message must be provided.
 *
 * SECURITY:
 *   - admin-only (requireRoleOrError) + independent SMS_SEND_LIMIT key
 *     (10/admin/15min — the approved cap; OTP limiter keys untouched).
 *   - Sender identity comes ONLY from the authenticated session token —
 *     never from the request body.
 *   - Template state is loaded from the DB: the request body can never
 *     inject a providerTemplateId or bypass a stored template. INACTIVE
 *     templates are refused (400) — no SMS when a template is disabled.
 *   - Variables are validated against the template's SERVER-DERIVED declared
 *     set: missing/extra keys → 400 with the missing list.
 *   - Free-form message text is sanitized (plain text, bounded length).
 *   - Phone numbers are normalized to the canonical 09… form and rejected
 *     unless they are valid 11-digit Iranian mobiles.
 *   - The provider call NEVER throws (controlled BusinessSmsSendResult) and
 *     every attempt — success or failure — is persisted to SmsLog.
 *   - No provider API key, OTP material, or secret is ever echoed back.
 *
 * SMS_LOG lifecycle: written AFTER the provider returns, one immutable row
 * recording the final outcome (sent/failed + error code + rendered text).
 */
const SMS_PHONE_REGEX = /^09\d{9}$/;
const MESSAGE_MAX = 500;

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const rl = await rateLimit(`sms-send:${token!.id}`, SMS_SEND_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد پیامک بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const body = (await req.json()) as {
      phone?: unknown;
      templateId?: unknown;
      variables?: unknown;
      message?: unknown;
      userId?: unknown;
      orderId?: unknown;
    };

    // --- Recipient normalization (server-derived, never trusted raw) ---
    const phone = normalizePhone(typeof body.phone === "string" ? body.phone : "");
    if (!SMS_PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { error: "شماره موبایل گیرنده نامعتبر است" },
        { status: 400 }
      );
    }

    const hasTemplate = typeof body.templateId === "string" && body.templateId.trim() !== "";
    const hasMessage = typeof body.message === "string" && body.message.trim() !== "";
    if (hasTemplate === hasMessage) {
      return NextResponse.json(
        { error: "دقیقاً یکی از قالب یا متن پیام باید ارسال شود" },
        { status: 400 }
      );
    }
    // Shape-validate the template reference BEFORE the one-of semantics so an
    // unknown (well-formed) id is a 404, not a masked 400.
    if (hasTemplate && !/^[0-9a-fA-F]{24}$/.test((body.templateId as string).trim())) {
      return NextResponse.json({ error: "شناسه قالب نامعتبر است" }, { status: 400 });
    }

    // --- Optional relation links (validated ObjectIds) ---
    const validId = (v: unknown) =>
      typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v) ? v : null;
    const userId = validId(body.userId);
    const orderId = validId(body.orderId);
    if ((body.userId && !userId) || (body.orderId && !orderId)) {
      return NextResponse.json({ error: "شناسه کاربر/سفارش نامعتبر است" }, { status: 400 });
    }

    // --- Build the final message + metadata ---
    let message = "";
    let messageType = "custom";
    let templateRef: string | null = null;
    let templateName = "";

    if (hasTemplate) {
      const templateId = (body.templateId as string).trim();
      if (!/^[0-9a-fA-F]{24}$/.test(templateId)) {
        return NextResponse.json({ error: "شناسه قالب نامعتبر است" }, { status: 400 });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const template: any = await SmsTemplate.findById(templateId).lean();
      if (!template) {
        return NextResponse.json({ error: "قالب یافت نشد" }, { status: 404 });
      }
      if (!template.isActive) {
        return NextResponse.json(
          { error: "قالب غیرفعال است و امکان ارسال با آن وجود ندارد" },
          { status: 400 }
        );
      }
      const templateBody = template.body || "";
      if (!templateBody) {
        return NextResponse.json(
          { error: "متن قالب خالی است" },
          { status: 400 }
        );
      }
      // Fail-closed variable validation against the SERVER-DERIVED set.
      const declared = template.variables || [];
      const provided = (body.variables && typeof body.variables === "object"
        ? (body.variables as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const missing = declared.filter(
        (v: string) =>
          provided[v] === undefined ||
          provided[v] === null ||
          String(provided[v]).trim() === ""
      );
      const extraKeys = Object.keys(provided).filter(
        (k) => !declared.includes(k)
      );
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `مقادیر متغیرهای قالب ناقص است: ${missing.join(", ")}`,
            missing,
          },
          { status: 400 }
        );
      }
      if (extraKeys.length > 0) {
        return NextResponse.json(
          { error: `متغیرهای ناشناخته ارسال شده‌اند: ${extraKeys.join(", ")}` },
          { status: 400 }
        );
      }
      const vars: Record<string, string> = {};
      for (const k of declared) {
        vars[k] = String(provided[k]);
      }
      const rendered = renderTemplate(templateBody, vars);
      if (!rendered.ok) {
        return NextResponse.json(
          { error: "رندر قالب ناموفق بود", missing: rendered.missing },
          { status: 400 }
        );
      }
      message = rendered.text;
      messageType = template.type;
      templateRef = String(template._id);
      templateName = template.name;
    } else {
      message = sanitizePlainText((body.message as string).trim());
      if (!message) {
        return NextResponse.json({ error: "متن پیام الزامی است" }, { status: 400 });
      }
      if (message.length > MESSAGE_MAX) {
        return NextResponse.json(
          { error: `متن پیام حداکثر ${MESSAGE_MAX} کاراکتر است` },
          { status: 400 }
        );
      }
    }

    // --- Optional user link must exist (prevents dangling context) ---
    if (userId) {
      const linkedUser = await User.findById(userId).select("_id").lean();
      if (!linkedUser) {
        return NextResponse.json({ error: "کاربر یافت نشد" }, { status: 404 });
      }
    }

    // --- Provider call (never throws) ---
    const result = await sendBusinessSms(phone, message);

    // --- SmsLog lifecycle: one immutable row for the final outcome ---
    await SmsLog.create({
      recipient: phone,
      user: userId,
      order: orderId,
      template: templateRef,
      templateName,
      messageType,
      provider: result.provider,
      providerMessageId: result.messageId || "",
      status: result.ok ? "sent" : "failed",
      error: result.error || "",
      errorMessage: result.error ? "ارسال پیامک ناموفق بود" : "",
      message,
      sentAt: new Date(),
      createdBy: token!.id,
    });

    if (!result.ok) {
      // Controlled failure surfaced to the admin — no secrets, no provider
      // internals, just the stable error code.
      return NextResponse.json(
        {
          error: "ارسال پیامک ناموفق بود",
          code: result.error,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      message: "پیامک با موفقیت ارسال شد",
      provider: result.provider,
      messageId: result.messageId || "",
    });
  } catch (error) {
    console.error("Error sending business SMS:", error);
    return serverError();
  }
}
