import { NextResponse, NextRequest } from "next/server";
import Review from "@/models/Review";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import Product from "@/models/Product";
import Attribute from "@/models/Attribute";
import Brand from "@/models/Brand";
import Tag from "@/models/Tag";
import Category from "@/models/Category";
import { getPublicProductById, getPublicProductBySlug } from "@/lib/public-products";
import { applyEffectivePricing } from "@/lib/product-pricing";
import {
  computeRatingSummaries,
  getRatedProductOrder,
  parseMinRating,
} from "@/lib/rating-summary";
import {
  parsePaginationParams,
  buildPaginatedResponse,
  escapeRegex,
} from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const slug = searchParams.get("slug");
    const category = searchParams.get("category");
    const supplier = searchParams.get("supplier");
    const brand = searchParams.get("brand");
    const tag = searchParams.get("tag");
    const search = searchParams.get("search");
    const sort = searchParams.get("sort") || "newest";
    const discounted = searchParams.get("discounted");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");

    // Build query filter
    const filter: Record<string, unknown> = { isActive: true, stock: { $gt: 0 } };

    // If id or slug is provided, return a single product (unchanged behavior).
    // Session 71 — the detail shape lives in src/lib/public-products.ts
    // (same projection/population/ratingSummary), shared with the SSR page.
    if (id || slug) {
      // Malformed id would throw a CastError -> 500; guard it to 404 instead
      if (id && !mongoose.isValidObjectId(id)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      const product = id
        ? await getPublicProductById(id)
        : await getPublicProductBySlug(slug!);

      if (!product) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }

      return NextResponse.json(product);
    }

    // NOTE (Session 48): filter ids are cast to ObjectId at build time.
    // find()/countDocuments() auto-cast string ids, but the aggregation $match
    // used by the ranked search path does NOT (Session 47 lesson) — explicit
    // casting keeps both paths identical.

    // Category filter
    if (category) {
      filter.category = new mongoose.Types.ObjectId(category);
    }

    // Supplier filter (Session 42) — additive; malformed id -> 404
    if (supplier) {
      if (!mongoose.isValidObjectId(supplier)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.supplier = new mongoose.Types.ObjectId(supplier);
    }

    // Brand filter (Session 47) — additive; malformed id -> 404.
    // Identity filter on the product's brand ref (matches supplier semantics).
    if (brand) {
      if (!mongoose.isValidObjectId(brand)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.brand = new mongoose.Types.ObjectId(brand);
    }

    // Tag filter (Session 47) — additive; malformed id -> 404.
    // Identity filter on the product's tags ref array.
    if (tag) {
      if (!mongoose.isValidObjectId(tag)) {
        return NextResponse.json(
          { error: "محصول یافت نشد" },
          { status: 404 }
        );
      }
      filter.tags = new mongoose.Types.ObjectId(tag);
    }

    // Attribute filters (Session 47 extension) — nested attributes[<slug>]=<value>.
    // Each selection requires a variant carrying (attributeId, value); multiple
    // selections AND together ($all of $elemMatch on variants.attributes).
    // Unknown slug -> no products can match -> 200 empty (mirrors the
    // valid-but-nonexistent-id rule). No behavior change when omitted.
    const attributeSelections: Array<{ slug: string; value: string }> = [];
    for (const [key, value] of searchParams.entries()) {
      const match = key.match(/^attributes\[(.+)\]$/);
      if (match && value) attributeSelections.push({ slug: match[1], value });
    }
    if (attributeSelections.length > 0) {
      const slugs = [...new Set(attributeSelections.map((s) => s.slug))];
      const attrs = await Attribute.find({ slug: { $in: slugs } })
        .select("_id slug")
        .lean();
      const idBySlug = new Map(attrs.map((a) => [a.slug, String(a._id)]));
      const elemMatches: Array<Record<string, unknown>> = [];
      let unknownSlug = false;
      for (const sel of attributeSelections) {
        const attrId = idBySlug.get(sel.slug);
        if (!attrId) {
          unknownSlug = true;
          break;
        }
        // Cast to ObjectId — aggregation $match does not auto-cast (Session 47).
        elemMatches.push({
          attributeId: new mongoose.Types.ObjectId(attrId),
          value: sel.value,
        });
      }
      if (unknownSlug) {
        // No product can carry an unknown attribute -> force an empty result.
        filter._id = { $in: [] };
      } else if (elemMatches.length > 0) {
        filter["variants.attributes"] = {
          $all: elemMatches.map((em) => ({ $elemMatch: em })),
        };
      }
    }

    // Discounted-only filter (Session 77 — homepage «محصولات تخفیف‌دار» rail):
    // ONLY products with a currently-ACTIVE discount (enabled + in-window).
    // Time semantics mirror getEffectivePrice: start INCLUSIVE (startsAt <= now),
    // end EXCLUSIVE (now < endsAt); a missing/null boundary = open-ended.
    // Products without a discount subdoc never match. `discounted` is a data
    // filter only — its URLs stay noindex, follow via catalog-seo (Session 74).
    if (discounted === "true") {
      const now = new Date();
      filter["discount.isActive"] = true;
      filter.$and = [
        {
          $or: [
            { "discount.startsAt": { $lte: now } },
            { "discount.startsAt": null },
            { "discount.startsAt": { $exists: false } },
          ],
        },
        {
          $or: [
            { "discount.endsAt": { $gt: now } },
            { "discount.endsAt": null },
            { "discount.endsAt": { $exists: false } },
          ],
        },
      ];
    }

    // Search filter (Session 48) — expanded coverage: product name/description,
    // variant attribute values, plus brand/tag/category names resolved through
    // their reference collections (substring, case-insensitive — Persian
    // substring behavior preserved; regex stays the search primitive, no $text).
    // When the term matches nothing in a reference collection, $in: [] simply
    // contributes no matches for that clause. Behavior without search is
    // byte-for-byte unchanged.
    let searchMeta: {
      safeSearch: string;
      brandIds: mongoose.Types.ObjectId[];
      tagIds: mongoose.Types.ObjectId[];
      categoryIds: mongoose.Types.ObjectId[];
    } | null = null;
    if (search) {
      const safeSearch = escapeRegex(search);
      const [brandIds, tagIds, categoryIds] = await Promise.all([
        Brand.find({ name: { $regex: safeSearch, $options: "i" } }).distinct(
          "_id"
        ),
        Tag.find({ name: { $regex: safeSearch, $options: "i" } }).distinct(
          "_id"
        ),
        Category.find({
          name: { $regex: safeSearch, $options: "i" },
        }).distinct("_id"),
      ]);
      searchMeta = { safeSearch, brandIds, tagIds, categoryIds };
      filter.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { description: { $regex: safeSearch, $options: "i" } },
        { "variants.attributes.value": { $regex: safeSearch, $options: "i" } },
        { brand: { $in: brandIds } },
        { tags: { $in: tagIds } },
        { category: { $in: categoryIds } },
      ];
    }

    // Price range filter
    if (minPrice || maxPrice) {
      const priceFilter: Record<string, number> = {};
      if (minPrice) priceFilter.$gte = parseInt(minPrice);
      if (maxPrice) priceFilter.$lte = parseInt(maxPrice);
      filter.price = priceFilter;
    }

    // Rating filter / sort (approved reviews only). `minRating` restricts the
    // filter to products with an approved average >= minRating (unrated
    // products never match). The constraint is ANDed so it never overwrites
    // the `_id` constraint set by the attribute filter.


    const minRating = parseMinRating(searchParams.get("minRating"));
    const ratingSort = sort === "rating_desc";

    let ratedOrder: Array<{
      _id: mongoose.Types.ObjectId;
      average: number;
      count: number;
    }> | null = null;

    if (minRating !== null || ratingSort) {
      ratedOrder = await getRatedProductOrder(minRating);
    }

    // فقط فیلتر حداقل امتیاز، محصولات را به شناسه‌های واجد شرایط محدود می‌کند.
    // مرتب‌سازی rating_desc به‌تنهایی نباید محصولات بدون نظر را حذف کند.
    if (minRating !== null && ratedOrder !== null) {
      const ratedIds = ratedOrder.map((r) => r._id);
      filter.$and = [
        ...((filter.$and as Record<string, unknown>[] | undefined) ?? []),
        { _id: { $in: ratedIds } },
      ];
    }

    // Sort
    let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
    if (sort === "price_asc") sortOption = { price: 1 };
    else if (sort === "price_desc") sortOption = { price: -1 };
    else if (sort === "name") sortOption = { name: 1 };
    else if (sort === "oldest") sortOption = { createdAt: 1 };
    // Session 56 — best-sellers: most units sold first (soldCount is internal
    // and never exposed; it exists only to power this sort). Newest breaks ties.
    else if (sort === "best_selling") sortOption = { soldCount: -1, createdAt: -1 };

    // Pagination — at database level, never fetch-all
    const { page, limit, skip } = parsePaginationParams(searchParams);

    // Session 48 — RANKED search path. Used only when a search term is present
    // AND no explicit sort was requested (default "newest"). An explicit sort
    // (price_asc, name, …) deliberately overrides relevance — those requests
    // fall through to the existing find() path below with the same expanded
    // filter. One aggregation computes a weighted score per matching product,
    // then the EXISTING populate chain re-hydrates the page's ids (response
    // shape unchanged). Pagination happens inside the aggregation (skip/limit)
    // — never fetch-all.
    if (search && (sort === "newest" || ratingSort) && searchMeta) {
      const { safeSearch, brandIds, tagIds, categoryIds } = searchMeta;
      const rankedIds = await Product.aggregate([
        { $match: filter },
        {
          $addFields: {
            // Weighted relevance (Session 48): exact name 100, name prefix 60,
            // name substring 40, brand/tag/category 25 each, attribute value 20,
            // description 10. Terms are additive so a product matching name
            // prefix + brand outranks a bare substring hit.
            score: {
              $add: [
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$name",
                        regex: "^" + safeSearch + "$",
                        options: "i",
                      },
                    },
                    100,
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$name",
                        regex: "^" + safeSearch,
                        options: "i",
                      },
                    },
                    60,
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: "$name",
                        regex: safeSearch,
                        options: "i",
                      },
                    },
                    40,
                    0,
                  ],
                },
                ...(brandIds.length
                  ? [{ $cond: [{ $in: ["$brand", brandIds] }, 25, 0] }]
                  : []),
                ...(tagIds.length
                  ? [
                    {
                      $cond: [
                        {
                          $gt: [
                            {
                              $size: {
                                $setIntersection: [
                                  { $ifNull: ["$tags", []] },
                                  tagIds,
                                ],
                              },
                            },
                            0,
                          ],
                        },
                        25,
                        0,
                      ],
                    },
                  ]
                  : []),
                ...(categoryIds.length
                  ? [
                    { $cond: [{ $in: ["$category", categoryIds] }, 25, 0] },
                  ]
                  : []),
                {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              // NOTE: in aggregation EXPRESSION context
                              // variants.attributes is an ARRAY OF ARRAYS
                              // ($variants.attributes.value yields
                              // [["قرمز"]] — query context flattens, expression
                              // context does not), so flatten it with
                              // $reduce/$concatArrays before regex-matching.
                              input: {
                                $reduce: {
                                  input: {
                                    $ifNull: ["$variants.attributes", []],
                                  },
                                  initialValue: [],
                                  in: {
                                    $concatArrays: [
                                      "$$value",
                                      { $ifNull: ["$$this.value", []] },
                                    ],
                                  },
                                },
                              },
                              as: "v",
                              cond: {
                                $and: [
                                  { $eq: [{ $type: "$$v" }, "string"] },
                                  {
                                    $regexMatch: {
                                      input: "$$v",
                                      regex: safeSearch,
                                      options: "i",
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    20,
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $regexMatch: {
                        input: { $ifNull: ["$description", ""] },
                        regex: safeSearch,
                        options: "i",
                      },
                    },
                    10,
                    0,
                  ],
                },
              ],
            },
          },
        },
        ...(ratingSort
          ? [
            {
              $lookup: {
                from: Review.collection.name,
                let: { productId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$product", "$$productId"] },
                          { $eq: ["$status", "approved"] },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      average: { $avg: "$rating" },
                      count: { $sum: 1 },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      average: { $round: ["$average", 1] },
                      count: 1,
                    },
                  },
                ],
                as: "ratingStats",
              },
            },
            {
              $addFields: {
                ratingAverage: {
                  $ifNull: [
                    { $arrayElemAt: ["$ratingStats.average", 0] },
                    0,
                  ],
                },
                ratingCount: {
                  $ifNull: [
                    { $arrayElemAt: ["$ratingStats.count", 0] },
                    0,
                  ],
                },
              },
            },
            {
              $sort: {
                score: -1,
                ratingAverage: -1,
                ratingCount: -1,
                createdAt: -1,
                _id: -1,
              } as const,
            },
          ]
          : [
            {
              $sort: {
                score: -1,
                createdAt: -1,
              } as const,
            },
          ]),
        { $skip: skip },
        { $limit: limit },
        { $project: { _id: 1 } },
      ]);

      const ids = rankedIds.map((r) => r._id);
      const [total, products] = await Promise.all([
        Product.countDocuments(filter),
        ids.length
          ? Product.find({ _id: { $in: ids } })
            .select("-soldCount") // Session 56 — internal field, never public
            .populate("category", "name slug")
            .populate("supplier", "_id businessName logo")
            .populate("brand", "name slug logo")
            .populate("tags", "name slug")
            .lean()
          : Promise.resolve([]),
      ]);

      // find() does not preserve $in order — re-sort to the ranked order.
      const orderMap = new Map(ids.map((id, i) => [String(id), i]));
      products.sort(
        (a, b) =>
          (orderMap.get(String((a as { _id: unknown })._id)) ?? 0) -
          (orderMap.get(String((b as { _id: unknown })._id)) ?? 0)
      );

      const ratings = await computeRatingSummaries(
        products.map((p) => String((p as { _id: unknown })._id))
      );

      return NextResponse.json(
        buildPaginatedResponse(
          products.map((p) => ({
            ...applyEffectivePricing(
              p as unknown as {
                price: number;
                discount?: unknown;
                variants?: Array<{ price: number }>;
              }
            ),
            ratingSummary: ratings.get(
              String((p as { _id: unknown })._id)
            ) ?? { average: 0, count: 0 },
          })),
          total,
          page,
          limit
        )
      );
    }

    // rating_desc: rated products first in average order, then unrated products
    // by newest. Ordering happens over the FULL filtered set (ids), then
    // pagination is applied to that ordering — never per page. With minRating,
    // the rated order only contains qualifying products, so the unrated list is empty.
    let products: Array<Record<string, unknown>>;
    let total: number;
    if (ratingSort && ratedOrder) {
      const matchingIds = (await Product.find(filter)
        .select("_id createdAt")
        .lean()) as unknown as Array<{
          _id: mongoose.Types.ObjectId;
          createdAt: Date;
        }>;
      const ratedRank = new Map(
        ratedOrder.map((r, i) => [String(r._id), i])
      );
      const rated = matchingIds
        .filter((p) => ratedRank.has(String(p._id)))
        .sort(
          (a, b) =>
            (ratedRank.get(String(a._id)) ?? 0) -
            (ratedRank.get(String(b._id)) ?? 0)
        );
      const unrated = matchingIds
        .filter((p) => !ratedRank.has(String(p._id)))
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      const ordered = [...rated, ...unrated];
      total = ordered.length;
      const pageIds = ordered.slice(skip, skip + limit).map((p) => p._id);
      const pageDocs = pageIds.length
        ? await Product.find({ _id: { $in: pageIds } })
          .select("-soldCount")
          .populate("category", "name slug")
          .populate("supplier", "_id businessName logo")
          .populate("brand", "name slug logo")
          .populate("tags", "name slug")
          .lean()
        : [];
      const pageOrder = new Map(pageIds.map((id, i) => [String(id), i]));
      products = (pageDocs as Array<Record<string, unknown>>).sort(
        (a, b) =>
          (pageOrder.get(String(a._id)) ?? 0) -
          (pageOrder.get(String(b._id)) ?? 0)
      );
    } else {
      const [count, found] = await Promise.all([
        Product.countDocuments(filter),
        Product.find(filter)
          .select("-soldCount") // Session 56 — internal field, never public
          .populate("category", "name slug")
          .populate("supplier", "_id businessName logo")
          .populate("brand", "name slug logo")
          .populate("tags", "name slug")
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);
      total = count;
      products = found as Array<Record<string, unknown>>;
    }

    const ratings = await computeRatingSummaries(
      products.map((p) => String((p as { _id: unknown })._id))
    );

    return NextResponse.json(
      buildPaginatedResponse(
        // Session 77 — effective pricing on every list row (active-only discount).
        products.map((p) => ({
          ...applyEffectivePricing(
            p as unknown as {
              price: number;
              discount?: unknown;
              variants?: Array<{ price: number }>;
            }
          ),
          ratingSummary: ratings.get(String((p as { _id: unknown })._id)) ?? {
            average: 0,
            count: 0,
          },
        })),
        total,
        page,
        limit
      )
    );
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "خطا در دریافت محصولات" },
      { status: 500 }
    );
  }
}
