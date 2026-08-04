import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import HomepageSection from "@/models/HomepageSection";
import { SLUG_RE, seedHomepageContent } from "@/lib/homepage-content";
import { getHomepageBlock } from "@/lib/homepage-sections/registry";
import { sanitizePlainText } from "@/lib/sanitize";

const requireAdminOrError = async (req: NextRequest) =>
  requireRoleOrError(req, ["admin"]);

const APPEARANCE_KEYS = ["themeColor", "background", "spacing", "borderRadius"] as const;
const BEHAVIOR_KEYS = [
  "autoplay",
  "autoplayInterval",
  "showArrows",
  "showDots",
  "countdownEnabled",
  "countdownTarget",
  "countdownEndsAt",
  "maxItems",
  "layoutVariant",
] as const;
const COUNTDOWN_TARGETS = ["end_of_day", "fixed", "off"] as const;
const LAYOUT_VARIANTS = ["grid", "carousel", "stacked", "split"] as const;

/** Normalize + validate the grouped presentation object. Returns an error string or null. */
function normalizePresentation(
  raw: unknown,
  out: { appearance: Record<string, unknown>; behavior: Record<string, unknown> }
): string | null {
  if (!raw || typeof raw !== "object") return null; // absent → keep defaults
  const p = raw as Record<string, unknown>;
  const appearance = (p.appearance ?? {}) as Record<string, unknown>;
  const behavior = (p.behavior ?? {}) as Record<string, unknown>;

  for (const key of APPEARANCE_KEYS) {
    if (appearance[key] !== undefined) {
      if (typeof appearance[key] !== "string") return `مقدار ${key} نامعتبر است`;
      out.appearance[key] = (appearance[key] as string).trim().slice(0, 128);
    }
  }
  for (const key of BEHAVIOR_KEYS) {
    const v = behavior[key];
    if (v === undefined) continue;
    if (key === "autoplay" || key === "showArrows" || key === "showDots" || key === "countdownEnabled") {
      if (typeof v !== "boolean") return `مقدار ${key} نامعتبر است`;
      out.behavior[key] = v;
    } else if (key === "autoplayInterval" || key === "maxItems") {
      const n = Number(v);
      if (!Number.isFinite(n)) return `مقدار ${key} نامعتبر است`;
      if (key === "autoplayInterval") {
        if (n < 1000) return "فاصله خودکار حداقل ۱۰۰۰ میلی‌ثانیه است";
        out.behavior[key] = Math.floor(n);
      } else {
        if (n < 1 || n > 100) return "تعداد آیتم بین ۱ تا ۱۰۰ است";
        out.behavior[key] = Math.floor(n);
      }
    } else if (key === "countdownTarget") {
      if (!COUNTDOWN_TARGETS.includes(v as (typeof COUNTDOWN_TARGETS)[number]))
        return "هدف شمارش معکوس نامعتبر است";
      out.behavior[key] = v;
    } else if (key === "countdownEndsAt") {
      if (v === null || v === "") {
        out.behavior[key] = null;
      } else {
        const d = new Date(String(v));
        if (Number.isNaN(d.getTime())) return "زمان پایان شمارش معکوس نامعتبر است";
        out.behavior[key] = d;
      }
    } else if (key === "layoutVariant") {
      if (!LAYOUT_VARIANTS.includes(v as (typeof LAYOUT_VARIANTS)[number]))
        return "نوع چیدمان نامعتبر است";
      out.behavior[key] = v;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSectionJson(section: any) {
  return {
    _id: section._id,
    slug: section.slug,
    component: section.component,
    title: section.title ?? "",
    subtitle: section.subtitle ?? "",
    enabled: section.enabled ?? true,
    sortOrder: section.sortOrder ?? 0,
    presentation: section.presentation,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
  };
}

/**
 * GET /api/admin/homepage/sections
 * Seeds the default composition when the DB is empty (idempotent), then
 * returns ALL sections (enabled + disabled, excluding soft-deleted).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    await seedHomepageContent();

    const sections = await HomepageSection.find({ deletedAt: null })
      .sort({ sortOrder: 1, slug: 1 })
      .lean();

    return NextResponse.json({ sections: sections.map(toSectionJson) });
  } catch (err) {
    console.error("Error listing homepage sections:", err);
    return serverError();
  }
}

/**
 * POST /api/admin/homepage/sections
 * Create a NEW section instance (slug + component required). Both are
 * immutable after creation — the renderer identifier is whitelisted against
 * the block registry at the boundary.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();

    if (typeof body.slug !== "string" || !body.slug.trim()) {
      return NextResponse.json({ error: "شناسه بخش (slug) الزامی است" }, { status: 400 });
    }
    const slug = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ error: "شناسه بخش نامعتبر است" }, { status: 400 });
    }
    if (typeof body.component !== "string" || !body.component.trim()) {
      return NextResponse.json({ error: "کامپوننت الزامی است" }, { status: 400 });
    }
    const component = body.component.trim();
    if (!getHomepageBlock(component)) {
      return NextResponse.json(
        { error: "کامپوننت انتخاب‌شده در رجیستری صفحه اصلی وجود ندارد" },
        { status: 400 }
      );
    }

    const existing = await HomepageSection.findOne({ slug });
    if (existing) {
      return NextResponse.json({ error: "بخشی با این شناسه قبلاً وجود دارد" }, { status: 409 });
    }

    const presentation = { appearance: {}, behavior: {} };
    const presentationError = normalizePresentation(body.presentation, presentation);
    if (presentationError) {
      return NextResponse.json({ error: presentationError }, { status: 400 });
    }

    const section = await HomepageSection.create({
      slug,
      component,
      title: sanitizePlainText(String(body.title ?? "")).slice(0, 120),
      subtitle: sanitizePlainText(String(body.subtitle ?? "")).slice(0, 300),
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
      sortOrder: Number.isFinite(Number(body.sortOrder))
        ? Math.max(0, Math.floor(Number(body.sortOrder)))
        : 0,
      presentation: {
        appearance: { ...presentation.appearance },
        behavior: { ...presentation.behavior },
      },
    });

    const lean = await HomepageSection.findById(section._id).lean();
    return NextResponse.json({ section: toSectionJson(lean as never) }, { status: 201 });
  } catch (err) {
    console.error("Error creating homepage section:", err);
    return serverError();
  }
}

/**
 * PUT /api/admin/homepage/sections?id=xxx
 * Update ONLY: title, subtitle, enabled, sortOrder, presentation.
 * slug and component are IMMUTABLE — changing them is rejected (400).
 */
export async function PUT(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "شناسه بخش الزامی است" }, { status: 400 });
    }
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "شناسه بخش نامعتبر است" }, { status: 400 });
    }

    const body = await req.json();

    if (body.slug !== undefined || body.component !== undefined) {
      return NextResponse.json(
        { error: "شناسه (slug) و کامپوننت قابل تغییر نیستند" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) {
      updateData.title = sanitizePlainText(String(body.title)).slice(0, 120);
    }
    if (body.subtitle !== undefined) {
      updateData.subtitle = sanitizePlainText(String(body.subtitle)).slice(0, 300);
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "وضعیت فعال نامعتبر است" }, { status: 400 });
      }
      updateData.enabled = body.enabled;
    }
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "ترتیب نمایش نامعتبر است" }, { status: 400 });
      }
      updateData.sortOrder = Math.floor(n);
    }
    if (body.presentation !== undefined) {
      const presentation = { appearance: {}, behavior: {} };
      const presentationError = normalizePresentation(body.presentation, presentation);
      if (presentationError) {
        return NextResponse.json({ error: presentationError }, { status: 400 });
      }
      updateData.presentation = {
        appearance: { ...presentation.appearance },
        behavior: { ...presentation.behavior },
      };
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "موردی برای به‌روزرسانی ارسال نشده است" }, { status: 400 });
    }

    const updated = await HomepageSection.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return NextResponse.json({ error: "بخش یافت نشد" }, { status: 404 });
    }
    return NextResponse.json({ section: toSectionJson(updated as never) });
  } catch (err) {
    console.error("Error updating homepage section:", err);
    return serverError();
  }
}

/**
 * DELETE /api/admin/homepage/sections?id=xxx
 * Soft-delete: sets deletedAt (public queries exclude it). Section rows stay
 * in the DB so re-enabling or auditing is possible later.
 */
export async function DELETE(req: NextRequest) {
  const { error } = await requireAdminOrError(req);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "شناسه بخش الزامی است" }, { status: 400 });
    }
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "شناسه بخش نامعتبر است" }, { status: 400 });
    }

    const section = await HomepageSection.findById(id);
    if (!section) {
      return NextResponse.json({ error: "بخش یافت نشد" }, { status: 404 });
    }

    await HomepageSection.findByIdAndUpdate(id, {
      $set: { deletedAt: new Date() },
    });
    return NextResponse.json({ message: "بخش با موفقیت حذف شد" });
  } catch (err) {
    console.error("Error deleting homepage section:", err);
    return serverError();
  }
}
