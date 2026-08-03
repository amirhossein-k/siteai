import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import Brand from "@/models/Brand";

/**
 * GET /api/brands — public facet list (Session 47).
 * Active brands only, STRICT projection (_id, name, slug) — the same
 * read-only pattern as /api/categories. No auth, no rate limit (mirrors the
 * public categories precedent). Pure read — never mutates.
 */
export async function GET() {
  try {
    await dbConnect();

    const brands = await Brand.find({ isActive: true })
      .select("name slug")
      .sort({ name: 1 })
      .lean();

    return NextResponse.json(brands);
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { error: "خطا در دریافت برندها" },
      { status: 500 }
    );
  }
}
