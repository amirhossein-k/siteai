import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
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
import { prepareVariantsForSave } from "@/lib/product-variants";
import { prepareRichDescription } from "@/lib/product-description";
import { createWithUniqueSlug } from "@/lib/product-slug";
import { parseProductDiscount } from "@/lib/product-pricing";
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
    const productFields = {
      name: sanitizePlainText(body.name),
      slug: body.slug,
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
      // undefined (field omitted) → absent discount; null → explicitly cleared;
      // object → validated config. Supplier routes never map this field.
      discount: discountResult.value,
    };
    const slugResult = await createWithUniqueSlug(
      body.slug,
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

    const body = await req.json();

    // Prepare variants (validates attributes, SKUs, combos; recomputes summary)
    // Pass the product id so the global SKU check excludes this product's own SKUs
    const prepared = await prepareVariantsForSave(body, id);
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
      prepared.hasVariants ? prepared.price : body.price
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
      stock: prepared.hasVariants ? undefined : body.stock,
      variants: prepared.hasVariants ? prepared.variants : undefined,
    });
    if (!stockGuard.ok) {
      return NextResponse.json({ error: stockGuard.error }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      name: sanitizePlainText(body.name),
      slug: body.slug,
      description:
        rich.description !== undefined
          ? rich.description
          : sanitizePlainText(body.description || ""),
      descriptionRich: rich.descriptionRich,
      images: body.images,
      // Normalize the empty-string "no brand" value (the edit form's "بدون
      // برند" option submits "") — casting "" to ObjectId throws a CastError
      // 500. Mirrors the POST normalization below.
      brand: body.brand || null,
      tags: body.tags || [],
      category: body.category,
      supplier: body.supplier,
      supplierPrice: prepared.hasVariants ? 0 : body.supplierPrice,
      price: prepared.hasVariants ? prepared.price : body.price,
      stock: prepared.hasVariants ? prepared.stock : body.stock,
      hasVariants: prepared.hasVariants,
      variants: prepared.variants,
      isActive: body.isActive,
    };
    // discount is undefined when the field was omitted (backward compat with
    // legacy API clients) → keep the stored value; null → cleared; object → set.
    if (discountResult.value !== undefined) {
      update.discount = discountResult.value;
    }

    // Same auto-slug collision handling as POST: auto-generated slugs get a
    // deterministic suffix; user-entered slugs keep the 409 behavior.
    const slugResult = await createWithUniqueSlug(
      body.slug,
      (candidate) =>
        Product.findByIdAndUpdate(
          id,
          { ...update, slug: candidate },
          { new: true, runValidators: true }
        )
          .populate("category", "name")
          .populate("supplier", "businessName")
          .populate("brand", "name")
          .populate("tags", "name slug")
          .lean(),
      body.autoSlug === true ? 20 : 1
    );
    if (!slugResult.ok) {
      return NextResponse.json(
        { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    const updated = slugResult.value;

    if (!updated) {
      return NextResponse.json(
        { error: "محصول یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
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
