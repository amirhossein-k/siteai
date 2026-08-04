"use client";

import { TrendingUp } from "lucide-react";
import { usePublicProducts } from "@/hooks/use-public-products";
import { ProductRail } from "@/components/storefront/home/product-rail";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Best-Sellers (Session 56 — real sales, CMS-driven limit/title).
 *
 * Ranks products by `Product.soldCount` (units PAID, non-refunded) through the
 * additive `sort=best_selling` API sort — no fake data, no pool derivation.
 * soldCount itself is INTERNAL (excluded from the public API); the rail shows
 * the products, never the raw count. Independent query (not the newest-sorted
 * homepage pool) so the ranking is authoritative.
 */
export function BestSellers({ section }: HomepageSectionRendererProps) {
  const maxItems = Math.min(
    section.presentation?.behavior?.maxItems ?? 12,
    24
  );
  const { data, isLoading, isError } = usePublicProducts({
    sort: "best_selling",
    limit: maxItems,
  });
  const products = data?.data ?? [];

  return (
    <ProductRail
      title={section.title || "پرفروش‌ترین محصولات"}
      subtitle={section.subtitle || "محبوب‌ترین‌ها بر اساس فروش واقعی"}
      href="/products?sort=best_selling"
      icon={<TrendingUp className="h-4.5 w-4.5" />}
      products={products}
      loading={isLoading}
      error={isError}
    />
  );
}
