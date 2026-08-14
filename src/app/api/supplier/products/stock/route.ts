import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import Product from "@/models/Product";
import { setVariantStock } from "@/lib/inventory";
import { isInventoryInitialized } from "@/lib/inventory-adjustments";

/**
 * POST /api/supplier/products/stock
 *
 * Supplier variant stock quick-edit — update a variant's stock directly
 * without opening the full product form.
 *
 * Authorization:
 *  - Supplier only (requireRoleOrError)
 *  - Ownership enforced: product must belong to the caller's supplier
 *
 * Stock safety (reuses the SINGLE inventory helper, no second system):
 *  - setVariantStock() = atomic optimistic-lock update (stockVersion),
 *    never negative, top-level summary stock kept in sync atomically
 *  - 409 on concurrent modification (version mismatch)
 *  - 400 on invalid variant / missing fields
 *  - 404 on product not owned / not found
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const productId: unknown = body?.productId;
    const variantId: unknown = body?.variantId;
    const stock: unknown = body?.stock;

    if (
      typeof productId !== "string" ||
      !mongoose.isValidObjectId(productId) ||
      typeof variantId !== "string" ||
      !mongoose.isValidObjectId(variantId)
    ) {
      return NextResponse.json(
        { error: "شناسه محصول یا تنوع نامعتبر است" },
        { status: 400 }
      );
    }

    if (
      typeof stock !== "number" ||
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      return NextResponse.json(
        { error: "موجودی باید عدد صحیح و غیرمنفی باشد" },
        { status: 400 }
      );
    }

    // --- Ownership: product must belong to this supplier ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product: any = await Product.findOne({
      _id: productId,
      supplier: supplier._id,
    }).lean();

    if (!product) {
      return NextResponse.json(
        { error: "محصول یافت نشد یا متعلق به شما نیست" },
        { status: 404 }
      );
    }

    // Session 82 Phase D — post-cutover enforcement: once accounting is
    // initialized, direct variant stock edits are rejected (admin must use
    // the /admin/inventory adjustment mechanism so the ledger stays complete).
    if (await isInventoryInitialized()) {
      return NextResponse.json(
        {
          error:
            "پس از فعال‌شدن حسابداری، تغییر مستقیم موجودی ممکن نیست — مدیر باید از صفحه «انبار» (تعدیل موجودی) استفاده کند",
        },
        { status: 400 }
      );
    }

    if (product.hasVariants !== true) {
      return NextResponse.json(
        { error: "این محصول تنوع ندارد" },
        { status: 400 }
      );
    }

    // --- Validate variant existence ---
    const variantExists = (product.variants || []).some(
      (v: { _id: unknown }) => String(v._id) === String(variantId)
    );
    if (!variantExists) {
      return NextResponse.json(
        { error: "تنوع مورد نظر یافت نشد" },
        { status: 400 }
      );
    }

    // --- Atomic update via the shared helper ---
    const updated = await setVariantStock(
      String(productId),
      String(variantId),
      stock as number
    );

    if (!updated) {
      return NextResponse.json(
        {
          error:
            "موجودی این تنوع به‌صورت هم‌زمان تغییر کرده است. لطفاً دوباره تلاش کنید.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Error quick-editing variant stock:", err);
    return serverError();
  }
}
