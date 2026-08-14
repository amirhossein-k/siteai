import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError } from "@/lib/auth-utils";
import Product from "@/models/Product";
import { buildPaginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/inventory/layers — Session 82 Phase D.
 *
 * Admin-only viewer of ACTIVE FIFO cost layers (remaining > 0). Fully
 * consumed layers stay auditable through /api/admin/inventory/movements.
 * Optional `product` filter; optional `variant` filter (with product).
 * Response rows carry product/variant identity + cost/value fields.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const sp = req.nextUrl.searchParams;

    const product = sp.get("product");
    if (product && !mongoose.isValidObjectId(product)) {
      return NextResponse.json({ error: "شناسه محصول نامعتبر است" }, { status: 400 });
    }
    const variant = sp.get("variant");
    if (variant && !mongoose.isValidObjectId(variant)) {
      return NextResponse.json({ error: "شناسه تنوع نامعتبر است" }, { status: 400 });
    }

    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20)
    );

    const query: Record<string, unknown> = {
      sourcing: "purchased",
      $or: [
        { costLayers: { $elemMatch: { remaining: { $gt: 0 } } } },
        { variants: { $elemMatch: { costLayers: { $elemMatch: { remaining: { $gt: 0 } } } } } },
      ],
    };
    if (product) query._id = product;

    const products = await Product.find(query)
      .select("name slug hasVariants costLayers variants")
      .lean();

    // Flatten active layers into rows.
    const rows: Array<{
      productId: string;
      productName: string;
      slug: string;
      variantId: string | null;
      variantSku: string;
      variantLabel: string;
      qty: number;
      remaining: number;
      unitCost: number;
      value: number;
      acquiredAt: Date;
      source: string;
      ref: string;
    }> = [];
    for (const p of products) {
      const productIdStr = String(p._id);
      if (p.hasVariants && Array.isArray(p.variants) && p.variants.length > 0) {
        for (const v of p.variants as Array<{
          _id: unknown;
          sku?: string;
          variantLabel?: string;
          attributes?: Array<{ name: string; value: string }>;
          costLayers?: Array<{
            qty: number;
            remaining: number;
            unitCost: number;
            acquiredAt: Date;
            source: string;
            ref: string;
          }>;
        }>) {
          if (variant && String(v._id) !== String(variant)) continue;
          for (const l of v.costLayers ?? []) {
            if (l.remaining <= 0) continue;
            const label =
              v.variantLabel ||
              (v.attributes ?? [])
                .map((a) => `${a.name}: ${a.value}`)
                .join("، ");
            rows.push({
              productId: productIdStr,
              productName: p.name,
              slug: p.slug,
              variantId: String(v._id),
              variantSku: v.sku || "",
              variantLabel: label,
              qty: l.qty,
              remaining: l.remaining,
              unitCost: l.unitCost,
              value: l.remaining * l.unitCost,
              acquiredAt: l.acquiredAt,
              source: l.source,
              ref: l.ref,
            });
          }
        }
      } else {
        for (const l of (p.costLayers ?? []) as Array<{
          qty: number;
          remaining: number;
          unitCost: number;
          acquiredAt: Date;
          source: string;
          ref: string;
        }>) {
          if (l.remaining <= 0) continue;
          rows.push({
            productId: productIdStr,
            productName: p.name,
            slug: p.slug,
            variantId: null,
            variantSku: "",
            variantLabel: "",
            qty: l.qty,
            remaining: l.remaining,
            unitCost: l.unitCost,
            value: l.remaining * l.unitCost,
            acquiredAt: l.acquiredAt,
            source: l.source,
            ref: l.ref,
          });
        }
      }
    }

    rows.sort((a, b) => b.acquiredAt.getTime() - a.acquiredAt.getTime());
    const total = rows.length;
    const bounded = rows.slice((page - 1) * limit, (page - 1) * limit + limit);

    return NextResponse.json(buildPaginatedResponse(bounded, total, page, limit));
  } catch (err) {
    console.error("[InventoryLayers] GET failed:", err);
    return NextResponse.json({ error: "خطا در دریافت لایه‌های هزینه" }, { status: 500 });
  }
}
