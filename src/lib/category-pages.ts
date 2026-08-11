import mongoose from "mongoose";
import { APP_NAME, PAGINATION } from "@/lib/constants";
import { dbConnect } from "@/lib/dbConnect";
import Category from "@/models/Category";
import Product from "@/models/Product";
import { getCategoryAncestors, type CategoryBreadcrumbNode } from "@/lib/breadcrumbs";
import { buildCategoryUrl } from "@/lib/category-url";
import { buildProductUrl } from "@/lib/product-slug";
import { parsePageParam } from "@/lib/pagination";
import { isAllowedImageSrc } from "@/lib/utils";
import type { Product as CatalogProduct } from "@/types";

/**
 * Category page data layer (Session 75) — the SINGLE implementation of the
 * `/categories/<slug>` page: active-category lookup, bounded ancestor chain,
 * first-page product query, metadata, visible breadcrumb and ItemList JSON-LD.
 *
 * Pure builders (breadcrumb trail, ItemList, metadata) are hermetic and unit-
 * tested; the DB entry point (`getCategoryPage`) follows the established
 * pattern from src/lib/breadcrumbs.ts — model imports are inert until called,
 * so the pure tests stay hermetic.
 *
 * Rules (approved Session 75 design):
 *   - Only ACTIVE categories with a non-empty slug resolve to a page.
 *     Missing / inactive / malformed-slug categories → `null` → the page
 *     calls `notFound()` (HTTP 404). No indexable surface for them.
 *   - Valid active categories are `index, follow` with a self-canonical
 *     `/categories/<slug>` (APP_URL origin). Query parameters never become
 *     part of the canonical (v1 serves page 1; Session 76 adds URL-driven
 *     pagination without changing the canonical).
 *   - Empty categories (active, zero products) remain indexable: they are
 *     real navigational pages with real metadata, and admins publish products
 *     into them over time — no artificial minimum-product threshold.
 *   - Products: the SAME public listing rules as the catalog API (isActive +
 *     stock > 0, `-soldCount`, populated category/supplier/brand/tags, newest
 *     first, DEFAULT_PAGE_SIZE), so the category page and the interactive
 *     filter never disagree about what is publicly listed.
 *   - URL-driven pagination (Session 76): `?page=N` slices the listing on
 *     the SERVER. Page 1 canonicalizes to the clean `/categories/<slug>`;
 *     valid page 2+ are indexable with SELF-canonicals; page=1 / malformed /
 *     invalid values are 308-redirected to the clean URL by the page
 *     component; out-of-range pages 404 (never a thin indexable page).
 */

/** JSON-plain category page data (safe as an RSC prop / for JSON-LD). */
export interface CategoryPageData {
  category: {
    _id: string;
    name: string;
    slug: string;
    description: string;
    image: string;
    metaTitle: string;
    metaDescription: string;
  };
  /** Root-first ancestor chain INCLUDING the category itself (last element). */
  ancestorChain: CategoryBreadcrumbNode[];
  /** First page of public products — JSON-plain (RSC-serializable). */
  products: CatalogProduct[];
  total: number;
  totalPages: number;
}

/**
 * Decode the Next.js 16 (Turbopack) dynamic-segment param — the PAGE
 * component receives Unicode slugs still percent-encoded («هدفون-…» arrives
 * as «%D9%87%D8%AF…»), exactly like the product page. decodeURIComponent is a
 * no-op on an already-decoded slug; a malformed sequence falls back to the
 * raw value instead of throwing (→ 404, never a 500).
 */
export function normalizeCategorySlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolve the RAW `?page=` search param for the category page (Session 76).
 *
 * The category page needs to DISTINGUISH the redirect cases from a real page
 * (unlike `parsePageParam`, which collapses everything to ≥ 1):
 *   - missing / empty → page 1, no redirect (plain render),
 *   - present but malformed (non-integer, ≤ 0, «abc», «2.5») or explicitly
 *     «1» → page 1 WITH a permanent redirect to the clean category URL
 *     (canonical consolidation — no `?page=1` / no junk-param duplicates),
 *   - a valid integer ≥ 2 → render that page (the page component 404s when
 *     it exceeds totalPages).
 */
export function resolveCategoryPageParam(
  raw: string | null | undefined
): { page: number; redirectClean: boolean } {
  if (raw === null || raw === undefined || raw === "") {
    return { page: 1, redirectClean: false };
  }
  const n = Number(raw);
  const valid = Number.isInteger(n) && n >= 1;
  if (!valid || n === 1) {
    return { page: 1, redirectClean: true };
  }
  return { page: n, redirectClean: false };
}

/**
 * Visible category breadcrumb — Home → [Parent Category → …] → Current
 * Category. `ancestorChain` is the root-first chain from
 * `getCategoryAncestors` INCLUDING the current category; every intermediate
 * links to its real `/categories/<slug>` page, the FINAL element is plain
 * text (no url → no self-link in the UI and no `item` in the JSON-LD).
 * No fabricated levels: a root category yields Home → Category.
 */
export function buildCategoryBreadcrumbTrail({
  ancestorChain,
  baseUrl,
}: {
  ancestorChain: CategoryBreadcrumbNode[];
  baseUrl: string;
}): Array<{ name: string; url?: string }> {
  const items: Array<{ name: string; url?: string }> = [
    { name: "صفحه اصلی", url: baseUrl },
  ];
  ancestorChain.forEach((cat, index) => {
    const isLast = index === ancestorChain.length - 1;
    items.push(
      isLast
        ? { name: cat.name } // current page — no url, aria-current in the UI
        : { name: cat.name, url: buildCategoryUrl(baseUrl, cat.slug) }
    );
  });
  return items;
}

/**
 * ItemList data for the first-page products — ONLY factual fields that
 * already exist: `name` + `url` (via buildProductUrl). Positions are added by
 * `itemListSchema` (single 1-based sequence). No price, rating, review count
 * or availability is ever fabricated for the structured data.
 */
export function buildCategoryItemList(
  products: Pick<CatalogProduct, "_id" | "name" | "slug">[],
  baseUrl: string
): Array<{ name: string; url: string }> {
  return products.map((p) => ({
    name: p.name,
    url: buildProductUrl(baseUrl, p.slug || p._id),
  }));
}

/** Absolute image URL for OG/JSON-LD (same-origin paths need the host).
 *  Uses the SAME baseUrl the metadata is composed with, so the pure builder
 *  is deterministic (unit-testable with any origin). */
function absoluteImageUrl(baseUrl: string, url: string): string {
  return /^https?:\/\//.test(url)
    ? url
    : `${baseUrl.replace(/\/+$/, "")}${url}`;
}

/** Clean a description for meta output (collapse whitespace, cap at 160). */
function toMetaText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * The exact Metadata shape the category page produces — named + exported so
 * unit tests can assert every field without casts (same convention as
 * CatalogMetadata in src/lib/catalog-seo.ts).
 */
export interface CategoryMetadata {
  title: string;
  description: string;
  alternates: { canonical: string };
  robots: { index: true; follow: true };
  openGraph: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    locale: string;
    type: "website";
    images?: string[];
  };
  twitter: {
    card: "summary";
    title: string;
    description: string;
    images?: string[];
  };
}

/**
 * Compose the full Metadata for a category page (pure — unit-testable).
 *
 * Priority (real data first, never invented):
 *   - title:        category.metaTitle when non-empty, else category.name.
 *   - description:  category.metaDescription when non-empty, else the category
 *                   description (cleaned ≤160), else a NATURAL factual
 *                   fallback («محصولات دستهبندی X») — no marketing claims,
 *                   no keyword stuffing, no fabricated counts.
 *   - canonical:    /categories/<slug> via APP_URL (single origin source).
 *   - image:        category.image ONLY when it passes the existing
 *                   isAllowedImageSrc allowlist → absolute URL (the same
 *                   allowlist the storefront images use; never weakened).
 */
export function buildCategoryMetadata(
  category: CategoryPageData["category"],
  baseUrl: string,
  opts: { page?: number; totalPages?: number } = {}
): CategoryMetadata {
  const { page = 1, totalPages = 1 } = opts;
  // Page 1 → the clean URL; a valid page ≥ 2 (the page component 404s
  // anything beyond totalPages, so this canonical always resolves) → a
  // self-canonical /categories/<slug>?page=N.
  const canonical =
    page > 1 && page <= totalPages
      ? `${buildCategoryUrl(baseUrl, category.slug)}?page=${page}`
      : buildCategoryUrl(baseUrl, category.slug);
  const title = category.metaTitle?.trim() || category.name;
  const description =
    toMetaText(category.metaDescription) ||
    toMetaText(category.description) ||
    `محصولات دسته‌بندی ${category.name} در ${APP_NAME}`;
  const image = isAllowedImageSrc(category.image)
    ? absoluteImageUrl(baseUrl, category.image)
    : null;
  const meta: CategoryMetadata = {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: APP_NAME,
      locale: "fa_IR",
      type: "website",
    },
    twitter: { card: "summary", title, description },
  };
  if (image) {
    meta.openGraph.images = [image];
    meta.twitter.images = [image];
  }
  return meta;
}

/**
 * Load the category page data — one indexed active-category lookup by slug,
 * one bounded ancestor walk (getCategoryAncestors: max-depth + cycle guard,
 * indexed `_id` point lookups — no N+1 over products), and TWO product
 * queries (count + the requested page) with the exact public listing rules
 * of the catalog API. Returns `null` for inactive/missing/malformed
 * categories. `page` is 1-based; the page component is responsible for
 * redirecting invalid values and 404ing pages beyond totalPages (this
 * function simply slices — a beyond-range page yields an empty list).
 */
export async function getCategoryPage(
  slug: string,
  page: number = 1
): Promise<CategoryPageData | null> {
  await dbConnect();
  const category = (await Category.findOne({ slug, isActive: true })
    .select("name slug description image metaTitle metaDescription")
    .lean()) as {
    _id: unknown;
    name: string;
    slug: string;
    description?: string;
    image?: string;
    metaTitle?: string;
    metaDescription?: string;
  } | null;
  if (!category || !category.slug) return null;

  const ancestorChain = await getCategoryAncestors(String(category._id));

  const filter = {
    isActive: true,
    stock: { $gt: 0 },
    category: new mongoose.Types.ObjectId(String(category._id)),
  };
  const safePage = parsePageParam(String(page));
  const skip = (safePage - 1) * PAGINATION.DEFAULT_PAGE_SIZE;
  const [total, products] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .select("-soldCount") // Session 56 — internal field, never public
      .populate("category", "name slug")
      .populate("supplier", "_id businessName logo")
      .populate("brand", "name slug logo")
      .populate("tags", "name slug")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(PAGINATION.DEFAULT_PAGE_SIZE)
      .lean(),
  ]);

  return {
    category: {
      _id: String(category._id),
      name: category.name,
      slug: category.slug,
      description: category.description || "",
      image: category.image || "",
      metaTitle: category.metaTitle || "",
      metaDescription: category.metaDescription || "",
    },
    ancestorChain,
    // JSON round-trip: ObjectIds → hex strings, Dates → ISO strings — safe
    // as RSC props (same convention as src/lib/public-products.ts).
    products: JSON.parse(JSON.stringify(products)) as CatalogProduct[],
    total,
    totalPages: Math.max(
      1,
      Math.ceil(total / PAGINATION.DEFAULT_PAGE_SIZE)
    ),
  };
}
