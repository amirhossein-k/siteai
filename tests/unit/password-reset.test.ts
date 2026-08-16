/**
 * Session 84 — password-recovery primitives unit tests (hermetic, no DB/network).
 */
import { describe, it, expect } from "vitest";
import {
  OTP_RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
} from "@/lib/otp";
import { resetPasswordSchema } from "@/lib/validations/auth";

describe("generateResetToken / hashResetToken", () => {
  it("generates a 256-bit hex token (64 hex chars)", () => {
    expect(generateResetToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is cryptographically random — two tokens differ", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).not.toBe(b);
  });

  it("stores only the SHA-256 digest — the hash never equals the plaintext", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(token)).not.toBe(token);
  });

  it("hashes deterministically (same token → same digest, twice)", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
  });
});

describe("OTP_RESET_TOKEN_TTL_MS", () => {
  it("is short-lived — 2 minutes, aligned with the code-row lifetime", () => {
    expect(OTP_RESET_TOKEN_TTL_MS).toBe(2 * 60 * 1000);
  });
});

describe("resetPasswordSchema (client step 3)", () => {
  it("accepts a valid 6–100 char password with a matching confirm", () => {
    const parsed = resetPasswordSchema.safeParse({
      password: "new-pass-123",
      confirmPassword: "new-pass-123",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a password shorter than 6 chars", () => {
    const parsed = resetPasswordSchema.safeParse({
      password: "12345",
      confirmPassword: "12345",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.errors[0]?.message).toContain("۶");
    }
  });

  it("rejects a password longer than 100 chars", () => {
    const parsed = resetPasswordSchema.safeParse({
      password: "x".repeat(101),
      confirmPassword: "x".repeat(101),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a confirm-password mismatch", () => {
    const parsed = resetPasswordSchema.safeParse({
      password: "new-pass-123",
      confirmPassword: "different-pass",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.errors[0]?.path).toContain("confirmPassword");
      expect(parsed.error.errors[0]?.message).toContain("یکسان");
    }
  });

  it("accepts exactly 6 chars (same floor as registration)", () => {
    const parsed = resetPasswordSchema.safeParse({
      password: "123456",
      confirmPassword: "123456",
    });
    expect(parsed.success).toBe(true);
  });
});
