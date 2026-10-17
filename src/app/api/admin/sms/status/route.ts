import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, SMS_STATUS_LIMIT } from "@/lib/rate-limiter";
import {
  getSmsIrHealth,
  resolveSmsIrConfig,
} from "@/lib/sms-ir-admin";
import SmsProviderState from "@/models/SmsProviderState";

/**
 * Phase 1 — Read-only SMS.ir provider monitoring (GET only).
 *
 * GET /api/admin/sms/status
 *   Admin-only. Runs the provider health probe (GET /v1/credit + /v1/line —
 *   two read-only GETs, no SMS is sent, no credit is spent by the provider),
 *   then persists the outcome into the single SmsProviderState document so
 *   the dashboard can show "last successful synchronization" and "last
 *   synchronization error" across restarts. Success/failure states store
 *   ONLY sanitized values: stable error taxonomy codes, bounded Persian
 *   summaries, provider-confirmed credit/lines. The API key never appears in
 *   the state or the response (only a ****mask hint is available via config
 *   and even that is deliberately NOT included here — nothing secret leaves
 *   the process).
 *
 * The response never includes: the API key (not even the hint), any provider
 * raw error body, or fabricated values — everything is either
 * provider-confirmed, a stable error code, or an explicit null/"unknown".
 */

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const rl = await rateLimit(`sms-status:${token!.id}`, SMS_STATUS_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const env = process.env;

    // --- Run the read-only provider probe (may be entirely local when the
    // key is missing — no network call, honest failed state instead). ---
    const health = await getSmsIrHealth({ env });

    // --- Persist the probe outcome (single upsert doc — never fabricated) ---
    const creditValue = health.credit.state === "ok" ? health.credit.credit : null;
    const linesValue = health.lines.state === "ok" ? health.lines.lines : null;
    const firstFailureCredits = health.credit.state !== "ok" ? health.credit : null;
    const firstFailureLines = health.lines.state !== "ok" ? health.lines : null;

    type HealthFailureLike = {
      messageFa?: string;
      errorKind?: string;
      credit?: never;
      lines?: never;
    };

    const now = new Date();
    const update: Record<string, unknown> = {
      lastSyncAt: now,
      lastSyncOk: health.ok,
      updatedBy: token!.id,
    };
    if (creditValue !== null && creditValue !== undefined) {
      update["credit.value"] = creditValue;
      update["credit.syncedAt"] = now;
    }
    if (linesValue) {
      update["lines.lineNumbers"] = linesValue;
      update["lines.syncedAt"] = now;
    }
    if (firstFailureCredits || firstFailureLines) {
      const f = ((firstFailureCredits || firstFailureLines) as unknown as HealthFailureLike);
      update.lastError = {
        kind: f.errorKind ?? "unknown",
        messageFa: f.messageFa ?? "",
        httpStatus: null,
        providerStatus: null,
        providerMessage: "",
        at: now,
      };
    } else {
      update.lastError = null;
    }

    const stateDoc = (await SmsProviderState.findOneAndUpdate(
      { _id: "smsir" },
      { $set: update, $setOnInsert: { _id: "smsir" } },
      { new: true, upsert: true }
    ).lean()) as {
      credit?: { value: number | null; syncedAt: Date | null };
      lines?: { lineNumbers: string[]; syncedAt: Date | null };
      lastError?: null | {
        kind: string | null;
        messageFa: string;
        at: Date | null;
      };
      lastSyncAt?: Date | null;
      lastSyncOk?: boolean | null;
    } | null;

    // --- Sanitized client payload (no secrets, no fabrication) ---
    const cfg = resolveSmsIrConfig(env);
    return NextResponse.json({
      checkedAt: health.checkedAt,
      ok: health.ok,
      config: {
        apiKeyConfigured: cfg.hasApiKey,
        otpTemplateConfigured: cfg.otpTemplateId !== null,
        businessSwitchOn: cfg.businessEnabled,
        senderLineConfigured: cfg.senderLine !== null,
        // NON-SECRET: the service line number is configuration the admin
        // needs to see (it also goes on real SMS envelopes).
        senderLine: cfg.senderLine,
      },
      credit: {
        // Null when never synced or the probe failed — NEVER a fabricated 0.
        value: stateDoc?.credit?.value ?? null,
        lastSyncAt: stateDoc?.credit?.syncedAt ?? null,
        probeState: health.credit.state,
        probeMessageFa: health.credit.messageFa ?? "",
      },
      lines: {
        providerLines: stateDoc?.lines?.lineNumbers ?? [],
        lastSyncAt: stateDoc?.lines?.syncedAt ?? null,
        probeState: health.lines.state,
        probeMessageFa: health.lines.messageFa ?? "",
      },
      senderMismatch: health.senderMismatch
        ? {
            detected: true,
            reason: health.senderMismatch.reason ?? null,
            messageFa: health.senderMismatch.messageFa ?? "",
          }
        : { detected: false },
      lastError: stateDoc?.lastError
        ? {
            kind: stateDoc.lastError.kind,
            messageFa: stateDoc.lastError.messageFa,
            at: stateDoc.lastError.at,
          }
        : null,
      lastSyncAt: stateDoc?.lastSyncAt ?? null,
      lastSyncOk: stateDoc?.lastSyncOk ?? null,
      // Phase 1 capability truth (from the audit — honest, no invented features):
      capabilities: {
        otpVerify: {
          // Available per official docs; usable only when key+template exist.
          available: true,
          configured: Boolean(cfg.hasApiKey && cfg.otpTemplateId),
          planRestricted: false,
        },
        deliveryReports: {
          // Pull-only API (GET /v1/send/{messageId}) — no webhooks exist.
          available: true,
          pullOnly: true,
        },
        textBulk: {
          // NOT enabled for a SERVICE line until SMS.ir verifies it — the
          // existing SMS_BUSINESS_ENABLED kill-switch stays the only path.
          available: false,
          reason: "SERVICE_LINE_TEXT_BULK_UNVERIFIED",
          messageFa:
            "ارسال پولی/متن آزاد برای خط خدماتی تأیید نشده — تا بررسی در پنل SMS.ir غیرفعال است",
        },
        scheduledSending: { available: false, reason: "PHASE_1_SCOPE" },
        contacts: { available: false, reason: "NOT_IN_OFFICIAL_API" },
        webhooks: { available: false, reason: "NOT_IN_OFFICIAL_API" },
      },
    });
  } catch (err) {
    console.error("Error probing SMS.ir provider status:", err);
    return serverError();
  }
}
