import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { z } from "zod";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Product from "@/models/Product";
import Category from "@/models/Category";
import Brand from "@/models/Brand";
import Tag from "@/models/Tag";
import {
  parsePaginationParams,
  buildPaginatedResponse,
  escapeRegex,
} from "@/lib/pagination";
import { sanitizePlainText } from "@/lib/sanitize";
import { slugify } from "@/lib/utils";
import { prepareVariantsForSave } from "@/lib/product-variants";
import { prepareRichDescription } from "@/lib/product-description";
import { createWithUniqueSlug } from "@/lib/product-slug";
import { parseProductDiscount } from "@/lib/product-pricing";
import {
  buildPriceCasUpdate,
  createProductPriceSnapshotReader,
  updateProductWithPriceStamp,
} from "@/lib/product-price-cas";
import {
  initialPriceStampFields,
  omitInternalPriceFields,
  resolveNextDiscount,
  toPricingRevision,
} from "@/lib/product-price-audit";
import { PRICE_CONFLICT_ERROR } from "@/lib/constants";
import { assertNoDirectStockChange } from "@/lib/inventory-adjustments";
// Note: All models are registered globally via dbConnect.js — no side-effect imports needed here

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // If ?id= is provided, return a single product
    if (id) {
      const product = await Product.findById(id)
        .populate("category", "name")
        .populate("supplier", "businessName")
        .populate("brand", "name")
        .populate("tags", "name slug")
        .lean();

      if (!product) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }

      return NextResponse.json(product);
    }

    // --- List products with search + pagination ---
    const search = searchParams.get("search");
    // Session 82 Phase B — restrict to a sourcing mode (the purchase form picks
    // only purchased products; the accounting init wizard shows both).
    const sourcing = searchParams.get("sourcing");
    const filter: Record<string, unknown> = {};
    if (
      sourcing === "purchased" ||
      sourcing === "consignment"
    ) {
      filter.sourcing = sourcing;
    }

    // Search filter — matches name, slug, description, or category/brand/tag name.
    // category/brand/tags are ObjectId refs at query time, so resolve matching
    // ids first (dotted-path filters like "category.name" never match).
    if (search) {
      const safeSearch = escapeRegex(search);
      const regex = new RegExp(safeSearch, "i");
      const [categoryIds, brandIds, tagIds] = await Promise.all([
        Category.find({ name: regex }).distinct("_id"),
        Brand.find({ name: regex }).distinct("_id"),
        Tag.find({ name: regex }).distinct("_id"),
      ]);
      filter.$or = [
        { name: regex },
        { slug: regex },
        { description: regex },
        { category: { $in: categoryIds } },
        { brand: { $in: brandIds } },
        { tags: { $in: tagIds } },
      ];
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate("category", "name")
        .populate("supplier", "businessName")
        .populate("brand", "name")
        .populate("tags", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(products, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching products:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    // Prepare variants (validates attributes, SKUs, combos; recomputes summary)
    const prepared = await prepareVariantsForSave(body);
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: prepared.status });
    }

    // Rich description — server-side allowlist validation + plain-text projection.
    // When descriptionRich is absent, the legacy plain-text path is preserved.
    const rich = prepareRichDescription(body);
    if (!rich.ok) {
      return NextResponse.json({ error: rich.error }, { status: 400 });
    }

    // Product discount — ADMIN-only (this route is admin-gated), validated
    // server-side against the single source (src/lib/product-pricing.ts). The
    // applicable base price is the min active variant price for variant
    // products, the submitted price otherwise (the fixed < price rule).
    const discountResult = parseProductDiscount(
      body.discount,
      prepared.hasVariants ? prepared.price : body.price
    );
    if (!discountResult.ok) {
      return NextResponse.json(
        { error: discountResult.error },
        { status: 400 }
      );
    }

    // Session 70 — an AUTO-GENERATED slug (autoSlug: true, derived from the
    // name) that collides gets a deterministic suffix (base-2, base-3, …) via
    // the DB unique index retry; a manually-entered slug is authoritative and
    // keeps the existing 409 behavior (maxTries=1 → conflict = {ok:false}).
    // Bug fix — slug auto-generation (server-authoritative): an empty or
    // whitespace-only slug is generated from the product NAME (the same
    // slugify used by the client form). A blank name cannot generate a slug —
    // it is rejected as the missing field it is (field-specific error, no
    // generic "slug required").
    const sanitizedName = sanitizePlainText(body.name);
    if (!sanitizedName || sanitizedName.trim() === "") {
      return NextResponse.json(
        { error: "نام محصول الزامی است", field: "name" },
        { status: 400 }
      );
    }
    const normalizedSlug =
      typeof body.slug === "string" ? body.slug.trim() : "";
    const effectiveSlug =
      normalizedSlug !== "" ? normalizedSlug : slugify(sanitizedName);

    const productFields = {
      name: sanitizedName,
      slug: effectiveSlug,
      description:
        rich.description !== undefined
          ? rich.description
          : sanitizePlainText(body.description || ""),
      descriptionRich: rich.descriptionRich,
      images: body.images || [],
      brand: body.brand || null,
      tags: body.tags || [],
      category: body.category,
      supplier: body.supplier,
      supplierPrice: prepared.hasVariants ? 0 : body.supplierPrice,
      price: prepared.hasVariants ? prepared.price : body.price,
      stock: prepared.hasVariants ? prepared.stock : body.stock,
      hasVariants: prepared.hasVariants,
      variants: prepared.variants,
      isActive: body.isActive ?? true,
      // Session 93 — CREATION-TIME stamp: the pricing configuration a product is
      // created with IS its first one, so the stamp starts real (never a null
      // "never priced") and the public label is available immediately. Later
      // pricing EDITS move it only when the revision actually changes
      // (src/lib/product-price-audit.ts); `priceVersion` keeps its schema
      // default 0 = "no pricing write yet".
      ...initialPriceStampFields(),
      // undefined (field omitted) → absent discount; null → explicitly cleared;
      // object → validated config. Supplier routes never map this field.
      discount: discountResult.value,
    };
    const slugResult = await createWithUniqueSlug(
      effectiveSlug,
      (candidate) => Product.create({ ...productFields, slug: candidate }),
      body.autoSlug === true ? 20 : 1
    );
    if (!slugResult.ok) {
      return NextResponse.json(
        { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    const product = slugResult.value;

    const populated = await Product.findById(product._id)
      .populate("category", "name")
      .populate("supplier", "businessName")
      .populate("brand", "name")
      .populate("tags", "name slug")
      .lean();

    return NextResponse.json(populated, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating product:", error);
    if (error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000) {      return NextResponse.json(
          { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    return serverError();
  }
}

// Session 82 — authoritative 14-field perfume/cologne contract. The values
// mirror src/types/index.ts exactly (no invented restrictions). Product identity
// (`id`) is deliberately NOT part of this schema — it is validated separately
// from the URL query and is never part of the update payload.
const PERFUME_UPDATE_FIELDS = [
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

const GENDER_VALUES = ["men", "women", "unisex"] as const;
const PERFUME_TYPE_VALUES = ["parfum", "edp", "edt", "edc", "cologne", "body_spray"] as const;
const FRAGRANCE_FAMILY_VALUES = ["woody", "floral", "fresh", "oriental", "aromatic", "fougere", "chypre", "gourmand"] as const;
const LONGEVITY_VALUES = ["weak", "moderate", "long", "very_long"] as const;
const SILLAGE_VALUES = ["intimate", "moderate", "strong", "enormous"] as const;
const SEASON_VALUES = ["spring", "summer", "autumn", "winter"] as const;
const OCCASION_VALUES = ["daily", "evening", "formal", "party", "office", "romantic"] as const;
const AUTHENTICITY_TYPE_VALUES = ["original", "tester", "decant", "sample"] as const;

// Session 82 follow-up — narrow backward-compatibility normalizers for the
// legacy (non-perfume) PUT fields. Before the perfume schema existed this route
// had no Zod at all, so Mongoose casting accepted these values. The schema must
// keep accepting exactly those, without becoming broad coercion.
const NUMERIC_STRING_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Accept a real number or a VALID numeric string, converting the string to a
 * number before any pricing/CAS calculation. Everything else (empty string,
 * whitespace, booleans, null, "NaN", "Infinity", hex, partial numbers) is
 * passed through untouched so the underlying `z.number()` rejects it.
 */
function numericField<T extends z.ZodNumber>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed === "") return value; // never "" -> 0
    if (!NUMERIC_STRING_PATTERN.test(trimmed)) return value;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }, schema);
}

/**
 * Historical Mongoose Boolean casting accepted the exact strings "true" and
 * "false". `z.coerce.boolean()` is unusable here (Boolean("false") is true),
 * so only those two spellings are normalized; everything else is left for
 * `z.boolean()` to reject.
 */
const booleanField = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean()
);

/**
 * Decision A — the variant configuration is a MANDATORY, explicit part of the
 * PUT contract. A missing property must never be interpreted as false/[] (that
 * silently erased every variant of a variant product). Returns a user-facing
 * error message, or null when the shape is valid.
 */
function validateVariantContract(
  body: Record<string, unknown>
): string | null {
  const hasHasVariants = Object.prototype.hasOwnProperty.call(
    body,
    "hasVariants"
  );
  const hasVariantsArray = Object.prototype.hasOwnProperty.call(
    body,
    "variants"
  );
  if (!hasHasVariants || !hasVariantsArray) {
    return "پیکربندی تنوع الزامی است: hasVariants و variants باید ارسال شوند";
  }
  if (typeof body.hasVariants !== "boolean") {
    return "نوع hasVariants نامعتبر است";
  }
  if (!Array.isArray(body.variants)) {
    return "نوع variants نامعتبر است";
  }
  if (body.hasVariants === true && body.variants.length === 0) {
    return "برای محصول دارای تنوع، حداقل یک تنوع لازم است";
  }
  if (body.hasVariants === false && body.variants.length > 0) {
    return "محصول ساده نباید تنوع داشته باشد";
  }
  return null;
}

const productApiUpdateSchema = z.object({
  name: z.string().optional(),
  // `null` is accepted for backwards compatibility: the historical handler only
  // read `slug` when it was a string and otherwise regenerated it from the name.
  slug: z.string().nullable().optional(),
  // Three-state semantics are `.nullable().optional()` + the pre-validation
  // "" stripping below: omitted/"" → absent (preserve), null → clear, value → update.
  gender: z.enum(GENDER_VALUES).nullable().optional(),
  perfumeType: z.enum(PERFUME_TYPE_VALUES).nullable().optional(),
  fragranceFamily: z.enum(FRAGRANCE_FAMILY_VALUES).nullable().optional(),
  topNotes: z.array(z.string()).nullable().optional(),
  heartNotes: z.array(z.string()).nullable().optional(),
  baseNotes: z.array(z.string()).nullable().optional(),
  longevity: z.enum(LONGEVITY_VALUES).nullable().optional(),
  sillage: z.enum(SILLAGE_VALUES).nullable().optional(),
  season: z.array(z.enum(SEASON_VALUES)).nullable().optional(),
  occasion: z.array(z.enum(OCCASION_VALUES)).nullable().optional(),
  countryOfOrigin: z.string().nullable().optional(),
  releaseYear: z.number().nullable().optional(),
  barcode: z.string().nullable().optional(),
  authenticityType: z.enum(AUTHENTICITY_TYPE_VALUES).nullable().optional(),
  description: z.string().optional(),
  descriptionRich: z.unknown().optional(),
  // `null` clears the brand (historical `body.brand || null`); "" is normalized
  // to null below. An omitted key is preserved (no write).
  brand: z.string().nullable().optional(),
  category: z.string().optional(),
  supplier: z.string().optional(),
  price: numericField(z.number().nonnegative()).optional(),
  supplierPrice: numericField(z.number().nonnegative()).optional(),
  stock: numericField(z.number().int().nonnegative()).optional(),
  isActive: booleanField.optional(),
  autoSlug: z.boolean().optional(),
  discount: z.unknown().optional(),
});

export async function PUT(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه محصول الزامی است" },
        { status: 400 }
      );
    }
    // A malformed id must be a 400 — never an unhandled Mongoose CastError (500).
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Decision A — variant configuration is MANDATORY. Missing properties are
    // rejected here, before any validation/write, so they can never fall back
    // to false/[] and silently erase a variant product.
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "بدنه درخواست نامعتبر است" },
        { status: 400 }
      );
    }
    const variantContractError = validateVariantContract(
      body as Record<string, unknown>
    );
    if (variantContractError) {
      return NextResponse.json(
        { error: variantContractError },
        { status: 400 }
      );
    }

    // Session 82 — empty-string normalization MUST run BEFORE Zod validation.
    // For all 14 perfume fields "" means "preserve the stored value", which is
    // exactly the same as omitting the key. Doing this after validation is too
    // late: Zod would already have rejected "" for enum/array/number fields.
    const normalizedBody: Record<string, unknown> = { ...body };
    for (const field of PERFUME_UPDATE_FIELDS) {
      if (normalizedBody[field] === "") delete normalizedBody[field];
    }

    // Product identity is the URL query id (validated above), never the body.
    // `id` is not declared in the schema, so Zod strips any body-supplied id
    // and it can never reach the update payload.
    const apiResult = productApiUpdateSchema.safeParse(normalizedBody);
    if (!apiResult.success) {
      const formError = (apiResult.error.formErrors && typeof apiResult.error.formErrors.raw === "function")
        ? apiResult.error.formErrors.raw()[0]
        : apiResult.error.issues?.[0]?.message || "Invalid data";
      return NextResponse.json(
        { error: formError },
        { status: 400 }
      );
    }

    // Session 82 — explicit, auditable three-state normalization.
    // "" was removed BEFORE validation (preserve == omit), so only these remain:
    //   - key absent from the request → preserve (not in $set)
    //   - value === null             → BSON null (in $set)
    //   - []                         → empty array (in $set — never dropped)
    //   - valid scalar/enum/array    → in $set
    // No truthiness checks: null and [] are deliberately preserved.
    const normalizedUpdate: Record<string, unknown> = {};
    for (const field of PERFUME_UPDATE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(normalizedBody, field)) continue;
      const value = apiResult.data[field];
      if (value === undefined) continue;
      normalizedUpdate[field] = value;
    }

    // Prepare variants (validates attributes, SKUs, combos; recomputes summary).
    // Pass the product id so the global SKU check excludes this product's own SKUs.
    //
    // `hasVariants`/`variants` are deliberately NOT declared in
    // productApiUpdateSchema — the variant helper owns their validation. Zod
    // strips unknown keys, so they must be read from the raw request body (their
    // original source) rather than from apiResult.data. Otherwise every variant
    // product would be downgraded to a simple product with its variants erased.
    const prepared = await prepareVariantsForSave(
      { hasVariants: body.hasVariants, variants: body.variants },
      id
    );
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: prepared.status });
    }

    // Rich description — server-side allowlist validation + plain-text projection.
    // When descriptionRich is absent (legacy product edited without touching the
    // rich editor), body.description flows through unchanged → nothing erased.
    const rich = prepareRichDescription(body);
    if (!rich.ok) {
      return NextResponse.json({ error: rich.error }, { status: 400 });
    }

    // Product discount — same admin-only validation as POST. basePrice = min
    // active variant price (variants) or the submitted price (simple).
    const discountResult = parseProductDiscount(
      body.discount,
      prepared.hasVariants ? prepared.price : apiResult.data.price
    );
    if (!discountResult.ok) {
      return NextResponse.json(
        { error: discountResult.error },
        { status: 400 }
      );
    }

    // Session 82 Phase D — post-cutover enforcement: once accounting is
    // initialized, direct stock edits are rejected (use /admin/inventory
    // adjustments instead). Non-stock product editing is untouched.
    const stockGuard = await assertNoDirectStockChange(id, {
      stock: prepared.hasVariants ? undefined : apiResult.data.stock,
      variants: prepared.hasVariants ? prepared.variants : undefined,
    });
    if (!stockGuard.ok) {
      return NextResponse.json({ error: stockGuard.error }, { status: 400 });
    }

    // Bug fix — slug handling on EDIT (mirror of POST): a blank name is a
    // field-specific error; an empty/whitespace slug is regenerated from the
    // NEW name (the edit form leaves it untouched); a manually-entered slug
    // stays authoritative. The stored slug is never silently overwritten by
    // unrelated field edits (only save() rewrites what the user submitted).
    const updateName = sanitizePlainText(body.name);
    if (!updateName || updateName.trim() === "") {
      return NextResponse.json(
        { error: "نام محصول الزامی است", field: "name" },
        { status: 400 }
      );
    }
    const normalizedSlug =
      typeof body.slug === "string" ? body.slug.trim() : "";
    const effectiveSlug =
      normalizedSlug !== "" ? normalizedSlug : slugify(updateName);

    const update: Record<string, unknown> = {
      name: updateName,
      slug: effectiveSlug,
      description:
        rich.description !== undefined
          ? rich.description
          : sanitizePlainText(body.description || ""),
      descriptionRich: rich.descriptionRich,
      images: body.images,
      tags: body.tags || [],
      category: body.category,
      supplier: body.supplier,
      // These are the Zod-validated/coerced values: numeric strings are real
      // numbers before pricing/CAS. An omitted key stays undefined and is
      // dropped by buildPriceCasUpdate -> the stored value is preserved.
      supplierPrice: prepared.hasVariants ? 0 : apiResult.data.supplierPrice,
      price: prepared.hasVariants ? prepared.price : apiResult.data.price,
      stock: prepared.hasVariants ? prepared.stock : apiResult.data.stock,
      hasVariants: prepared.hasVariants,
      variants: prepared.variants,
      isActive: apiResult.data.isActive,
      // Session 82 — the 14 perfume fields MUST reach the actual Mongo update.
      // null (explicit clear) and [] (explicit empty) are preserved here; only
      // omitted/"" keys are absent (see the pre-validation normalization).
      ...normalizedUpdate,
    };
    // Brand is three-state: omitted -> preserve (no write), null -> clear,
    // "" -> clear (the form's «بدون برند» option submits ""). Only string/null
    // pass Zod, so a cast error can no longer come from an empty value.
    const normalizedBrand =
      apiResult.data.brand === "" ? null : apiResult.data.brand;
    if (normalizedBrand !== undefined) {
      update.brand = normalizedBrand;
    }
    // discount is undefined when the field was omitted (backward compat with
    // legacy API clients) → keep the stored value; null → cleared; object → set.
    if (discountResult.value !== undefined) {
      update.discount = discountResult.value;
    }

    // Session 93 — price stamp (trustworthy «آخرین تغییر تنظیمات قیمت و تخفیف»).
    // The write is a BOUNDED CAS loop: snapshot (token + pricing revision) →
    // conditional update pinned to that token → at most
    // PRICE_STAMP_MAX_ATTEMPTS attempts, 409 on exhaustion (never an
    // unconditional fallback write). The stamp moves ONLY when the pricing
    // revision changes; every other edit persists with the stamp byte-for-byte
    // as stored. Full contract: src/lib/product-price-cas.ts.
    const scopeFilter: Record<string, unknown> = { _id: id };
    const outcome = await updateProductWithPriceStamp({
      effectiveSlug,
      autoSlug: body.autoSlug === true,
      readSnapshot: createProductPriceSnapshotReader(scopeFilter),
      stillExists: async () => (await Product.exists(scopeFilter)) !== null,
      buildNextRevision: (snapshot) =>
        toPricingRevision({
          price: update.price,
          hasVariants: update.hasVariants,
          variants: update.variants,
          // An OMITTED discount keeps the stored config (never a price change);
          // `null` clears it; an object is the validated submission.
          discount: resolveNextDiscount(
            snapshot.revision.discount,
            discountResult.value
          ),
        }),
      write: ({ candidate, token, stamp }) => {
        const { filter, update: casUpdate } = buildPriceCasUpdate(
          scopeFilter,
          { ...update, slug: candidate },
          token,
          stamp
        );
        return Product.findOneAndUpdate(filter, casUpdate, {
          new: true,
          runValidators: true,
        })
          .populate("category", "name")
          .populate("supplier", "businessName")
          .populate("brand", "name")
          .populate("tags", "name slug")
          .lean();
      },
    });

    if (outcome.status === "slug_conflict") {
      return NextResponse.json(
        { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    if (outcome.status === "price_conflict") {
      return NextResponse.json(
        { error: PRICE_CONFLICT_ERROR },
        { status: 409 }
      );
    }
    if (outcome.status === "not_found") {
      return NextResponse.json(
        { error: "محصول یافت نشد" },
        { status: 404 }
      );
    }

    // The stamp + its token are internal: no response may carry them.
    return NextResponse.json(omitInternalPriceFields(outcome.value));
  } catch (error: unknown) {
    console.error("Error updating product:", error);
    if (error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000) {    return NextResponse.json(
          { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    return serverError();
  }
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه محصول الزامی است" },
        { status: 400 }
      );
    }

    const deleted = await Product.findByIdAndDelete(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "محصول یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "محصول با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting product:", error);
    return serverError();
  }
}
