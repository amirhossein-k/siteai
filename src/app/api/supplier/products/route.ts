import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Product from "@/models/Product";
import { sanitizePlainText } from "@/lib/sanitize";
import { prepareVariantsForSave } from "@/lib/product-variants";
import { prepareRichDescription } from "@/lib/product-description";
import { createWithUniqueSlug } from "@/lib/product-slug";
import {
  buildPriceCasUpdate,
  createProductPriceSnapshotReader,
  updateProductWithPriceStamp,
} from "@/lib/product-price-cas";
import {
  initialPriceStampFields,
  omitInternalPriceFields,
  toPricingRevision,
} from "@/lib/product-price-audit";
import { PRICE_CONFLICT_ERROR } from "@/lib/constants";

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // If ?id= is provided, return a single product (only if it belongs to this supplier)
    if (id) {
      const product = await Product.findOne({ _id: id, supplier: supplier._id })
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

    // Otherwise return all products for this supplier
    const products = await Product.find({ supplier: supplier._id })
      .populate("category", "name")
      .populate("supplier", "businessName")
      .populate("brand", "name")
      .populate("tags", "name slug")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(products);
  } catch (error) {
    console.error("Error fetching supplier products:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const body = await req.json();

    // Prepare variants (validates attributes, SKUs, combos; recomputes summary)
    const prepared = await prepareVariantsForSave(body);
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: prepared.status });
    }

    // Rich description — server-side allowlist validation + plain-text projection.
    const rich = prepareRichDescription(body);
    if (!rich.ok) {
      return NextResponse.json({ error: rich.error }, { status: 400 });
    }

    // Session 70 — auto-generated slugs (autoSlug: true) get a deterministic
    // collision suffix (base-2, …); user-entered slugs keep the 409 behavior.
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
      supplier: supplier._id, // Auto-set to this supplier
      supplierPrice: prepared.hasVariants ? 0 : body.supplierPrice,
      price: prepared.hasVariants ? prepared.price : body.price,
      stock: prepared.hasVariants ? prepared.stock : body.stock,
      hasVariants: prepared.hasVariants,
      variants: prepared.variants,
      isActive: body.isActive ?? true,
      // Session 93 — CREATION-TIME stamp, same contract as the admin POST: the
      // pricing configuration a product is created with IS its first one, so the
      // stamp starts real instead of null ("never priced"). Later edits move it
      // only when the pricing revision actually changes.
      ...initialPriceStampFields(),
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
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه محصول الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Only allow updating products that belong to this supplier
    const existing = await Product.findOne({ _id: id, supplier: supplier._id });
    if (!existing) {
      return NextResponse.json(
        { error: "محصول یافت نشد یا متعلق به شما نیست" },
        { status: 404 }
      );
    }

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

    // Same auto-slug collision handling as POST.
    const updateFields = {
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
      supplierPrice: prepared.hasVariants ? 0 : body.supplierPrice,
      price: prepared.hasVariants ? prepared.price : body.price,
      stock: prepared.hasVariants ? prepared.stock : body.stock,
      hasVariants: prepared.hasVariants,
      variants: prepared.variants,
      isActive: body.isActive,
    };

    // Session 93 — price stamp (trustworthy «آخرین تغییر تنظیمات قیمت و تخفیف»)
    // with the OWNERSHIP scope pinned in both the snapshot and the CAS filter: the
    // supplier may only ever stamp a product that is still theirs. Bounded CAS
    // loop (3 attempts, 409 on exhaustion — never an unconditional write);
    // full contract: src/lib/product-price-cas.ts.
    const scopeFilter: Record<string, unknown> = {
      _id: id,
      supplier: supplier._id,
    };
    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: body.slug,
      autoSlug: body.autoSlug === true,
      readSnapshot: createProductPriceSnapshotReader(scopeFilter),
      stillExists: async () => (await Product.exists(scopeFilter)) !== null,
      buildNextRevision: (snapshot) =>
        toPricingRevision({
          price: updateFields.price,
          hasVariants: updateFields.hasVariants,
          variants: updateFields.variants,
          // Suppliers never map the admin-only `discount` field: the STORED
          // config is carried through, so a supplier edit can never move the
          // stamp on account of a discount it does not own.
          discount: snapshot.revision.discount,
        }),
      write: ({ candidate, token, stamp }) => {
        const { filter, update: casUpdate } = buildPriceCasUpdate(
          scopeFilter,
          { ...updateFields, slug: candidate },
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
      // PRESERVED BEHAVIOR: this route has no post-update existence check — a
      // product deleted (or re-assigned) between the pre-check and the write
      // answered `200` with a `null` body, and still does.
      return NextResponse.json(null);
    }

    // The stamp + its token are internal: no response may carry them.
    return NextResponse.json(omitInternalPriceFields(outcome.value));
  } catch (error: unknown) {
    console.error("Error updating product:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "محصولی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

export async function DELETE(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه محصول الزامی است" },
        { status: 400 }
      );
    }

    // Only allow deleting products that belong to this supplier
    const deleted = await Product.findOneAndDelete({
      _id: id,
      supplier: supplier._id,
    });

    if (!deleted) {
      return NextResponse.json(
        { error: "محصول یافت نشد یا متعلق به شما نیست" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "محصول با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting product:", error);
    return serverError();
  }
}
