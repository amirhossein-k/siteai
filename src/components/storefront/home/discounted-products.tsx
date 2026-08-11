"use client";

import { BadgePercent } from "lucide-react";
import { usePublicProducts } from "@/hooks/use-public-products";
import { ProductRail } from "@/components/storefront/home/product-rail";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * «محصولات تخفیف‌دار» (Session 77) — products with a discount ACTIVE at
 * request time.
 *
 * The `discounted=true` filter is evaluated SERVER-side by the public products
 * API with the exact getEffectivePrice time semantics (enabled + in-window,
 * start inclusive / end exclusive), so expired, future and disabled discounts
 * never appear — and the list rules already exclude inactive and out-of-stock
 * products. No fake percentages, no pool derivation: the rail only ever shows
 * what the server computes as currently discounted. The empty state stays
 * honest (the rail renders nothing when no discount is live).
 */
export function DiscountedProducts({
  section,
}: HomepageSectionRendererProps) {
  const maxItems = Math.min(
    section.presentation?.behavior?.maxItems ?? 12,
    24
  );
  const { data, isLoading, isError } = usePublicProducts({
    discounted: "true",
    limit: maxItems,
  });
  const products = data?.data ?? [];

  return (
    <ProductRail
      title={section.title || "محصولات تخفیف‌دار"}
      subtitle={section.subtitle || "تخفیف‌های فعال همین حالا"}
      href="/products?discounted=true"
      icon={<BadgePercent className="h-4.5 w-4.5" />}
      products={products}
      loading={isLoading}
      error={isError}
    />
  );
}
