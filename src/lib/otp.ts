/**
 * Session 62 — OTP (One-Time Password) helpers.
 *
 * Pure, server-side crypto + constants for the SMS OTP login/registration
 * flow. Nothing here touches the database or the network (the request/verify
 * API routes own persistence; src/lib/sms.ts owns delivery).
 *
 * Security model:
 *   - codes are generated with `crypto.randomInt` (never Math.random);
 *   - only the SHA-256 digest is persisted (plaintext exists ONLY inside the
 *     SMS_MOCK dev seam, on the OtpCode row, for E2E/verify readability);
 *   - the one-time login token exchanged with NextAuth is 256-bit random and
 *     is also stored hashed; it is atomically consumed at exchange time.
 */

import crypto from "crypto";

/** A code is exactly 6 digits. */
export const OTP_CODE_LENGTH = 6;
/** A code is valid for 2 minutes. */
export const OTP_TTL_MS = 2 * 60 * 1000;
/** A new code for the same phone may not be requested within 60s. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Max failed verify attempts before the code is locked (consumed). */
export const OTP_MAX_ATTEMPTS = 5;
/** The one-time login token issued after a successful verify (2 minutes). */
export const OTP_LOGIN_TOKEN_TTL_MS = 2 * 60 * 1000;
/** The one-time password-reset token issued after a successful verify (2 minutes). */
export const OTP_RESET_TOKEN_TTL_MS = 2 * 60 * 1000;

/**
 * Normalize an Iranian mobile to the canonical `09xxxxxxxxx` form:
 * strips +98 / 0098 international prefixes and any non-digit characters.
 */
export function normalizePhone(raw: string): string {
  let p = (raw || "").trim();
  if (p.startsWith("+98")) p = `0${p.slice(3)}`;
  else if (p.startsWith("0098")) p = `0${p.slice(4)}`;
  return p.replace(/\D/g, "");
}

/** Generate a 6-digit code using crypto.randomInt (unbiased, non-inferable). */
export function generateOtpCode(): string {
  let code = "";
  for (let i = 0; i < OTP_CODE_LENGTH; i += 1) {
    code += crypto.randomInt(0, 10);
  }
  return code;
}

/** Generate a high-entropy one-time login token (64 hex chars / 256 bits). */
export function generateLoginToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Session 84 — generate a high-entropy one-time PASSWORD-RESET token
 * (64 hex chars / 256 bits). Same crypto as the login token; the PURPOSE is
 * kept distinct so a login token can never be spent on a reset and vice
 * versa (the reset complete route only looks at resetTokenHash).
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 digest of an OTP code (what is persisted instead of the code). */
export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

/** SHA-256 digest of a one-time login token (what is persisted). */
export function hashLoginToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** SHA-256 digest of a one-time password-reset token (what is persisted). */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** True when `expiresAt` is in the past (code no longer usable). */
export function isOtpExpired(expiresAt: Date | string | number): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/** True when the row has been consumed (verify success or attempt-lock). */
export function isOtpConsumed(
  consumedAt: Date | string | null | undefined
): boolean {
  return Boolean(consumedAt);
}

/** sms.ir expects the mobile WITHOUT the leading zero (9120000000). */
export function smsIrMobile(phone: string): string {
  return phone.replace(/^0/, "");
}
