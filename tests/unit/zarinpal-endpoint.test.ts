/**
 * Zarinpal gateway endpoint + initiation-failure contract.
 *
 * ROOT-CAUSE regression tests for the checkout 502 «درگاه پرداخت موقتاً در
 * دسترس نیست»: requestPayment() returning null is the ONLY condition that
 * reaches that message (src/app/api/checkout/route.ts), and production used
 * to POST to the legacy api.zarinpal.com host, which now REJECTS the /pg/v4
 * routes with HTTP 403 (probed 2026-10). The official v4 docs cite
 * payment.zarinpal.com/pg/v4/payment/{request,verify}.json (and the sandbox
 * doc says to swap ONLY the host: payment.zarinpal.com → sandbox.zarinpal.com).
 *
 * Every interaction is intercepted via global fetch — no real network, no
 * payment transaction initiated, no merchant/credentials printed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const TEST_MERCHANT_ID = "0123456789abcdef0123456789abcdef";

/**
 * Re-import the module with a fresh NODE_ENV so the module-level
 * `const isDev` re-evaluates (vitest: vi.resetModules + dynamic import).
 * Secrets/env names are set but never printed.
 */
async function importZarinpal(nodeEnv: "production" | "development") {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  delete process.env.ZARINPAL_MOCK;
  process.env.ZARINPAL_MERCHANT_ID = TEST_MERCHANT_ID;
  return await import("@/lib/zarinpal");
}

function zarinPayload(data: unknown, errors: unknown = []) {
  return { ok: true, json: async () => ({ data, errors }) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("gateway host selection (endpoint contract)", () => {
  it("PRODUCTION posts request.json to the documented payment.zarinpal.com host — never the legacy api.zarinpal.com (403) host", async () => {
    const { requestPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce(
      zarinPayload({ code: 100, authority: "A0000000000000000000000000000AUTH02" })
    );

    await requestPayment(5000, "سفارش #test", "orderEP");

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(
      "https://payment.zarinpal.com/pg/v4/payment/request.json"
    );
    expect(url).not.toContain("api.zarinpal.com");
  });

  it("PRODUCTION verify.json uses the same documented host", async () => {
    const { verifyPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce(
      zarinPayload({ code: 100, ref_id: 111222, card_pan: "" })
    );

    await verifyPayment(5000, "A0000000000000000000000000000AUTH02");

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("https://payment.zarinpal.com/pg/v4/payment/verify.json");
    expect(url).not.toContain("api.zarinpal.com");
  });

  it("DEVELOPMENT (ZARINPAL_MOCK unset) posts to sandbox.zarinpal.com — the documented host-swap of payment.zarinpal.com", async () => {
    const { requestPayment } = await importZarinpal("development");
    fetchMock.mockResolvedValueOnce(
      zarinPayload({ code: 100, authority: "S0000000000000000000000000000SBX01" })
    );

    const result = await requestPayment(5000, "desc", "orderSbx");

    expect(result).not.toBeNull();
    // Sandbox authorities start with S per the official sandbox doc.
    expect(result!.authority.startsWith("S")).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://sandbox.zarinpal.com/pg/v4/payment/request.json"
    );
  });
});

describe("requestPayment failure branches → null (the checkout 502 conditions)", () => {
  it("a thrown/rejected fetch (server unreachable) returns null", async () => {
    const { requestPayment } = await importZarinpal("production");
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const result = await requestPayment(5000, "desc", "orderNetFail");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an HTTP-error response with a JSON errors object returns null", async () => {
    const { requestPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        data: null,
        errors: { code: -3, message: " Мерچنت id نامعتبر است ".trim() },
      }),
    });

    const result = await requestPayment(5000, "desc", "orderHttpFail");
    expect(result).toBeNull();
  });

  it("a non-JSON body (HTML error page) throws in res.json and is caught → null — no unhandled crash", async () => {
    const { requestPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new TypeError("Unexpected token < in JSON");
      },
    });

    const result = await requestPayment(5000, "desc", "orderHtmlFail");
    expect(result).toBeNull();
  });

  it("the legacy-v4 quirk `errors: []` (EMPTY array, truthy in JS) is treated as SUCCESS, not failure", async () => {
    const { requestPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce(
      zarinPayload({ code: 100, authority: "A0000000000000000000000000000EMPTY errors" })
    );

    const result = await requestPayment(5000, "desc", "orderEmptyErrors");
    expect(result).not.toBeNull();
    expect(result!.authority.startsWith("A")).toBe(true);
  });

  it("data.code !== 100 (e.g. gateway refusal) returns null", async () => {
    const { requestPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce(
      zarinPayload({ code: 99, message: "درخواست نامعتبر" })
    );

    const result = await requestPayment(5000, "desc", "orderCode99");
    expect(result).toBeNull();
  });

  it("a missing merchant id returns null WITHOUT any network call (never the 503 path — checkout guards first)", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ZARINPAL_MOCK;
    delete process.env.ZARINPAL_MERCHANT_ID;
    const { requestPayment } = await import("@/lib/zarinpal");

    const result = await requestPayment(5000, "desc", "orderNoMerchant");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyPayment failure branches → null", () => {
  it("a rejected fetch returns null without marking anything paid", async () => {
    const { verifyPayment } = await importZarinpal("production");
    fetchMock.mockRejectedValueOnce(new Error("timeout"));

    expect(await verifyPayment(5000, "AVERIFYFAIL")).toBeNull();
  });

  it("an unverified authority (code !== 100) returns null — the order can never be marked paid from this", async () => {
    const { verifyPayment } = await importZarinpal("production");
    fetchMock.mockResolvedValueOnce(
      zarinPayload({ code: -50, message: "مبلغ ارسالی با مبلغ تراکنش مطابقت ندارد" })
    );

    expect(await verifyPayment(5000, "AVERIFYNOK")).toBeNull();
  });
});
