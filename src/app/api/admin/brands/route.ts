import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Brand from "@/models/Brand";

const requireAdminOrError = async (req: NextRequest) =>
  requireRoleOrError(req, ["admin"]);

/**
 * GET /api/admin/brands
 *
 * Returns all brands. Open to admin and supplier for dropdowns.
 * Query params:
 *   - active: if "true", returns only active brands
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
    const active = searchParams.get("active");

    const filter: Record<string, unknown> = {};
    if (active === "true") {
      filter.isActive = true;
    }

    const brands = await Brand.find(filter)
      .sort({ name: 1 })
      .lean();

    return NextResponse.json(brands);
  } catch (error) {
    console.error("Error fetching brands:", error);
    return serverError();
  }
}

/**
 * POST /api/admin/brands
 *
 * Creates a new brand.
 * Body: { name, slug, description?, logo?, website?, isActive? }
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { error: "نام برند الزامی است" },
        { status: 400 }
      );
    }

    if (!body.slug || !body.slug.trim()) {
      return NextResponse.json(
        { error: "اسلاگ برند الزامی است" },
        { status: 400 }
      );
    }

    const existing = await Brand.findOne({ slug: body.slug.trim().toLowerCase() });
    if (existing) {
      return NextResponse.json(
        { error: "برندی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }

    const brand = await Brand.create({
      name: body.name.trim(),
      slug: body.slug.trim().toLowerCase(),
      description: body.description || "",
      logo: body.logo || "",
      website: body.website || "",
      isActive: body.isActive ?? true,
    });

    return NextResponse.json(brand, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating brand:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "برندی با این نام یا اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * PUT /api/admin/brands?id=xxx
 *
 * Updates an existing brand.
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
        { error: "شناسه برند الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (body.slug) {
      const existing = await Brand.findOne({
        slug: body.slug.trim().toLowerCase(),
        _id: { $ne: id },
      });
      if (existing) {
        return NextResponse.json(
          { error: "برندی با این اسلاگ قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.slug !== undefined) updateData.slug = body.slug.trim().toLowerCase();
    if (body.description !== undefined) updateData.description = body.description;
    if (body.logo !== undefined) updateData.logo = body.logo;
    if (body.website !== undefined) updateData.website = body.website;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await Brand.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return NextResponse.json(
        { error: "برند یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Error updating brand:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "برندی با این نام یا اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * DELETE /api/admin/brands?id=xxx
 *
 * Deletes a brand.
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
        { error: "شناسه برند الزامی است" },
        { status: 400 }
      );
    }

    const brand = await Brand.findByIdAndDelete(id);

    if (!brand) {
      return NextResponse.json(
        { error: "برند یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "برند با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting brand:", error);
    return serverError();
  }
}