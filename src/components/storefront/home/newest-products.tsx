"use client";

import { Sparkles } from "lucide-react";
import { useHomeProductPool } from "@/hooks/use-home-product-pool";
import { ProductRail } from "@/components/storefront/home/product-rail";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Newest Products (Session 50; Session 53 — CMS-driven limit/title).
 * First N of the shared homepage product pool (sort=newest) — reuses the
 * single pool query; no additional network request.
 */
export function NewestProducts({ section }: HomepageSectionRendererProps) {
  const { data, isLoading, isError } = useHomeProductPool();
  const maxItems = Math.min(section.presentation?.behavior?.maxItems ?? 12, 24);
  const products = (data?.data ?? []).slice(0, maxItems);

  return (
    <ProductRail
      title={section.title || "جدیدترین محصولات"}
      subtitle={section.subtitle || "تازه‌های فروشگاه را زودتر ببینید"}
      href="/products?sort=newest"
      icon={<Sparkles className="h-4.5 w-4.5" />}
      products={products}
      loading={isLoading}
      error={isError}
    />
  );
}
