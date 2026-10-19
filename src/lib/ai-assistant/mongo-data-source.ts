/**
 * MongoDB implementation of StoreDataSource. Reuses the storefront's own
 * models and pricing helper (getEffectivePrice via store-data mappers), the
 * same `isActive` / `stock > 0` visibility rules as the public catalog, and
 * the public rating aggregate. Projections are explicit so private fields
 * (supplierPrice, costLayers, supplier, priceVersion, payment.authority,
 * payment.retryToken, cardPan, shippingAddress…) are never even loaded.
 */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import Product from "@/models/Product";
import Category from "@/models/Category";
import Brand from "@/models/Brand";
import Order from "@/models/Order";
import { computeRatingSummary } from "@/lib/public-products";
import { searchTokens, tolerantTokenPattern, normalizePersian, isObjectIdLike } from "./normalize";
import { orderRefOf, rankProducts, toOrderView, toProductDetail } from "./store-data";
import type {
  AssistantProductSummary,
  CatalogOverview,
  ProductSearchInput,
  ProductSearchResult,
  StoreDataSource,
} from "./types";

type Raw = Record<string, unknown>;

const SUMMARY_FIELDS =
  "name slug description images price discount stock soldCount createdAt hasVariants isActive category brand variants.price variants.isActive";
const DETAIL_FIELDS =
  "name slug description images price discount stock hasVariants isActive category brand tags variants._id variants.sku variants.attributes variants.price variants.stock variants.isActive";
const CANDIDATE_LIMIT = 80;
const OVERVIEW_CACHE_MS = 30_000;

let overviewCache: { expiresAt: number; value: CatalogOverview } | null = null;

async function idsBySlug(model: mongoose.Model<Raw>, slug?: string): Promise<unknown | null | undefined> {
  if (!slug) return undefined;
  const doc = (await model.findOne({ slug, isActive: true, deletedAt: null }).select("_id").lean()) as Raw | null;
  return doc ? doc._id : null;
}

export function createMongoStoreDataSource(): StoreDataSource {
  return {
    async searchProducts(input: ProductSearchInput): Promise<ProductSearchResult> {
      await dbConnect();
      const now = new Date();
      const base: Raw = { isActive: true };
      if (!input.includeOutOfStock) base.stock = { $gt: 0 };
      const categoryId = await idsBySlug(Category as unknown as mongoose.Model<Raw>, input.categorySlug);
      const brandId = await idsBySlug(Brand as unknown as mongoose.Model<Raw>, input.brandSlug);
      if (categoryId === null || brandId === null) return { products: [], relaxedQuery: false };
      if (categoryId) base.category = categoryId;
      if (brandId) base.brand = brandId;
      if (input.onlyDiscounted) base["discount.isActive"] = true;
      // Effective price ≤ base price, so a min bound can be pushed down; a max
      // bound cannot (a discount may bring a pricier item under budget).
      if (input.minPrice) base.price = { $gte: input.minPrice };
      if (input.maxPrice) base.$and = [{ $or: [{ price: { $lte: input.maxPrice } }, { "discount.isActive": true }] }];

      const tokens = searchTokens(input.query || "");
      let textFilter: Raw | null = null;
      if (tokens.length) {
        const regexes = tokens.map((t) => new RegExp(tolerantTokenPattern(t), "i"));
        const [cats, brands] = await Promise.all([
          Category.find({ isActive: true, deletedAt: null, name: { $in: regexes } }).select("_id").limit(20).lean(),
          Brand.find({ isActive: true, deletedAt: null, name: { $in: regexes } }).select("_id").limit(20).lean(),
        ]);
        const or: Raw[] = [{ name: { $in: regexes } }, { description: { $in: regexes } }];
        if (cats.length) or.push({ category: { $in: (cats as Raw[]).map((c) => c._id) } });
        if (brands.length) or.push({ brand: { $in: (brands as Raw[]).map((b) => b._id) } });
        textFilter = { $or: or };
      }

      const findCandidates = (filter: Raw) =>
        Product.find(filter)
          .select(SUMMARY_FIELDS)
          .populate("category", "name slug")
          .populate("brand", "name slug")
          .sort({ soldCount: -1, createdAt: -1 })
          .limit(CANDIDATE_LIMIT)
          .lean() as unknown as Promise<Raw[]>;

      let relaxedQuery = false;
      let raw = await findCandidates(textFilter ? { ...base, ...textFilter } : base);
      if (!raw.length && textFilter) {
        relaxedQuery = true;
        raw = await findCandidates(base);
      }

      const products: AssistantProductSummary[] = rankProducts(raw, input, tokens, normalizePersian, now);
      return { products, relaxedQuery };
    },

    async getProductsByIds(ids: string[]) {
      const valid = ids.filter(isObjectIdLike).slice(0, 8);
      if (!valid.length) return [];
      await dbConnect();
      const docs = (await Product.find({ _id: { $in: valid }, isActive: true })
        .select(DETAIL_FIELDS)
        .populate("category", "name slug")
        .populate("brand", "name slug")
        .populate("tags", "name")
        .lean()) as unknown as Raw[];
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const ordered = valid.map((id) => byId.get(id)).filter((d): d is Raw => Boolean(d));
      return Promise.all(
        ordered.map(async (d) => toProductDetail(d, await computeRatingSummary(d._id).catch(() => null)))
      );
    },

    async getProductBySlug(slug: string) {
      await dbConnect();
      const doc = (await Product.findOne({ slug, isActive: true })
        .select(DETAIL_FIELDS)
        .populate("category", "name slug")
        .populate("brand", "name slug")
        .populate("tags", "name")
        .lean()) as unknown as Raw | null;
      if (!doc) return null;
      return toProductDetail(doc, await computeRatingSummary(doc._id).catch(() => null));
    },

    async getCatalogOverview() {
      if (overviewCache && overviewCache.expiresAt > Date.now()) return overviewCache.value;
      await dbConnect();
      const [categories, brands, activeInStockProducts, discountedProducts] = await Promise.all([
        Category.find({ isActive: true, deletedAt: null }).select("name slug").sort({ name: 1 }).limit(40).lean(),
        Brand.find({ isActive: true, deletedAt: null }).select("name slug").sort({ name: 1 }).limit(40).lean(),
        Product.countDocuments({ isActive: true, stock: { $gt: 0 } }),
        Product.countDocuments({ isActive: true, stock: { $gt: 0 }, "discount.isActive": true }),
      ]);
      const value: CatalogOverview = {
        categories: (categories as Raw[]).map((c) => ({
          name: String(c.name || ""),
          slug: String(c.slug || ""),
          url: `/products?category=${encodeURIComponent(String(c.slug || ""))}`,
        })),
        brands: (brands as Raw[]).map((b) => ({ name: String(b.name || ""), slug: String(b.slug || "") })),
        activeInStockProducts,
        discountedProducts,
      };
      overviewCache = { expiresAt: Date.now() + OVERVIEW_CACHE_MS, value };
      return value;
    },

    async getCustomerOrders(customerId: string, opts: { orderRef?: string; limit: number }) {
      if (!isObjectIdLike(customerId)) return [];
      await dbConnect();
      const docs = (await Order.find({ customer: customerId })
        .select(
          "_id status totalAmount createdAt payment.status payment.method shipping.provider shipping.trackingCode shipping.shippedAt shipping.deliveredAt items.name items.variantLabel items.quantity items.price"
        )
        .sort({ createdAt: -1 })
        .limit(opts.orderRef ? 100 : Math.min(5, opts.limit))
        .lean()) as unknown as Raw[];
      const filtered = opts.orderRef ? docs.filter((d) => orderRefOf(d._id).endsWith(opts.orderRef!)) : docs;
      return filtered.slice(0, Math.min(5, opts.limit)).map(toOrderView);
    },
  };
}
