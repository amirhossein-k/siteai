"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShoppingCart, ImageOff, Heart, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import { useWishlistIds, useToggleWishlist } from "@/hooks/use-wishlist";
import { DiscountCountdown } from "@/components/storefront/discount-countdown";
import type { Product } from "@/types";

interface ProductCardProps {
  product: Product;
  className?: string;
  /**
   * Session 78.1 — optional hook fired when THIS card's countdown reaches
   * zero (the discounted rail wires it to its single refetch so card expiry is
   * handled even independently of the section-level chip). Other consumers
   * omit it — default behavior unchanged. `endsAt` is the expired target.
   */
  onCountdownExpire?: (endsAt: string) => void;
}

/**
 * Product card (Session 50; Session 85 Phase B — dark-glass reference restyle).
 *
 * The reference glass surface (glass-card utility from the Phase A theme),
 * gradient status badges on the RTL start corner, blue-gradient CTA and a
 * dominant price — while preserving EVERY behavior contract: server-computed
 * effective pricing (Session 77), countdown + onCountdownExpire (Session 78),
 * the stretched product link, customer-gated wishlist heart, supplier link,
 * image allowlist + fallback, and the disabled/out-of-stock add-to-cart.
 * Badge/label TEXT is unchanged («ناموجود», «تنها X عدد باقیست», «٪Y تخفیف»,
 * «افزودن به سبد خرید») — the E2E text contracts hold.
 */
export function ProductCard({
  product,
  className,
  onCountdownExpire,
}: ProductCardProps) {
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
  // Session 78 — the server-returned active-only summary decides the countdown:
  // finite endsAt → chip under the price; endsAt null (open-ended) → no chip.
  const discountEndsAt = hasActiveDiscount
    ? product.discount?.endsAt ?? null
    : null;

  const firstImage = product.images?.[0];
  // Session 61 — next/image throws on unconfigured hosts (native <img> just
  // showed a broken image); fall back to the placeholder instead.
  const showImage = !!firstImage && !imageError && isAllowedImageSrc(firstImage);

  return (
    <div
      className={cn(
        // Session 85 — glass-card provides the reference surface (translucent
        // gradient, blur, border, deep shadow + hover lift); the glow overlay
        // below adds the blue accent glow on hover. `relative` keeps the
        // stretched-link overlay and z-indexed actions working.
        "glass-card group relative overflow-hidden rounded-3xl",
        className
      )}
    >
      {/* Hover glow overlay (pointer-events-none; transparent, ring + glow). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          boxShadow:
            "inset 0 0 0 1px rgba(90,160,255,0.22), 0 0 42px rgba(60,120,255,0.14)",
        }}
      />

      {/* Product Image */}
      <div className="relative aspect-square overflow-hidden bg-white/[0.02]">
        {showImage ? (
          <>
            {/* Loading skeleton */}
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.04] to-transparent animate-pulse">
                <span className="text-5xl font-bold text-white/10">
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
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.04] to-transparent">
            {imageError ? (
              <ImageOff className="h-10 w-10 text-white/20" />
            ) : (
              <span className="text-5xl font-bold text-white/15">
                {product.name?.[0] || "?"}
              </span>
            )}
          </div>
        )}

        {/* Status badges — RTL start corner (top-right), reference gradient
            pills. All gradient stops keep white text ≥ WCAG AA (Session 61
            convention; the axe gate scans the catalog/homepage). Text is
            byte-identical to the pre-Phase-B badges. */}
        <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
          {product.stock === 0 && (
            <span className="rounded-lg bg-gradient-to-b from-red-600 to-red-800 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-black/40">
              ناموجود
            </span>
          )}
          {hasLowStock && (
            <span className="rounded-lg bg-gradient-to-b from-amber-700 to-amber-800 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-black/40">
              تنها {product.stock} عدد باقیست
            </span>
          )}
          {hasActiveDiscount && (
            <span className="rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-black/40">
              ٪{discountPercent} تخفیف
            </span>
          )}
        </div>

        {/* Wishlist heart (Session 35) — RTL end corner (top-left); z-20 lifts
            it above the stretched-link overlay so it stays independent. */}
        <button
          type="button"
          onClick={handleWishlist}
          aria-label={inWishlist ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
          className="absolute left-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white shadow-md backdrop-blur-sm transition-all hover:scale-110 hover:bg-black/50"
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
          <h3 className="mb-2 line-clamp-2 text-sm font-semibold leading-tight text-foreground transition-colors hover:text-primary">
            {product.name}
          </h3>
        </Link>

        {/* Price + supplier link (Session 42) — the dominant current price
            (Session 85: white/extrabold on the dark glass) with the original
            struck-through and secondary when a discount is active. */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            {hasActiveDiscount ? (
              <>
                <span className="text-lg font-extrabold text-white">
                  {formatPrice(effectivePrice)}
                </span>
                <span className="text-xs text-muted-foreground line-through">
                  {formatPrice(product.price)}
                </span>
              </>
            ) : (
              <span className="text-lg font-extrabold text-white">
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

        {/* Discount countdown (Session 78) — only while the server reports an
            ACTIVE discount with a finite end. Presentation only; the server
            remains authoritative for pricing. */}
        {discountEndsAt && (
          <div className="mb-2">
            <DiscountCountdown
              endsAt={discountEndsAt}
              compact
              onExpire={() => onCountdownExpire?.(discountEndsAt)}
            />
          </div>
        )}

        {/* Add to cart — Session 85: reference blue-gradient CTA. Both
            gradient stops (blue-600 → blue-800) keep white text ≥ 4.5:1, and
            the disabled/out-of-stock state + label text are unchanged. z-10
            lifts it above the stretched product overlay. */}
        <Button
          className="relative z-10 w-full gap-2 bg-gradient-to-b from-blue-600 to-blue-800 text-xs text-white shadow-lg shadow-blue-950/50 transition-all hover:-translate-y-0.5 hover:from-blue-600 hover:to-blue-700 hover:shadow-blue-900/60"
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
