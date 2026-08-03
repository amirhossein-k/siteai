"use client";

import { Crown } from "lucide-react";
import { useHomeProductPool } from "@/hooks/use-home-product-pool";
import { ProductRail } from "@/components/storefront/home/product-rail";

/**
 * Premium Collection (Session 50) — «کلکسیون ویژه».
 * Priciest products of the shared homepage product pool, derived client-side
 * from real API data. No extra network request.
 */
export function PremiumCollection() {
  const { data, isLoading, isError } = useHomeProductPool();

  const products = [...(data?.data ?? [])]
    .sort((a, b) => b.price - a.price)
    .slice(0, 12);

  return (
    <ProductRail
      title="کلکسیون ویژه"
      subtitle="منتخبی از محصولات پریمیوم فروشگاه"
      href="/products?sort=price_desc"
      icon={<Crown className="h-4.5 w-4.5" />}
      products={products}
      loading={isLoading}
      error={isError}
    />
  );
}
