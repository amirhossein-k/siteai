/**
 * Session 62 — OTP utility layer unit tests (hermetic, no DB/network).
 */
import { describe, it, expect } from "vitest";
import {
  OTP_CODE_LENGTH,
  OTP_LOGIN_TOKEN_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  generateLoginToken,
  generateOtpCode,
  hashLoginToken,
  hashOtpCode,
  isOtpConsumed,
  isOtpExpired,
  normalizePhone,
  smsIrMobile,
} from "@/lib/otp";

describe("normalizePhone", () => {
  it("keeps the canonical 09xxxxxxxxx form untouched", () => {
    expect(normalizePhone("09123456789")).toBe("09123456789");
  });

  it("converts +98 international prefixes to the canonical 09 form", () => {
    expect(normalizePhone("+989123456789")).toBe("09123456789");
  });

  it("converts 0098 international prefixes to the canonical 09 form", () => {
    expect(normalizePhone("00989123456789")).toBe("09123456789");
  });

  it("strips separators and whitespace", () => {
    expect(normalizePhone("0912-345-6789")).toBe("09123456789");
    expect(normalizePhone("  0912 345 6789  ")).toBe("09123456789");
  });

  it("returns an empty string for non-numeric input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("not-a-phone")).toBe("");
  });
});

describe("generateOtpCode", () => {
  it("returns exactly 6 digits", () => {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(code.length).toBe(OTP_CODE_LENGTH);
  });

  it("produces codes without leading-zero loss (string, not number)", () => {
    // 10 runs can't prove randomness, but they prove format stability.
    for (let i = 0; i < 10; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateLoginToken / hashing", () => {
  it("returns a 64-hex-char (256-bit) token", () => {
    const token = generateLoginToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct tokens", () => {
    expect(generateLoginToken()).not.toBe(generateLoginToken());
  });

  it("hashOtpCode is deterministic and 64 hex chars", () => {
    const a = hashOtpCode("123456");
    const b = hashOtpCode("123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(hashOtpCode("654321"));
  });

  it("hashLoginToken is deterministic and differs from the raw token", () => {
    const token = generateLoginToken();
    const h1 = hashLoginToken(token);
    const h2 = hashLoginToken(token);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(token);
  });
});

describe("isOtpExpired / isOtpConsumed", () => {
  it("flags past dates as expired and future dates as live", () => {
    expect(isOtpExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isOtpExpired(new Date(Date.now() + 1000))).toBe(false);
    expect(isOtpExpired(Date.now() - 5000)).toBe(true);
  });

  it("flags only real consumedAt values as consumed", () => {
    expect(isOtpConsumed(null)).toBe(false);
    expect(isOtpConsumed(undefined)).toBe(false);
    expect(isOtpConsumed(new Date())).toBe(true);
    expect(isOtpConsumed("2026-01-01T00:00:00.000Z")).toBe(true);
  });
});

describe("smsIrMobile", () => {
  it("strips the leading zero (sms.ir format)", () => {
    expect(smsIrMobile("09123456789")).toBe("9123456789");
  });
});

describe("constants", () => {
  it("exposes the documented security parameters", () => {
    expect(OTP_TTL_MS).toBe(2 * 60 * 1000);
    expect(OTP_RESEND_COOLDOWN_MS).toBe(60 * 1000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_LOGIN_TOKEN_TTL_MS).toBe(2 * 60 * 1000);
  });
});
