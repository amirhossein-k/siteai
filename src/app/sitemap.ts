import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/constants";
import { dbConnect } from "@/lib/dbConnect";
import Supplier from "@/models/Supplier";

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

  // TODO: Fetch dynamic product pages from DB when available
  // const products = await getProducts();
  // const productPages = products.map((product) => ({
  //   url: `${baseUrl}/products/${product.slug}`,
  //   lastModified: new Date(product.updatedAt),
  //   changeFrequency: 'weekly' as const,
  //   priority: 0.8,
  // }));

  return [...staticPages, ...supplierPages];
}
