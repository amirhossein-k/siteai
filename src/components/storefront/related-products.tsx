"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { ProductRail } from "@/components/storefront/home/product-rail";
import type { Product } from "@/types";

const RECENT_KEY = "marloo-recent-products";

export function RelatedProducts({ product }: { product: Product }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentId = product._id;
    let viewed: string[] = [];
    try {
      viewed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (!Array.isArray(viewed)) viewed = [];
      viewed = [currentId, ...viewed.filter((id) => id !== currentId)].slice(0, 12);
      localStorage.setItem(RECENT_KEY, JSON.stringify(viewed));
    } catch {
      viewed = [];
    }

    const controller = new AbortController();
    fetch(`/api/products/${encodeURIComponent(currentId)}/related?viewed=${viewed.join(",")}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { products: [] }))
      .then((data) => setProducts(Array.isArray(data.products) ? data.products : []))
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [product._id]);

  return (
    <ProductRail
      title="پیشنهادهای مرتبط برای شما"
      subtitle="بر اساس محصولی که می‌بینید و بازدیدهای اخیرتان"
      href="/products"
      linkLabel="مشاهده همه محصولات"
      icon={<Sparkles className="h-4.5 w-4.5" />}
      products={products}
      loading={loading}
    />
  );
}
