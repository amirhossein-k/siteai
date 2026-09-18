/**
 * Session 62 — SMS abstraction unit tests (hermetic; every provider is
 * exercised with injected env/fetch, never real network).
 */
import { describe, it, expect, vi } from "vitest";
import {
  isSmsIrConfigured,
  isSmsMockEnabled,
  resolveSmsProvider,
  sendOtp,
} from "@/lib/sms";

const DEV = "development";
const PROD = "production";
const TEST = "test";

describe("isSmsMockEnabled", () => {
  it("activates ONLY in development with SMS_MOCK=1", () => {
    expect(isSmsMockEnabled({ SMS_MOCK: "1" }, DEV)).toBe(true);
    expect(isSmsMockEnabled({ SMS_MOCK: "1" }, PROD)).toBe(false);
    expect(isSmsMockEnabled({ SMS_MOCK: "1" }, TEST)).toBe(false);
    expect(isSmsMockEnabled({}, DEV)).toBe(false);
    expect(isSmsMockEnabled({ SMS_MOCK: "0" }, DEV)).toBe(false);
  });
});

describe("isSmsIrConfigured", () => {
  it("requires BOTH the API key and the template id", () => {
    expect(
      isSmsIrConfigured({ SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "123" })
    ).toBe(true);
    expect(isSmsIrConfigured({ SMS_IR_API_KEY: "k" })).toBe(false);
    expect(isSmsIrConfigured({ SMS_IR_TEMPLATE_ID: "123" })).toBe(false);
    expect(isSmsIrConfigured({})).toBe(false);
  });
});

describe("resolveSmsProvider", () => {
  it("mock beats smsir in development", () => {
    expect(
      resolveSmsProvider(
        { SMS_MOCK: "1", SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "1" },
        DEV
      )
    ).toBe("mock");
  });

  it("smsir activates in production when configured", () => {
    expect(
      resolveSmsProvider({ SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "1" }, PROD)
    ).toBe("smsir");
  });

  it("none when neither mock nor credentials exist (any environment)", () => {
    expect(resolveSmsProvider({}, DEV)).toBe("none");
    expect(resolveSmsProvider({}, PROD)).toBe("none");
  });
});

describe("sendOtp — mock provider", () => {
  it("returns ok without touching the network", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("must not be called"));
    const result = await sendOtp("09123456789", "123456", {
      env: { SMS_MOCK: "1" },
      nodeEnv: DEV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.messageId).toBe("MOCK_SMS");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sendOtp — no provider", () => {
  it("returns a controlled SMS_NOT_CONFIGURED error (never throws)", async () => {
    const result = await sendOtp("09123456789", "123456", {
      env: {},
      nodeEnv: PROD,
    });
    expect(result.ok).toBe(false);
    expect(result.provider).toBe("none");
    expect(result.error).toBe("SMS_NOT_CONFIGURED");
  });
});

describe("sendOtp — sms.ir adapter", () => {
  const SMS_IR_ENV = { SMS_IR_API_KEY: "api-key", SMS_IR_TEMPLATE_ID: "100" };

  it("POSTs to /v1/send/verify with the documented contract and returns ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, data: { messageId: 89545112 } }),
    });
    const result = await sendOtp("09123456789", "123456", {
      env: SMS_IR_ENV,
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("smsir");
    expect(result.messageId).toBe("89545112");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.sms.ir/v1/send/verify");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("api-key");
    const body = JSON.parse(init.body as string);
    expect(body.mobile).toBe("9123456789"); // leading zero stripped
    expect(body.templateId).toBe(100);
    expect(body.parameters).toEqual([{ name: "OTP", value: "123456" }]);
  });

  it("returns SMS_IR_API_ERROR when the gateway rejects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 0, message: "ناموفق" }),
    });
    const result = await sendOtp("09123456789", "123456", {
      env: SMS_IR_ENV,
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("SMS_IR_API_ERROR");
  });

  it("returns NETWORK_ERROR when the fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await sendOtp("09123456789", "123456", {
      env: SMS_IR_ENV,
      nodeEnv: PROD,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NETWORK_ERROR");
  });
});
