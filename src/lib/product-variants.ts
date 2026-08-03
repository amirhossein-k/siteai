/**
 * Product Variants — shared validation & summary helpers.
 *
 * Used by admin + supplier product APIs so variant validation and the
 * price/stock summary recomputation stay consistent everywhere.
 */

import mongoose from "mongoose";
import Attribute from "@/models/Attribute";
import Product from "@/models/Product";
import { sanitizePlainText } from "@/lib/sanitize";

/** Maximum reasonable number of variants per product */
export const MAX_VARIANTS = 200;

/**
 * Recompute the top-level product summary from its variants:
 *   price = min(active variant price)
 *   stock = sum(active variant stock)
 *
 * For simple products (variants empty) this is not used — the route keeps
 * the user-provided price/stock.
 */
export function recomputeVariantSummary(
  variants: Array<{
    isActive?: boolean;
    price: number;
    stock?: number;
  }>
): { price: number; stock: number } {
  const active = variants.filter((v) => v.isActive !== false);
  if (active.length === 0) return { price: 0, stock: 0 };
  const price = Math.min(...active.map((v) => v.price));
  const stock = active.reduce((sum, v) => sum + (v.stock || 0), 0);
  return { price, stock };
}

export interface VariantAttributeInput {
  attributeId: string;
  value: string;
}

export interface VariantInput {
  sku: string;
  attributes: VariantAttributeInput[];
  price: number;
  supplierPrice: number;
  stock: number;
  images?: string[];
  isActive?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  status?: number;
  variants?: VariantInput[];
}

/**
 * Full server-side prepare step for a variant product save.
 *
 * 1. If `hasVariants` is falsy -> returns { hasVariants: false, variants: [] }
 *    (simple product; route keeps user-provided price/stock).
 * 2. If `hasVariants` is truthy -> fetches the referenced Attribute docs,
 *    validates the variant list (ids, values, SKU uniqueness, duplicate
 *    combos, max count, at least one active), denormalizes attribute names,
 *    and recomputes the product summary { price, stock }.
 *
 * Returns { ok: false, error, status } on failure.
 *
 * @param excludeProductId — when updating an existing product, pass its id so
 *   the global SKU uniqueness pre-check does not flag the product's own SKUs.
 */
export async function prepareVariantsForSave(
  body: {
    hasVariants?: boolean;
    variants?: unknown;
  },
  excludeProductId?: string
): Promise<
  | { ok: true; hasVariants: boolean; variants: VariantInput[]; price: number; stock: number }
  | { ok: false; error: string; status: number }
> {
  const hasVariants = body.hasVariants === true;

  if (!hasVariants) {
    return { ok: true, hasVariants: false, variants: [], price: 0, stock: 0 };
  }

  const rawVariants = Array.isArray(body.variants) ? body.variants : [];
  if (rawVariants.length === 0) {
    return {
      ok: false,
      error: "برای محصول دارای تنوع، حداقل یک تنوع لازم است",
      status: 400,
    };
  }

  // Collect all attribute ids referenced by the variants (single query, no N+1)
  const attributeIds = Array.from(
    new Set(
      rawVariants.flatMap((v: { attributes?: Array<{ attributeId?: string }> }) =>
        (v.attributes || [])
          .map((a) => String(a.attributeId || ""))
          .filter((id) => mongoose.isValidObjectId(id))
      )
    )
  );

  const attributes =
    attributeIds.length > 0
      ? await Attribute.find({ _id: { $in: attributeIds } }).lean()
      : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attributesMap = new Map<string, { name: string; values: string[] }>();
  for (const attr of attributes as unknown as Array<{
    _id: unknown;
    name: string;
    values?: string[];
  }>) {
    attributesMap.set(String(attr._id), {
      name: attr.name,
      values: attr.values || [],
    });
  }

  const validation = validateVariants(rawVariants, attributesMap);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error || "ساختار تنوع نامعتبر است",
      status: validation.status || 400,
    };
  }

  // Denormalize attribute names from the Attribute collection (authoritative),
  // sanitize user-controlled text (SKU + attribute values), normalize SKU case.
  const variants: VariantInput[] = (validation.variants || []).map((v) => ({
    ...v,
    sku: sanitizePlainText(String(v.sku || "").trim().toUpperCase()),
    attributes: v.attributes.map((a) => {
      const def = attributesMap.get(a.attributeId);
      return {
        attributeId: a.attributeId,
        name: def?.name || "",
        value: sanitizePlainText(String(a.value).trim()),
      };
    }),
  }));

  // Global SKU uniqueness pre-check — friendly 409 instead of a raw E11000 500.
  // (The sparse unique index on variants.sku remains the final race guard.)
  const skus = variants.map((v) => v.sku).filter(Boolean);
  if (skus.length > 0) {
    const skuFilter: Record<string, unknown> = { "variants.sku": { $in: skus } };
    if (excludeProductId && mongoose.isValidObjectId(excludeProductId)) {
      skuFilter._id = { $ne: excludeProductId };
    }
    const conflicting = await Product.exists(skuFilter);
    if (conflicting) {
      return {
        ok: false,
        error: "یکی از کدهای SKU قبلاً در محصول دیگری استفاده شده است",
        status: 409,
      };
    }
  }

  const summary = recomputeVariantSummary(variants);
  return { ok: true, hasVariants: true, variants, ...summary };
}

/**
 * Validate a raw variants array from the request body.
 * Checks:
 *  - array present, non-empty, <= MAX_VARIANTS
 *  - at least one active variant
 *  - SKU present + unique within the request
 *  - attributes non-empty; attributeId valid + provided in attributesMap
 *  - price/supplierPrice >= 0; stock >= 0 integer
 *  - duplicate attribute combinations rejected
 *
 * `attributesMap` maps attributeId -> { name, values } and is built by the
 * caller (single query) so we never N+1.
 */
export function validateVariants(
  variants: unknown,
  attributesMap: Map<string, { name: string; values: string[] }>
): ValidationResult {
  if (!Array.isArray(variants) || variants.length === 0) {
    return {
      ok: false,
      error: "برای محصول دارای تنوع، حداقل یک تنوع لازم است",
      status: 400,
    };
  }

  if (variants.length > MAX_VARIANTS) {
    return {
      ok: false,
      error: `حداکثر ${MAX_VARIANTS} تنوع مجاز است`,
      status: 400,
    };
  }

  const seenSkus = new Set<string>();
  const seenCombos = new Set<string>();

  for (const raw of variants) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "ساختار تنوع نامعتبر است", status: 400 };
    }

    const sku = String(raw.sku || "").trim().toUpperCase();
    if (!sku) {
      return { ok: false, error: "کد SKU برای هر تنوع الزامی است", status: 400 };
    }
    if (seenSkus.has(sku)) {
      return {
        ok: false,
        error: `کد SKU تکراری در تنوع‌ها: ${sku}`,
        status: 400,
      };
    }
    seenSkus.add(sku);

    const attributes = Array.isArray(raw.attributes) ? raw.attributes : [];
    if (attributes.length === 0) {
      return {
        ok: false,
        error: `تنوع "${sku}" باید حداقل یک ویژگی داشته باشد`,
        status: 400,
      };
    }

    const comboParts: string[] = [];
    for (const attr of attributes) {
      const attributeId = String(attr?.attributeId || "");
      const value = String(attr?.value || "").trim();
      if (!mongoose.isValidObjectId(attributeId)) {
        return {
          ok: false,
          error: `شناسه ویژگی نامعتبر در تنوع "${sku}"`,
          status: 400,
        };
      }
      const attrDef = attributesMap.get(attributeId);
      if (!attrDef) {
        return {
          ok: false,
          error: `ویژگی انتخاب‌شده در تنوع "${sku}" یافت نشد`,
          status: 400,
        };
      }
      if (!value) {
        return {
          ok: false,
          error: `مقدار ویژگی "${attrDef.name}" در تنوع "${sku}" خالی است`,
          status: 400,
        };
      }
      // Validate the value against the attribute's preset values list (when defined)
      if (attrDef.values.length > 0 && !attrDef.values.includes(value)) {
        return {
          ok: false,
          error: `مقدار "${value}" برای ویژگی "${attrDef.name}" در تنوع "${sku}" مجاز نیست`,
          status: 400,
        };
      }
      comboParts.push(`${attributeId}:${value.toLowerCase()}`);
    }

    // Duplicate combination detection (order-insensitive)
    const comboKey = comboParts.sort().join("|");
    if (seenCombos.has(comboKey)) {
      return {
        ok: false,
        error: `ترکیب تکراری در تنوع‌ها یافت شد: ${sku}`,
        status: 400,
      };
    }
    seenCombos.add(comboKey);

    const price = Number(raw.price);
    const supplierPrice = Number(raw.supplierPrice);
    const stock = Number(raw.stock ?? 0);

    if (!Number.isFinite(price) || price < 0) {
      return {
        ok: false,
        error: `قیمت تنوع "${sku}" نامعتبر است`,
        status: 400,
      };
    }
    if (!Number.isFinite(supplierPrice) || supplierPrice < 0) {
      return {
        ok: false,
        error: `قیمت تأمین تنوع "${sku}" نامعتبر است`,
        status: 400,
      };
    }
    if (!Number.isInteger(stock) || stock < 0) {
      return {
        ok: false,
        error: `موجودی تنوع "${sku}" نامعتبر است`,
        status: 400,
      };
    }
  }

  const hasActive = (variants as VariantInput[]).some(
    (v) => v.isActive !== false
  );
  if (!hasActive) {
    return {
      ok: false,
      error: "حداقل یک تنوع باید فعال باشد",
      status: 400,
    };
  }

  return { ok: true, variants: variants as VariantInput[] };
}
