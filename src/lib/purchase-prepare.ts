import Product from "@/models/Product";
import type { PurchaseItemInput } from "@/types";

export interface PreparedPurchaseItem {
  product: string;
  variantId: string | null;
  name: string;
  variantLabel: string;
  quantity: number;
  unitCost: number;
}

export type PrepareResult =
  | { ok: true; items: PreparedPurchaseItem[] }
  | { ok: false; error: string; status: number };

/**
 * Validate + snapshot purchase items against the CURRENT products:
 *  - every product must exist
 *  - every product must be `sourcing: "purchased"` (Phase A invariant —
 *    receiving can never silently convert consignment inventory)
 *  - variant products require a valid variantId; simple products forbid it
 *  - names/variant labels are snapshotted from the product docs
 *
 * Shared by create + update so the two can never drift.
 */
export async function preparePurchaseItems(
  items: PurchaseItemInput[]
): Promise<PrepareResult> {
  const productIds = [...new Set(items.map((it) => it.product))];
  const products = await Product.find({ _id: { $in: productIds } })
    .select("name sourcing hasVariants variants.sku variants._id")
    .lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const prepared: PreparedPurchaseItem[] = [];
  for (const it of items) {
    const product = productById.get(it.product);
    if (!product) {
      return { ok: false, error: "کالایی در خرید یافت نشد", status: 400 };
    }
    if (product.sourcing !== "purchased") {
      return {
        ok: false,
        error: `کالای «${String(product.name)}» در حالت امانی است — ابتدا از طریق حسابداری به حالت خریداری‌شده تبدیل شود`,
        status: 400,
      };
    }
    const hasVariants = product.hasVariants === true;
    const variants = (product.variants as Array<Record<string, unknown>>) || [];
    let variantLabel = "";
    if (hasVariants) {
      if (!it.variantId) {
        return {
          ok: false,
          error: `برای کالای «${String(product.name)}» تنوع الزامی است`,
          status: 400,
        };
      }
      const variant = variants.find((v) => String(v._id) === String(it.variantId));
      if (!variant) {
        return { ok: false, error: "تنوع یافت نشد", status: 400 };
      }
      variantLabel = String(variant.sku || "");
    } else if (it.variantId) {
      return { ok: false, error: "این کالا تنوع ندارد", status: 400 };
    }
    prepared.push({
      product: it.product,
      variantId: it.variantId ? String(it.variantId) : null,
      name: String(product.name || ""),
      variantLabel,
      quantity: it.quantity,
      unitCost: it.unitCost,
    });
  }
  return { ok: true, items: prepared };
}
