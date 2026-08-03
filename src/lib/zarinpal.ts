/**
 * Zarinpal Payment Gateway Service
 *
 * Implements Zarinpal REST API v4 for online payment processing.
 * Docs: https://www.zarinpal.com/mp/pages/restApi
 */

const isDev = process.env.NODE_ENV === "development";

// Use sandbox in development mode for safe testing
const ZARINPAL_API_BASE = isDev
  ? "https://sandbox.zarinpal.com/pg/v4"
  : "https://api.zarinpal.com/pg/v4";
const ZARINPAL_START_PAY = isDev
  ? "https://sandbox.zarinpal.com/pg/StartPay"
  : "https://www.zarinpal.com/pg/StartPay";

function getMerchantId(): string {
  return process.env.ZARINPAL_MERCHANT_ID || "";
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
  const merchantId = getMerchantId();
  if (!merchantId) {
    console.warn("[Zarinpal] ZARINPAL_MERCHANT_ID not set — skipping payment request");
    return null;
  }

  try {
    const callbackUrl = `${getCallbackUrl()}?orderId=${orderId}`;

    const res = await fetch(`${ZARINPAL_API_BASE}/payment/request.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        amount,
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
  const merchantId = getMerchantId();
  if (!merchantId) {
    console.warn("[Zarinpal] ZARINPAL_MERCHANT_ID not set — skipping verification");
    return null;
  }

  try {
    const res = await fetch(`${ZARINPAL_API_BASE}/payment/verify.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        amount,
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
