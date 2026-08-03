import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Attribute from "@/models/Attribute";
import { sanitizePlainText } from "@/lib/sanitize";

// Allowed attribute types
const ATTRIBUTE_TYPES = ["text", "color", "size", "number"];

/**
 * GET — list attributes.
 * - Admin: all attributes (active + inactive)
 * - Supplier: active attributes only (for variant builders)
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin", "supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const filter =
      token!.role === "supplier" ? { isActive: true } : {};

    const attributes = await Attribute.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(attributes);
  } catch (error) {
    console.error("Error fetching attributes:", error);
    return serverError();
  }
}

/**
 * POST — create attribute (admin only)
 */
export async function POST(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    const name = sanitizePlainText(body.name || "");
    const slug = String(body.slug || "")
      .trim()
      .toLowerCase();

    if (!name) {
      return NextResponse.json(
        { error: "نام ویژگی الزامی است" },
        { status: 400 }
      );
    }
    if (!slug) {
      return NextResponse.json(
        { error: "اسلاگ ویژگی الزامی است" },
        { status: 400 }
      );
    }

    const type = ATTRIBUTE_TYPES.includes(body.type) ? body.type : "text";

    // Duplicate name / slug detection
    const existing = await Attribute.findOne({
      $or: [{ slug }, { name }],
    });
    if (existing) {
      const isSlugDup = existing.slug === slug;
      return NextResponse.json(
        {
          error: isSlugDup
            ? "ویژگی‌ای با این اسلاگ قبلاً وجود دارد"
            : "ویژگی‌ای با این نام قبلاً وجود دارد",
        },
        { status: 409 }
      );
    }

    const attribute = await Attribute.create({
      name,
      slug,
      type,
      values: Array.isArray(body.values)
        ? body.values
            .map((v: string) => sanitizePlainText(String(v || "")))
            .filter((v: string) => v.length > 0)
        : [],
      isActive: body.isActive ?? true,
    });

    return NextResponse.json(attribute, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating attribute:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "ویژگی‌ای با این نام یا اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * PUT — update attribute (admin only)
 */
export async function PUT(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه ویژگی الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();

    const name = body.name !== undefined ? sanitizePlainText(body.name) : undefined;
    const slug =
      body.slug !== undefined
        ? String(body.slug).trim().toLowerCase()
        : undefined;

    if (name !== undefined && !name) {
      return NextResponse.json(
        { error: "نام ویژگی الزامی است" },
        { status: 400 }
      );
    }
    if (slug !== undefined && !slug) {
      return NextResponse.json(
        { error: "اسلاگ ویژگی الزامی است" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (slug !== undefined) update.slug = slug;
    if (body.type !== undefined) {
      if (!ATTRIBUTE_TYPES.includes(body.type)) {
        return NextResponse.json(
          { error: "نوع ویژگی معتبر نیست" },
          { status: 400 }
        );
      }
      update.type = body.type;
    }
    if (body.values !== undefined) {
      update.values = Array.isArray(body.values)
        ? body.values
            .map((v: string) => sanitizePlainText(String(v || "")))
            .filter((v: string) => v.length > 0)
        : [];
    }
    if (body.isActive !== undefined) update.isActive = !!body.isActive;

    // Duplicate slug check (excluding self)
    if (slug !== undefined) {
      const dup = await Attribute.findOne({ slug, _id: { $ne: id } });
      if (dup) {
        return NextResponse.json(
          { error: "ویژگی‌ای با این اسلاگ قبلاً وجود دارد" },
          { status: 409 }
        );
      }
    }

    const updated = await Attribute.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return NextResponse.json(
        { error: "ویژگی یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Error updating attribute:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      return NextResponse.json(
        { error: "ویژگی‌ای با این نام یا اسلاگ قبلاً وجود دارد" },
        { status: 409 }
      );
    }
    return serverError();
  }
}

/**
 * DELETE — delete attribute (admin only)
 */
export async function DELETE(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه ویژگی الزامی است" },
        { status: 400 }
      );
    }

    const deleted = await Attribute.findByIdAndDelete(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "ویژگی یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "ویژگی با موفقیت حذف شد" });
  } catch (error) {
    console.error("Error deleting attribute:", error);
    return serverError();
  }
}
