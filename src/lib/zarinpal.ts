/**
 * Zarinpal Payment Gateway Service
 *
 * Implements Zarinpal REST API v4 for online payment processing.
 * Docs: https://www.zarinpal.com/mp/pages/restApi
 *
 * CURRENCY CONTRACT (critical financial invariant):
 *   - The APPLICATION stores and computes every amount in TOMAN (integer,
 *     no decimals) — product prices, discounts, coupons and order.totalAmount
 *     are all Toman (src/lib/product-pricing.ts, src/lib/coupons.ts).
 *   - Zarinpal v4 accepts an optional `currency` field: "IRR" (Rial, the
 *     DEFAULT when omitted — official docs/connectToGateway + fee docs
 *     "پیش‌فرض: IRR") or "IRT" (Toman).
 *   - requestPayment therefore sends the Toman value with currency:"IRT"
 *     explicitly, so the gateway page charges exactly the payable amount.
 *   - verifyPayment requires the SAME amount as charged, expressed in the
 *     unit the transaction was negotiated in. Since the request was made in
 *     IRT, the verify amount is ALSO sent in Toman with currency:"IRT"
 *     (explicit unit on both calls — no silent ×10 conversions to drift).
 *
 * Both functions take TOMAN integers and never expose Rial arithmetic to
 * callers; conversion is impossible to apply twice because no caller ever
 * deals in Rial.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Session 59 — E2E mock seam (dev-only, fail-safe).
 *
 * When `ZARINPAL_MOCK=1` AND `NODE_ENV=development`, the interactive Zarinpal
 * sandbox gateway is replaced with a hermetic same-origin stub:
 *   - requestPayment returns a deterministic authority + a redirectUrl that
 *     points straight at our own /api/payment/verify with Status=OK — the
 *     browser completes the payment journey without touching sandbox.zarinpal.com
 *   - verifyPayment returns a fixed success (refId/cardPan)
 *
 * Production can never activate the seam (NODE_ENV gate). Without the env var
 * the module is byte-for-byte identical to the real gateway flow.
 */
function isZarinpalMock(): boolean {
  return isDev && process.env.ZARINPAL_MOCK === "1";
}

/** Deterministic mock authority derived from the order id (callback cross-check passes). */
function mockAuthority(orderId: string): string {
  return `E2E_MOCK_${orderId}`;
}

// Gateway hosts (official v4 docs):
//   - request/verify endpoint (current, documented):
//       https://payment.zarinpal.com/pg/v4/payment/{request,verify}.json
//     The older api.zarinpal.com host now REJECTS /pg/v4 API calls
//     (HTTP 403 observed on the same path), so posting there fails every
//     production initiation (checkout answered 502 «درگاه پرداخت موقتاً
//     در دسترس نیست» even with a valid merchant/amount).
//   - sandbox (docs, سرویس تست): SAME paths with the host swapped
//     payment.zarinpal.com → sandbox.zarinpal.com; accepts an arbitrary
//     UUID merchant and issues an S-prefixed authority.
//     StartPay keeps the hosts it already uses.
const ZARINPAL_API_BASE = isDev
  ? "https://sandbox.zarinpal.com/pg/v4"
  : "https://payment.zarinpal.com/pg/v4";
const ZARINPAL_START_PAY = isDev
  ? "https://sandbox.zarinpal.com/pg/StartPay"
  : "https://www.zarinpal.com/pg/StartPay";

function getMerchantId(): string {
  return process.env.ZARINPAL_MERCHANT_ID || "";
}

/**
 * Validate a gateway amount BEFORE contacting Zarinpal.
 *
 * The amount arrives server-side (order.totalAmount, computed from server
 * prices + server coupon logic — never from the browser). It must be a
 * positive integer within Zarinpal's documented bounds before any request:
 *   - integer (no floating-point currency arithmetic anywhere in this module)
 *   - > 0
 *   - ≤ 100_000_000 IRT — Zarinpal's documented maximum, error list code -41:
 *     "Maximum amount is 100,000,000 tomans" (payments error list, first-party
 *     docs). Matching the provider cap exactly fails closed locally, before
 *     any network call, instead of relying on the gateway to reject the
 *     same value later with -41.
 *
 * Returns null for invalid input — callers treat it as an unreachable
 * gateway (same contract as requestPayment/verifyPayment failure), so an
 * invalid amount can never start or confirm a transaction.
 */
function isValidGatewayAmount(amount: unknown): amount is number {
  return (
    typeof amount === "number" &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= 100_000_000
  );
}

function getCallbackUrl(): string {
  return (
    process.env.ZARINPAL_CALLBACK_URL ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/payment/verify`
  );
}

/**
 * Zarinpal v4 responses include an `errors` field on BOTH success and failure:
 *   success → { data: { code: 100, ... }, errors: [] }   (EMPTY array)
 *   failure → { errors: { code, message } }              (non-empty object)
 * An empty array is truthy in JS, so a bare `if (result.errors)` check would
 * treat every SUCCESS as a failure. This helper distinguishes properly.
 */
function hasZarinpalErrors(errors: unknown): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors).length > 0;
}

/**
 * Request a payment from Zarinpal gateway.
 *
 * @param amount - Amount in Tomans (Rials / 10)
 * @param description - Order description shown in gateway
 * @param orderId - Internal order ID for metadata
 * @param mobile - Optional customer mobile for gateway
 * @returns The payment authority and redirect URL, or null on failure
 */
export async function requestPayment(
  amount: number,
  description: string,
  orderId: string,
  mobile?: string
): Promise<{ authority: string; redirectUrl: string } | null> {
  // Session 59 — hermetic E2E stub: no merchant id required, no network call.
  if (isZarinpalMock()) {
    const authority = mockAuthority(orderId);
    // Point the browser at our own verify route with Status=OK so the whole
    // payment journey (checkout → redirect → verify → paid) runs locally.
    const redirectUrl = `${getCallbackUrl()}?orderId=${orderId}&Authority=${authority}&Status=OK`;
    return { authority, redirectUrl };
  }

  const merchantId = getMerchantId();
  if (!merchantId) {
    console.warn("[Zarinpal] ZARINPAL_MERCHANT_ID not set — skipping payment request");
    return null;
  }

  if (!isValidGatewayAmount(amount)) {
    console.error(
      `[Zarinpal] Invalid payment request amount (${JSON.stringify(amount)}) — must be a positive integer Toman value within bounds. Payment refused.`
    );
    return null;
  }

  try {
    const callbackUrl = `${getCallbackUrl()}?orderId=${orderId}`;

    const res = await fetch(`${ZARINPAL_API_BASE}/payment/request.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        // CURRENCY CONTRACT: `amount` is TOMAN (order.totalAmount is Toman).
        // marketing copy in the gateway is unit-neutral, but the numeric
        // value MUST be interpreted as IRT — otherwise Zarinpal's default
        // IRR would read the Toman number as Rial and charge 1/10th.
        // Declaring currency:"IRT" pins the unit explicitly at the
        // gateway boundary (single conversion point — none elsewhere).
        amount,
        currency: "IRT",
        description: description.substring(0, 255),
        callback_url: callbackUrl,
        ...(mobile ? { mobile } : {}),
      }),
    });

    const result = await res.json();

    if (!res.ok || hasZarinpalErrors(result.errors)) {
      console.error(
        "[Zarinpal] Payment request failed:",
        result.errors || result
      );
      return null;
    }

    const { data } = result;

    if (data.code !== 100) {
      console.error(
        `[Zarinpal] Payment request returned code ${data.code}:`,
        data.message
      );
      return null;
    }

    return {
      authority: data.authority,
      redirectUrl: `${ZARINPAL_START_PAY}/${data.authority}`,
    };
  } catch (error) {
    console.error("[Zarinpal] Error requesting payment:", error);
    return null;
  }
}

/**
 * Verify a payment after the user returns from Zarinpal gateway.
 *
 * @param amount - The amount that was paid (must match the request amount)
 * @param authority - The authority code from the callback
 * @returns Verification result with refId on success, or null on failure
 */
export async function verifyPayment(
  amount: number,
  authority: string
): Promise<{ refId: number; cardPan: string; message: string } | null> {
  // Session 59 — hermetic E2E stub: deterministic success, no network call.
  if (isZarinpalMock()) {
    return {
      refId: 100_000_000 + (authority.length % 1000),
      cardPan: "5022********0000",
      message: "پرداخت با موفقیت انجام شد",
    };
  }

  const merchantId = getMerchantId();
  if (!merchantId) {
    console.warn("[Zarinpal] ZARINPAL_MERCHANT_ID not set — skipping verification");
    return null;
  }

  if (!isValidGatewayAmount(amount)) {
    console.error(
      `[Zarinpal] Invalid verify amount (${JSON.stringify(amount)}) — refusing to verify.`
    );
    return null;
  }

  try {
    const res = await fetch(`${ZARINPAL_API_BASE}/payment/verify.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        // CURRENCY CONTRACT: same unit as requestPayment — the authority was
        // negotiated in TOMAN (currency:"IRT"), so verify must present the
        // Toman value with the SAME currency declaration. (Zarinpal requires
        // request/verify amounts to MATCH; verifyAmountInToman = the exact
        // order.totalAmount — no ×10 math, no double conversion anywhere.)
        amount,
        currency: "IRT",
        authority,
      }),
    });

    const result = await res.json();

    if (!res.ok || hasZarinpalErrors(result.errors)) {
      console.error(
        "[Zarinpal] Payment verification failed:",
        result.errors || result
      );
      return null;
    }

    const { data } = result;

    // code 100 = success
    if (data.code !== 100) {
      console.error(
        `[Zarinpal] Payment verification returned code ${data.code}:`,
        data.message
      );
      return null;
    }

    return {
      refId: data.ref_id,
      cardPan: data.card_pan || "",
      message: data.message || "پرداخت با موفقیت انجام شد",
    };
  } catch (error) {
    console.error("[Zarinpal] Error verifying payment:", error);
    return null;
  }
}
