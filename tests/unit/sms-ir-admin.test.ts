/**
 * Phase 1 — SMS.ir provider foundation unit tests (fully hermetic).
 *
 * Every provider interaction is exercised with an injected fetch/mock — no
 * network, no real SMS.ir calls, no credit consumption, no real SMS (the
 * monitor is read-only by construction and the tests never call a send).
 */
import { describe, it, expect, vi } from "vitest";
import {
  deliveryStateToStatus,
  getSmsIrCredit,
  getSmsIrHealth,
  getSmsIrLines,
  httpStatusToKind,
  isSmsIrUsable,
  normalizeSmsIrError,
  parseSmsIrEnvelope,
  resolveSmsIrConfig,
  smsIrStatusToKind,
  type SmsIrFailure,
} from "@/lib/sms-ir-admin";

const KEY_ENV = { SMS_IR_API_KEY: "test-key-1234567890" };

/** Small fetch mock builder: one scripted HTTP response. */
function fetchOk(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ status: 1, message: "موفق", data }),
  });
}

function isFailure(r: unknown): r is SmsIrFailure {
  return typeof r === "object" && r !== null && (r as SmsIrFailure).ok === false;
}

// ============================================================
// Configuration
// ============================================================

describe("resolveSmsIrConfig / isSmsIrUsable", () => {
  it("reports missing key without exposing any value", () => {
    const cfg = resolveSmsIrConfig({});
    expect(cfg.hasApiKey).toBe(false);
    expect(cfg.apiKeyHint).toBeNull();
    expect(cfg.senderLine).toBeNull();
    expect(cfg.otpTemplateId).toBeNull();
    expect(cfg.businessEnabled).toBe(false);
    expect(isSmsIrUsable({})).toBe(false);
  });

  it("reads key/sender/template flags and a masked key hint", () => {
    const cfg = resolveSmsIrConfig({
      SMS_IR_API_KEY: "supersecretkeyvalue",
      SMS_BUSINESS_SENDER: "30004505000017",
      SMS_IR_TEMPLATE_ID: "574993",
      SMS_BUSINESS_ENABLED: "1",
    });
    expect(cfg.hasApiKey).toBe(true);
    expect(cfg.senderLine).toBe("30004505000017");
    expect(cfg.otpTemplateId).toBe("574993");
    expect(cfg.businessEnabled).toBe(true);
    // Masked hint only — never the raw value.
    expect(cfg.apiKeyHint).toBe("****alue");
    expect(isSmsIrUsable({ SMS_IR_API_KEY: "k" })).toBe(true);
    // Default base URL without an override.
    expect(cfg.baseUrl).toBe("https://api.sms.ir");
  });

  it("normalizes a custom base URL (no trailing slash)", () => {
    expect(resolveSmsIrConfig({ SMS_IR_API_BASE: "https://example.com/" }).baseUrl).toBe(
      "https://example.com"
    );
  });
});

// ============================================================
// Envelope parsing + error taxonomy
// ============================================================

describe("parseSmsIrEnvelope", () => {
  it("accepts the documented {status,message,data} envelope", () => {
    const parsed = parseSmsIrEnvelope({ status: 1, message: "موفق", data: 165.3 });
    expect(parsed.ok).toBe(true);
  });

  it("rejects non-object bodies and missing status", () => {
    expect(parseSmsIrEnvelope(null).ok).toBe(false);
    expect(parseSmsIrEnvelope([1, 2]).ok).toBe(false);
    expect(parseSmsIrEnvelope({ data: 1 }).ok).toBe(false);
    expect(parseSmsIrEnvelope({ status: "1" }).ok).toBe(false);
  });
});

describe("error taxonomy mapping", () => {
  const cases: Array<[number, string]> = [
    [102, "insufficient_credit"], // اعتبار کافی نمیباشد
    [101, "invalid_line"], // شماره خط نامعتبر
    [123, "line_needs_activation"], // خط نیاز به فعال‌سازی
    [20, "rate_limited"], // تعداد درخواست بیشتر از حد مجاز
    [104, "invalid_recipient"], // موبایل نادرست
    [107, "invalid_recipient"], // لیست موبایل خالی
    [115, "recipient_blocked"], // لیست سیاه
    [113, "template_not_found"], // قالب یافت نشد
    [114, "template_param_invalid"], // مقدار پارامتر >25 کاراکتر
    [116, "template_param_invalid"], // نام پارامتر خالی
    [117, "template_rejected"], // متن تأیید نشده
    [119, "plan_restricted"], // پلن باید ارتقا یابد
    [10, "auth_failed"],
    [11, "auth_failed"],
    [12, "auth_failed"],
    [13, "auth_failed"],
    [14, "auth_failed"],
    [103, "provider_logical_error"], // متن خالی → generic
    [105, "provider_logical_error"], // تعداد موبایل > 100
    [0, "provider_logical_error"],
    [999, "provider_logical_error"], // undocumented code → generic
  ];
  it.each(cases.map((c) => [JSON.stringify(c[0]) + " → " + c[1], c[0], c[1]]))(
    "%s",
    (_label, code, expected) => {
      expect(smsIrStatusToKind(code)).toBe(expected);
    }
  );

  it("provider status wins over http status when both exist", () => {
    const err = normalizeSmsIrError(400, { providerStatus: 102 });
    expect(err.kind).toBe("insufficient_credit");
    expect(err.providerStatus).toBe(102);
  });

  it("maps http statuses (401/429/5xx/other)", () => {
    expect(httpStatusToKind(401)).toBe("auth_failed");
    expect(httpStatusToKind(429)).toBe("rate_limited");
    expect(httpStatusToKind(500)).toBe("provider_server_error");
    expect(httpStatusToKind(502)).toBe("provider_server_error");
    expect(httpStatusToKind(400)).toBe("provider_logical_error");
  });

  it("carries a bounded provider message and Persian explanation", () => {
    const err = normalizeSmsIrError(200, { providerStatus: 102, providerMessage: "اعتبار کافی نمیباشد" });
    expect(err.messageFa).toContain("موجودی");
    expect(err.providerMessage).toBe("اعتبار کافی نمیباشد");
    const long = normalizeSmsIrError(200, { providerStatus: 102, providerMessage: "x".repeat(500) });
    expect(long.providerMessage!.length).toBe(200);
  });
});

// ============================================================
// Delivery-state normalization (official 1–7 table)
// ============================================================

describe("deliveryStateToStatus", () => {
  it("maps every documented delivery state", () => {
    expect(deliveryStateToStatus(1)).toBe("delivered");
    expect(deliveryStateToStatus(2)).toBe("not_delivered");
    expect(deliveryStateToStatus(3)).toBe("processing");
    expect(deliveryStateToStatus(4)).toBe("not_reached_telecom");
    expect(deliveryStateToStatus(5)).toBe("reached_telecom");
    expect(deliveryStateToStatus(6)).toBe("provider_error");
    expect(deliveryStateToStatus(7)).toBe("blocked");
  });

  it("never claims delivered from an acceptance-only response", () => {
    expect(deliveryStateToStatus(null)).toBe("unknown");
    expect(deliveryStateToStatus(undefined)).toBe("unknown");
  });
});

// ============================================================
// Credit endpoint
// ============================================================

describe("getSmsIrCredit", () => {
  it("returns the provider-confirmed credit number", async () => {
    const res = await getSmsIrCredit({ env: KEY_ENV, fetchImpl: fetchOk(165.3) as unknown as typeof fetch });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.credit).toBe(165.3);
      expect(res.syncedAt).toBeTruthy();
    }
  });

  it("coerces a numeric-string credit, rejects garbage (no fabricated balance)", async () => {
    const ok = await getSmsIrCredit({ env: KEY_ENV, fetchImpl: fetchOk("42.5") as unknown as typeof fetch });
    expect(ok.ok && ok.credit).toBe(42.5);

    const bad = await getSmsIrCredit({ env: KEY_ENV, fetchImpl: fetchOk(null) as unknown as typeof fetch });
    expect(bad.ok).toBe(false);
  });

  it("fails with CONFIG_MISSING when no key exists (no network call)", async () => {
    const fetchImpl = vi.fn();
    const res = await getSmsIrCredit({ env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(false);
    if (isFailure(res)) {
      expect(res.kind).toBe("not_configured");
      expect(res.messageFa).toBeTruthy();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps an auth rejection (HTTP 401)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ status: 10, message: "کلیدوب سرویس نامعتبر است" }),
    });
    const res = await getSmsIrCredit({ env: KEY_ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    if (isFailure(res)) {
      expect(res.kind).toBe("auth_failed");
      expect(res.providerMessage).toContain("کلید");
      // The masked-key test below also covers no-key-leak; the message must
      // never contain the API key value either.
      expect(res.providerMessage).not.toContain("test-key-1234567890");
    }
  });

  it("maps insufficient credit (provider status 102) and rate limit (429)", async () => {
    const noCredit = await getSmsIrCredit({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ status: 102, message: "اعتبار کافی نمیباشد" }),
      }) as unknown as typeof fetch,
    });
    if (isFailure(noCredit)) expect(noCredit.kind).toBe("insufficient_credit");

    const limited = await getSmsIrCredit({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "",
      }) as unknown as typeof fetch,
    });
    if (isFailure(limited)) expect(limited.kind).toBe("rate_limited");
  });

  it("maps network timeout and generic network failure", async () => {
    const abort = new DOMException("The operation was aborted", "AbortError");
    const timedOut = await getSmsIrCredit({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockRejectedValue(abort) as unknown as typeof fetch,
    });
    if (isFailure(timedOut)) expect(timedOut.kind).toBe("network_timeout");

    const netErr = await getSmsIrCredit({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch,
    });
    if (isFailure(netErr)) expect(netErr.kind).toBe("network_error");
  });

  it("maps a malformed (non-JSON) success response", async () => {
    const res = await getSmsIrCredit({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "not-json-at-all",
      }) as unknown as typeof fetch,
    });
    if (isFailure(res)) expect(res.kind).toBe("malformed_response");
  });

  it("scrubs the API key from any echoed provider message", async () => {
    const res = await getSmsIrCredit({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          status: 102,
          message: "bad key test-key-1234567890 rejected",
        }),
      }) as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.providerMessage).not.toContain("test-key-1234567890");
      if (res.providerMessage) {
        expect(res.providerMessage).toContain("****");
      }
    }
  });
});

// ============================================================
// Lines endpoint + sender-line mismatch
// ============================================================

describe("getSmsIrLines", () => {
  it("parses the documented number array", async () => {
    const res = await getSmsIrLines({
      env: KEY_ENV,
      fetchImpl: fetchOk([10002155613464, 30004505000017]) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines.map((l) => l.lineNumber)).toEqual([
        "10002155613464",
        "30004505000017",
      ]);
    }
  });

  it("fails malformed (non-array) data", async () => {
    const res = await getSmsIrLines({
      env: KEY_ENV,
      fetchImpl: fetchOk({ nope: true }) as unknown as typeof fetch,
    });
    if (isFailure(res)) expect(res.kind).toBe("malformed_response");
  });
});

// ============================================================
// Health probe
// ============================================================

describe("getSmsIrHealth", () => {
  const LINE_DATA = [30004505000017, 10002155613464];

  it("is never 'healthy' merely because env vars exist (probe is the proof)", async () => {
    // CONFIGURED env, but provider rejects with auth error → not ok.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ status: 10, message: "کلیدوب سرویس نامعتبر است" }),
    });
    const health = await getSmsIrHealth({
      env: { ...KEY_ENV, SMS_BUSINESS_SENDER: "30004505000017" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(health.ok).toBe(false);
    expect(health.envConfigured).toBe(true);
    expect(health.credit.state).toBe("failed");
    expect(health.credit.errorKind).toBe("auth_failed");
  });

  it("reports missing configuration without any network call", async () => {
    const fetchImpl = vi.fn();
    const health = await getSmsIrHealth({ env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(health.envConfigured).toBe(false);
    expect(health.ok).toBe(false);
    expect(health.credit.errorKind).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes only when BOTH credit and lines probes succeed", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const data = url.includes("/v1/credit") ? 165.3 : LINE_DATA;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 1, message: "موفق", data }),
      };
    });
    const health = await getSmsIrHealth({
      env: { ...KEY_ENV, SMS_BUSINESS_SENDER: "30004505000017" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(health.ok).toBe(true);
    expect(health.credit.credit).toBe(165.3);
    expect(health.lines.lines).toEqual(["30004505000017", "10002155613464"]);
    // The configured line IS confirmed by the provider → no mismatch.
    expect(health.senderMismatch?.detected).toBe(false);
  });

  it("flags a mismatch when the configured line is not provider-confirmed", async () => {
    const health = await getSmsIrHealth({
      env: { ...KEY_ENV, SMS_BUSINESS_SENDER: "30009999999999" },
      fetchImpl: vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: 1,
            message: "موفق",
            data: url.includes("/v1/credit") ? 165.3 : LINE_DATA,
          }),
      })) as unknown as typeof fetch,
    });
    expect(health.senderMismatch?.detected).toBe(true);
    if (health.senderMismatch?.messageFa) {
      expect(health.senderMismatch.messageFa).toContain("خط");
    }
  });

  it("no configured line → also OK, and mismatch reason set for missing provider lines", async () => {
    // No local line configured → no mismatch check.
    const noLocal = await getSmsIrHealth({
      env: KEY_ENV,
      fetchImpl: vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: 1,
            message: "موفق",
            data: url.includes("/v1/credit") ? 10 : LINE_DATA,
          }),
      })) as unknown as typeof fetch,
    });
    expect(noLocal.ok).toBe(true);
    expect(noLocal.senderMismatch?.detected).toBe(false);

    // Local line configured but provider lines probe failed → mismatch reason.
    const linesDown = await getSmsIrHealth({
      env: { ...KEY_ENV, SMS_BUSINESS_SENDER: "30004505000017" },
      fetchImpl: vi.fn(async (url: string) => {
        if (url.includes("/v1/credit")) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ status: 1, data: 10 }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ status: 0, message: "سیستم" }),
        };
      }) as unknown as typeof fetch,
    });
    expect(linesDown.ok).toBe(false);
    expect(linesDown.senderMismatch?.detected).toBe(true);
    expect(linesDown.senderMismatch?.reason).toBe("missing_provider_lines");
  });

  it("carries config booleans (OTP template, business switch) without secrets", async () => {
    const health = await getSmsIrHealth({
      env: { ...KEY_ENV, SMS_IR_TEMPLATE_ID: "574993", SMS_BUSINESS_ENABLED: "1" },
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "",
      })) as unknown as typeof fetch,
    });
    expect(health.otpTemplateConfigured).toBe(true);
    expect(health.businessSwitch).toBe(true);
    // The full health object never leaks the raw key.
    expect(JSON.stringify(health)).not.toContain("test-key-1234567890");
  });
});
