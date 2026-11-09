import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const PRODUCT_ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f191e810c19729de860ea";

const { mockFindOneAndUpdate } = vi.hoisted(() => ({
  mockFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  requireRoleOrError: vi.fn(),
  serverError: vi.fn(),
}));
vi.mock("@/lib/dbConnect", () => ({
  dbConnect: vi.fn(),
}));
vi.mock("@/lib/product-variants", () => ({
  prepareVariantsForSave: vi.fn(),
}));
vi.mock("@/lib/product-description", () => ({
  prepareRichDescription: vi.fn(),
}));
vi.mock("@/lib/product-pricing", () => ({
  parseProductDiscount: vi.fn(),
}));
vi.mock("@/lib/product-slug", () => ({
  createWithUniqueSlug: vi.fn(),
}));
vi.mock("@/lib/utils", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/utils")>();
  return {
    ...actual,
    slugify: vi.fn(() => "test-slug"),
  };
});
vi.mock("@/lib/sanitize", () => ({
  sanitizePlainText: vi.fn((v) => (v ? String(v) : "")),
}));
vi.mock("@/lib/inventory-adjustments", () => ({
  assertNoDirectStockChange: vi.fn(),
}));
vi.mock("@/models/Product", () => ({
  default: {
    findOneAndUpdate: mockFindOneAndUpdate,
    findOne: vi.fn(),
    findById: vi.fn(),
    exists: vi.fn().mockResolvedValue(true),
  },
}));

// Keep the REAL price-CAS module so the actual `$set` is constructed by
// buildPriceCasUpdate/withoutUndefined. Only the DB-backed snapshot reader and
// the retry loop's driver are stubbed; the loop still calls the route's write
// callback, which is exactly the boundary under test.
vi.mock("@/lib/product-price-cas", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/product-price-cas")>();
  return {
    ...actual,
    createProductPriceSnapshotReader: vi.fn(() => async () => null),
    updateProductWithPriceStamp: vi.fn(
      async (options: {
        effectiveSlug: string;
        readSnapshot: () => Promise<unknown | null>;
        buildNextRevision: (snapshot: unknown) => unknown;
        write: (attempt: {
          candidate: string;
          token: number | null;
          stamp: Date | null;
        }) => Promise<unknown>;
      }) => {
        // Model the real loop: read the pinned snapshot, let the route decide
        // the next revision (this is where discount validation lives), then
        // build the write. A `null` write result is a CAS miss → not_found.
        const snapshot = await options.readSnapshot();
        if (snapshot === null) return { status: "not_found" as const };
        options.buildNextRevision(snapshot);
        const value = await options.write({
          // Mirror the real CAS loop: the written slug is the route's
          // effectiveSlug, so slug assertions exercise the actual logic.
          candidate: options.effectiveSlug,
          token: null,
          stamp: null,
        });
        if (value === null) return { status: "not_found" as const };
        return { status: "ok" as const, value };
      }
    ),
  };
});

import { PUT } from "@/app/api/admin/products/route";
import { requireRoleOrError } from "@/lib/auth-utils";
import { dbConnect } from "@/lib/dbConnect";
import { prepareVariantsForSave } from "@/lib/product-variants";
import { prepareRichDescription } from "@/lib/product-description";
import { parseProductDiscount } from "@/lib/product-pricing";
import { assertNoDirectStockChange } from "@/lib/inventory-adjustments";
import { createProductPriceSnapshotReader } from "@/lib/product-price-cas";

const mockRequireRoleOrError = vi.mocked(requireRoleOrError);
const mockDbConnect = vi.mocked(dbConnect);
const mockPrepareVariantsForSave = vi.mocked(prepareVariantsForSave);
const mockPrepareRichDescription = vi.mocked(prepareRichDescription);
const mockParseProductDiscount = vi.mocked(parseProductDiscount);
const mockAssertNoDirectStockChange = vi.mocked(assertNoDirectStockChange);

const ALL_FIELDS = [
  "gender",
  "perfumeType",
  "fragranceFamily",
  "topNotes",
  "heartNotes",
  "baseNotes",
  "longevity",
  "sillage",
  "season",
  "occasion",
  "countryOfOrigin",
  "releaseYear",
  "barcode",
  "authenticityType",
] as const;

type PerfumeField = (typeof ALL_FIELDS)[number];

const ENUM_FIELDS: Array<{ field: PerfumeField; values: string[] }> = [
  { field: "gender", values: ["men", "women", "unisex"] },
  {
    field: "perfumeType",
    values: ["parfum", "edp", "edt", "edc", "cologne", "body_spray"],
  },
  {
    field: "fragranceFamily",
    values: ["woody", "floral", "fresh", "oriental", "aromatic", "fougere", "chypre", "gourmand"],
  },
  { field: "longevity", values: ["weak", "moderate", "long", "very_long"] },
  { field: "sillage", values: ["intimate", "moderate", "strong", "enormous"] },
  { field: "authenticityType", values: ["original", "tester", "decant", "sample"] },
];

const ARRAY_FIELDS: Array<{ field: PerfumeField; valid: unknown[]; invalid: unknown[] }> = [
  { field: "topNotes", valid: ["bergamot", "lemon"], invalid: [123] },
  { field: "heartNotes", valid: ["jasmine"], invalid: [null] },
  { field: "baseNotes", valid: ["vanilla"], invalid: [{}] },
  { field: "season", valid: ["spring", "winter"], invalid: ["monsoon"] },
  { field: "occasion", valid: ["daily", "evening"], invalid: ["midnight"] },
];

const SCALAR_FIELDS: Array<{ field: PerfumeField; valid: unknown; invalid: unknown }> = [
  { field: "countryOfOrigin", valid: "France", invalid: 42 },
  { field: "releaseYear", valid: 2020, invalid: "2020" },
  { field: "barcode", valid: "1234567890123", invalid: 12345 },
];

const VALID_VALUES: Record<PerfumeField, unknown> = {
  gender: "women",
  perfumeType: "edp",
  fragranceFamily: "floral",
  topNotes: ["bergamot"],
  heartNotes: ["jasmine"],
  baseNotes: ["vanilla"],
  longevity: "long",
  sillage: "moderate",
  season: ["spring"],
  occasion: ["daily"],
  countryOfOrigin: "France",
  releaseYear: 2020,
  barcode: "1234567890123",
  authenticityType: "original",
};

const baseProduct = {
  name: "Test Perfume",
  slug: "test-perfume",
  category: "cat123",
  supplier: "sup123",
  price: 100000,
  supplierPrice: 80000,
  stock: 10,
  isActive: true,
  // Decision A — the variant configuration is mandatory on every PUT.
  hasVariants: false,
  variants: [],
};

function createPutRequest(body: unknown, id: string | null = PRODUCT_ID) {
  const url =
    id === null
      ? "http://localhost/api/admin/products"
      : `http://localhost/api/admin/products?id=${id}`;
  return new NextRequest(url, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall() {
  const call = mockFindOneAndUpdate.mock.calls.at(-1);
  if (!call) throw new Error("Product.findOneAndUpdate was not called");
  return {
    filter: call[0] as Record<string, unknown>,
    updateDoc: call[1] as {
      $set: Record<string, unknown>;
      $inc: Record<string, number>;
    },
  };
}

function lastSet(): Record<string, unknown> {
  return lastCall().updateDoc.$set;
}

function bodyWithout(...fields: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...baseProduct };
  for (const field of fields) delete copy[field];
  return copy;
}

beforeEach(() => {
  mockRequireRoleOrError.mockResolvedValue({ token: null, error: null });
  mockDbConnect.mockResolvedValue(undefined);
  // Default pinned snapshot: a simple product with a stored price and no
  // discount. Discount-base tests override this per case.
  (createProductPriceSnapshotReader as unknown as ReturnType<typeof vi.fn>)
    .mockImplementation(() => async () => ({
      token: 0,
      revision: {
        price: baseProduct.price,
        hasVariants: false,
        variants: [],
        discount: null,
      },
    }));
  mockPrepareVariantsForSave.mockClear();
  mockPrepareVariantsForSave.mockResolvedValue({
    ok: true,
    hasVariants: false,
    variants: [],
    price: 0,
    stock: 0,
  });
  mockPrepareRichDescription.mockImplementation(() => ({
    ok: true,
    description: "desc",
    descriptionRich: undefined,
  }));
  mockParseProductDiscount.mockReset();
  mockParseProductDiscount.mockReturnValue({ ok: true, value: undefined });
  mockAssertNoDirectStockChange.mockResolvedValue({ ok: true });

  mockFindOneAndUpdate.mockReset();
  mockFindOneAndUpdate.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.populate = () => chain;
    chain.lean = async () => ({ _id: PRODUCT_ID, name: "Test Perfume" });
    return chain;
  });
});

describe("PUT /api/admin/products — 14 perfume fields reach the Mongo $set", () => {
  it("omitted fields are all absent from $set", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct }));
    expect(res.status).toBe(200);
    const set = lastSet();
    for (const field of ALL_FIELDS) {
      expect(set, `${field} must be preserved when omitted`).not.toHaveProperty(field);
    }
  });

  for (const field of ALL_FIELDS) {
    it(`empty string preserves ${field} (absent from $set, no 400)`, async () => {
      const res = await PUT(createPutRequest({ ...baseProduct, [field]: "" }));
      expect(res.status).toBe(200);
      expect(lastSet()).not.toHaveProperty(field);
    });
  }

  for (const field of ALL_FIELDS) {
    it(`null clears ${field} to an explicit BSON null in $set`, async () => {
      const res = await PUT(createPutRequest({ ...baseProduct, [field]: null }));
      expect(res.status).toBe(200);
      const set = lastSet();
      expect(set).toHaveProperty(field);
      expect(set[field]).toBeNull();
    });
  }

  for (const field of ALL_FIELDS) {
    it(`valid value for ${field} is written to $set`, async () => {
      const res = await PUT(
        createPutRequest({ ...baseProduct, [field]: VALID_VALUES[field] })
      );
      expect(res.status).toBe(200);
      expect(lastSet()[field]).toEqual(VALID_VALUES[field]);
    });
  }

  for (const { field } of ARRAY_FIELDS) {
    it(`empty array for ${field} persists as [] in $set`, async () => {
      const res = await PUT(createPutRequest({ ...baseProduct, [field]: [] }));
      expect(res.status).toBe(200);
      const set = lastSet();
      expect(set).toHaveProperty(field);
      expect(set[field]).toEqual([]);
    });
  }

  it("persists every valid value at once in a single update", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct, ...VALID_VALUES }));
    expect(res.status).toBe(200);
    const set = lastSet();
    for (const field of ALL_FIELDS) {
      expect(set[field]).toEqual(VALID_VALUES[field]);
    }
  });

  it("persists nulls and empty arrays together without dropping either", async () => {
    const body: Record<string, unknown> = { ...baseProduct };
    for (const field of ALL_FIELDS) body[field] = null;
    body.season = [];
    body.topNotes = [];
    const res = await PUT(createPutRequest(body));
    expect(res.status).toBe(200);
    const set = lastSet();
    expect(set.season).toEqual([]);
    expect(set.topNotes).toEqual([]);
    expect(set.occasion).toBeNull();
    expect(set.releaseYear).toBeNull();
    expect(set.countryOfOrigin).toBeNull();
  });
});

describe("PUT /api/admin/products — invalid values are rejected with 400", () => {
  for (const { field } of ENUM_FIELDS) {
    it(`rejects an invalid enum for ${field}`, async () => {
      const res = await PUT(
        createPutRequest({ ...baseProduct, [field]: "not-a-valid-value" })
      );
      expect(res.status).toBe(400);
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  }

  for (const { field, invalid } of ARRAY_FIELDS) {
    it(`rejects invalid array members for ${field}`, async () => {
      const res = await PUT(createPutRequest({ ...baseProduct, [field]: invalid }));
      expect(res.status).toBe(400);
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  }

  for (const { field, invalid } of SCALAR_FIELDS) {
    it(`rejects an invalid type for ${field}`, async () => {
      const res = await PUT(createPutRequest({ ...baseProduct, [field]: invalid }));
      expect(res.status).toBe(400);
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  }

  it("rejects non-numeric releaseYear values", async () => {
    for (const bad of ["2020", true, {}, []]) {
      const res = await PUT(
        createPutRequest({ ...baseProduct, releaseYear: bad })
      );
      expect(res.status, `releaseYear=${JSON.stringify(bad)}`).toBe(400);
    }
  });
});

describe("PUT /api/admin/products — gender accepts all authoritative values", () => {
  for (const gender of ["men", "women", "unisex"]) {
    it(`accepts gender: ${gender} and writes it`, async () => {
      const res = await PUT(createPutRequest({ ...baseProduct, gender }));
      expect(res.status).toBe(200);
      expect(lastSet().gender).toBe(gender);
    });
  }
});

describe("PUT /api/admin/products — URL id is authoritative", () => {
  it("rejects a missing URL id with 400", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct }, null));
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL id with 400 (not 500)", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct }, "not-an-object-id"));
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("ignores a body-supplied id and uses the URL id for filter and payload", async () => {
    const res = await PUT(
      createPutRequest({ ...baseProduct, id: OTHER_ID, gender: "men" }, PRODUCT_ID)
    );
    expect(res.status).toBe(200);
    const { filter, updateDoc } = lastCall();
    expect(filter._id).toBe(PRODUCT_ID);
    expect(updateDoc.$set).not.toHaveProperty("id");
    expect(updateDoc.$set.gender).toBe("men");
  });
});

function lastHelperInput(): { hasVariants?: boolean; variants?: unknown } {
  const call = mockPrepareVariantsForSave.mock.calls.at(-1);
  if (!call) throw new Error("prepareVariantsForSave was not called");
  return call[0];
}

describe("PUT /api/admin/products — variant contract is preserved", () => {
  const submittedVariants = [
    {
      sku: "SKU-1",
      attributes: [
        { attributeId: "507f1f77bcf86cd799439011", value: "100ml" },
      ],
      price: 120000,
      supplierPrice: 90000,
      stock: 3,
      images: [],
      isActive: true,
    },
  ];

  const preparedVariants = [
    {
      sku: "SKU-1",
      attributes: [
        {
          attributeId: "507f1f77bcf86cd799439011",
          name: "حجم",
          value: "100ml",
        },
      ],
      price: 120000,
      supplierPrice: 90000,
      stock: 3,
      images: [],
      isActive: true,
    },
  ];

  function stubPreparedVariants() {
    mockPrepareVariantsForSave.mockResolvedValue({
      ok: true,
      hasVariants: true,
      variants: preparedVariants,
      price: 120000,
      stock: 3,
    } as unknown as Awaited<ReturnType<typeof prepareVariantsForSave>>);
  }

  it("passes the submitted hasVariants/variants to prepareVariantsForSave", async () => {
    stubPreparedVariants();
    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        hasVariants: true,
        variants: submittedVariants,
      })
    );
    expect(res.status).toBe(200);
    const input = lastHelperInput();
    expect(input.hasVariants).toBe(true);
    expect(input.variants).toEqual(submittedVariants);
  });

  it("writes the prepared variant values into $set (never false/[])", async () => {
    stubPreparedVariants();
    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        hasVariants: true,
        variants: submittedVariants,
      })
    );
    expect(res.status).toBe(200);
    const set = lastSet();
    expect(set.hasVariants).toBe(true);
    expect(set.variants).toEqual(preparedVariants);
    expect(set.price).toBe(120000);
    expect(set.stock).toBe(3);
    expect(set.supplierPrice).toBe(0);
  });

  it("preserves variants on a perfume-only edit when hasVariants is supplied", async () => {
    stubPreparedVariants();
    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        hasVariants: true,
        variants: submittedVariants,
        gender: "women",
        topNotes: [],
      })
    );
    expect(res.status).toBe(200);
    const set = lastSet();
    expect(set.hasVariants).toBe(true);
    expect(set.variants).toEqual(preparedVariants);
    expect(set.gender).toBe("women");
    expect(set.topNotes).toEqual([]);
  });

  it("rejects a request that omits both hasVariants and variants", async () => {
    const res = await PUT(
      createPutRequest(bodyWithout("hasVariants", "variants"))
    );
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects variants: [] when hasVariants is omitted", async () => {
    const res = await PUT(
      createPutRequest({ ...bodyWithout("hasVariants"), variants: [] })
    );
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects hasVariants: true with variants omitted", async () => {
    const res = await PUT(
      createPutRequest({ ...bodyWithout("variants"), hasVariants: true })
    );
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects hasVariants: true with an empty variants array", async () => {
    const res = await PUT(
      createPutRequest({ ...baseProduct, hasVariants: true, variants: [] })
    );
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects hasVariants: false with a non-empty variants array", async () => {
    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        hasVariants: false,
        variants: submittedVariants,
      })
    );
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid hasVariants/variants types with 400 and no write", async () => {
    for (const bad of ["true", 1, null, {}, [], "false"]) {
      const res = await PUT(
        createPutRequest({ ...baseProduct, hasVariants: bad })
      );
      expect(res.status, `hasVariants=${JSON.stringify(bad)}`).toBe(400);
    }
    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        hasVariants: true,
        variants: "nope",
      })
    );
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("supports explicit conversion to a simple product (false + [])", async () => {
    const res = await PUT(
      createPutRequest({ ...baseProduct, hasVariants: false, variants: [] })
    );
    expect(res.status).toBe(200);
    const input = lastHelperInput();
    expect(input.hasVariants).toBe(false);
    expect(input.variants).toEqual([]);
    const set = lastSet();
    expect(set.hasVariants).toBe(false);
    expect(set.variants).toEqual([]);
    expect(set.price).toBe(100000);
    expect(set.stock).toBe(10);
    expect(set.supplierPrice).toBe(80000);
  });
});

describe("PUT /api/admin/products — legacy brand compatibility", () => {
  it("accepts brand: null and clears it", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct, brand: null }));
    expect(res.status).toBe(200);
    expect(lastSet().brand).toBeNull();
  });

  it("normalizes brand: \"\" to null", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct, brand: "" }));
    expect(res.status).toBe(200);
    expect(lastSet().brand).toBeNull();
  });

  it("preserves the stored brand when brand is omitted", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct }));
    expect(res.status).toBe(200);
    expect(lastSet()).not.toHaveProperty("brand");
  });

  it("rejects non-string brands with 400 and no write", async () => {
    for (const bad of [123, {}, [], true]) {
      const res = await PUT(createPutRequest({ ...baseProduct, brand: bad }));
      expect(res.status, `brand=${JSON.stringify(bad)}`).toBe(400);
    }
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

const NUMERIC_CASES = [
  { field: "price", value: 100000, numericString: "100000" },
  { field: "supplierPrice", value: 80000, numericString: "80000" },
  { field: "stock", value: 10, numericString: "10" },
] as const;

describe("PUT /api/admin/products — legacy numeric compatibility", () => {
  for (const { field, value, numericString } of NUMERIC_CASES) {
    it(`accepts ${field} as a number`, async () => {
      const res = await PUT(
        createPutRequest({ ...baseProduct, [field]: value })
      );
      expect(res.status).toBe(200);
      expect(lastSet()[field]).toBe(value);
    });

    it(`converts a valid numeric string for ${field}`, async () => {
      const res = await PUT(
        createPutRequest({ ...baseProduct, [field]: numericString })
      );
      expect(res.status).toBe(200);
      const stored = lastSet()[field];
      expect(stored).toBe(value);
      expect(typeof stored).toBe("number");
    });

    it(`preserves ${field} when omitted`, async () => {
      const res = await PUT(createPutRequest(bodyWithout(field)));
      expect(res.status).toBe(200);
      expect(lastSet()).not.toHaveProperty(field);
    });

    it(`rejects empty/null/invalid values for ${field}`, async () => {
      for (const bad of ["", null, "12abc", "NaN", "Infinity", " ", "0x10"]) {
        const res = await PUT(
          createPutRequest({ ...baseProduct, [field]: bad })
        );
        expect(res.status, `${field}=${JSON.stringify(bad)}`).toBe(400);
      }
      for (const bad of [-1, "-1"]) {
        const res = await PUT(
          createPutRequest({ ...baseProduct, [field]: bad })
        );
        expect(res.status, `${field}=${JSON.stringify(bad)}`).toBe(400);
      }
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });
  }

  it("rejects fractional stock values", async () => {
    for (const bad of [5.5, "5.5"]) {
      const res = await PUT(createPutRequest({ ...baseProduct, stock: bad }));
      expect(res.status, `stock=${JSON.stringify(bad)}`).toBe(400);
    }
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/products — legacy isActive compatibility", () => {
  const accepted: Array<[unknown, boolean]> = [
    [true, true],
    [false, false],
    ["true", true],
    ["false", false],
  ];

  for (const [input, expected] of accepted) {
    it(`accepts isActive=${JSON.stringify(input)} as ${expected}`, async () => {
      const res = await PUT(
        createPutRequest({ ...baseProduct, isActive: input })
      );
      expect(res.status).toBe(200);
      expect(lastSet().isActive).toBe(expected);
    });
  }

  it("rejects other spellings, numbers and null with 400 and no write", async () => {
    for (const bad of ["yes", "no", "1", "0", "TRUE", "False", 1, 0, null]) {
      const res = await PUT(
        createPutRequest({ ...baseProduct, isActive: bad })
      );
      expect(res.status, `isActive=${JSON.stringify(bad)}`).toBe(400);
    }
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/products — legacy slug compatibility", () => {
  it("regenerates the slug from the name when slug is null", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct, slug: null }));
    expect(res.status).toBe(200);
    expect(lastSet().slug).toBe("test-slug");
  });

  it("regenerates the slug when slug is an empty string", async () => {
    const res = await PUT(createPutRequest({ ...baseProduct, slug: "" }));
    expect(res.status).toBe(200);
    expect(lastSet().slug).toBe("test-slug");
  });

  it("regenerates the slug when slug is omitted", async () => {
    const res = await PUT(createPutRequest(bodyWithout("slug")));
    expect(res.status).toBe(200);
    expect(lastSet().slug).toBe("test-slug");
  });

  it("keeps an explicit valid slug", async () => {
    const res = await PUT(
      createPutRequest({ ...baseProduct, slug: "my-slug" })
    );
    expect(res.status).toBe(200);
    expect(lastSet().slug).toBe("my-slug");
  });

  it("rejects non-string slugs with 400 and no write", async () => {
    for (const bad of [123, {}, [], true]) {
      const res = await PUT(createPutRequest({ ...baseProduct, slug: bad }));
      expect(res.status, `slug=${JSON.stringify(bad)}`).toBe(400);
    }
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("Product model schema — 14 perfume paths", () => {
  it("defines all 14 paths with the correct types and no implicit defaults", async () => {
    const mod = await vi.importActual<{ default: { schema: any } }>(
      "@/models/Product"
    );
    const schema = mod.default.schema;

    for (const field of ALL_FIELDS) {
      const path = schema.path(field);
      expect(path, `${field} path must exist`).toBeTruthy();
      expect(
        path.options.default,
        `${field} must not define a default`
      ).toBeUndefined();
    }

    for (const { field, values } of ENUM_FIELDS) {
      const path = schema.path(field);
      const actual: string[] =
        path.enumValues ?? path.caster?.enumValues ?? [];
      expect(actual, `${field} enum values`).toEqual(
        expect.arrayContaining([...values])
      );
      expect(actual).toHaveLength(values.length);
    }

    for (const { field } of ARRAY_FIELDS) {
      expect(schema.path(field).instance, `${field} must be an array`).toBe(
        "Array"
      );
      const actual: string[] =
        schema.path(field).caster?.enumValues ??
        schema.path(field).enumValues ??
        [];
      const expected = ENUM_FIELDS.find((e) => e.field === field);
      if (expected) {
        expect(actual).toEqual(expect.arrayContaining(expected.values));
      }
    }

    expect(schema.path("releaseYear").instance).toBe("Number");
    expect(schema.path("countryOfOrigin").instance).toBe("String");
    expect(schema.path("barcode").instance).toBe("String");
  });

  it("accepts null for every field and rejects invalid enum values", async () => {
    const mod = await vi.importActual<{ default: any }>("@/models/Product");
    const Model = mod.default;

    for (const field of ALL_FIELDS) {
      const doc = new Model({ [field]: null });
      expect(doc.validateSync([field]), `${field} must accept null`).toBeUndefined();
    }

    for (const { field, values } of ENUM_FIELDS) {
      const invalid = new Model({ [field]: "not-a-valid-value" });
      expect(
        invalid.validateSync([field]),
        `${field} must reject invalid enum values`
      ).toBeTruthy();
      for (const value of values) {
        const valid = new Model({ [field]: value });
        expect(
          valid.validateSync([field]),
          `${field}=${value} must validate`
        ).toBeUndefined();
      }
    }

    for (const { field } of ARRAY_FIELDS) {
      const invalid = new Model({ [field]: [123] });
      // String arrays cast 123 -> "123"; season/occasion must reject it.
      const err = invalid.validateSync([field]);
      if (field === "season" || field === "occasion") {
        expect(err, `${field} must reject unknown members`).toBeTruthy();
      }
    }

    const empty = new Model({});
    for (const field of ALL_FIELDS) {
      expect(empty[field], `${field} must have no implicit default`).toBeUndefined();
    }
  });
});
/**
 * Discount validation base price — the PUT contract must validate against the
 * right base for every shape of request, WITHOUT assuming the body carries a
 * price and WITHOUT weakening the price-stamp CAS.
 *
 * The regression file keeps the REAL product-price-cas module (only the
 * snapshot reader + driver are stubbed), so these tests exercise the actual
 * `$set` that reaches `findOneAndUpdate`.
 */
describe("PUT /api/admin/products — discount base price", () => {
  const STORED_PRICE = 250000;

  /** Stub the CAS reader with a persisted price/revision + a token. */
  function withStoredPrice(price: number, discount: unknown = null) {
    (createProductPriceSnapshotReader as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation(() => async () => ({
        token: 7,
        revision: {
          price,
          hasVariants: false,
          variants: [],
          discount,
        },
      }));
  }

  it("omitted price + valid discount validates against the PERSISTED price", async () => {
    withStoredPrice(STORED_PRICE);
    mockParseProductDiscount.mockReturnValue({
      ok: true,
      value: {
        type: "fixed",
        value: 50000,
        startsAt: null,
        endsAt: null,
        isActive: true,
      },
    });

    const res = await PUT(
      createPutRequest({
        ...bodyWithout("price"),
        discount: { type: "fixed", value: 50000 },
      })
    );

    expect(res.status).toBe(200);
    // The base passed to validation is the snapshot's persisted price — never
    // `undefined`, never a body field that was omitted.
    expect(mockParseProductDiscount).toHaveBeenCalledWith(
      { type: "fixed", value: 50000 },
      STORED_PRICE
    );
    // And the product's stored price is NOT overwritten by the omission.
    expect(lastSet()).not.toHaveProperty("price");
    expect(lastSet().discount).toEqual({
      type: "fixed",
      value: 50000,
      startsAt: null,
      endsAt: null,
      isActive: true,
    });
  });

  it("omitted price + INVALID discount returns 400 and never writes", async () => {
    withStoredPrice(STORED_PRICE);
    mockParseProductDiscount.mockReturnValue({
      ok: false,
      error: "مبلغ تخفیف باید کمتر از قیمت محصول باشد",
    });

    const res = await PUT(
      createPutRequest({
        ...bodyWithout("price"),
        discount: { type: "fixed", value: 999999 },
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "مبلغ تخفیف باید کمتر از قیمت محصول باشد",
    });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("submitted price + discount validates against the SUBMITTED price", async () => {
    withStoredPrice(STORED_PRICE);
    mockParseProductDiscount.mockReturnValue({
      ok: true,
      value: {
        type: "percent",
        value: 10,
        startsAt: null,
        endsAt: null,
        isActive: true,
      },
    });

    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        price: 400000,
        discount: { type: "percent", value: 10 },
      })
    );

    expect(res.status).toBe(200);
    // The submitted (Zod-validated) price wins over the persisted one.
    expect(mockParseProductDiscount).toHaveBeenCalledWith(
      { type: "percent", value: 10 },
      400000
    );
    expect(lastSet().price).toBe(400000);
    expect(lastSet().discount).toEqual({
      type: "percent",
      value: 10,
      startsAt: null,
      endsAt: null,
      isActive: true,
    });
  });

  it("variant product validates against the prepared variant price", async () => {
    withStoredPrice(STORED_PRICE);
    mockPrepareVariantsForSave.mockResolvedValue({
      ok: true,
      hasVariants: true,
      variants: [
        {
          sku: "SKU-1",
          price: 900000,
          isActive: true,
          attributes: [] as Array<{ attributeId: string; value: string }>,
          supplierPrice: 800000,
          stock: 5,
        },
      ],
      price: 900000,
      stock: 5,
    });
    mockParseProductDiscount.mockReturnValue({
      ok: true,
      value: {
        type: "percent",
        value: 15,
        startsAt: null,
        endsAt: null,
        isActive: true,
      },
    });

    const res = await PUT(
      createPutRequest({
        ...baseProduct,
        hasVariants: true,
        variants: [{ sku: "SKU-1", price: 900000, isActive: true }],
        discount: { type: "percent", value: 15 },
      })
    );

    expect(res.status).toBe(200);
    // Variant products ALWAYS use the prepared effective price, even when the
    // body also carries a `price` field.
    expect(mockParseProductDiscount).toHaveBeenCalledWith(
      { type: "percent", value: 15 },
      900000
    );
  });

  it("omitted discount preserves the stored discount and skips validation", async () => {
    const storedDiscount = {
      type: "percent" as const,
      value: 20,
      startsAt: null,
      endsAt: null,
      isActive: true,
    };
    withStoredPrice(STORED_PRICE, storedDiscount);

    const res = await PUT(createPutRequest({ ...baseProduct }));

    expect(res.status).toBe(200);
    // No needless re-validation of a discount the client did not send.
    expect(mockParseProductDiscount).not.toHaveBeenCalled();
    expect(lastSet()).not.toHaveProperty("discount");
  });

  it("explicit null discount clears the stored discount", async () => {
    withStoredPrice(STORED_PRICE, {
      type: "percent",
      value: 20,
      startsAt: null,
      endsAt: null,
      isActive: true,
    });
    mockParseProductDiscount.mockReturnValue({ ok: true, value: null });

    const res = await PUT(
      createPutRequest({ ...baseProduct, discount: null })
    );

    expect(res.status).toBe(200);
    expect(mockParseProductDiscount).toHaveBeenCalledWith(null, 100000);
    expect(lastSet().discount).toBeNull();
  });
});
