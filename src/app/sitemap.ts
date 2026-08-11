import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/constants";
import { dbConnect } from "@/lib/dbConnect";
import Product from "@/models/Product";
import Supplier from "@/models/Supplier";
import Category from "@/models/Category";
import { buildProductUrl } from "@/lib/product-slug";
import { buildCategoryUrl } from "@/lib/category-url";

// Next 16 docs: sitemap.ts is a special Route Handler that is CACHED BY
// DEFAULT unless it opts into a Request-time API or a dynamic config option.
// The catalog changes constantly (new products, deactivations), so the
// sitemap must reflect the live DB — otherwise a production build freezes the
// product list until the next rebuild and Google can't discover new products.
// force-dynamic regenerates per request (the same freshness contract as the
// force-dynamic product page).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = APP_URL;

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    },
    {
      url: `${baseUrl}/register`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    },
  ];

  // Dynamic supplier storefront pages (Session 42) — fail-silent so a DB
  // outage never breaks sitemap generation.
  let supplierPages: MetadataRoute.Sitemap = [];
  try {
    await dbConnect();
    const suppliers = await Supplier.find({ isActive: true })
      .select("_id updatedAt")
      .lean();
    supplierPages = suppliers.map((s) => ({
      url: `${baseUrl}/suppliers/${s._id}`,
      lastModified: s.updatedAt || new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch (error) {
    console.error("Error generating supplier sitemap entries:", error);
  }

  // Dynamic PRODUCT pages (Session 71) — every indexable product: active +
  // non-empty slug (the unique slug index makes duplicates impossible; the
  // Set below is defensive). URL = the same buildProductUrl used by the
  // canonical + JSON-LD so the sitemap, canonical and structured data always
  // point at the identical resource (Unicode slugs stay human-readable; the
  // XML is UTF-8 and search engines percent-encode on fetch). lastModified =
  // updatedAt (falls back to createdAt). Google's hard limit is 50k URLs per
  // sitemap file — this project is far below it, so a single sitemap is
  // correct; if the catalog ever approaches ~45k products, switch to
  // generateSitemaps() (Next 16 docs) with a 50k chunk size instead.
  const productPages: MetadataRoute.Sitemap = [];
  try {
    await dbConnect();
    const products = await Product.find({
      isActive: true,
      slug: { $exists: true, $ne: "" },
    })
      .select("slug updatedAt createdAt")
      .sort({ updatedAt: -1 })
      .lean();
    const seen = new Set<string>();
    for (const p of products) {
      if (!p.slug || seen.has(p.slug)) continue;
      seen.add(p.slug);
      productPages.push({
        url: buildProductUrl(baseUrl, p.slug),
        lastModified: p.updatedAt || p.createdAt || new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      });
    }
  } catch (error) {
    console.error("Error generating product sitemap entries:", error);
  }

  // Dynamic CATEGORY pages (Session 75) — every indexable category: active +
  // non-empty slug. URL = the same buildCategoryUrl used by the canonical +
  // breadcrumbs + ItemList so the sitemap, canonical and structured data
  // always point at the identical resource (Unicode Persian slugs stay
  // human-readable; the XML is UTF-8). lastModified = updatedAt (falls back
  // to createdAt). Defensive dedupe — the unique slug index makes duplicates
  // impossible, but the Set below protects against legacy data.
  const categoryPages: MetadataRoute.Sitemap = [];
  try {
    await dbConnect();
    const categories = await Category.find({
      isActive: true,
      slug: { $exists: true, $ne: "" },
    })
      .select("slug updatedAt createdAt")
      .sort({ updatedAt: -1 })
      .lean();
    const seen = new Set<string>();
    for (const c of categories) {
      if (!c.slug || seen.has(c.slug)) continue;
      seen.add(c.slug);
      categoryPages.push({
        url: buildCategoryUrl(baseUrl, c.slug),
        lastModified: c.updatedAt || c.createdAt || new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      });
    }
  } catch (error) {
    console.error("Error generating category sitemap entries:", error);
  }

  return [...staticPages, ...supplierPages, ...productPages, ...categoryPages];
}
