import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import Tag from "@/models/Tag";

/**
 * GET /api/tags — public facet list (Session 47).
 * Active tags only, STRICT projection (_id, name, slug) — the same read-only
 * pattern as /api/categories and /api/brands. No auth, no rate limit (public
 * categories precedent). Pure read — never mutates.
 */
export async function GET() {
  try {
    await dbConnect();

    const tags = await Tag.find({ isActive: true })
      .select("name slug")
      .sort({ name: 1 })
      .lean();

    return NextResponse.json(tags);
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      { error: "خطا در دریافت برچسب‌ها" },
      { status: 500 }
    );
  }
}
