"use client";

import { Sparkles } from "lucide-react";
import { useHomeProductPool } from "@/hooks/use-home-product-pool";
import { ProductRail } from "@/components/storefront/home/product-rail";

/**
 * Newest Products (Session 50).
 * First 12 of the shared homepage product pool (sort=newest) — reuses the
 * single pool query; no additional network request.
 */
export function NewestProducts() {
  const { data, isLoading, isError } = useHomeProductPool();
  const products = (data?.data ?? []).slice(0, 12);

  return (
    <ProductRail
      title="جدیدترین محصولات"
      subtitle="تازه‌های فروشگاه را زودتر ببینید"
      href="/products?sort=newest"
      icon={<Sparkles className="h-4.5 w-4.5" />}
      products={products}
      loading={isLoading}
      error={isError}
    />
  );
}
