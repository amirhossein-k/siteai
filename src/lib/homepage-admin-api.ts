/**
 * Session 53 — shared admin CRUD factory for the four per-type homepage
 * content models (hero slides / campaign banners / gift collections /
 * trust badges). Each model gets its own thin route file that delegates here
 * — the factory guarantees identical validation, RBAC and response shapes,
 * and per-type field validation still lives in validateContentRow.
 */
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import HomepageSection from "@/models/HomepageSection";
import { validateContentRow, normalizeContentCommon } from "@/lib/homepage-content";

export type HomepageContentType =
  | "hero-slide"
  | "campaign-banner"
  | "gift-collection"
  | "trust-badge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentModel = any;

const CONTENT_FIELDS = [
  "title",
  "subtitle",
  "tagline",
  "description",
  "ctaLabel",
  "ctaHref",
  "imageDesktop",
  "imageMobile",
  "themeColor",
  "icon",
] as const;

/** Map a lean content doc to the admin row shape (all fields exposed to admin). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRowJson(row: any) {
  const out: Record<string, unknown> = {
    _id: row._id,
    sectionSlug: row.sectionSlug ?? "",
    sortOrder: row.sortOrder ?? 0,
    isActive: row.isActive ?? true,
    status: row.status ?? "published",
    publishedAt: row.publishedAt ?? null,
    publishAt: row.publishAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  for (const key of CONTENT_FIELDS) {
    out[key] = row[key] ?? "";
  }
  return out;
}

export function createContentRouteHandlers(type: HomepageContentType, model: ContentModel) {
  const requireAdminOrError = async (req: NextRequest) =>
    requireRoleOrError(req, ["admin"]);

  return {
    /**
     * GET /api/admin/homepage/<type>s?sectionSlug=xxx
     * All rows for a section (or all), excluding soft-deleted. Draft +
     * inactive rows ARE included (admin visibility).
     */
    async GET(req: NextRequest) {
      const { error } = await requireAdminOrError(req);
      if (error) return error;

      try {
        await dbConnect();
        const { searchParams } = new URL(req.url);
        const sectionSlug = (searchParams.get("sectionSlug") ?? "").trim();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filter: any = { deletedAt: null };
        if (sectionSlug) filter.sectionSlug = sectionSlug;

        const rows = await model
          .find(filter)
          .sort({ sortOrder: 1, createdAt: 1 })
          .lean();
        return NextResponse.json({ rows: rows.map(toRowJson) });
      } catch (err) {
        console.error("Error listing homepage content:", err);
        return serverError();
      }
    },

    /** POST /api/admin/homepage/<type>s — create one content row. */
    async POST(req: NextRequest) {
      const { error } = await requireAdminOrError(req);
      if (error) return error;

      try {
        await dbConnect();
        const body = await req.json();

        // Content rows are bound to a section instance.
        const sectionSlug = String(body.sectionSlug ?? "").trim().toLowerCase();
        if (!sectionSlug) {
          return NextResponse.json(
            { error: "بخش (sectionSlug) الزامی است" },
            { status: 400 }
          );
        }
        const section = await HomepageSection.findOne({
          slug: sectionSlug,
          deletedAt: null,
        }).lean();
        if (!section) {
          return NextResponse.json({ error: "بخش یافت نشد" }, { status: 400 });
        }

        const out: Record<string, unknown> = {};
        const fieldError = validateContentRow(type, body, out);
        if (fieldError) return NextResponse.json({ error: fieldError }, { status: 400 });
        const commonError = normalizeContentCommon(body, out);
        if (commonError) return NextResponse.json({ error: commonError }, { status: 400 });

        const row = await model.create({
          ...out,
          sectionSlug,
          sortOrder: out.sortOrder ?? 0,
          isActive: out.isActive ?? true,
          status: out.status ?? "published",
          publishedAt: out.status === "draft" ? null : new Date(),
          publishAt: null,
        });

        const lean = await model.findById(row._id).lean();
        return NextResponse.json({ row: toRowJson(lean) }, { status: 201 });
      } catch (err) {
        console.error("Error creating homepage content:", err);
        return serverError();
      }
    },

    /** PUT /api/admin/homepage/<type>s?id=xxx — update mutable fields. */
    async PUT(req: NextRequest) {
      const { error } = await requireAdminOrError(req);
      if (error) return error;

      try {
        await dbConnect();
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) {
          return NextResponse.json({ error: "شناسه محتوا الزامی است" }, { status: 400 });
        }
        if (!mongoose.isValidObjectId(id)) {
          return NextResponse.json({ error: "شناسه محتوا نامعتبر است" }, { status: 400 });
        }

        const existing = await model.findById(id);
        if (!existing || existing.deletedAt) {
          return NextResponse.json({ error: "محتوا یافت نشد" }, { status: 404 });
        }

        const body = await req.json();

        // Re-validate the MERGED doc so partial updates stay consistent with
        // the full type contract (title required etc.).
        const merged = {
          ...existing.toObject(),
          ...body,
          sectionSlug: body.sectionSlug ?? existing.sectionSlug,
        };
        const out: Record<string, unknown> = {};
        const fieldError = validateContentRow(type, merged, out);
        if (fieldError) return NextResponse.json({ error: fieldError }, { status: 400 });
        const commonError = normalizeContentCommon(body, out);
        if (commonError) return NextResponse.json({ error: commonError }, { status: 400 });

        if (body.sectionSlug !== undefined) {
          const section = await HomepageSection.findOne({
            slug: String(body.sectionSlug).trim().toLowerCase(),
            deletedAt: null,
          }).lean();
          if (!section) {
            return NextResponse.json({ error: "بخش یافت نشد" }, { status: 400 });
          }
        }

        const updateData: Record<string, unknown> = { ...out };
        if (body.sectionSlug !== undefined) {
          updateData.sectionSlug = String(body.sectionSlug).trim().toLowerCase();
        }
        if (body.status === "published") updateData.publishedAt = new Date();
        if (body.status === "draft") updateData.publishedAt = null;

        const updated = await model.findByIdAndUpdate(id, updateData, {
          new: true,
          runValidators: true,
        }).lean();

        if (!updated) {
          return NextResponse.json({ error: "محتوا یافت نشد" }, { status: 404 });
        }
        return NextResponse.json({ row: toRowJson(updated) });
      } catch (err) {
        console.error("Error updating homepage content:", err);
        return serverError();
      }
    },

    /** DELETE /api/admin/homepage/<type>s?id=xxx — soft delete. */
    async DELETE(req: NextRequest) {
      const { error } = await requireAdminOrError(req);
      if (error) return error;

      try {
        await dbConnect();
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) {
          return NextResponse.json({ error: "شناسه محتوا الزامی است" }, { status: 400 });
        }
        if (!mongoose.isValidObjectId(id)) {
          return NextResponse.json({ error: "شناسه محتوا نامعتبر است" }, { status: 400 });
        }

        const row = await model.findById(id);
        if (!row || row.deletedAt) {
          return NextResponse.json({ error: "محتوا یافت نشد" }, { status: 404 });
        }

        await model.findByIdAndUpdate(id, { $set: { deletedAt: new Date() } });
        return NextResponse.json({ message: "محتوا با موفقیت حذف شد" });
      } catch (err) {
        console.error("Error deleting homepage content:", err);
        return serverError();
      }
    },
  };
}
