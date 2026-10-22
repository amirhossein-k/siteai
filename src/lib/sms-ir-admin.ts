/**
 * Phase 1 — Centralized SMS.ir provider foundation (read-only monitoring).
 *
 * Single server-side module that owns every SMS.ir REST-API interaction the
 * admin monitoring surfaces need. Design constraints from the Phase 0 audit:
 *
 *   - SERVER-SIDE ONLY: the API key is read from process.env inside this
 *     module and never leaves the process. No client import point exists.
 *   - Official API only (docs verified 2026-10): the endpoints used here are
 *     GET /v1/credit, GET /v1/line and GET /v1/send/{messageId}. Nothing else
 *     is assumed. Features absent from the API (webhooks, contacts, template
 *     management) are never referenced.
 *   - STATUS-1 IS NOT DELIVERY: `status: 1` means the REQUEST was accepted.
 *     Delivery is the separate pull-only deliveryState (1–7) exposed by
 *     GET /v1/send/{messageId} and normalized by deliveryStateToStatus().
 *   - No secrets in logs: request failures are logged/returned as stable
 *     error codes + (bounded) provider text. The API key is never logged,
 *     returned, or embedded in any message — `redactKey()` scrubs it if a
 *     provider echo ever contains it.
 *   - Injectable fetch/env/now so unit tests are fully hermetic (no network,
 *     no real SMS, no credit consumption — read-only GETs authorized).
 *
 * HTTP surface used by the REST API (official): 200 success · 400 logical
 * error · 401 auth · 429 rate limit · 500 unexpected.
 */

// ===========================================================================
// Types — normalized provider model (only fields SMS.ir actually provides)
// ===========================================================================

/** Subset env type (same convention as sms.ts / sms-business.ts). */
type SmsIrEnv = Record<string, string | undefined>;

/**
 * Stable internal error taxonomy. The RESPONSE payload never includes the
 * provider's raw HTTP body verbatim (only a bounded fragment may surface for
 * diagnostics); the original status code/message is kept internally for
 * auditing and mapped to these stable codes.
 */
export type SmsIrErrorKind =
  // HTTP status
  | "auth_failed" // 401 (or provider key codes 10–14 by contract)
  | "rate_limited" // HTTP 429
  | "provider_server_error" // HTTP 5xx
  | "provider_logical_error" // HTTP 400 / non-1 status (generic)
  // Content (status table from the official docs)
  | "insufficient_credit" // provider status 102 (اعتبار کافی نمیباشد)
  | "invalid_line" // provider status 101 (شماره خط نامعتبر)
  | "line_needs_activation" // provider status 123 (خط نیاز به فعال‌سازی)
  | "invalid_recipient" // provider status 104 (موبایل نادرست) / 107 (لیست موبایل خالی)
  | "recipient_blocked" // provider status 115 (موبایل‌ها در لیست سیاه)
  | "template_not_found" // provider status 113 (قالب یافت نشد)
  | "template_param_invalid" // provider status 114 (مقدار >25 کاراکتر) / 116 (نام پارامتر خالی)
  | "template_rejected" // provider status 117 (متن تأیید نشده)
  | "plan_restricted" // provider status 119 (پلن ارتقا) — free-plan restriction
  // Transport / environment
  | "network_timeout"
  | "network_error"
  // Local
  | "not_configured" // SMS_IR_API_KEY missing
  | "malformed_response"; // unexpected JSON/body shape

/** Normalized failure (returned, never thrown, to callers). */
export interface SmsIrFailure {
  ok: false;
  /** Stable taxonomy code — safe to expose to an admin UI. */
  kind: SmsIrErrorKind;
  /** Persian operator-facing explanation (no secrets, no provider internals). */
  messageFa: string;
  /** Original HTTP status when the failure has one. */
  httpStatus?: number;
  /** Original provider status code from the JSON envelope when present. */
  providerStatus?: number;
  /** Bounded provider message text when the provider supplied one (≤200 chars). */
  providerMessage?: string;
}

// ============================================================
// Envelope parsing
// ============================================================

export interface SmsIrEnvelope {
  status: number;
  message?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

export function parseSmsIrEnvelope(
  body: unknown
): { ok: true; envelope: SmsIrEnvelope } | { ok: false; reason: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "body is not an object" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  if (typeof b.status !== "number") {
    return { ok: false, reason: "missing numeric status" };
  }
  return {
    ok: true,
    envelope: {
      status: b.status,
      message: typeof b.message === "string" ? b.message : undefined,
      data: b.data,
    },
  };
}

// ============================================================
// Error normalization
// ============================================================

const MAX_PROVIDER_MESSAGE_LEN = 200;

function bounded(text: string | undefined, max = MAX_PROVIDER_MESSAGE_LEN): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Provider JSON status code → stable taxonomy (official status table). */
export function smsIrStatusToKind(status: number): SmsIrErrorKind {
  switch (status) {
    case 1:
      return "provider_logical_error"; // placeholder — never called for 1
    case 20:
      return "rate_limited"; // تعداد درخواست بیشتر از حد مجاز
    case 102:
      return "insufficient_credit";
    case 101:
      return "invalid_line"; // شماره خط نامعتبر
    case 123:
      return "line_needs_activation";
    case 104:
    case 107:
      return "invalid_recipient"; // موبایل نادرست / لیست خالی
    case 115:
      return "recipient_blocked"; // لیست سیاه
    case 113:
      return "template_not_found";
    case 114:
    case 116:
      return "template_param_invalid"; // مقدار بلند / نام پارامتر خالی
    case 117:
      return "template_rejected";
    case 119:
      return "plan_restricted";
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
      return "auth_failed";
    default:
      return "provider_logical_error";
  }
}

/**
 * HTTP status → stable taxonomy. Called only when the HTTP request failed or
 * the envelope could not be trusted.
 */
export function httpStatusToKind(httpStatus: number): SmsIrErrorKind {
  if (httpStatus === 401) return "auth_failed";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "provider_server_error";
  return "provider_logical_error";
}

const FA_MESSAGES: Record<SmsIrErrorKind, string> = {
  auth_failed: "خطای احراز هویت سرویس‌دهنده — کلید API نامعتبر یا غیرفعال است",
  rate_limited: "سرویس‌دهنده درخواست‌های بیش از حد را محدود کرده است",
  provider_server_error: "خطای داخلی سرویس‌دهنده — بعداً تلاش کنید",
  provider_logical_error: "خطای منطقی سرویس‌دهنده",
  insufficient_credit: "موجودی حساب SMS.ir کافی نیست",
  invalid_line: "شماره خط ارسال نامعتبر است",
  line_needs_activation: "خط ارسال نیاز به فعال‌سازی دارد",
  invalid_recipient: "شماره گیرنده نامعتبر است",
  recipient_blocked: "شماره گیرنده در لیست سیاه سرویس‌دهنده است",
  template_not_found: "قالب پیامک در سرویس‌دهنده یافت نشد",
  template_param_invalid: "پارامتر قالب نامعتبر است (مقدار بلند یا نام خالی)",
  template_rejected: "متن قالب توسط سرویس‌دهنده تأیید نشده است",
  plan_restricted: "این قابلیت به ارتقای پلن SMS.ir نیاز دارد",
  network_timeout: "اتصال به سرویس‌دهنده زمان‌بر شد (timeout)",
  network_error: "خطای شبکه در ارتباط با سرویس‌دهنده",
  not_configured: "کلید API سرویس‌دهنده تنظیم نشده است",
  malformed_response: "پاسخ سرویس‌دهنده نامعتبر بود",
};

export function persianMessageFor(kind: SmsIrErrorKind): string {
  return FA_MESSAGES[kind];
}

export interface NormalizeErrorOptions {
  /** Original provider status code from the JSON envelope (when readable). */
  providerStatus?: number;
  providerMessage?: string;
}

/**
 * Build a normalized failure from an HTTP status + optional envelope data.
 * The provider status (from the JSON body) wins over the HTTP status when
 * both are present because it is more specific.
 */
export function normalizeSmsIrError(
  httpStatus: number,
  options: NormalizeErrorOptions = {}
): SmsIrFailure {
  const kind = options.providerStatus
    ? smsIrStatusToKind(options.providerStatus)
    : httpStatusToKind(httpStatus);
  const providerMessage = bounded(options.providerMessage);
  return {
    ok: false,
    kind,
    messageFa: persianMessageFor(kind),
    httpStatus,
    ...(options.providerStatus !== undefined
      ? { providerStatus: options.providerStatus }
      : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };
}

// ============================================================
// Delivery-state normalization (official deliveryState table 1–7)
// ============================================================

export type SmsDeliveryStatus =
  | "accepted" // send request accepted (status=1) — NOT yet delivery info
  | "delivered" // 1 رسیده به گوشی
  | "not_delivered" // 2 نرسیده به گوشی
  | "processing" // 3 پردازش در مخابرات
  | "not_reached_telecom" // 4 نرسیده به مخابرات
  | "reached_telecom" // 5 رسیده به مخابرات
  | "provider_error" // 6 خطا
  | "blocked" // 7 لیست سیاه
  | "unknown"; // null / not yet resolved

export function deliveryStateToStatus(
  deliveryState: number | null | undefined
): SmsDeliveryStatus {
  switch (deliveryState) {
    case 1:
      return "delivered";
    case 2:
      return "not_delivered";
    case 3:
      return "processing";
    case 4:
      return "not_reached_telecom";
    case 5:
      return "reached_telecom";
    case 6:
      return "provider_error";
    case 7:
      return "blocked";
    default:
      return "unknown";
  }
}

export const SMS_DELIVERY_STATUS_FA: Record<SmsDeliveryStatus, string> = {
  accepted: "پذیرفته شد (درخواست)",
  delivered: "تحویل شد",
  not_delivered: "تحویل نشد",
  processing: "در حال پردازش",
  not_reached_telecom: "به مخابرات نرسید",
  reached_telecom: "به مخابرات رسید",
  provider_error: "خطای سرویس‌دهنده",
  blocked: "مسدود (لیست سیاه)",
  unknown: "نامشخص",
};

// ============================================================
// Normalized models (only fields the provider actually returns)
// ============================================================

export interface NormalizedMessageReport {
  messageId: number;
  mobile: string | null;
  messageText: string | null;
  sendDateTime: number | null; // UnixTime (provider unit)
  lineNumber: number | null;
  cost: number | null;
  deliveryState: SmsDeliveryStatus;
  deliveryDateTime: number | null; // UnixTime or null
}

/** GET /v1/send/{messageId} → data object. */
export function normalizeMessageReport(data: unknown): NormalizedMessageReport | null {
  if (typeof data !== "object" || data === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (typeof d.messageId !== "number") return null;
  const dsRaw = d.deliveryState === null || d.deliveryState === undefined ? undefined : d.deliveryState;
  const ds = typeof dsRaw === "number" ? deliveryStateToStatus(dsRaw) : "unknown";
  return {
    messageId: d.messageId,
    mobile: typeof d.mobile === "number" || typeof d.mobile === "string" ? String(d.mobile) : null,
    messageText: typeof d.messageText === "string" ? d.messageText : null,
    sendDateTime: typeof d.sendDateTime === "number" ? d.sendDateTime : null,
    lineNumber: typeof d.lineNumber === "number" ? d.lineNumber : null,
    cost: typeof d.cost === "number" ? d.cost : null,
    deliveryState: ds,
    deliveryDateTime: typeof d.deliveryDateTime === "number" ? d.deliveryDateTime : null,
  };
}

// ===========================================================================
// Configuration (validated, centralized)
// ===========================================================================

export interface SmsIrConfig {
  /** API key is present (its value is never included in the returned object). */
  hasApiKey: boolean;
  /** Base URL (default https://api.sms.ir) — overridable for tests only. */
  baseUrl: string;
  /** Service/transactional sender line, if one is configured. */
  senderLine: string | null;
  /** Explicit OTP template id (env SMS_IR_TEMPLATE_ID) if set. Present as a STRING (no secret). */
  otpTemplateId: string | null;
  /** Business-SMS kill-switch (env SMS_BUSINESS_ENABLED=1). */
  businessEnabled: boolean;
}

/** Length of a key to keep only a masked hint (never the value). */
function maskKeyTail(key: string): string {
  if (key.length <= 8) return "****";
  return `****${key.slice(-4)}`;
}

/**
 * Build the validated provider config from an env-like object. Never throws.
 * `apiKeyHint` keeps a masked tail (last 4 chars) so an admin can sanity-check
 * WHICH key is configured without the panel ever showing the real value.
 */
export function resolveSmsIrConfig(
  env: SmsIrEnv = process.env
): SmsIrConfig & { apiKeyHint: string | null } {
  const key = env.SMS_IR_API_KEY || "";
  const baseUrl = env.SMS_IR_API_BASE || "https://api.sms.ir";
  const sender = (env.SMS_BUSINESS_SENDER || env.SMS_IR_SENDER || "").trim() || null;
  const otpTemplate = (env.SMS_IR_TEMPLATE_ID || "").trim() || null;
  // Trim trailing slashes so string-building can never double-slash the path.
  return {
    hasApiKey: key.length > 0,
    apiKeyHint: key ? maskKeyTail(key) : null,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    senderLine: sender,
    otpTemplateId: otpTemplate,
    businessEnabled: env.SMS_BUSINESS_ENABLED === "1",
  };
}

/** True when this process may talk to the provider at all. */
export function isSmsIrUsable(env: SmsIrEnv = process.env): boolean {
  return Boolean((env.SMS_IR_API_KEY || "").length > 0);
}

// ===========================================================================
// Health / credit / lines — read-only provider calls (GET, no SMS consumed)
// ===========================================================================

export interface SmsIrRequestOptions {
  env?: SmsIrEnv;
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms (default 10_000). */
  timeoutMs?: number;
}

/**
 * One generic GET against the provider. Returns the parsed envelope on
 * success or a normalized failure. Never throws. The API key is sent ONLY
 * via the x-api-key header and is scrubbed from any echoed message.
 */
async function smsIrGet(
  path: string,
  options: SmsIrRequestOptions = {}
): Promise<{ ok: true; envelope: SmsIrEnvelope } | SmsIrFailure> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  if (!isSmsIrUsable(env)) {
    return {
      ok: false,
      kind: "not_configured",
      messageFa: FA_MESSAGES.not_configured,
    };
  }

  const cfg = resolveSmsIrConfig(env);
  const apiKey = env.SMS_IR_API_KEY as string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: controller.signal,
    });

    // Read the body first (the provider status may live in a non-200 body).
    let raw = "";
    try {
      raw = await res.text();
    } catch {
      raw = "";
    }

    let envelope: SmsIrEnvelope | null;
    try {
      const parsed = parseSmsIrEnvelope(JSON.parse(raw));
      envelope = parsed.ok ? parsed.envelope : null;
    } catch {
      envelope = null;
    }

    if (!res.ok) {
      const failure = normalizeSmsIrError(res.status, {
        providerStatus: envelope?.status,
        providerMessage: envelope?.message || bounded(raw),
      });
      // Scrub the key from any echoed diagnostics before it escapes.
      if (failure.providerMessage) {
        failure.providerMessage = failure.providerMessage.split(apiKey).join("****");
      }
      return failure;
    }

    if (!envelope) {
      return {
        ok: false,
        kind: "malformed_response",
        messageFa: FA_MESSAGES.malformed_response,
        httpStatus: res.status,
      };
    }

    if (envelope.status === 1) {
      return { ok: true, envelope };
    }

    // HTTP 200 but a logical provider failure in the envelope.
    return normalizeSmsIrError(res.status, {
      providerStatus: envelope.status,
      providerMessage: envelope.message,
    });
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.name === "TimeoutError" ||
        /aborted|timeout/i.test(err.message || ""));
    return {
      ok: false,
      kind: isAbort ? "network_timeout" : "network_error",
      messageFa: FA_MESSAGES[isAbort ? "network_timeout" : "network_error"],
    } as SmsIrFailure;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Credit — GET /v1/credit { status:1, data: 165.3 }
// ---------------------------------------------------------------------------

export type SmsIrCreditResult =
  | { ok: true; credit: number; syncedAt: string }
  | SmsIrFailure;

export async function getSmsIrCredit(
  options: SmsIrRequestOptions = {}
): Promise<SmsIrCreditResult> {
  const result = await smsIrGet("/v1/credit", options);
  if (!result.ok) return result;
  const raw = result.envelope?.data;
  const credit =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(credit)) {
    return {
      ok: false,
      kind: "malformed_response",
      messageFa: FA_MESSAGES.malformed_response,
    };
  }
  return { ok: true, credit, syncedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Lines — GET /v1/line { status:1, data: [10002155613464, 30004505000017] }
// ---------------------------------------------------------------------------

export type SmsIrLinesResult =
  | { ok: true; lines: { lineNumber: string }[]; syncedAt: string }
  | SmsIrFailure;

export async function getSmsIrLines(
  options: SmsIrRequestOptions = {}
): Promise<SmsIrLinesResult> {
  const result = await smsIrGet("/v1/line", options);
  if (!result.ok) return result;
  const raw = result.envelope?.data;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      kind: "malformed_response",
      messageFa: FA_MESSAGES.malformed_response,
    };
  }
  const lines = raw
    .filter((v) => typeof v === "number" || typeof v === "string")
    .map((v) => ({ lineNumber: String(v) }));
  if (lines.length !== raw.length) {
    // Some entries were not numbers/strings — still malformed per the docs.
    return {
      ok: false,
      kind: "malformed_response",
      messageFa: FA_MESSAGES.malformed_response,
    };
  }
  return { ok: true, lines, syncedAt: new Date().toISOString() };
}

// ===========================================================================
// Health
// ===========================================================================

export type SmsIrSubStatus =
  | "unknown" // not probed
  | "ok"
  | "configured_but_unreachable"
  | "failed";

export interface SmsIrHealthCheck {
  /** Stable per-check state — an admin UI shows these directly. */
  state: SmsIrSubStatus;
  /** Persian summary of this check's outcome (empty for unknown). */
  messageFa?: string;
  /** Stable error taxonomy code when the check failed. */
  errorKind?: SmsIrErrorKind;
  /** ISO timestamp of when the check ran. */
  checkedAt: string;
}

export interface SmsIrHealth {
  /** Overall verdict — never automatically "healthy" merely from env vars. */
  ok: boolean;
  /** Provider configured: env bank states AND provider is reachable&valid. */
  envConfigured: boolean; // SMS_IR_API_KEY present
  otpTemplateConfigured: boolean; // SMS_IR_TEMPLATE_ID present
  businessSwitch: boolean; // SMS_BUSINESS_ENABLED === "1"
  senderLineConfigured: boolean;
  senderLine: string | null;
  /** Actual provider probe result (only this proves "reachable+authed"). */
  credit: SmsIrHealthCheck & { credit: number | null };
  lines: SmsIrHealthCheck & { lines: string[] | null };
  senderMismatch: {
    detected: boolean;
    messageFa?: string;
    reason?: "not_confirmed_by_provider" | "provider_rejects_line" | "missing_provider_lines";
  };
  checkedAt: string;
}

/**
 * Read-only health probe: credit + lines in parallel. Overall `ok` requires
 * BOTH provider calls to succeed — env presence alone is never "healthy".
 * A configured sender line that the provider does not confirm sets
 * senderMismatch (warning), which does NOT fail the overall probe.
 */
export async function getSmsIrHealth(
  options: SmsIrRequestOptions = {}
): Promise<SmsIrHealth> {
  const env = options.env ?? process.env;
  const cfg = resolveSmsIrConfig(env);
  const checkedAt = new Date().toISOString();

  const envConfigured = cfg.hasApiKey;
  const senderLineConfigured = Boolean(cfg.senderLine);

  let creditCheck: SmsIrHealth["credit"];
  let linesCheck: SmsIrHealth["lines"];

  if (!envConfigured) {
    const missing: SmsIrHealthCheck = {
      state: "failed",
      messageFa: FA_MESSAGES.not_configured,
      errorKind: "not_configured",
      checkedAt,
    };
    creditCheck = { ...missing, credit: null };
    linesCheck = { ...missing, lines: null };
  } else {
    const [creditRes, linesRes] = await Promise.all([
      getSmsIrCredit({ ...options, env }),
      getSmsIrLines({ ...options, env }),
    ]);

    if (creditRes.ok) {
      creditCheck = { state: "ok", checkedAt, credit: creditRes.credit };
    } else {
      creditCheck = {
        state: creditRes.kind === "network_timeout" ? "configured_but_unreachable" : "failed",
        messageFa: creditRes.messageFa,
        errorKind: creditRes.kind,
        checkedAt,
        credit: null,
      };
    }

    if (linesRes.ok) {
      linesCheck = {
        state: "ok",
        checkedAt,
        lines: linesRes.lines.map((l) => l.lineNumber),
      };
    } else {
      linesCheck = {
        state: linesRes.kind === "network_timeout" ? "configured_but_unreachable" : "failed",
        messageFa: linesRes.messageFa,
        errorKind: linesRes.kind,
        checkedAt,
        lines: null,
      };
    }
  }

  // --- Sender-line mismatch warning (never blocks overall health) ---
  let senderMismatch: SmsIrHealth["senderMismatch"] = { detected: false };
  if (senderLineConfigured) {
    const confirmed = linesCheck.lines ?? null;
    if (confirmed === null) {
      senderMismatch = { detected: true, reason: "missing_provider_lines" };
    } else if (!confirmed.includes(cfg.senderLine as string)) {
      senderMismatch = {
        detected: true,
        reason: "not_confirmed_by_provider",
        messageFa: "خط پیکربندی‌شده توسط سرویس‌دهنده تأیید نشده است",
      };
    }
  }

  const ok = creditCheck.state === "ok" && linesCheck.state === "ok";

  return {
    ok,
    envConfigured,
    otpTemplateConfigured: Boolean(cfg.otpTemplateId),
    businessSwitch: cfg.businessEnabled,
    senderLineConfigured,
    senderLine: cfg.senderLine,
    credit: creditCheck,
    lines: linesCheck,
    senderMismatch,
    checkedAt,
  };
}

// ===========================================================================
// Template management — read-only provider calls (GET, no SMS consumed)
// ===========================================================================

/**
 * SMS.ir template check status mapping.
 *
 * Official status codes (doc.md, "وضعیت بررسی قالب"):
 *   1 = در حال بررسی (pending)
 *   2 = تایید شده (approved)
 *   3 = رد شده (rejected)
 *
 * Additional client-side statuses for templates not present in the provider:
 *   not_found    — provider explicitly reported template_not_found (113)
 *   unknown      — provider returned an unrecognized status code
 *   not_submitted — locally known that the template has never been submitted
 *                   to SMS.ir (only set by the local Marloo record, never by
 *                   the provider API).
 */
export type SmsIrTemplateStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "not_found"
  | "unknown"
  | "not_submitted";

/** A single template parameter as returned by SMS.ir. */
export interface SmsIrTemplateParameter {
  name: string;
  description: string | null;
}

/** A single SMS.ir template as returned by /v1/templates or /v1/templates/:id. */
export interface SmsIrTemplate {
  id: number;
  title: string;
  templateText: string;
  type: number; // 1=OTP, 2=Notification, 3=Order Status, 100=Other
  parameters: SmsIrTemplateParameter[];
  status: number; // 1=pending, 2=approved, 3=rejected
  rejectionReason: string | null;
  creationDateTime: number | null; // UnixTime (UTC)
}

/** Result of listing templates from /v1/templates. */
export interface SmsIrTemplatesResult {
  ok: true;
  templates: SmsIrTemplate[];
  total: number;
  page: number;
  pageSize: number;
} | SmsIrFailure;

/** Result of getting a single template from /v1/templates/:id. */
export interface SmsIrTemplateResult {
  ok: true;
  template: SmsIrTemplate;
} | SmsIrFailure;

/**
 * Map the official SMS.ir template review status code (1/2/3) to our
 * client-facing status. Any other code is treated as unknown.
 */
export function mapSmsIrTemplateStatus(status: number): SmsIrTemplateStatus {
  switch (status) {
    case 1:
      return "pending";
    case 2:
      return "approved";
    case 3:
      return "rejected";
    default:
      return "unknown";
  }
}

/**
 * List templates from SMS.ir (GET /v1/templates).
 * Read-only — no SMS is sent, no credit is consumed.
 * Supports optional pageNumber, pageSize, and status filter.
 */
export async function getSmsIrTemplates(
  options: SmsIrRequestOptions & {
    pageNumber?: number;
    pageSize?: number;
    status?: number;
  } = {}
): Promise<SmsIrTemplatesResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pageNumber = options.pageNumber ?? 1;
  const pageSize = options.pageSize ?? 10;
  const status = options.status;

  if (!isSmsIrUsable(env)) {
    return { ok: false, kind: "not_configured", messageFa: FA_MESSAGES.not_configured };
  }

  const cfg = resolveSmsIrConfig(env);
  const apiKey = env.SMS_IR_API_KEY as string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${cfg.baseUrl}/v1/templates`);
    url.searchParams.set("pageNumber", String(pageNumber));
    url.searchParams.set("pageSize", String(pageSize));
    if (status !== undefined) {
      url.searchParams.set("status", String(status));
    }

    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: controller.signal,
    });

    // Read the body first (the provider status may live in a non-200 body).
    let raw = "";
    try {
      raw = await res.text();
    } catch {
      raw = "";
    }

    let envelope: SmsIrEnvelope | null;
    try {
      const parsed = parseSmsIrEnvelope(JSON.parse(raw));
      envelope = parsed.ok ? parsed.envelope : null;
    } catch {
      envelope = null;
    }

    if (!res.ok) {
      const failure = normalizeSmsIrError(res.status, {
        providerStatus: envelope?.status,
        providerMessage: envelope?.message || bounded(raw),
      });
      // Scrub the key from any echoed diagnostics before it escapes.
      if (failure.providerMessage) {
        failure.providerMessage = failure.providerMessage.split(apiKey).join("****");
      }
      return failure;
    }

    if (!envelope) {
      return {
        ok: false,
        kind: "malformed_response",
        messageFa: FA_MESSAGES.malformed_response,
        httpStatus: res.status,
      };
    }

    if (envelope.status !== 1) {
      return normalizeSmsIrError(res.status, {
        providerStatus: envelope.status,
        providerMessage: envelope.message,
      });
    }

    const rawTemplates = envelope.data;
    if (!Array.isArray(rawTemplates)) {
      return {
        ok: false,
        kind: "malformed_response",
        messageFa: FA_MESSAGES.malformed_response,
      };
    }

    const templates: SmsIrTemplate[] = rawTemplates.map((t: any) => ({
      id: typeof t.id === "number" ? t.id : 0,
      title: typeof t.title === "string" ? t.title : "",
      templateText: typeof t.templateText === "string" ? t.templateText : "",
      type: typeof t.type === "number" ? t.type : 100,
      parameters: Array.isArray(t.parameters)
        ? t.parameters.map((p: any) => ({
            name: typeof p.name === "string" ? p.name : "",
            description:
              typeof p.description === "string" ? p.description : null,
          }))
        : [],
      status: typeof t.status === "number" ? t.status : 0,
      rejectionReason:
        typeof t.rejectionReason === "string" ? t.rejectionReason : null,
      creationDateTime:
        typeof t.creationDateTime === "number" ? t.creationDateTime : null,
    }));

    return {
      ok: true,
      templates,
      total: templates.length,
      page: pageNumber,
      pageSize: pageSize,
    };
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.name === "TimeoutError" ||
        /aborted|timeout/i.test(err.message || ""));
    return {
      ok: false,
      kind: isAbort ? "network_timeout" : "network_error",
      messageFa: FA_MESSAGES[isAbort ? "network_timeout" : "network_error"],
    } as SmsIrFailure;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get a single template from SMS.ir (GET /v1/templates/:TemplateId).
 * Read-only — no SMS is sent, no credit is consumed.
 */
export async function getSmsIrTemplate(
  templateId: number,
  options: SmsIrRequestOptions = {}
): Promise<SmsIrTemplateResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  if (!isSmsIrUsable(env)) {
    return { ok: false, kind: "not_configured", messageFa: FA_MESSAGES.not_configured };
  }

  const cfg = resolveSmsIrConfig(env);
  const apiKey = env.SMS_IR_API_KEY as string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${cfg.baseUrl}/v1/templates/${templateId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: controller.signal,
    });

    // Read the body first (the provider status may live in a non-200 body).
    let raw = "";
    try {
      raw = await res.text();
    } catch {
      raw = "";
    }

    let envelope: SmsIrEnvelope | null;
    try {
      const parsed = parseSmsIrEnvelope(JSON.parse(raw));
      envelope = parsed.ok ? parsed.envelope : null;
    } catch {
      envelope = null;
    }

    if (!res.ok) {
      const failure = normalizeSmsIrError(res.status, {
        providerStatus: envelope?.status,
        providerMessage: envelope?.message || bounded(raw),
      });
      // Scrub the key from any echoed diagnostics before it escapes.
      if (failure.providerMessage) {
        failure.providerMessage = failure.providerMessage.split(apiKey).join("****");
      }
      return failure;
    }

    if (!envelope) {
      return {
        ok: false,
        kind: "malformed_response",
        messageFa: FA_MESSAGES.malformed_response,
        httpStatus: res.status,
      };
    }

    if (envelope.status !== 1) {
      return normalizeSmsIrError(res.status, {
        providerStatus: envelope.status,
        providerMessage: envelope.message,
      });
    }

    const t = envelope.data;
    if (!t || typeof t !== "object") {
      return {
        ok: false,
        kind: "malformed_response",
        messageFa: FA_MESSAGES.malformed_response,
      };
    }

    return {
      ok: true,
      template: {
        id: typeof t.id === "number" ? t.id : 0,
        title: typeof t.title === "string" ? t.title : "",
        templateText: typeof t.templateText === "string" ? t.templateText : "",
        type: typeof t.type === "number" ? t.type : 100,
        parameters: Array.isArray(t.parameters)
          ? t.parameters.map((p: any) => ({
              name: typeof p.name === "string" ? p.name : "",
              description:
                typeof p.description === "string" ? p.description : null,
            }))
          : [],
        status: typeof t.status === "number" ? t.status : 0,
        rejectionReason:
          typeof t.rejectionReason === "string" ? t.rejectionReason : null,
        creationDateTime:
          typeof t.creationDateTime === "number" ? t.creationDateTime : null,
      },
    };
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.name === "TimeoutError" ||
        /aborted|timeout/i.test(err.message || ""));
    return {
      ok: false,
      kind: isAbort ? "network_timeout" : "network_error",
      messageFa: FA_MESSAGES[isAbort ? "network_timeout" : "network_error"],
    } as SmsIrFailure;
  } finally {
    clearTimeout(timer);
  }
}
