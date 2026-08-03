import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Wishlist from "@/models/Wishlist";
import Product from "@/models/Product";
import { rateLimit } from "@/lib/rate-limiter";

/**
 * POST /api/wishlist/add-to-cart — Wishlist → Cart bulk resolver (Session 38).
 *
 * API-assisted design: this endpoint resolves the customer's wishlist rows
 * against FRESH product/variant state and returns ready-to-add cart payloads;
 * the client adds them to the Zustand cart store (addItem is idempotent on the
 * composite key and clamps quantity to maxQuantity). It NEVER reserves stock —
 * reserveStock() stays exclusive to POST /api/checkout, which remains the
 * single source of truth for price/stock/inventory. Wishlist rows are NEVER
 * modified (keep-in-wishlist design).
 *
 * Contract:
 *   Body:  optional { productIds?: string[] }
 *          - missing / empty array → process ALL of the customer's wishlist rows
 *          - provided             → process only rows whose product is in the
 *            list. Foreign ids can't match this user's rows, so they are
 *            ignored safely (no IDOR).
 *   200 → { added: Array<{ id, variantId?, sku?, variantLabel?, slug, name,
 *                          price, maxQuantity, image?, variant? }>,
 *           addedCount,
 *           skipped: Array<{ productId, reason }>,
 *           skippedCount }
 *          reason ∈ "deleted" | "inactive" | "out_of_stock" | "no_available_variant"
 *
 * Validation order: auth → payload validation → rate limit → DB resolution.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    // --- Payload validation BEFORE the rate limiter (Session 34 convention) ---
    let productIds: string[] | undefined;
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    if (body && typeof body === "object") {
      const raw = (body as { productIds?: unknown }).productIds;
      if (raw !== undefined && raw !== null) {
        if (
          !Array.isArray(raw) ||
          raw.length > 500 ||
          raw.some(
            (id) => typeof id !== "string" || !mongoose.isValidObjectId(id)
          )
        ) {
          return NextResponse.json(
            { error: "شناسه محصول نامعتبر است" },
            { status: 400 }
          );
        }
        productIds = raw as string[];
      }
    }

    // --- Rate limit (dedicated key — independent of the wishlist 30/15min) ---
    const rl = await rateLimit("wishlist-cart:" + token!.id, {
      max: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // --- DB resolution: rows always scoped to the authenticated user ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any = { user: token!.id };
    if (productIds && productIds.length > 0) {
      filter.product = { $in: productIds };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await Wishlist.find(filter)
      .select("product variantId createdAt")
      .lean();

    if (rows.length === 0) {
      return NextResponse.json({
        added: [],
        addedCount: 0,
        skipped: [],
        skippedCount: 0,
      });
    }

    // Dedupe product ids (a product can appear once per user, but be safe)
    const productIdSet = [
      ...new Set(rows.map((row) => String(row.product))),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const products: any[] = await Product.find({ _id: { $in: productIdSet } })
      .select("name slug price stock images isActive hasVariants variants")
      .lean();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    const added: Array<{
      id: string;
      variantId?: string;
      sku?: string;
      variantLabel?: string;
      slug: string;
      name: string;
      price: number;
      maxQuantity: number;
      image?: string;
      variant?: { id: string; sku?: string; label?: string };
    }> = [];
    const skipped: Array<{ productId: string; reason: string }> = [];

    for (const row of rows) {
      const productId = String(row.product);
      const product = productMap.get(productId);

      if (!product) {
        skipped.push({ productId, reason: "deleted" });
        continue;
      }
      if (product.isActive === false) {
        skipped.push({ productId, reason: "inactive" });
        continue;
      }

      const hasVariants =
        !!product.hasVariants &&
        Array.isArray(product.variants) &&
        product.variants.length > 0;

      if (hasVariants) {
        // Prefer an existing wishlist variantId (future variant-wishlist
        // compatibility — the Wishlist model already reserves the field)…
        let variant = null;
        if (row.variantId) {
          variant = product.variants.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v: any) =>
              String(v._id) === String(row.variantId) &&
              v.isActive !== false &&
              (v.stock ?? 0) > 0
          );
        }
        // …fall back to the first available ACTIVE variant with stock
        // (matches the storefront VariantSelector auto-select semantics).
        if (!variant) {
          variant = product.variants.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v: any) => v.isActive !== false && (v.stock ?? 0) > 0
          );
        }
        if (!variant) {
          skipped.push({ productId, reason: "no_available_variant" });
          continue;
        }

        const variantLabel =
          variant.attributes && variant.attributes.length > 0
            ? variant.attributes
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((a: { name: string; value: string }) => `${a.name}: ${a.value}`)
                .join("، ")
            : "";

        added.push({
          id: productId,
          variantId: String(variant._id),
          sku: variant.sku || undefined,
          variantLabel: variantLabel || undefined,
          slug: product.slug || productId,
          name: variantLabel
            ? `${product.name} — ${variantLabel}`
            : product.name,
          price: variant.price,
          maxQuantity: variant.stock,
          image: variant.images?.[0] || product.images?.[0] || undefined,
          // Extensible — reserved for future variant metadata
          variant: {
            id: String(variant._id),
            sku: variant.sku || undefined,
            label: variantLabel || undefined,
          },
        });
      } else {
        if ((product.stock ?? 0) <= 0) {
          skipped.push({ productId, reason: "out_of_stock" });
          continue;
        }
        added.push({
          id: productId,
          slug: product.slug || productId,
          name: product.name,
          price: product.price,
          maxQuantity: product.stock,
          image: product.images?.[0] || undefined,
        });
      }
    }

    return NextResponse.json({
      added,
      addedCount: added.length,
      skipped,
      skippedCount: skipped.length,
    });
  } catch (error) {
    console.error("Error resolving wishlist → cart:", error);
    return serverError();
  }
}
