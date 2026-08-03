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
    const filter: Record<string, unknown> = {};

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

    const product = await Product.create({
      name: sanitizePlainText(body.name),
      slug: body.slug,
      description: sanitizePlainText(body.description || ""),
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

    const updated = await Product.findByIdAndUpdate(
      id,
      {
        name: sanitizePlainText(body.name),
        slug: body.slug,
        description: sanitizePlainText(body.description || ""),
        images: body.images,
        brand: body.brand,
        tags: body.tags || [],
        category: body.category,
        supplier: body.supplier,
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
