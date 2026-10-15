import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import Product from "@/models/Product";
import { dbConnect } from "@/lib/dbConnect";
import { applyEffectivePricing } from "@/lib/product-pricing";
import { computeRatingSummaries } from "@/lib/rating-summary";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ products: [] });
  }

  try {
    await dbConnect();
    const current = await Product.findOne({ _id: id, isActive: true })
      .select("category brand tags")
      .lean();
    if (!current) return NextResponse.json({ products: [] });

    const viewed = new Set(
      (new URL(req.url).searchParams.get("viewed") || "")
        .split(",")
        .filter((value) => mongoose.isValidObjectId(value))
    );
    const candidates = await Product.find({
      _id: { $ne: id },
      isActive: true,
      stock: { $gt: 0 },
      $or: [
        { category: current.category },
        ...(current.brand ? [{ brand: current.brand }] : []),
        ...(Array.isArray(current.tags) && current.tags.length > 0
          ? [{ tags: { $in: current.tags } }]
          : []),
      ],
    })
      .select("-soldCount")
      .populate("category", "name slug")
      .populate("brand", "name slug logo")
      .populate("supplier", "_id businessName")
      .sort({ soldCount: -1, createdAt: -1 })
      .limit(24)
      .lean();

    const ordered = [...candidates].sort((a, b) => {
      const score = (item: typeof a) =>
        (viewed.has(String(item._id)) ? 30 : 0) +
        (String(item.category?._id || item.category) === String(current.category) ? 20 : 0) +
        (String(item.brand?._id || item.brand) === String(current.brand) ? 15 : 0);
      return score(b) - score(a);
    }).slice(0, 8);

    const ratings = await computeRatingSummaries(ordered.map((item) => String(item._id)));
    const products = ordered.map((item) => {
      const priced = applyEffectivePricing(
        JSON.parse(JSON.stringify(item)) as Parameters<typeof applyEffectivePricing>[0]
      );
      return { ...priced, ratingSummary: ratings.get(String(item._id)) || { average: 0, count: 0 } };
    });
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Error fetching related products:", error);
    return NextResponse.json({ products: [] });
  }
}
