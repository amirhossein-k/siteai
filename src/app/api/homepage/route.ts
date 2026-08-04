import { NextResponse } from "next/server";
import { getHomepageComposition } from "@/lib/homepage-content";
import { serverError } from "@/lib/auth-utils";

/**
 * GET /api/homepage — PUBLIC homepage composition (Session 53).
 *
 * Returns the full storefront composition: enabled, non-deleted sections in
 * sortOrder, each with its PUBLISHED + active + non-deleted content rows
 * (strict projection — internal fields like status/publishedAt/isActive are
 * NEVER exposed). When the CMS has never been bootstrapped, falls back to
 * the Session 50 static configuration so the storefront is never empty.
 *
 * Response: { sections: Array<{ slug, component, title, subtitle,
 * presentation, content: [...] }> }
 */
export async function GET() {
  try {
    const composition = await getHomepageComposition();
    return NextResponse.json(composition, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Error building homepage composition:", error);
    return serverError();
  }
}
