"use client";

import { Crown } from "lucide-react";
import { useHomeProductPool } from "@/hooks/use-home-product-pool";
import { ProductRail } from "@/components/storefront/home/product-rail";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Premium Collection (Session 50; Session 53 — CMS-driven limit/title) — «کلکسیون ویژه».
 * Priciest products of the shared homepage product pool, derived client-side
 * from real API data. No extra network request.
 */
export function PremiumCollection({ section }: HomepageSectionRendererProps) {
  const { data, isLoading, isError } = useHomeProductPool();
  const maxItems = Math.min(section.presentation?.behavior?.maxItems ?? 12, 24);

  const products = [...(data?.data ?? [])]
    .sort((a, b) => b.price - a.price)
    .slice(0, maxItems);

  return (
    <ProductRail
      title={section.title || "کلکسیون ویژه"}
      subtitle={section.subtitle || "منتخبی از محصولات پریمیوم فروشگاه"}
      href="/products?sort=price_desc"
      icon={<Crown className="h-4.5 w-4.5" />}
      products={products}
      loading={isLoading}
      error={isError}
    />
  );
}
