/**
 * Session 62 — SMS abstraction (adapter-first).
 *
 * Provider selection (never throws — callers receive a controlled result):
 *   1. `mock`  — NODE_ENV=development AND SMS_MOCK=1. The code is logged to
 *                the server console and stored as `devPlaintextCode` on the
 *                OtpCode row so E2E/verify suites can read it back via
 *                GET /api/auth/otp/dev-last. Same philosophy as ZARINPAL_MOCK.
 *   2. `smsir` — production provider. ACTIVE ONLY when BOTH
 *                SMS_IR_API_KEY and SMS_IR_TEMPLATE_ID are configured
 *                (see .env.example). Endpoint: POST https://api.sms.ir/v1/send/verify
 *   3. `none`  — no mock and no credentials → controlled error
 *                SMS_NOT_CONFIGURED (the request API maps it to a 503), so
 *                local development NEVER breaks on a missing sms.ir account.
 *
 * The adapter functions take injectable `env`/`nodeEnv`/`fetchImpl` so the
 * unit tests can exercise every provider without network access.
 */

const SMS_IR_API_BASE = "https://api.sms.ir";

/**
 * Subset env type: `process.env` and plain test literals both satisfy it
 * (NodeJS.ProcessEnv requires a literal NODE_ENV key — awkward for tests).
 */
type SmsEnv = Record<string, string | undefined>;

export type SmsProvider = "mock" | "smsir" | "none";

export interface SmsSendResult {
  ok: boolean;
  provider: SmsProvider;
  /** sms.ir messageId on success; deterministic stub in mock mode. */
  messageId?: string;
  error?: "SMS_NOT_CONFIGURED" | "SMS_IR_API_ERROR" | "NETWORK_ERROR";
}

export function isSmsMockEnabled(
  env: SmsEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return nodeEnv === "development" && env.SMS_MOCK === "1";
}

export function isSmsIrConfigured(env: SmsEnv = process.env): boolean {
  return Boolean(env.SMS_IR_API_KEY && env.SMS_IR_TEMPLATE_ID);
}

export function resolveSmsProvider(
  env: SmsEnv = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): SmsProvider {
  if (isSmsMockEnabled(env, nodeEnv)) return "mock";
  if (isSmsIrConfigured(env)) return "smsir";
  return "none";
}

export interface SendOtpOptions {
  env?: SmsEnv;
  nodeEnv?: string | undefined;
  /** Injectable fetch for hermetic unit tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Send an OTP code to `phone` (canonical 09xxxxxxxxx form) via the active
 * provider. Never throws — returns a controlled SmsSendResult instead.
 */
export async function sendOtp(
  phone: string,
  code: string,
  options: SendOtpOptions = {}
): Promise<SmsSendResult> {
  const env = options.env ?? process.env;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const fetchImpl = options.fetchImpl ?? fetch;
  const provider = resolveSmsProvider(env, nodeEnv);

  if (provider === "none") {
    return { ok: false, provider, error: "SMS_NOT_CONFIGURED" };
  }

  if (provider === "mock") {
    console.log(`[SMS-MOCK] OTP code for ${phone}: ${code} (valid 2 min)`);
    return { ok: true, provider, messageId: "MOCK_SMS" };
  }

  // --- sms.ir adapter (production) ---
  try {
    const res = await fetchImpl(`${SMS_IR_API_BASE}/v1/send/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": env.SMS_IR_API_KEY as string,
      },
      body: JSON.stringify({
        mobile: phone.replace(/^0/, ""),
        templateId: Number(env.SMS_IR_TEMPLATE_ID),
        parameters: [{ name: "Code", value: code }],
      }),
    });

    let data: { status?: number; data?: { messageId?: number } } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      data = {};
    }

    // sms.ir success → HTTP 200 + `status: 1`.
    if (!res.ok || data.status !== 1) {
      return { ok: false, provider, error: "SMS_IR_API_ERROR" };
    }

    return {
      ok: true,
      provider,
      messageId: data.data?.messageId != null ? String(data.data.messageId) : "",
    };
  } catch {
    return { ok: false, provider, error: "NETWORK_ERROR" };
  }
}
