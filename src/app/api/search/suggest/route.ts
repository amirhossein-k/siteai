/**
 * Session 49 — Search Autocomplete / Suggestions (Phase 2 of Session 48).
 *
 * Pure read-only endpoint: `GET /api/search/suggest?q=<prefix>`.
 * Returns up to 10 matching product names + brand names (active only) that
 * start with the given prefix, case-insensitive. No auth required — the
 * public catalog already exposes search without login.
 *
 * Rate-limited per IP (30/15min) to prevent scraping.
 * No schema changes, no indexes, no model changes.
 */

import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { rateLimit } from "@/lib/rate-limiter";
import { escapeRegex } from "@/lib/pagination";
import Product from "@/models/Product";
import Brand from "@/models/Brand";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    // Rate limit: 30 requests per 15 minutes per IP.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const rl = await rateLimit(`search-suggest:${ip}`, {
      max: 30,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const safePattern = escapeRegex(q);

    // Query active product names (prefix match, case-insensitive). Limit to 8.
    const productNames = await Product.find({
      isActive: true,
      name: { $regex: `^${safePattern}`, $options: "i" },
    })
      .select("name")
      .sort({ name: 1 })
      .limit(8)
      .lean();

    // Query active brand names (prefix match, case-insensitive). Limit to 4.
    const brandNames = await Brand.find({
      isActive: true,
      name: { $regex: `^${safePattern}`, $options: "i" },
    })
      .select("name")
      .sort({ name: 1 })
      .limit(4)
      .lean();

    // Merge unique names, product names first, then brand names, up to 10.
    const seen = new Set<string>();
    const suggestions: string[] = [];

    for (const p of productNames) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        suggestions.push(p.name);
      }
    }
    for (const b of brandNames) {
      if (!seen.has(b.name)) {
        seen.add(b.name);
        suggestions.push(b.name);
      }
      if (suggestions.length >= 10) break;
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Error fetching search suggestions:", error);
    return NextResponse.json(
      { error: "خطا در دریافت پیشنهادات جستجو" },
      { status: 500 }
    );
  }
}