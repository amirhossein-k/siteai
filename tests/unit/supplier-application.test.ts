import { describe, it, expect } from "vitest";
import {
  validateSupplierApplicationInput,
  validateAdminNote,
  canDecide,
  isSupplierApplicationAction,
  normalizeContactPhone,
  isValidContactPhone,
  SUPPLIER_APPLICATION_LIMITS,
} from "@/lib/supplier-application";

describe("validateSupplierApplicationInput", () => {
  it("accepts a valid application", () => {
    expect(
      validateSupplierApplicationInput({
        businessName: "فروشگاه دیجیتال پارس",
        description: "محصولات دیجیتال با کیفیت",
        contactPhone: "09123456789",
      })
    ).toEqual({ ok: true });
  });

  it("trims and accepts a valid businessName", () => {
    expect(
      validateSupplierApplicationInput({ businessName: "  فروشگاه  " })
    ).toEqual({ ok: true });
  });

  it("rejects a missing / too-short businessName", () => {
    const res = validateSupplierApplicationInput({ businessName: "ف" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("نام کسب‌وکار");
  });

  it("rejects an over-long businessName", () => {
    const long = "ف".repeat(SUPPLIER_APPLICATION_LIMITS.businessName.max + 1);
    const res = validateSupplierApplicationInput({ businessName: long });
    expect(res.ok).toBe(false);
  });

  it("rejects an over-long description (capped at the Supplier.description max)", () => {
    const longDesc = "ف".repeat(SUPPLIER_APPLICATION_LIMITS.description.max + 1);
    const res = validateSupplierApplicationInput({
      businessName: "فروشگاه",
      description: longDesc,
    });
    expect(res.ok).toBe(false);
  });

  it("accepts a description at the cap", () => {
    const atCap = "ف".repeat(SUPPLIER_APPLICATION_LIMITS.description.max);
    expect(
      validateSupplierApplicationInput({
        businessName: "فروشگاه",
        description: atCap,
      })
    ).toEqual({ ok: true });
  });

  it("rejects an invalid contactPhone when provided", () => {
    const res = validateSupplierApplicationInput({
      businessName: "فروشگاه",
      contactPhone: "12345",
    });
    expect(res.ok).toBe(false);
  });

  it("accepts a valid contactPhone", () => {
    expect(
      validateSupplierApplicationInput({
        businessName: "فروشگاه",
        contactPhone: "09351234567",
      })
    ).toEqual({ ok: true });
  });

  it("treats a missing contactPhone as optional (defaults server-side)", () => {
    expect(
      validateSupplierApplicationInput({ businessName: "فروشگاه" })
    ).toEqual({ ok: true });
  });
});

describe("normalizeContactPhone / isValidContactPhone", () => {
  it("trims whitespace", () => {
    expect(normalizeContactPhone("  09123456789  ")).toBe("09123456789");
  });

  it("validates the 11-digit 0-prefixed Iranian mobile format", () => {
    expect(isValidContactPhone("09123456789")).toBe(true);
    expect(isValidContactPhone("0912345678")).toBe(false);
    expect(isValidContactPhone("19123456789")).toBe(false);
    expect(isValidContactPhone("091234567890")).toBe(false);
    expect(isValidContactPhone(" 09123456789 ")).toBe(true);
  });
});

describe("validateAdminNote", () => {
  it("accepts an empty / short note", () => {
    expect(validateAdminNote("")).toEqual({ ok: true });
    expect(validateAdminNote("مدارک ناقص")).toEqual({ ok: true });
  });

  it("rejects an over-long note", () => {
    const long = "ف".repeat(SUPPLIER_APPLICATION_LIMITS.adminNote.max + 1);
    const res = validateAdminNote(long);
    expect(res.ok).toBe(false);
  });
});

describe("canDecide", () => {
  it("only pending applications may be decided", () => {
    expect(canDecide("pending")).toBe(true);
    expect(canDecide("approved")).toBe(false);
    expect(canDecide("rejected")).toBe(false);
  });
});

describe("isSupplierApplicationAction", () => {
  it("accepts only approve / reject", () => {
    expect(isSupplierApplicationAction("approve")).toBe(true);
    expect(isSupplierApplicationAction("reject")).toBe(true);
    expect(isSupplierApplicationAction("")).toBe(false);
    expect(isSupplierApplicationAction("delete")).toBe(false);
  });
});
