import { beforeEach, describe, expect, it, vi } from "vitest";

const { attrFind, productExists } = vi.hoisted(() => ({
  attrFind: vi.fn(),
  productExists: vi.fn(),
}));

vi.mock("@/models/Attribute", () => ({ default: { find: attrFind } }));
vi.mock("@/models/Product", () => ({ default: { exists: productExists } }));

import {
  MAX_VARIANTS,
  prepareVariantsForSave,
  recomputeVariantSummary,
  validateVariants,
} from "@/lib/product-variants";

// 24-char hex strings — valid Mongoose ObjectIds for the pure checks.
const COLOR_ID = "a".repeat(24);
const SIZE_ID = "b".repeat(24);

const ATTR_MAP = new Map([
  [COLOR_ID, { name: "رنگ", values: ["قرمز", "آبی"] }],
  [SIZE_ID, { name: "سایز", values: ["M", "L"] }],
]);

function baseVariant(overrides: Record<string, unknown> = {}) {
  return {
    sku: "SKU-1",
    attributes: [{ attributeId: COLOR_ID, value: "قرمز" }],
    price: 1000,
    supplierPrice: 800,
    stock: 5,
    ...overrides,
  };
}

describe("recomputeVariantSummary", () => {
  it("computes min active price and summed active stock", () => {
    expect(
      recomputeVariantSummary([
        { price: 100, stock: 2 },
        { price: 50, stock: 3 },
      ])
    ).toEqual({ price: 50, stock: 5 });
  });

  it("excludes inactive variants", () => {
    expect(
      recomputeVariantSummary([
        { price: 100, stock: 2, isActive: false },
        { price: 80, stock: 4 },
      ])
    ).toEqual({ price: 80, stock: 4 });
  });

  it("returns zeros for an empty or fully-inactive list", () => {
    expect(recomputeVariantSummary([])).toEqual({ price: 0, stock: 0 });
    expect(recomputeVariantSummary([{ price: 10, stock: 1, isActive: false }])).toEqual({
      price: 0,
      stock: 0,
    });
  });

  it("handles a zero-priced active variant (min of [0, 100])", () => {
    expect(
      recomputeVariantSummary([{ price: 0, stock: 1 }, { price: 100, stock: 2 }])
    ).toEqual({ price: 0, stock: 3 });
  });

  it("treats missing stock as 0", () => {
    expect(recomputeVariantSummary([{ price: 10 }])).toEqual({ price: 10, stock: 0 });
  });
});

describe("validateVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid variant list", () => {
    const result = validateVariants([baseVariant()], ATTR_MAP);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty or non-array input", () => {
    expect(validateVariants([], ATTR_MAP).ok).toBe(false);
    expect(validateVariants("nope", ATTR_MAP).ok).toBe(false);
    expect(validateVariants(null, ATTR_MAP).ok).toBe(false);
  });

  it("rejects more than MAX_VARIANTS", () => {
    const tooMany = Array.from({ length: MAX_VARIANTS + 1 }, (_, i) =>
      baseVariant({ sku: `S${i}` })
    );
    const result = validateVariants(tooMany, ATTR_MAP);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_VARIANTS));
  });

  it("requires a SKU on every variant", () => {
    const result = validateVariants([baseVariant({ sku: "  " })], ATTR_MAP);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("کد SKU");
  });

  it("rejects duplicate SKUs", () => {
    const result = validateVariants(
      [baseVariant({ sku: "SAME" }), baseVariant({ sku: "same" })],
      ATTR_MAP
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("کد SKU تکراری");
  });

  it("requires at least one attribute per variant", () => {
    const result = validateVariants([baseVariant({ attributes: [] })], ATTR_MAP);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid attributeId", () => {
    const result = validateVariants(
      [baseVariant({ attributes: [{ attributeId: "not-an-id", value: "x" }] })],
      ATTR_MAP
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("شناسه ویژگی نامعتبر");
  });

  it("rejects an attribute missing from the map", () => {
    const result = validateVariants(
      [baseVariant({ attributes: [{ attributeId: "c".repeat(24), value: "x" }] })],
      ATTR_MAP
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("یافت نشد");
  });

  it("rejects an empty attribute value", () => {
    const result = validateVariants(
      [baseVariant({ attributes: [{ attributeId: COLOR_ID, value: "  " }] })],
      ATTR_MAP
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("خالی است");
  });

  it("rejects a value outside the attribute's preset values", () => {
    const result = validateVariants(
      [baseVariant({ attributes: [{ attributeId: COLOR_ID, value: "سبز" }] })],
      ATTR_MAP
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("مجاز نیست");
  });

  it("rejects duplicate combinations regardless of attribute order", () => {
    const v1 = baseVariant({
      sku: "A",
      attributes: [
        { attributeId: COLOR_ID, value: "قرمز" },
        { attributeId: SIZE_ID, value: "M" },
      ],
    });
    const v2 = baseVariant({
      sku: "B",
      attributes: [
        { attributeId: SIZE_ID, value: "M" },
        { attributeId: COLOR_ID, value: "قرمز" },
      ],
    });
    const result = validateVariants([v1, v2], ATTR_MAP);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ترکیب تکراری");
  });

  it("rejects invalid price / supplierPrice", () => {
    expect(validateVariants([baseVariant({ price: -1 })], ATTR_MAP).ok).toBe(false);
    expect(validateVariants([baseVariant({ price: "abc" })], ATTR_MAP).ok).toBe(false);
    expect(
      validateVariants([baseVariant({ supplierPrice: -1 })], ATTR_MAP).ok
    ).toBe(false);
  });

  it("rejects invalid stock (non-integer or negative)", () => {
    expect(validateVariants([baseVariant({ stock: 1.5 })], ATTR_MAP).ok).toBe(false);
    expect(validateVariants([baseVariant({ stock: -1 })], ATTR_MAP).ok).toBe(false);
  });

  it("rejects a list with no active variant", () => {
    const result = validateVariants(
      [baseVariant({ isActive: false })],
      ATTR_MAP
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("حداقل یک تنوع باید فعال باشد");
  });

  it("allows a zero price (only negative is rejected)", () => {
    expect(validateVariants([baseVariant({ price: 0 })], ATTR_MAP).ok).toBe(true);
  });
});

describe("prepareVariantsForSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty variant result for simple products", async () => {
    const result = await prepareVariantsForSave({ hasVariants: false });
    expect(result).toEqual({ ok: true, hasVariants: false, variants: [], price: 0, stock: 0 });
    expect(attrFind).not.toHaveBeenCalled();
  });

  it("rejects a variant product with no variants", async () => {
    const result = await prepareVariantsForSave({ hasVariants: true, variants: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a non-array variants payload", async () => {
    const result = await prepareVariantsForSave({
      hasVariants: true,
      variants: { not: "an array" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("حداقل یک تنوع");
    }
  });

  it("normalizes, denormalizes and summarizes a valid variant set", async () => {
    attrFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: COLOR_ID, name: "رنگ", values: ["قرمز", "آبی"] },
      ]),
    });
    productExists.mockResolvedValue(null);

    const result = await prepareVariantsForSave({
      hasVariants: true,
      variants: [
        {
          sku: " sku-1 ",
          attributes: [{ attributeId: COLOR_ID, value: " قرمز " }],
          price: 1500,
          supplierPrice: 1200,
          stock: 7,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hasVariants).toBe(true);
    expect(result.variants[0].sku).toBe("SKU-1");
    expect(result.variants[0].attributes).toEqual([
      { attributeId: COLOR_ID, name: "رنگ", value: "قرمز" },
    ]);
    expect(result.price).toBe(1500);
    expect(result.stock).toBe(7);
  });

  it("returns a 409 when any SKU already exists on another product", async () => {
    attrFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: COLOR_ID, name: "رنگ", values: ["قرمز"] },
      ]),
    });
    productExists.mockResolvedValue({ _id: "z".repeat(24) });

    const result = await prepareVariantsForSave({
      hasVariants: true,
      variants: [baseVariant({ sku: "DUP" })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("SKU");
    }
  });

  it("passes excludeProductId into the SKU pre-check", async () => {
    attrFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: COLOR_ID, name: "رنگ", values: ["قرمز"] },
      ]),
    });
    productExists.mockResolvedValue(null);
    const excludeId = "f".repeat(24);

    await prepareVariantsForSave(
      { hasVariants: true, variants: [baseVariant({ sku: "EXCL" })] },
      excludeId
    );

    const filter = productExists.mock.calls[0][0] as { _id?: { $ne?: string } };
    expect(filter._id).toEqual({ $ne: excludeId });
  });
});
