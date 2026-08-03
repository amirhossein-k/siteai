"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShoppingCart, ImageOff, Heart, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatPrice } from "@/lib/utils";
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

  const firstImage = product.images?.[0];
  const showImage = !!firstImage && !imageError;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
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
            <img
              src={firstImage}
              alt={product.name}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              className={cn(
                "h-full w-full object-cover transition-all duration-500 group-hover:scale-110",
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

        {/* Stock badge */}
        {product.stock === 0 && (
          <div className="absolute left-2 top-2">
            <Badge variant="destructive" className="text-xs">
              ناموجود
            </Badge>
          </div>
        )}
        {hasLowStock && (
          <div className="absolute left-2 top-2">
            <Badge variant="warning" className="text-xs">
              تنها {product.stock} عدد باقیست
            </Badge>
          </div>
        )}

        {/* Wishlist heart (Session 35) */}
        <button
          type="button"
          onClick={handleWishlist}
          aria-label={inWishlist ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:scale-110 hover:bg-background hover:text-rose-500"
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

        {/* Name */}
        <Link href={`/products/${product.slug || product._id}`}>
          <h3 className="mb-2 text-sm font-semibold leading-tight transition-colors hover:text-primary line-clamp-2">
            {product.name}
          </h3>
        </Link>

        {/* Price + supplier link (Session 42) */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <span className="text-lg font-bold">
              {formatPrice(product.price)}
            </span>
          </div>
          {supplierInfo && (
            <Link
              href={`/suppliers/${supplierInfo._id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
              title={supplierInfo.businessName}
            >
              <Store className="h-3 w-3 flex-shrink-0" />
              <span className="max-w-[100px] truncate">
                {supplierInfo.businessName}
              </span>
            </Link>
          )}
        </div>

        {/* Add to cart button */}
        <Button
          className="w-full gap-2 text-xs"
          size="sm"
          disabled={product.stock === 0}
          onClick={() => {
            addItem({
              id: product._id,
              slug: product.slug || product._id,
              name: product.name,
              price: product.price,
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
