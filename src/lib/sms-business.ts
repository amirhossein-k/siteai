/**
 * Session 90 — Business-SMS service (Phase 1a). INDEPENDENT from OTP.
 *
 * This module is deliberately a PARALLEL implementation, never an extension
 * of src/lib/sms.ts:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ OTP (UNTOUCHABLE — Session 90 isolation contract)                   │
 *   │   src/lib/sms.ts   sendOtp() / resolveSmsProvider()                 │
 *   │   - provider gate: SMS_IR_API_KEY + SMS_IR_TEMPLATE_ID              │
 *   │   - endpoint: /v1/send/verify (template-VARIABLE send)              │
 *   │   - callers: /api/auth/otp/request only                             │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ BUSINESS SMS (this module)                                          │
 *   │   resolveBusinessSmsProvider() / renderTemplate() / sendBusinessSms │
 *   │   - auth: SMS_IR_API_KEY only (SMS_IR_TEMPLATE_ID NEVER read)       │
 *   │   - endpoint: /v1/send/bulk (sms.ir documented text-SMS send)       │
 *   │   - kill-switch: SMS_BUSINESS_ENABLED !== "1" → provider "none"     │
 *   │   - mock-first: dev + SMS_MOCK=1 → mock adapter (no network)        │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * PRODUCTION SAFETY (approved design): the default provider is "none" —
 * business SMS can only ever send when BOTH SMS_IR_API_KEY is configured
 * AND the explicit SMS_BUSINESS_ENABLED="1" kill-switch is set. Deploying
 * Phase 1 without the switch therefore CANNOT send real SMS to real users.
 *
 * renderTemplate() is a pure function; both adapters take an injectable
 * `fetchImpl`/`env`/`nodeEnv` exactly like src/lib/sms.ts so unit tests are
 * hermetic. Failures are CONTROLLED (returned values, never thrown) so a
 * business-SMS failure can never crash an unrelated admin request.
 */

const SMS_IR_API_BASE = "https://api.sms.ir";

/** Subset env type — `process.env` and plain test literals both satisfy it. */
type SmsBusinessEnv = Record<string, string | undefined>;

export type BusinessSmsProvider = "mock" | "smsir" | "none";

export type BusinessSmsError =
  | "SMS_BUSINESS_DISABLED"
  | "SMS_BUSINESS_NOT_CONFIGURED"
  | "SMS_BUSINESS_API_ERROR"
  | "NETWORK_ERROR";

export interface BusinessSmsSendResult {
  ok: boolean;
  provider: BusinessSmsProvider;
  /** sms.ir messageId on success; deterministic stub in mock mode. */
  messageId?: string;
  error?: BusinessSmsError;
}

/**
 * Provider resolution — business-SMS-specific, deliberately stricter than
 * the OTP resolver:
 *   1. mock  — NODE_ENV=development AND SMS_MOCK=1 (same dev seam UX as OTP,
 *              but a separate adapter inside THIS module; no network calls).
 *   2. smsir — ONLY when SMS_BUSINESS_ENABLED === "1" (explicit kill-switch)
 *              AND SMS_IR_API_KEY is set. The OTP-only SMS_IR_TEMPLATE_ID is
 *              deliberately NOT consulted — business patterns are stored per
 *              template (SmsTemplate.providerTemplateId).
 *   3. none  — default: business SMS is disabled/unconfigured. Controlled
 *              SMS_BUSINESS_DISABLED / SMS_BUSINESS_NOT_CONFIGURED errors.
 */
export function isBusinessSmsMockEnabled(
  env: SmsBusinessEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return nodeEnv === "development" && env.SMS_MOCK === "1";
}

export function isBusinessSmsConfigured(env: SmsBusinessEnv = process.env): boolean {
  return Boolean(env.SMS_BUSINESS_ENABLED === "1" && env.SMS_IR_API_KEY);
}

export function resolveBusinessSmsProvider(
  env: SmsBusinessEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): BusinessSmsProvider {
  if (isBusinessSmsMockEnabled(env, nodeEnv)) return "mock";
  if (isBusinessSmsConfigured(env)) return "smsir";
  return "none";
}

// ============================================================
// Template rendering (pure, testable)
// ============================================================

/** A rendered template: variables replaced; `missing` lists unfilled ones. */
export interface RenderedTemplate {
  ok: boolean;
  text: string;
  missing: string[];
}

/** Max rendered SMS text (SMS.ir pattern bodies are similarly bounded). */
export const BUSINESS_SMS_MAX_LENGTH = 500;

/**
 * Replace `{{variable}}` placeholders in `body` with values from `vars`.
 *
 * Pure function. Fail-closed contract:
 *   - every declared placeholder that receives NO value (empty string counts
 *     as a value; undefined/null/whitespace-only do not) is reported in
 *     `missing` and left as `{{name}}` in the output;
 *   - `ok` is true only when nothing is missing;
 *   - values are coerced with String() and the result is trimmed;
 *   - the output is hard-capped at BUSINESS_SMS_MAX_LENGTH.
 */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number> = {}
): RenderedTemplate {
  const missing: string[] = [];
  const text = (body || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(name);
      return `{{${name}}}`;
    }
    return String(value);
  });

  const capped =
    text.length > BUSINESS_SMS_MAX_LENGTH
      ? text.slice(0, BUSINESS_SMS_MAX_LENGTH)
      : text;

  return { ok: missing.length === 0, text: capped, missing };
}

/**
 * Extract the declared placeholder names from a template body, in first
 * occurrence order, deduplicated. Used to keep SmsTemplate.variables in sync
 * with body on the API layer.
 */
export function extractTemplateVariables(body: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body || "")) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      names.push(m[1]);
    }
  }
  return names;
}

// ============================================================
// Providers
// ============================================================

export interface SendBusinessSmsOptions {
  env?: SmsBusinessEnv;
  nodeEnv?: string | undefined;
  /** Injectable fetch for hermetic unit tests (sms.ts convention). */
  fetchImpl?: typeof fetch;
}

/**
 * Send an already-rendered text message to one recipient (canonical
 * 09xxxxxxxxx). Never throws — returns a controlled BusinessSmsSendResult.
 *
 * NOTE: no OTP semantics, no template lookup, no plaintext-code handling —
 * the caller owns rendering and persistence (SmsLog lifecycle).
 */
export async function sendBusinessSms(
  phone: string,
  message: string,
  options: SendBusinessSmsOptions = {}
): Promise<BusinessSmsSendResult> {
  const env = options.env ?? process.env;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const fetchImpl = options.fetchImpl ?? fetch;
  const provider = resolveBusinessSmsProvider(env, nodeEnv);

  if (provider === "none") {
    return {
      ok: false,
      provider,
      error: env.SMS_BUSINESS_ENABLED === "1" ? "SMS_BUSINESS_NOT_CONFIGURED" : "SMS_BUSINESS_DISABLED",
    };
  }

  if (provider === "mock") {
    // Dev/CI seam — console only, NO network call, NO persistence here.
    console.log(`[SMS-BUSINESS-MOCK] to ${phone}: ${message}`);
    return { ok: true, provider, messageId: "MOCK_BUSINESS_SMS" };
  }

  // --- sms.ir adapter (production, kill-switch on) ---
  // Documented text-SMS endpoint: POST /v1/send/bulk. Authentication is the
  // SAME account-level x-api-key the OTP module uses (SMS_IR_API_KEY only —
  // SMS_IR_TEMPLATE_ID is never read here).
  try {
    const res = await fetchImpl(`${SMS_IR_API_BASE}/v1/send/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": env.SMS_IR_API_KEY as string,
      },
      body: JSON.stringify({
        // sms.ir text send expects numbers WITHOUT the leading zero.
        mobiles: [phone.replace(/^0/, "")],
        messageText: message,
        // Optional sender line-number; harmless when unset.
        ...(env.SMS_BUSINESS_SENDER ? { sendDateTime: undefined, lineNumber: env.SMS_BUSINESS_SENDER } : {}),
      }),
    });

    let data: { status?: number; data?: { messageId?: number | string; packageID?: number | string } } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      data = {};
    }

    // sms.ir success → HTTP 200 + `status: 1` (same envelope as /send/verify).
    if (!res.ok || data.status !== 1) {
      return { ok: false, provider, error: "SMS_BUSINESS_API_ERROR" };
    }

    const rawId = data.data?.messageId ?? data.data?.packageID;
    return {
      ok: true,
      provider,
      messageId: rawId != null ? String(rawId) : "",
    };
  } catch {
    return { ok: false, provider, error: "NETWORK_ERROR" };
  }
}
