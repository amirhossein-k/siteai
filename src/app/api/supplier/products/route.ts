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

    const product = await Product.create({
      name: sanitizePlainText(body.name),
      slug: body.slug,
      description: sanitizePlainText(body.description || ""),
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
    });

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

    const updated = await Product.findByIdAndUpdate(
      id,
      {
        name: sanitizePlainText(body.name),
        slug: body.slug,
        description: sanitizePlainText(body.description || ""),
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
      },
      { new: true, runValidators: true }
    )
      .populate("category", "name")
      .populate("supplier", "businessName")
      .populate("brand", "name")
      .populate("tags", "name slug")
      .lean();

    return NextResponse.json(updated);
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
