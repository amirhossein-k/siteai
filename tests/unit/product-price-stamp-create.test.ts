/**
 * Session 93 — CREATION-TIME price stamp at the WRITE boundaries.
 *
 * `initialPriceStampFields` (its own contract is pinned in
 * tests/unit/product-price-audit.test.ts) must actually be WIRED into every
 * create path, otherwise a product is born "never priced" and the public detail
 * page renders no indicator until the first edit:
 *   1. POST /api/admin/products
 *   2. POST /api/supplier/products
 *   3. the CSV import executor (shared by the admin + supplier import routes)
 *
 * Seams mirror tests/unit/products-rating-api.test.ts / checkout-gateway-rollback:
 * model + auth modules are mocked; the PURE libraries (product-slug,
 * product-pricing, product-description, product-price-audit) stay REAL so the
 * assertions are made against the real create payload the routes build.
 *
 * No DB, no network, deterministic (the stamp is asserted to be a Date close to
 * now, which is the actual contract).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  requireRoleOrError: vi.fn(),
  rateLimit: vi.fn(),
  productCreate: vi.fn(),
  productFindById: vi.fn(),
  productFind: vi.fn(),
  productCountDocuments: vi.fn(),
  productFindOne: vi.fn(),
  productFindOneAndUpdate: vi.fn(),
  productExists: vi.fn(),
  supplierFindOne: vi.fn(),
  categoryFind: vi.fn(),
  brandFind: vi.fn(),
  tagFind: vi.fn(),
  prepareVariantsForSave: vi.fn(),
  assertNoDirectStockChange: vi.fn(),
}));

vi.mock("@/lib/dbConnect", () => ({ dbConnect: mocks.dbConnect }));

vi.mock("@/lib/auth-utils", async () => {
  const { NextResponse: NR } = await import("next/server");
  return {
    requireRoleOrError: mocks.requireRoleOrError,
    serverError: async () => NR.json({ error: "خطای سرور" }, { status: 500 }),
  };
});

vi.mock("@/lib/rate-limiter", () => ({
  rateLimit: mocks.rateLimit,
  IMPORT_LIMIT: { max: 20, windowMs: 15 * 60 * 1000 },
}));

// The variant preparer is the only DB-touching collaborator of the create path;
// for simple (non-variant) products it is a pure passthrough — mocked so the
// Attribute collection is never touched.
vi.mock("@/lib/product-variants", () => ({
  prepareVariantsForSave: mocks.prepareVariantsForSave,
  recomputeVariantSummary: () => ({ price: 0, stock: 0 }),
}));

// Admin PUT-only guard; the create path never calls it (module-level import).
vi.mock("@/lib/inventory-adjustments", () => ({
  assertNoDirectStockChange: mocks.assertNoDirectStockChange,
}));

vi.mock("@/models/Product", () => ({
  default: {
    create: mocks.productCreate,
    findById: mocks.productFindById,
    find: mocks.productFind,
    countDocuments: mocks.productCountDocuments,
    findOne: mocks.productFindOne,
    findOneAndUpdate: mocks.productFindOneAndUpdate,
    exists: mocks.productExists,
  },
}));

vi.mock("@/models/Supplier", () => ({ default: { findOne: mocks.supplierFindOne } }));
vi.mock("@/models/Category", () => ({ default: { find: mocks.categoryFind } }));
vi.mock("@/models/Brand", () => ({ default: { find: mocks.brandFind } }));
vi.mock("@/models/Tag", () => ({ default: { find: mocks.tagFind } }));

import { POST as adminPost } from "@/app/api/admin/products/route";
import { POST as supplierPost } from "@/app/api/supplier/products/route";
import { executeProductImport } from "@/lib/product-import";

const SUPPLIER_ID = "6aaab0a2351255a9fdea5501";
const CATEGORY_ID = "6aaab0a2351255a9fdea5502";

/** Chainable `.populate().lean()` mock mirroring the routes' read-back shape. */
function leanChain(doc: unknown) {
  const chain: Record<string, unknown> = {};
  chain.populate = vi.fn(() => chain);
  chain.lean = vi.fn().mockResolvedValue(doc);
  return chain;
}

function reqWith(body: unknown): Parameters<typeof adminPost>[0] {
  return {
    url: "http://localhost:3000/api/products",
    json: async () => body,
  } as unknown as Parameters<typeof adminPost>[0];
}

/** A valid simple-product body (admin + supplier share the field names). */
function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "کالای تست",
    slug: "stamp-create-item",
    description: "توضیح",
    images: [],
    brand: null,
    tags: [],
    category: CATEGORY_ID,
    supplier: SUPPLIER_ID,
    supplierPrice: 400000,
    price: 1000000,
    stock: 5,
    hasVariants: false,
    variants: [],
    isActive: true,
    ...overrides,
  };
}

/** The payload the LAST Product.create call received. */
function lastCreatePayload(): Record<string, unknown> {
  const calls = mocks.productCreate.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbConnect.mockResolvedValue(undefined);
  mocks.requireRoleOrError.mockResolvedValue({
    token: { id: "6aaab0a2351255a9fdea5a01", role: "admin", name: "مدیر", phone: "09120000000" },
    error: null,
  });
  mocks.rateLimit.mockResolvedValue({ limited: false, remaining: 19, resetInMs: 0, headers: {} });
  mocks.prepareVariantsForSave.mockResolvedValue({
    ok: true,
    hasVariants: false,
    variants: [],
    price: 0,
    stock: 0,
  });
  mocks.productCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    ...doc,
    _id: "6aaab0a2351255a9fdea5b01",
  }));
  mocks.productFindById.mockReturnValue(
    leanChain({ _id: "6aaab0a2351255a9fdea5b01", name: "کالای تست" })
  );
  mocks.supplierFindOne.mockResolvedValue({ _id: SUPPLIER_ID });
});

describe("POST /api/admin/products — creation-time stamp", () => {
  it("stamps priceLastUpdatedAt with a real Date and never sets priceVersion", async () => {
    const before = Date.now();
    const res = await adminPost(reqWith(productBody()));
    const after = Date.now();

    expect(res.status).toBe(201);
    const payload = lastCreatePayload();
    expect(payload.priceLastUpdatedAt).toBeInstanceOf(Date);
    const t = (payload.priceLastUpdatedAt as Date).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
    // The CAS token stays the schema default 0 = "no pricing WRITE yet".
    expect("priceVersion" in payload).toBe(false);
  });

  it("keeps the creation stamp in the payload alongside the validated discount", async () => {
    await adminPost(
      reqWith(productBody({ discount: { type: "percent", value: 20, isActive: true } }))
    );
    const payload = lastCreatePayload();
    expect(payload.priceLastUpdatedAt).toBeInstanceOf(Date);
    expect(payload.discount).toMatchObject({ type: "percent", value: 20 });
  });
});

describe("POST /api/supplier/products — creation-time stamp", () => {
  it("stamps the creation instant and forces ownership to the caller's supplier", async () => {
    mocks.requireRoleOrError.mockResolvedValue({
      token: {
        id: "6aaab0a2351255a9fdea5a02",
        role: "supplier",
        name: "فروشنده",
        phone: "09120000001",
      },
      error: null,
    });
    const res = await supplierPost(reqWith(productBody({ supplier: undefined })));

    expect(res.status).toBe(201);
    const payload = lastCreatePayload();
    expect(payload.priceLastUpdatedAt).toBeInstanceOf(Date);
    expect(payload.supplier).toBe(SUPPLIER_ID);
    expect("priceVersion" in payload).toBe(false);
  });
});

describe("CSV import — creation-time stamp", () => {
  function importChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.lean = vi.fn().mockResolvedValue(rows);
    return chain;
  }

  const CSV = [
    "name,slug,description,price,supplierPrice,stock,category,brand,tags,images,isActive,supplier",
    "کتاب تست,csv-stamp-book,توضیح,۵۰۰۰۰,40000,3,کتاب,,,img1.jpg,1,تامین",
  ].join("\n");

  beforeEach(() => {
    mocks.categoryFind.mockReturnValue(importChain([{ _id: CATEGORY_ID, name: "کتاب" }]));
    mocks.brandFind.mockReturnValue(importChain([]));
    mocks.tagFind.mockReturnValue(importChain([]));
    // Pre-scan of existing slugs returns none → the row is created.
    mocks.productFind.mockReturnValue({ distinct: vi.fn().mockResolvedValue([]) });
  });

  it("stamps every imported row (the same contract as the POST APIs)", async () => {
    const before = Date.now();
    const result = await executeProductImport(CSV, SUPPLIER_ID);
    const after = Date.now();

    expect(result.report?.created).toBe(1);
    const payload = lastCreatePayload();
    expect(payload.priceLastUpdatedAt).toBeInstanceOf(Date);
    const t = (payload.priceLastUpdatedAt as Date).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
    expect("priceVersion" in payload).toBe(false);
  });

  it("does not create (and therefore does not stamp) a row whose slug already exists", async () => {
    mocks.productFind.mockReturnValue({
      distinct: vi.fn().mockResolvedValue(["csv-stamp-book"]),
    });

    const result = await executeProductImport(CSV, SUPPLIER_ID);
    expect(result.report?.skipped).toBe(1);
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });
});
