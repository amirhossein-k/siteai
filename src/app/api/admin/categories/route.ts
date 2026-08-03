import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Category from "@/models/Category";
import { sanitizePlainText, sanitizeOptional } from "@/lib/sanitize";

const requireAdminOrError = async (req: NextRequest) =>
  requireRoleOrError(req, ["admin"]);

/**
 * GET /api/admin/categories
 *
 * Returns all categories with optional parent filtering.
 * Query params:
 *   - parent: filter by parent ID (or "null" for root categories)
 *   - all: if "true", returns flat list with full details (for dropdowns)
 *   - tree: if "true", returns nested tree structure
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, [
    "admin",
    "supplier",
  ]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const parent = searchParams.get("parent");
    const all = searchParams.get("all");
    const tree = searchParams.get("tree");

    // ─── Tree mode ───
    if (tree === "true") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allCats: any[] = await Category.find({})
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      const catMap = new Map<string, Record<string, unknown>>();
      const roots: Record<string, unknown>[] = [];

      allCats.forEach((cat) => {
        catMap.set(cat._id.toString(), { ...cat, children: [] });
      });

      allCats.forEach((cat) => {
        const node = catMap.get(cat._id.toString());
        if (cat.parent && catMap.has(cat.parent.toString())) {
          const parentNode = catMap.get(cat.parent.toString());
          (parentNode!.children as unknown[]).push(node);
        } else {
          roots.push(node!);
        }
      });

      return NextResponse.json(roots);
    }

    // ─── Flat list mode ───
    if (all === "true") {
      const categories = await Category.find({})
        .populate("parent", "name slug")
        .sort({ sortOrder: 1, name: 1 })
        .lean();
      return NextResponse.json(categories);
    }

    // ─── Filtered mode ───
    const filter: Record<string, unknown> = {};
    if (parent === "null") {
      filter.parent = null;
    } else if (parent) {
      filter.parent = parent;
    }

    const categories = await Category.find(filter)
      .populate("parent", "name slug")
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    return NextResponse.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return serverError();
  }
}

/**
 * POST /api/admin/categories
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { error: "نام دسته‌بندی الزامی است" },
        { status: 400 }
      );
    }

    if (!body.slug || !body.slug.trim()) {
      return NextResponse.json(
        { error: "اسلاگ دسته‌بندی الزامی است" },
        { status: 400 }
      );
    }

    const existing = await Category.findOne({ slug: body.slug.trim().toLowerCase() });
    if (existing) {
      return NextResponse.json(
        { error: "دسته‌بندی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }

    if (body.parent) {
      const parentCat = await Category.findById(body.parent);
      if (!parentCat) {
        return NextResponse.json(
          { error: "دسته‌بندی والد یافت نشد" },
          { status: 400 }
        );
      }
    }

    const category = await Category.create({
      name: sanitizePlainText(body.name.trim()),
      slug: body.slug.trim().toLowerCase(),
      parent: body.parent || null,
      icon: body.icon || "",
      image: body.image || "",
      description: sanitizeOptional(body.description) || "",
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive ?? true,
      metaTitle: sanitizeOptional(body.metaTitle) || "",
      metaDescription: sanitizeOptional(body.metaDescription) || "",
    });

    const populated = await Category.findById(category._id)
      .populate("parent", "name slug")
      .lean();

    return NextResponse.json(populated, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating category:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "دسته‌بندی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * PUT /api/admin/categories?id=xxx
 */
export async function PUT(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه دسته‌بندی الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (body.parent === id) {
      return NextResponse.json(
        { error: "یک دسته‌بندی نمی‌تواند والد خودش باشد" },
        { status: 400 }
      );
    }

    if (body.slug) {
      const existing = await Category.findOne({
        slug: body.slug.trim().toLowerCase(),
        _id: { $ne: id },
      });
      if (existing) {
        return NextResponse.json(
          { error: "دسته‌بندی با این اسلاگ قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = sanitizePlainText(body.name.trim());
    if (body.slug !== undefined) updateData.slug = body.slug.trim().toLowerCase();
    if (body.parent !== undefined) updateData.parent = body.parent || null;
    if (body.icon !== undefined) updateData.icon = body.icon;
    if (body.image !== undefined) updateData.image = body.image;
    if (body.description !== undefined) updateData.description = sanitizeOptional(body.description) || "";
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.metaTitle !== undefined) updateData.metaTitle = sanitizeOptional(body.metaTitle) || "";
    if (body.metaDescription !== undefined) updateData.metaDescription = sanitizeOptional(body.metaDescription) || "";

    const updated = await Category.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("parent", "name slug")
      .lean();

    if (!updated) {
      return NextResponse.json(
        { error: "دسته‌بندی یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Error updating category:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "دسته‌بندی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * DELETE /api/admin/categories?id=xxx
 */
export async function DELETE(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه دسته‌بندی الزامی است" },
        { status: 400 }
      );
    }

    const category = await Category.findById(id);
    if (!category) {
      return NextResponse.json(
        { error: "دسته‌بندی یافت نشد" },
        { status: 404 }
      );
    }

    await Category.updateMany({ parent: id }, { $set: { parent: null } });
    await Category.findByIdAndDelete(id);

    return NextResponse.json({ message: "دسته‌بندی با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting category:", error);
    return serverError();
  }
}