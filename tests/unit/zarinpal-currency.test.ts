/**
 * Zarinpal gateway currency contract (critical financial invariant).
 *
 * The application computes every amount in TOMAN (order.totalAmount,
 * prices, coupons — integer, no decimals). Zarinpal v4 defaults to IRR
 * (Rial) when `currency` is omitted, so an un-declared Toman value would
 * be charged at 1/10th. These tests pin the contract at the gateway
 * boundary:
 *   - requestPayment sends the Toman value with currency:"IRT";
 *   - verifyPayment sends the same Toman value with currency:"IRT";
 *   - invalid amounts (non-integer, ≤0, out of bounds) NEVER reach the
 *     network (fail closed);
 *   - no ×10 conversion exists anywhere else — callers pass order.total
 *     straight through, so retry can never double-convert.
 *
 * All gateway interactions are intercepted via global fetch — no real
 * network, no real charges. The hermetic ZARINPAL_MOCK seam is covered
 * by the E2E payment journeys; these tests run with mocks DISABLED so
 * the real (guarded) code path is exercised.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

(process.env as Record<string, string | undefined>).NODE_ENV = "test"; // never development → mock seam offline
delete process.env.ZARINPAL_MOCK;
process.env.ZARINPAL_MERCHANT_ID = "0123456789abcdef0123456789abcdef";

import { requestPayment, verifyPayment } from "@/lib/zarinpal";

function okResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("requestPayment — currency contract", () => {
  it("sends the Toman amount with currency IRT (100,000 Toman order)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: { code: 100, authority: "A0000000000000000000000000000AUTH01" },
        errors: [],
      })
    );

    const result = await requestPayment(
      100_000,
      "سفارش #test0001",
      "order12345",
      "09120000000"
    );

    expect(result).toEqual({
      authority: "A0000000000000000000000000000AUTH01",
      redirectUrl: expect.stringContaining("A0000000000000000000000000000AUTH01"),
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The Toman number travels unchanged AND the unit is declared — the
    // gateway must interpret 100,000 as 100,000 TOMAN (= 1,000,000 Rial),
    // never as 100,000 Rial (which would be a 1/10 charge).
    expect(body.amount).toBe(100_000);
    expect(body.currency).toBe("IRT");
    expect(body.merchant_id).toBe("0123456789abcdef0123456789abcdef");
  });

  it("gateway request payload carries no Rial conversion (amount === Toman value)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: { code: 100, authority: "A1" },
        errors: [],
      })
    );

    await requestPayment(99_999, "desc", "orderX");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // If any ×10 multiplication leaked in, this would be 999,900.
    expect(body.amount).toBe(99_999);
    expect(body.currency).toBe("IRT");
  });
});

describe("verifyPayment — currency contract", () => {
  it("verifies with the SAME Toman value and the SAME declared currency", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: { code: 100, ref_id: 778899, card_pan: "6037********1234" },
        errors: [],
      })
    );

    const result = await verifyPayment(100_000, "A0000000000000000000000000000AUTH01");

    expect(result).toEqual({
      refId: 778899,
      cardPan: "6037********1234",
      message: expect.any(String),
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Verify must present the negotiated unit — a mismatched unit makes
    // Zarinpal reject (error -50 "amounts values is not the same") or,
    // worse, would silently mismatch a Rial against a Toman ledger row.
    expect(body.amount).toBe(100_000);
    expect(body.currency).toBe("IRT");
    expect(body.authority).toBe("A0000000000000000000000000000AUTH01");
  });
});

describe("amount validation — fail closed before any gateway contact", () => {
  const invalid = [
    0,
    -1,
    -100_000,
    10.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    100_000_001, // one Toman above Zarinpal's documented -41 maximum
  ];

  for (const amount of invalid) {
    it(`requestPayment refuses ${String(amount)} without calling the gateway`, async () => {
      const result = await requestPayment(amount as number, "desc", "orderZ");
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`verifyPayment refuses ${String(amount)} without calling the gateway`, async () => {
      const result = await verifyPayment(amount as number, "A0");
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("rejects 100,000,001 TOMAN — one above the provider's -41 maximum — without any network request", async () => {
    fetchMock.mockClear();

    const req = await requestPayment(100_000_001, "over cap", "orderCap");
    expect(req).toBeNull();
    const ver = await verifyPayment(100_000_001, "A0");
    expect(ver).toBeNull();
    // Fail-CLOSED: no outbound gateway traffic for either operation.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies the boundary exactly: 100,000,000 accepted, 100,000,001 rejected", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ data: { code: 100, authority: "Acap" }, errors: [] })
    );

    const okResult = await requestPayment(100_000_000, "at cap", "orderCapOk");
    expect(okResult).not.toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).amount).toBe(100_000_000);

    fetchMock.mockClear();
    expect(await requestPayment(100_000_001, "at cap+1", "orderCapBad")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("single-conversion guarantee (retry-safe)", () => {
  it("retry path reuses order.totalAmount unchanged — the module converts nothing internally", async () => {
    // The payment/retry route calls requestPayment(order.totalAmount, …).
    // Assert two sequential calls (original + retry) send byte-identical
    // amounts — double conversion would show as amount×100 by attempt 2.
    fetchMock
      .mockResolvedValueOnce(okResponse({ data: { code: 100, authority: "Afirst" }, errors: [] }))
      .mockResolvedValueOnce(okResponse({ data: { code: 100, authority: "Asecond" }, errors: [] }));

    await requestPayment(250_000, "desc", "orderR");
    await requestPayment(250_000, "desc", "orderR");

    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(first.amount).toBe(250_000);
    expect(second.amount).toBe(250_000);
    expect(first.currency).toBe("IRT");
    expect(second.currency).toBe("IRT");
  });
});
