/**
 * Session 90 — Business-SMS service unit tests (hermetic; every provider is
 * exercised with injected env/fetch, never real network, never real SMS).
 *
 * The explicit OTP-isolation tests at the bottom prove that the business
 * module does NOT alter the existing OTP SMS contract (src/lib/sms.ts).
 */
import { describe, it, expect, vi } from "vitest";
import {
  isBusinessSmsMockEnabled,
  isBusinessSmsConfigured,
  resolveBusinessSmsProvider,
  renderTemplate,
  extractTemplateVariables,
  sendBusinessSms,
  BUSINESS_SMS_MAX_LENGTH,
} from "@/lib/sms-business";
// OTP contract is imported ONLY to assert it is unaffected (isolation test).
import {
  resolveSmsProvider,
  sendOtp,
  isSmsIrConfigured,
} from "@/lib/sms";

const DEV = "development";
const PROD = "production";
const TEST = "test";

describe("isBusinessSmsMockEnabled", () => {
  it("activates ONLY in development with SMS_MOCK=1 (same seam rule as OTP)", () => {
    expect(isBusinessSmsMockEnabled({ SMS_MOCK: "1" }, DEV)).toBe(true);
    expect(isBusinessSmsMockEnabled({ SMS_MOCK: "1" }, PROD)).toBe(false);
    expect(isBusinessSmsMockEnabled({ SMS_MOCK: "1" }, TEST)).toBe(false);
    expect(isBusinessSmsMockEnabled({}, DEV)).toBe(false);
    expect(isBusinessSmsMockEnabled({ SMS_MOCK: "0" }, DEV)).toBe(false);
  });
});

describe("isBusinessSmsConfigured — kill-switch semantics", () => {
  it("requires the SMS_BUSINESS_ENABLED=1 switch AND the API key", () => {
    expect(
      isBusinessSmsConfigured({ SMS_BUSINESS_ENABLED: "1", SMS_IR_API_KEY: "k" })
    ).toBe(true);
    // Key without the switch → NOT configured (default-safe production).
    expect(isBusinessSmsConfigured({ SMS_IR_API_KEY: "k" })).toBe(false);
    // Switch without the key → NOT configured.
    expect(isBusinessSmsConfigured({ SMS_BUSINESS_ENABLED: "1" })).toBe(false);
    expect(isBusinessSmsConfigured({})).toBe(false);
  });

  it("does NOT consult the OTP-only SMS_IR_TEMPLATE_ID", () => {
    // Production currently has the OTP template configured — business SMS
    // must stay DISABLED regardless (that template id is not a business one).
    expect(
      isBusinessSmsConfigured({ SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "574993" })
    ).toBe(false);
  });
});

describe("resolveBusinessSmsProvider", () => {
  it("mock beats smsir in development", () => {
    expect(
      resolveBusinessSmsProvider(
        {
          SMS_MOCK: "1",
          SMS_BUSINESS_ENABLED: "1",
          SMS_IR_API_KEY: "k",
        },
        DEV
      )
    ).toBe("mock");
  });

  it("smsir activates only with the explicit kill-switch + key", () => {
    expect(
      resolveBusinessSmsProvider(
        { SMS_BUSINESS_ENABLED: "1", SMS_IR_API_KEY: "k" },
        PROD
      )
    ).toBe("smsir");
  });

  it("none is the DEFAULT — configured OTP credentials do not enable business SMS", () => {
    // Exactly the current production env shape: OTP fully configured,
    // no business switch → business SMS disabled.
    expect(
      resolveBusinessSmsProvider(
        { SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "574993" },
        PROD
      )
    ).toBe("none");
    expect(resolveBusinessSmsProvider({}, PROD)).toBe("none");
    expect(resolveBusinessSmsProvider({}, DEV)).toBe("none");
  });
});

describe("renderTemplate (pure)", () => {
  it("replaces declared placeholders with values", () => {
    const r = renderTemplate("سفارش {{orderNo}} برای {{name}} عزیز", {
      orderNo: "abc12345",
      name: "علی",
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.text).toBe("سفارش abc12345 برای علی عزیز");
  });

  it("tolerates whitespace inside braces", () => {
    expect(renderTemplate("کد: {{ code }}", { code: 42 }).text).toBe("کد: 42");
  });

  it("is fail-closed: missing variables are reported and left intact", () => {
    const r = renderTemplate("سفارش {{orderNo}} — {{trackingCode}}", {
      orderNo: "x1",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["trackingCode"]);
    expect(r.text).toContain("{{trackingCode}}");
    expect(r.text).toContain("x1");
  });

  it("treats empty-string and whitespace-only values as missing", () => {
    const r = renderTemplate("{{a}} {{b}}", { a: "", b: "   " });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["a", "b"]);
  });

  it("coerces numbers and zeroes are valid values", () => {
    const r = renderTemplate("مبلغ: {{amount}}", { amount: 0 });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("مبلغ: 0");
  });

  it("ignores non-declared extra vars", () => {
    const r = renderTemplate("سلام {{name}}", { name: "x", extra: "y" } as Record<string, string>);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("سلام x");
  });

  it("caps the rendered output at BUSINESS_SMS_MAX_LENGTH", () => {
    const r = renderTemplate("x".repeat(BUSINESS_SMS_MAX_LENGTH + 50), {});
    expect(r.text.length).toBe(BUSINESS_SMS_MAX_LENGTH);
  });
});

describe("extractTemplateVariables", () => {
  it("returns declared variables in first-occurrence order, deduplicated", () => {
    expect(
      extractTemplateVariables("{{b}} {{a}} {{b}} {{c1}}")
    ).toEqual(["b", "a", "c1"]);
  });

  it("returns [] for a body without placeholders", () => {
    expect(extractTemplateVariables("متن بدون متغیر")).toEqual([]);
  });
});

describe("sendBusinessSms — mock provider (dev/CI seam)", () => {
  it("sends without any network call", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("must not be called"));
    const result = await sendBusinessSms("09123456789", "سلام", {
      env: { SMS_MOCK: "1" },
      nodeEnv: DEV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.messageId).toBe("MOCK_BUSINESS_SMS");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sendBusinessSms — disabled by default (production safety)", () => {
  it("returns controlled SMS_BUSINESS_DISABLED with the current production env shape", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("must not be called"));
    const result = await sendBusinessSms("09123456789", "hello", {
      env: { SMS_IR_API_KEY: "real-key", SMS_IR_TEMPLATE_ID: "574993" },
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.provider).toBe("none");
    expect(result.error).toBe("SMS_BUSINESS_DISABLED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns SMS_BUSINESS_NOT_CONFIGURED when switched on but key missing", async () => {
    const result = await sendBusinessSms("09123456789", "hello", {
      env: { SMS_BUSINESS_ENABLED: "1" },
      nodeEnv: PROD,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("SMS_BUSINESS_NOT_CONFIGURED");
  });
});

describe("sendBusinessSms — sms.ir adapter (switch explicitly on)", () => {
  const BUSINESS_ENV = {
    SMS_BUSINESS_ENABLED: "1",
    SMS_IR_API_KEY: "api-key",
  };

  it("POSTs to /v1/send/bulk with the documented contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, data: { packageID: 9001 } }),
    });
    const result = await sendBusinessSms("09123456789", "پیام تست", {
      env: BUSINESS_ENV,
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("smsir");
    expect(result.messageId).toBe("9001");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.sms.ir/v1/send/bulk");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("api-key");
    const body = JSON.parse(init.body as string);
    expect(body.mobiles).toEqual(["9123456789"]); // leading zero stripped
    expect(body.messageText).toBe("پیام تست");
  });

  it("strips the OTP template id from its contract entirely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, data: { packageID: 1 } }),
    });
    await sendBusinessSms("09123456789", "m", {
      env: { ...BUSINESS_ENV, SMS_IR_TEMPLATE_ID: "574993" },
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.templateId).toBeUndefined();
  });

  it("returns SMS_BUSINESS_API_ERROR when the gateway rejects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 0, message: "خطا" }),
    });
    const result = await sendBusinessSms("09123456789", "m", {
      env: BUSINESS_ENV,
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("SMS_BUSINESS_API_ERROR");
  });

  it("returns NETWORK_ERROR when fetch itself throws (never throws upward)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await sendBusinessSms("09123456789", "m", {
      env: BUSINESS_ENV,
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NETWORK_ERROR");
  });
});

// ============================================================
// OTP ISOLATION — the business module must not perturb the OTP contract
// ============================================================

describe("OTP isolation — src/lib/sms.ts contract unchanged", () => {
  it("OTP provider resolution keeps its own gate (key + OTP template id)", () => {
    // Business kill-switch must be irrelevant to the OTP resolver.
    expect(
      resolveSmsProvider(
        { SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "1", SMS_BUSINESS_ENABLED: "1" },
        PROD
      )
    ).toBe("smsir");
    expect(
      resolveSmsProvider({ SMS_BUSINESS_ENABLED: "1" }, PROD)
    ).toBe("none");
    // And the original configured-check semantics hold.
    expect(isSmsIrConfigured({ SMS_IR_API_KEY: "k" })).toBe(false);
    expect(
      isSmsIrConfigured({ SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "1" })
    ).toBe(true);
  });

  it("OTP mock seam is untouched by business flags", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("must not be called"));
    const otpResult = await sendOtp("09123456789", "123456", {
      env: { SMS_MOCK: "1", SMS_BUSINESS_ENABLED: "1" },
      nodeEnv: DEV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(otpResult.ok).toBe(true);
    expect(otpResult.provider).toBe("mock");
    expect(otpResult.messageId).toBe("MOCK_SMS");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("OTP sms.ir request keeps the exact /v1/send/verify payload contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, data: { messageId: 777 } }),
    });
    const result = await sendOtp("09123456789", "654321", {
      env: { SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "574993" },
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.templateId).toBe(574993);
    expect(body.parameters).toEqual([{ name: "OTP", value: "654321" }]);
  });
});
