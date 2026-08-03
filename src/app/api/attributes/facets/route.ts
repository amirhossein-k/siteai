import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import Product from "@/models/Product";
import Attribute from "@/models/Attribute";
import { escapeRegex } from "@/lib/pagination";

/**
 * GET /api/attributes/facets — attribute facet counts for the storefront
 * catalog (Session 47 extension).
 *
 * Accepts the SAME filter params as GET /api/products (category, supplier,
 * brand, tag, search, minPrice, maxPrice) plus the nested attribute
 * selections (attributes[<slug>]=<value>). Returns per-attribute value counts
 * computed over the CURRENTLY VISIBLE product set (isActive + stock > 0 +
 * filters + selections).
 *
 * Sticky-facet semantics: when counting the values of attribute A, A's own
 * selection is excluded from the match (so picking red keeps blue visible
 * with an accurate count), while selections on OTHER attributes still apply.
 *
 * Aggregation strategy: ONE pipeline unwinds variants → attributes, groups by
 * (attributeId, value) with $addToSet of product _ids (distinct products, so
 * a product with two variants sharing a value counts once), then self-exclusion
 * is applied per-attribute by intersecting product sets in JS. No indexes, no
 * schema changes.
 *
 * Response: { facets: [{ slug, name, type, values: [{ value, count }] }] }
 * Only ACTIVE attributes with at least one value are returned. Counts always
 * reflect the current filter context (sticky behavior).
 */
export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const supplier = searchParams.get("supplier");
    const brand = searchParams.get("brand");
    const tag = searchParams.get("tag");
    const search = searchParams.get("search");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");

    // Product-level match — mirrors /api/products list behavior exactly.
    const filter: Record<string, unknown> = {
      isActive: true,
      stock: { $gt: 0 },
    };

    // NOTE: the aggregation $match does NOT auto-cast string ids to ObjectId
    // the way find() does — cast explicitly after validation (verified against
    // a failing test run where string ids silently matched nothing).
    if (category) {
      if (!mongoose.isValidObjectId(category)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.category = new mongoose.Types.ObjectId(category);
    }

    if (supplier) {
      if (!mongoose.isValidObjectId(supplier)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.supplier = new mongoose.Types.ObjectId(supplier);
    }

    if (brand) {
      if (!mongoose.isValidObjectId(brand)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.brand = new mongoose.Types.ObjectId(brand);
    }

    if (tag) {
      if (!mongoose.isValidObjectId(tag)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.tags = new mongoose.Types.ObjectId(tag);
    }

    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { description: { $regex: safeSearch, $options: "i" } },
      ];
    }

    if (minPrice || maxPrice) {
      const priceFilter: Record<string, number> = {};
      if (minPrice) priceFilter.$gte = parseInt(minPrice);
      if (maxPrice) priceFilter.$lte = parseInt(maxPrice);
      filter.price = priceFilter;
    }

    // --- Attribute selections: attributes[<slug>]=<value> ---
    const attributeSelections: Array<{ slug: string; value: string }> = [];
    for (const [key, value] of searchParams.entries()) {
      const match = key.match(/^attributes\[(.+)\]$/);
      if (match && value) attributeSelections.push({ slug: match[1], value });
    }

    // Load all attributes so we can resolve slugs AND know which are active.
    const allAttributes = await Attribute.find({})
      .select("name slug type values isActive")
      .sort({ name: 1 })
      .lean();

    const activeAttributes = allAttributes.filter((a) => a.isActive);
    const idBySlug = new Map(
      allAttributes.map((a) => [a.slug, String(a._id)])
    );

    // Resolve selections; unknown slug -> no product can match -> empty facets.
    const selected: Array<{ attributeId: string; value: string; slug: string }> =
      [];
    let unknownSlug = false;
    for (const sel of attributeSelections) {
      const attrId = idBySlug.get(sel.slug);
      if (!attrId) {
        unknownSlug = true;
        break;
      }
      selected.push({ attributeId: attrId, value: sel.value, slug: sel.slug });
    }

    let facets: Array<{
      slug: string;
      name: string;
      type: string;
      values: Array<{ value: string; count: number }>;
    }> = [];

    if (!unknownSlug) {
      // One aggregation: unwind variants -> attributes, group distinct products
      // per (attributeId, value). The base match is PRODUCT-LEVEL filters only
      // (isActive/stock/category/supplier/brand/tag/search/price) — attribute
      // selections are applied in JS as set intersections below. This is what
      // makes sticky self-exclusion correct: counting attribute A's values must
      // NOT be constrained by A's own selection in the DB layer (otherwise the
      // other values of A would vanish once A is selected).
      const rows = await Product.aggregate([
        { $match: filter },
        { $unwind: "$variants" },
        { $match: { "variants.isActive": true } },
        { $unwind: "$variants.attributes" },
        {
          $group: {
            _id: {
              attributeId: "$variants.attributes.attributeId",
              value: "$variants.attributes.value",
            },
            productIds: { $addToSet: "$_id" },
          },
        },
      ]);

      // valueSets: `${attrId}\u0000${value}` -> Set of product ids.
      const valueSets = new Map<string, Set<string>>();
      for (const row of rows) {
        const attrId = String(row._id.attributeId);
        const key = attrId + "\u0000" + row._id.value;
        if (!valueSets.has(key)) valueSets.set(key, new Set());
        for (const pid of row.productIds) valueSets.get(key)!.add(String(pid));
      }

      // selectedIdsBySlug: the product sets matching each applied selection.
      const selectedIdsBySlug = new Map<string, Set<string>>();
      for (const sel of selected) {
        selectedIdsBySlug.set(
          sel.slug,
          valueSets.get(sel.attributeId + "\u0000" + sel.value) || new Set()
        );
      }

      for (const attr of activeAttributes) {
        const attrId = String(attr._id);
        const prefix = attrId + "\u0000";

        // Sticky semantics: exclude this attribute's OWN selection from the
        // context (so other values of the same attribute stay visible), but
        // keep all other applied selections.
        const contextSets: Set<string>[] = [];
        for (const sel of selected) {
          if (sel.slug === attr.slug) continue;
          contextSets.push(selectedIdsBySlug.get(sel.slug) || new Set());
        }

        const values: Array<{ value: string; count: number }> = [];
        for (const [key, set] of valueSets) {
          if (!key.startsWith(prefix)) continue;
          const value = key.slice(prefix.length);

          let count = 0;
          // Every context intersection is a subset of baseVisible, so iterate
          // the smaller side when possible.
          if (contextSets.length === 0) {
            count = set.size;
          } else {
            const smallest =
              contextSets.reduce(
                (min, s) => (s.size < min.size ? s : min),
                contextSets[0]
              );
            for (const pid of smallest) {
              if (!set.has(pid)) continue;
              let inAll = true;
              for (const ctx of contextSets) {
                if (!ctx.has(pid)) {
                  inAll = false;
                  break;
                }
              }
              if (inAll) count++;
            }
          }

          if (count > 0) values.push({ value, count });
        }

        if (values.length > 0) {
          values.sort(
            (a, b) => b.count - a.count || a.value.localeCompare(b.value)
          );
          facets.push({ slug: attr.slug, name: attr.name, type: attr.type, values });
        }
      }
    }

    return NextResponse.json({ facets });
  } catch (error) {
    console.error("Error fetching attribute facets:", error);
    return NextResponse.json(
      { error: "خطا در دریافت ویژگی‌ها" },
      { status: 500 }
    );
  }
}
