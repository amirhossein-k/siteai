import { describe, expect, it } from "vitest";
import {
  productSchema,
  productVariantSchema,
  type ProductFormData,
} from "@/lib/validations/product";
import { slugify } from "@/lib/utils";

/**
 * Regression tests — admin product form bugs:
 *  1. Numeric price/stock inputs must not force 0 while typing (the form
 *     keeps the raw string; z.coerce parses at validation).
 *  2. An EMPTY slug is valid at the schema level (auto-generation contract:
 *     the form auto-generates from the name and the SERVER re-generates);
 *     a missing NAME is specifically rejected.
 *  3. An explicitly supplied slug is preserved; invalid slugs are rejected.
 *
 * The typing behavior itself lives in React; these tests pin the CONTRACTS
 * the form relies on (coercion + optional slug) so a regression in either
 * layer fails here first.
 */

const base = {
  category: "cat123",
  supplier: "sup123",
  stock: 10,
  isActive: true,
};

describe("productSchema — slug rules (Bug 2 semantics)", () => {
  it("accepts an EMPTY slug (auto-generation contract)", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "هدفون بی‌سیم X200",
      slug: "",
      price: 850000,
      supplierPrice: 650000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a whitespace-only slug after .trim() (treated as empty)", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "ماوس گیمینگ",
      slug: "   ",
      price: 500000,
      supplierPrice: 400000,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.slug).toBe("");
  });

  it("preserves an explicitly supplied VALID slug (manual slugs are untouched)", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "هدفون بی‌سیم",
      slug: "headphone-x200",
      price: 850000,
      supplierPrice: 650000,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.slug).toBe("headphone-x200");
  });

  it("rejects an INVALID manual slug with the field-specific message", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "هدفون",
      slug: "Headphone X200!",
      price: 1000,
      supplierPrice: 500,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "slug")?.message;
      expect(msg).toBe(
        "اسلاگ فقط شامل حروف فارسی، حروف لاتین کوچک، اعداد و خط تیره است"
      );
    }
  });

  it("rejects a MISSING product name with the name field message (no generic error)", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "",
      slug: "",
      price: 1000,
      supplierPrice: 500,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "name")?.message;
      expect(msg).toBe("نام محصول الزامی است");
    }
  });
});

describe("productSchema — numeric coercion contract (Bug 1 root)", () => {
  it("coerces the raw STRING the input keeps while typing", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "کیبورد",
      slug: "",
      price: "850000" as unknown as number,
      supplierPrice: "650000" as unknown as number,
      stock: "12" as unknown as number,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.price).toBe(850000);
      expect(r.data.supplierPrice).toBe(650000);
      expect(r.data.stock).toBe(12);
    }
  });

  it("an empty numeric string coerces to 0 and is rejected by .positive() — a real field error, not a NaN crash", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "کیبورد",
      slug: "",
      price: "",
      supplierPrice: 500,
    } as unknown as ProductFormData);
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path[0] === "price")?.message;
      expect(msg).toBe("قیمت باید بیشتر از صفر باشد");
    }
  });

  it("zero price/supplierPrice produce FIELD-SPECIFIC messages (this is what the old valueAsNumber||0 bug surfaced as a generic error)", () => {
    const r = productSchema.safeParse({
      ...base,
      name: "کیبورد",
      slug: "",
      price: 0,
      supplierPrice: 0,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => String(i.path[0]));
      expect(paths).toContain("price");
      expect(paths).toContain("supplierPrice");
    }
  });
});

describe("variants schema — the '' draft is coerced AT validation, same contract as the top-level fields", () => {
  it("an EMPTY price/supplierPrice draft coerces to 0 and is REJECTED by .positive() — empty is never silently accepted as a real value", () => {
    const r = productVariantSchema.safeParse({
      sku: "S1",
      attributes: [{ attributeId: "a1", name: "رنگ", value: "قرمز" }],
      price: "" as unknown as number,
      supplierPrice: "" as unknown as number,
      stock: "" as unknown as number,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => String(i.path[0]));
      expect(paths).toContain("price");
      expect(paths).toContain("supplierPrice");
      const priceMsg = r.error.issues.find((i) => i.path[0] === "price")?.message;
      expect(priceMsg).toBe("قیمت باید بیشتر از صفر باشد");
    }
  });

  it("stock has no .positive() rule (0 is a legitimate out-of-stock value), so a '' draft coerces to a valid 0", () => {
    const r = productVariantSchema.safeParse({
      sku: "S1",
      attributes: [{ attributeId: "a1", name: "رنگ", value: "قرمز" }],
      price: 1000,
      supplierPrice: 800,
      stock: "" as unknown as number,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stock).toBe(0);
  });
});

describe("slugify — the shared generator (client + server use the SAME function)", () => {
  it("Latin name yields a lowercase hyphenated slug", () => {
    expect(slugify("Wireless Headphone X200")).toBe("wireless-headphone-x200");
  });

  it("Persian name yields the Unicode slug (Session 70 SEO-first convention)", () => {
    // The ZWNJ (نیم‌فاصله) becomes a hyphen — the same ZWNJ-tolerant
    // convention as fa() in the E2E specs and the SLUG_PATTERN.
    expect(slugify("هدفون بی‌سیم")).toBe("هدفون-بی-سیم");
  });

  it("an EMPTY name yields an EMPTY slug — the server then rejects the missing name explicitly", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});
