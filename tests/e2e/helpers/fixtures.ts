import fs from "fs";
import path from "path";
import type { APIRequestContext } from "@playwright/test";

/**
 * E2E fixtures — PREFIX'd test-data seeding through the REAL public + admin
 * APIs (never direct DB writes for creation; the DB helper is used only for
 * cleanup). Mirrors how the 33 regression suites seed their fixtures.
 *
 * PREFIX convention: `e2e_<unixMs>_` on names/slugs/SKUs, and `E2E_<unixMs>_`
 * on coupon codes (they are uppercased+trimmed by the server). Fixed Iranian
 * phone numbers (11 digits, `09...`) for the three roles so login works.
 */

export const ADMIN_PHONE = "09120000000";
export const ADMIN_PASSWORD = "admin123456";
export const E2E_PASSWORD = "e2e-pass-123";

export interface E2EState {
  prefix: string;
  baseURL: string;
  supplierId: string;
  supplierUserId: string;
  customerId: string;
  supplierPhone: string;
  customerPhone: string;
  adminStatePath: string;
  supplierStatePath: string;
  customerStatePath: string;
}

const STATE_FILE = path.resolve(process.cwd(), "tests/e2e/.auth/state.json");

/** Read the per-run state written by global-setup. */
export function getState(): E2EState {
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  return JSON.parse(raw) as E2EState;
}

export function makePrefix(): string {
  return `e2e_${Date.now()}_`;
}

/**
 * API assertion helper — fail with the response body on non-2xx.
 *
 * Accepts BOTH Playwright APIResponse (`.status()` method) and Node fetch
 * Response (`.status` property) so fixture seeding can use either client.
 */
export async function expectOk(
  res: { status(): number; text(): Promise<string> } | { status: number; text(): Promise<string> },
  label: string
): Promise<void> {
  const code = typeof res.status === "function" ? res.status() : res.status;
  if (code >= 200 && code < 300) return;
  const body = await res.text();
  throw new Error(`${label} → ${code}: ${body.slice(0, 300)}`);
}

/**
 * Create a category via the admin API. IDEMPOTENT: if a category with the
 * same slug already exists (e.g. the describe `beforeAll` re-ran after a
 * failed sibling test in the same run), the existing row is reused instead
 * of failing with 409 — fixtures must never leave partial state behind.
 */
export async function createCategory(
  admin: APIRequestContext,
  prefix: string,
  index = 1
): Promise<string> {
  const slug = `${prefix}cat-${index}`;
  const res = await admin.post("/api/admin/categories", {
    data: { name: `دسته E2E ${prefix}${index}`, slug, isActive: true },
  });
  const code =
    typeof res.status === "function" ? res.status() : (res as never as { status: number }).status;
  if (code >= 200 && code < 300) {
    const body = (await res.json()) as { _id: string };
    return body._id;
  }
  if (code === 409) {
    const existing = await admin.get("/api/admin/categories?all=true");
    await expectOk(existing, "listCategories");
    const rows = (await existing.json()) as Array<{ _id: string; slug: string }>;
    const found = rows.find((r) => r.slug === slug);
    if (found) return found._id;
  }
  const body = await res.text();
  throw new Error(`createCategory → ${code}: ${body.slice(0, 300)}`);
}

export interface ProductSeed {
  slug: string;
  name: string;
  categoryId: string;
  supplierId: string;
  price: number;
  supplierPrice: number;
  stock: number;
}

/**
 * Create a product via the admin API. IDEMPOTENT: if a product with the same
 * slug already exists (e.g. a re-ran `beforeAll`), the existing row is reused
 * instead of failing — fixtures must never leave partial state behind.
 */
export async function createProduct(
  admin: APIRequestContext,
  seed: ProductSeed
): Promise<string> {
  const res = await admin.post("/api/admin/products", {
    data: {
      name: seed.name,
      slug: seed.slug,
      description: "محصول E2E — حذف میشود",
      images: [],
      category: seed.categoryId,
      supplier: seed.supplierId,
      supplierPrice: seed.supplierPrice,
      price: seed.price,
      stock: seed.stock,
      hasVariants: false,
      variants: [],
      isActive: true,
    },
  });
  const code =
    typeof res.status === "function" ? res.status() : (res as never as { status: number }).status;
  if (code >= 200 && code < 300) {
    const body = (await res.json()) as { _id: string };
    return body._id;
  }
  if (code === 409) {
    // Duplicate slug (auto-unique append would be wrong for idempotency):
    // reuse the existing product by exact slug.
    const existing = await admin.get(
      `/api/admin/products?search=${encodeURIComponent(seed.slug)}&limit=50`
    );
    await expectOk(existing, "listProducts");
    const body = (await existing.json()) as {
      products?: Array<{ _id: string; slug: string }>;
      items?: Array<{ _id: string; slug: string }>;
      data?: Array<{ _id: string; slug: string }>;
    };
    const rows = body.products ?? body.items ?? body.data ?? [];
    const found = rows.find((r) => r.slug === seed.slug);
    if (found) return found._id;
  }
  const body = await res.text();
  throw new Error(`createProduct → ${code}: ${body.slice(0, 300)}`);
}

/**
 * Create an Attribute then a 2-variant product (for the variant journey).
 * IDEMPOTENT: if the attribute or the product already exists (e.g. the describe
 * `beforeAll` re-ran after a failed sibling test on retry), the existing
 * exact-slug rows are reused instead of failing with 409 — same convention as
 * createCategory/createProduct above: fixtures must never leave partial state
 * behind.
 */
export async function createVariantProduct(
  admin: APIRequestContext,
  seed: ProductSeed & { values: [string, string] }
): Promise<{ productId: string; attributeId: string; variantIds: string[] }> {
  const attrSlug = `${seed.slug}-attr`;
  const attrRes = await admin.post("/api/admin/attributes", {
    data: {
      name: `ویژگی ${seed.name}`,
      slug: attrSlug,
      type: "text",
      values: seed.values,
      isActive: true,
    },
  });
  const attrCode =
    typeof attrRes.status === "function" ? attrRes.status() : (attrRes as never as { status: number }).status;
  let attrId: string;
  if (attrCode >= 200 && attrCode < 300) {
    const attr = (await attrRes.json()) as { _id: string };
    attrId = attr._id;
  } else if (attrCode === 409) {
    // Duplicate slug (the admin attributes endpoint is a bare array):
    // reuse the existing attribute by exact slug.
    const existing = await admin.get("/api/admin/attributes");
    await expectOk(existing, "listAttributes");
    const rows = (await existing.json()) as Array<{ _id: string; slug: string }>;
    const found = rows.find((r) => r.slug === attrSlug);
    if (found) {
      attrId = found._id;
    } else {
      const body = await attrRes.text();
      throw new Error(`createAttribute → ${attrCode}: ${body.slice(0, 300)}`);
    }
  } else {
    const body = await attrRes.text();
    throw new Error(`createAttribute → ${attrCode}: ${body.slice(0, 300)}`);
  }

  const variants = seed.values.map((value, i) => ({
    sku: `${seed.slug.toUpperCase()}-SKU${i + 1}`,
    attributes: [{ attributeId: attrId, name: "اندازه", value }],
    price: seed.price + i * 10_000,
    supplierPrice: seed.supplierPrice + i * 10_000,
    stock: seed.stock,
    images: [],
    isActive: true,
  }));

  const res = await admin.post("/api/admin/products", {
    data: {
      name: seed.name,
      slug: seed.slug,
      description: "محصول تنوعدار E2E",
      images: [],
      category: seed.categoryId,
      supplier: seed.supplierId,
      supplierPrice: 0,
      price: 0,
      stock: 0,
      hasVariants: true,
      variants,
      isActive: true,
    },
  });
  const code =
    typeof res.status === "function" ? res.status() : (res as never as { status: number }).status;
  if (code >= 200 && code < 300) {
    const body = (await res.json()) as { _id: string; variants: Array<{ _id: string }> };
    return {
      productId: body._id,
      attributeId: attrId,
      variantIds: body.variants.map((v) => v._id),
    };
  }
  if (code === 409) {
    // Duplicate slug: reuse the existing product by exact slug. The admin list
    // returns full documents, including the embedded variant _ids, so the
    // return contract is preserved.
    const existing = await admin.get(
      `/api/admin/products?search=${encodeURIComponent(seed.slug)}&limit=50`
    );
    await expectOk(existing, "listProducts");
    const body = (await existing.json()) as {
      products?: Array<{ _id: string; slug: string; variants?: Array<{ _id: string }> }>;
      items?: Array<{ _id: string; slug: string; variants?: Array<{ _id: string }> }>;
      data?: Array<{ _id: string; slug: string; variants?: Array<{ _id: string }> }>;
    };
    const rows = body.products ?? body.items ?? body.data ?? [];
    const found = rows.find((r) => r.slug === seed.slug);
    if (found && found.variants?.length) {
      return {
        productId: found._id,
        attributeId: attrId,
        variantIds: found.variants.map((v) => v._id),
      };
    }
  }
  const body = await res.text();
  throw new Error(`createVariantProduct → ${code}: ${body.slice(0, 300)}`);
}

export interface CouponSeed {
  code: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotal: number;
  maxDiscount?: number;
  /** Default false (not shown in the public picker) — eligibility is still public. */
  isPublic?: boolean;
}

export async function createCoupon(
  admin: APIRequestContext,
  seed: CouponSeed
): Promise<string> {
  const res = await admin.post("/api/admin/coupons", {
    data: {
      code: seed.code,
      type: seed.type,
      value: seed.value,
      minSubtotal: seed.minSubtotal,
      maxDiscount: seed.maxDiscount ?? 0,
      isActive: true,
      isPublic: seed.isPublic ?? false,
      usageLimit: 0,
      perUserLimit: 0,
    },
  });
  await expectOk(res, "createCoupon");
  const body = (await res.json()) as { _id: string };
  return body._id;
}

export interface CheckoutItem {
  id: string;
  quantity: number;
  price: number;
  name: string;
}

export interface PlaceOrderInput {
  customer: APIRequestContext;
  items: CheckoutItem[];
  paymentMethod?: "manual" | "zarinpal";
  couponCode?: string;
}

/** Place an order through the real checkout API; returns the order id. */
export async function placeOrder(
  input: PlaceOrderInput
): Promise<{ orderId: string; paymentUrl?: string }> {
  const res = await input.customer.post("/api/checkout", {
    data: {
      items: input.items,
      shippingAddress: {
        fullName: "مشتری E2E",
        phone: getState().customerPhone,
        address: "تهران، خیابان E2E، پلاک ۱",
        postalCode: "1234567890",
      },
      paymentMethod: input.paymentMethod ?? "manual",
      couponCode: input.couponCode,
    },
  });
  await expectOk(res, "placeOrder");
  const body = (await res.json()) as {
    orderId: string;
    paymentUrl?: string;
  };
  return body;
}
