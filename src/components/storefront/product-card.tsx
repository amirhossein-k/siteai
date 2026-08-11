"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShoppingCart, ImageOff, Heart, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import { useWishlistIds, useToggleWishlist } from "@/hooks/use-wishlist";
import type { Product } from "@/types";

interface ProductCardProps {
  product: Product;
  className?: string;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const router = useRouter();
  const { data: session } = useSession();
  const addItem = useCartStore((s) => s.addItem);
  const { data: wishlist } = useWishlistIds();
  const toggleWishlist = useToggleWishlist();

  const isCustomer = session?.user?.role === "customer";
  const inWishlist = !!wishlist?.ids?.includes(product._id);

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isCustomer) {
      showToast.info("برای افزودن به علاقه‌مندی‌ها وارد شوید");
      router.push("/login");
      return;
    }
    toggleWishlist.mutate({ productId: product._id, inList: inWishlist });
  };

  const categoryName =
    typeof product.category === "object"
      ? (product.category as { name: string }).name
      : "دسته‌بندی";

  const supplierInfo =
    typeof product.supplier === "object" && product.supplier
      ? (product.supplier as { _id: string; businessName: string })
      : null;

  const hasLowStock = product.stock > 0 && product.stock <= 3;

  // Session 77 — server-computed effective pricing (active-only discount
  // summary from the API; never client-derived, never stale: the API returns
  // discount=null once the window ends). effectivePrice === price when no
  // discount is active, so plain-price rendering is the untouched default.
  const effectivePrice = product.effectivePrice ?? product.price;
  const hasActiveDiscount =
    !!product.discount && effectivePrice < product.price;
  const discountPercent = product.discount?.percent ?? 0;

  const firstImage = product.images?.[0];
  // Session 61 — next/image throws on unconfigured hosts (native <img> just
  // showed a broken image); fall back to the placeholder instead.
  const showImage = !!firstImage && !imageError && isAllowedImageSrc(firstImage);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg",
        className
      )}
    >
      {/* Product Image */}
      <div className="relative aspect-square overflow-hidden bg-muted">
        {showImage ? (
          <>
            {/* Loading skeleton */}
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 animate-pulse">
                <span className="text-5xl font-bold text-muted-foreground/10">
                  {product.name?.[0] || "?"}
                </span>
              </div>
            )}
            <Image
              src={firstImage}
              alt={product.name}
              fill
              sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              loading="eager"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              className={cn(
                "object-cover transition-all duration-500 group-hover:scale-110",
                imageLoaded ? "opacity-100" : "opacity-0"
              )}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            {imageError ? (
              <ImageOff className="h-10 w-10 text-muted-foreground/30" />
            ) : (
              <span className="text-5xl font-bold text-muted-foreground/20">
                {product.name?.[0] || "?"}
              </span>
            )}
          </div>
        )}

        {/* Stock + discount badges (stacked, top-left) */}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-2">
          {product.stock === 0 && (
            <Badge variant="destructive" className="text-xs">
              ناموجود
            </Badge>
          )}
          {hasLowStock && (
            <Badge variant="warning" className="text-xs">
              تنها {product.stock} عدد باقیست
            </Badge>
          )}
          {hasActiveDiscount && (
            <Badge className="bg-rose-600 text-xs text-white">
              ٪{discountPercent} تخفیف
            </Badge>
          )}
        </div>

        {/* Wishlist heart (Session 35) — z-10 lifts it above the product
            stretched-link overlay so it stays an independent action. */}
        <button
          type="button"
          onClick={handleWishlist}
          aria-label={inWishlist ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:scale-110 hover:bg-background hover:text-rose-500"
        >
          <Heart
            className={cn(
              "h-4 w-4 transition-colors",
              inWishlist && "fill-rose-500 text-rose-500"
            )}
          />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Category */}
        <p className="mb-1 text-xs text-muted-foreground">{categoryName}</p>

        {/* Name — the STRETCHED product link (Session 68.3 UX): its transparent
            ::after overlay extends over the whole card (image, title, price),
            so clicking any of them navigates to /products/[slug]. The supplier
            link + wishlist + add-to-cart are stacked ABOVE the overlay with
            z-10, so they remain independent actions — no nested anchors, one
            keyboard tab stop for the product destination. */}
        <Link
          href={`/products/${product.slug || product._id}`}
          className="after:absolute after:inset-0 after:content-['']"
        >
          <h3 className="mb-2 text-sm font-semibold leading-tight transition-colors hover:text-primary line-clamp-2">
            {product.name}
          </h3>
        </Link>

        {/* Price + supplier link (Session 42) — the price sits under the
            stretched overlay (navigates); the supplier link is an independent
            action stacked above it. */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            {hasActiveDiscount ? (
              <>
                <span className="text-lg font-bold text-emerald-600">
                  {formatPrice(effectivePrice)}
                </span>
                <span className="text-xs text-muted-foreground line-through">
                  {formatPrice(product.price)}
                </span>
              </>
            ) : (
              <span className="text-lg font-bold">
                {formatPrice(effectivePrice)}
              </span>
            )}
          </div>
          {supplierInfo && (
            <Link
              href={`/suppliers/${supplierInfo._id}`}
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
              title={supplierInfo.businessName}
            >
              <Store className="h-3 w-3 flex-shrink-0" />
              <span className="max-w-[100px] truncate">
                {supplierInfo.businessName}
              </span>
            </Link>
          )}
        </div>

        {/* Add to cart button — z-10 lifts it above the stretched product
            overlay so adding to cart never triggers product navigation. */}
        <Button
          className="relative z-10 w-full gap-2 text-xs"
          size="sm"
          disabled={product.stock === 0}
          onClick={() => {
            addItem({
              id: product._id,
              slug: product.slug || product._id,
              name: product.name,
              price: effectivePrice, // Session 77 — effective unit price
              maxQuantity: product.stock,
              image: product.images?.[0],
            });
            showToast.success(`${product.name} به سبد خرید اضافه شد`);
          }}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {product.stock === 0 ? "ناموجود" : "افزودن به سبد خرید"}
        </Button>
      </div>
    </div>
  );
}
