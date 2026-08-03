import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Wishlist from "@/models/Wishlist";
import Product from "@/models/Product";
import { rateLimit } from "@/lib/rate-limiter";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * Customer Wishlist (Sessions 35 + 43).
 *
 * GET    /api/wishlist?page=&limit=  — paginated wishlist rows (newest
 *        first). Product-level rows (variantId null) and variant-level rows
 *        (variantId + variantSnapshot) coexist. Deleted products stay as rows
 *        but return `product: null` (rendered as an "unavailable" placeholder
 *        by the UI); inactive products return their document with
 *        isActive:false — NEVER silently removed from the list.
 *
 * POST   /api/wishlist { productId, variantId? } — add (idempotent via unique
 *        { user, product, variantId } index; duplicate → 200 { added: false }).
 *        variantId is validated: it must belong to the product AND be an
 *        active variant; when provided, a variantSnapshot { sku, label } is
 *        denormalized at save time. variantId absent → product-level row.
 *        Rate-limited 30/15min per customer.
 *
 * DELETE /api/wishlist { productId, variantId? } — remove (idempotent).
 *        variantId present → removes exactly that variant row;
 *        variantId absent → removes ALL rows for the product (product-level +
 *        every variant row) — this is the "remove product from wishlist"
 *        semantics used by the product-card heart.
 *        Rate-limited 30/15min per customer.
 *
 * Authorization: customer only (requireRoleOrError → 401/403); every query is
 * scoped to token.id (no IDOR). Read-only product population — inventory,
 * payment, checkout untouched.
 */
export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = parsePaginationParams(searchParams);

    const filter = { user: token!.id };

    // Two-query approach (NOT .populate().lean()): Mongoose leaves a missing
    // ref as a raw ObjectId with lean+populate, which breaks the
    // deleted-product placeholder. Fetching the wishlist rows and the products
    // separately gives a deterministic `productId` (always the raw ref) and
    // `product: null` when the product doc is gone.
    const [total, rows] = await Promise.all([
      Wishlist.countDocuments(filter),
      Wishlist.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("product variantId variantSnapshot createdAt")
        .lean(),
    ]);

    const productIds = rows.map((row) => String(row.product));
    const products = await Product.find({ _id: { $in: productIds } })
      .select("name slug price stock images hasVariants isActive category")
      .lean();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    // Keep every wishlist row (never silently drop). A deleted product maps to
    // `product: null` — the UI renders an unavailable placeholder. `productId`
    // is carried separately so the customer can still remove the row even when
    // the product document no longer exists. Variant rows additionally expose
    // `variantId` + the saved `variantSnapshot` (sku/label) so the UI can
    // render WHICH variant was saved.
    const data = rows.map((row) => {
      const productId = String(row.product);
      return {
        _id: row._id,
        productId,
        product: productMap.get(productId) || null,
        variantId: row.variantId ? String(row.variantId) : null,
        variantSnapshot: row.variantId ? row.variantSnapshot || null : null,
        createdAt: row.createdAt,
      };
    });

    return NextResponse.json(buildPaginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const productId: unknown = body?.productId;
    const variantId: unknown = body?.variantId ?? null;

    // Validate the payload BEFORE the rate limiter so malformed requests
    // don't burn a legit customer's wishlist quota (Session 34 convention).
    if (
      typeof productId !== "string" ||
      !mongoose.isValidObjectId(productId)
    ) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }
    if (variantId !== null && variantId !== undefined) {
      if (typeof variantId !== "string" || !mongoose.isValidObjectId(variantId)) {
        return NextResponse.json(
          { error: "شناسه تنوع نامعتبر است" },
          { status: 400 }
        );
      }
    }

    // Lightweight abuse protection (wishlist-bombing)
    const rl = await rateLimit("wishlist:" + token!.id, {
      max: 30,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // Product must exist and be ACTIVE to be added.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product: any = await Product.findOne({ _id: productId, isActive: true })
      .select("hasVariants variants")
      .lean();
    if (!product) {
      return NextResponse.json(
        { error: "محصول یافت نشد" },
        { status: 404 }
      );
    }

    // Variant validation (Session 43): variantId must belong to the product
    // AND be an active variant. Never silently fall back to a default variant
    // on the write path — if a variantId is supplied, it must be valid.
    let variantSnapshot: { sku: string; label: string } | undefined;
    if (variantId) {
      const hasVariants =
        !!product.hasVariants &&
        Array.isArray(product.variants) &&
        product.variants.length > 0;
      const variant = hasVariants
        ? (product.variants as any[]).find(
            (v) => String(v._id) === String(variantId)
          )
        : undefined;

      if (!variant) {
        return NextResponse.json(
          { error: "تنوع محصول یافت نشد" },
          { status: 400 }
        );
      }
      if (variant.isActive === false) {
        return NextResponse.json(
          { error: "این تنوع محصول فعال نیست" },
          { status: 400 }
        );
      }

      const label =
        variant.attributes && variant.attributes.length > 0
          ? variant.attributes
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((a: { name: string; value: string }) => `${a.name}: ${a.value}`)
              .join("، ")
          : "";
      variantSnapshot = {
        sku: variant.sku || "",
        label: label || "",
      };
    }

    // Idempotent add — unique { user, product, variantId } index makes
    // concurrent duplicates safe (variantId null = product-level row).
    const existing = await Wishlist.findOne({
      user: token!.id,
      product: productId,
      variantId: variantId || null,
    }).lean();
    if (existing) {
      return NextResponse.json({ added: false }, { status: 200 });
    }

    await Wishlist.create({
      user: token!.id,
      product: productId,
      variantId: variantId || null,
      // null snapshot on product-level rows — the GET contract returns null
      // (variantSnapshot present ONLY on variant-level rows, Session 43).
      variantSnapshot: variantSnapshot || null,
    });
    return NextResponse.json({ added: true }, { status: 201 });
  } catch (error) {
    // E11000 race backstop → already present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (error && (error as any).code === 11000) {
      return NextResponse.json({ added: false }, { status: 200 });
    }
    console.error("Error adding to wishlist:", error);
    return serverError();
  }
}

export async function DELETE(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["customer"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const productId: unknown = body?.productId;
    const variantId: unknown = body?.variantId ?? null;

    // Validate BEFORE the rate limiter (Session 34 convention)
    if (
      typeof productId !== "string" ||
      !mongoose.isValidObjectId(productId)
    ) {
      return NextResponse.json(
        { error: "شناسه محصول نامعتبر است" },
        { status: 400 }
      );
    }
    if (variantId !== null && variantId !== undefined) {
      if (typeof variantId !== "string" || !mongoose.isValidObjectId(variantId)) {
        return NextResponse.json(
          { error: "شناسه تنوع نامعتبر است" },
          { status: 400 }
        );
      }
    }

    const rl = await rateLimit("wishlist:" + token!.id, {
      max: 30,
      windowMs: 15 * 60 * 1000,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های شما زیاد است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // Idempotent remove — scoped to the authenticated user.
    // variantId present → delete exactly that variant row.
    // variantId absent → delete ALL rows for the product (product-level +
    // every variant row) — the product-card heart uses this to "remove the
    // product from the wishlist" regardless of how it was saved.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = { user: token!.id, product: productId };
    if (variantId) {
      query.variantId = variantId;
    }
    const res = variantId
      ? await Wishlist.deleteOne(query)
      : await Wishlist.deleteMany(query);
    return NextResponse.json({ removed: res.deletedCount > 0 }, { status: 200 });
  } catch (error) {
    console.error("Error removing from wishlist:", error);
    return serverError();
  }
}
