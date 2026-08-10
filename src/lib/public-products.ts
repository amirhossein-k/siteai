import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import Product from "@/models/Product";
import Review from "@/models/Review";
import type { RatingSummary, RichDescriptionNode, ProductVariant } from "@/types";

/**
 * Public product detail loader (Session 71) — the SINGLE implementation of
 * the public product shape, shared by GET /api/products (id/slug detail path)
 * and the product page Server Component (SSR metadata + JSON-LD).
 *
 * The response is byte-identical to the previous inline route logic:
 *   - `isActive`-only filter — the LIST path additionally requires stock > 0,
 *     the DETAIL path intentionally does not (out-of-stock pages are valid
 *     and indexable; the page renders «ناموجود»),
 *   - `soldCount` excluded (internal best-sellers counter — never public),
 *   - category/supplier/brand/tags populated with the same projections,
 *   - `ratingSummary` computed from APPROVED reviews only.
 *
 * A JSON round-trip produces exactly the shape NextResponse.json emits
 * (ObjectIds → hex strings, Dates → ISO strings) — which also makes the value
 * safe to pass as a Server-Component prop across the RSC boundary.
 */

export interface PublicProduct {
  _id: string;
  name: string;
  slug: string;
  description: string;
  descriptionRich?: RichDescriptionNode[];
  price: number;
  images: string[];
  category: string | { _id: string; name: string; slug?: string };
  stock: number;
  brand?:
    | string
    | { _id: string; name: string; slug?: string; logo?: string }
    | null;
  supplier?:
    | string
    | { _id: string; businessName: string; logo?: string }
    | null;
  tags?: Array<{ _id: string; name: string; slug: string } | string | null>;
  hasVariants?: boolean;
  variants?: ProductVariant[];
  ratingSummary: RatingSummary;
  createdAt: string;
  updatedAt: string;
}

/** Approved-reviews aggregate (average rounded to 1 decimal + count). */
export async function computeRatingSummary(
  productId: unknown
): Promise<RatingSummary> {
  const aggregate = await Review.aggregate([
    {
      $match: {
        product: new mongoose.Types.ObjectId(String(productId)),
        status: "approved",
      },
    },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return aggregate.length > 0
    ? {
        average: Math.round(aggregate[0].average * 10) / 10,
        count: aggregate[0].count,
      }
    : { average: 0, count: 0 };
}

async function queryPublicProduct(
  filter: Record<string, unknown>
): Promise<PublicProduct | null> {
  await dbConnect();
  const product = await Product.findOne(filter)
    .select("-soldCount")
    .populate("category", "name slug")
    .populate("supplier", "_id businessName logo")
    .populate("brand", "name slug logo")
    .populate("tags", "name slug")
    .lean();
  if (!product) return null;
  // JSON round-trip: ObjectIds → hex strings, Dates → ISO strings — identical
  // to NextResponse.json's serialization and safe for RSC props.
  const plain = JSON.parse(JSON.stringify(product)) as PublicProduct;
  plain.ratingSummary = await computeRatingSummary(plain._id);
  return plain;
}

/** Detail by slug (public product page). */
export function getPublicProductBySlug(
  slug: string
): Promise<PublicProduct | null> {
  return queryPublicProduct({ slug, isActive: true });
}

/** Detail by id — callers must guard malformed ids (CastError → 500). */
export function getPublicProductById(
  id: string
): Promise<PublicProduct | null> {
  return queryPublicProduct({ _id: id, isActive: true });
}
