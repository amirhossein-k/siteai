import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Tag from "@/models/Tag";
import { sanitizePlainText } from "@/lib/sanitize";

const requireAdminOrError = async (req: NextRequest) =>
  requireRoleOrError(req, ["admin"]);

/**
 * GET /api/admin/tags
 *
 * Returns all tags. Open to admin and supplier for dropdowns.
 * Query params:
 *   - active: if "true", returns only active tags
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin", "supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const active = searchParams.get("active");

    const filter: Record<string, unknown> = {};
    if (active === "true") {
      filter.isActive = true;
    }

    const tags = await Tag.find(filter).sort({ name: 1 }).lean();

    return NextResponse.json(tags);
  } catch (error) {
    console.error("Error fetching tags:", error);
    return serverError();
  }
}

/**
 * POST /api/admin/tags
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { error: "نام برچسب الزامی است" },
        { status: 400 }
      );
    }

    if (!body.slug || !body.slug.trim()) {
      return NextResponse.json(
        { error: "اسلاگ برچسب الزامی است" },
        { status: 400 }
      );
    }

    const existing = await Tag.findOne({
      slug: body.slug.trim().toLowerCase(),
    });
    if (existing) {
      return NextResponse.json(
        { error: "برچسبی با این اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }

    const tag = await Tag.create({
      name: sanitizePlainText(body.name.trim()),
      slug: body.slug.trim().toLowerCase(),
      isActive: body.isActive ?? true,
    });

    return NextResponse.json(tag, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating tag:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "برچسبی با این نام یا اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * PUT /api/admin/tags?id=xxx
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
        { error: "شناسه برچسب الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (body.slug) {
      const existing = await Tag.findOne({
        slug: body.slug.trim().toLowerCase(),
        _id: { $ne: id },
      });
      if (existing) {
        return NextResponse.json(
          { error: "برچسبی با این اسلاگ قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = sanitizePlainText(body.name.trim());
    if (body.slug !== undefined) updateData.slug = body.slug.trim().toLowerCase();
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await Tag.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return NextResponse.json(
        { error: "برچسب یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Error updating tag:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "برچسبی با این نام یا اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * DELETE /api/admin/tags?id=xxx
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
        { error: "شناسه برچسب الزامی است" },
        { status: 400 }
      );
    }

    const tag = await Tag.findByIdAndDelete(id);

    if (!tag) {
      return NextResponse.json(
        { error: "برچسب یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "برچسب با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting tag:", error);
    return serverError();
  }
}