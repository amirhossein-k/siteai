import { dbConnect } from "@/lib/dbConnect";
import Category from "@/models/Category";
import { buildCategoryUrl } from "@/lib/category-url";

/**
 * Breadcrumb data layer (Session 72, category URLs upgraded Session 75) —
 * shared by the visible server-rendered Breadcrumbs component and the
 * BreadcrumbList JSON-LD, so the structured data always matches what the
 * user sees.
 *
 * Hierarchy (real navigational structure, nothing invented):
 *   Home → [Parent Category → … →] Category → Product
 *
 * A product's category chain is resolved from the Category `parent`
 * self-reference (root-first). The Product detail loader populates the
 * product's `category` (name/slug) but NOT its ancestors, so the chain is
 * walked here with bounded indexed `_id` lookups.
 *
 * Category breadcrumb URLs are the real indexable category pages
 * `/categories/<slug>` (Session 75) via the single buildCategoryUrl helper —
 * never the noindex filter surface `/products?category=<id>`.
 */

export interface BreadcrumbItem {
  name: string;
  /** Omitted on the final (current page) item — Google's BreadcrumbList
   *  guidance: `item` is required for intermediate elements only. */
  url?: string;
}

export interface CategoryBreadcrumbNode {
  _id: string;
  name: string;
  slug: string;
}

/**
 * Resolve a category's ancestor chain root-first (Home-ward → the category
 * itself), e.g. `[پوشاک, مردانه]` for product in «پوشاک > مردانه».
 *
 * Walk is bounded (`maxDepth`) and cycle-guarded (`seen`) so malformed data
 * can never loop; each step is a single indexed `_id` lookup. The category
 * tree in this app is shallow (admin renders ~2 levels), so the worst case
 * is a handful of point lookups per product page request — no N+1 over
 * products. Returns `[]` when the id is unknown/deleted.
 */
export async function getCategoryAncestors(
  categoryId: string,
  maxDepth = 6
): Promise<CategoryBreadcrumbNode[]> {
  await dbConnect();
  const chain: CategoryBreadcrumbNode[] = [];
  const seen = new Set<string>();
  let current: string | null = categoryId;
  while (current && chain.length < maxDepth && !seen.has(current)) {
    seen.add(current);
    const cat = (await Category.findById(current)
      .select("name slug parent")
      .lean()) as {
      _id: unknown;
      name: string;
      slug: string;
      parent?: unknown;
    } | null;
    if (!cat) break;
    chain.unshift({
      _id: String(cat._id),
      name: cat.name,
      slug: cat.slug,
    });
    current = cat.parent ? String(cat.parent) : null;
  }
  return chain;
}

/**
 * Build the product breadcrumb trail from the resolved category chain.
 *
 * URL conventions (single source — reused by the visible UI and JSON-LD):
 *   - Home → `${baseUrl}` (same origin as canonical/OG/JSON-LD),
 *   - category → `${baseUrl}/categories/<slug>` — the real indexable
 *     category page (Session 75) via buildCategoryUrl,
 *   - product → the current page: name only, NO url → not a link in the UI
 *     and no `item` in the JSON-LD (Google: optional on the final element).
 *
 * No fabricated levels: a product without a category yields Home → Product.
 */
export function buildProductBreadcrumbTrail({
  categoryChain,
  productName,
  baseUrl,
}: {
  /** Root-first category ancestors INCLUDING the product's own category. */
  categoryChain: CategoryBreadcrumbNode[];
  productName: string;
  baseUrl: string;
}): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ name: "صفحه اصلی", url: baseUrl }];
  for (const cat of categoryChain) {
    items.push({
      name: cat.name,
      url: buildCategoryUrl(baseUrl, cat.slug),
    });
  }
  items.push({ name: productName }); // current page — no url, no link
  return items;
}
