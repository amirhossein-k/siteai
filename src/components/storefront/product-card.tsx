"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShoppingCart, ImageOff, Heart, Store, Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import { useWishlistIds, useToggleWishlist } from "@/hooks/use-wishlist";
import { DiscountCountdown } from "@/components/storefront/discount-countdown";
import type { Product, RatingSummary } from "@/types";

interface ProductCardProps {
  product: Product;
  className?: string;
  /**
   * Session 78.1 — optional hook fired when THIS card's countdown reaches
   * zero (the discounted rail wires it to its single refetch so card expiry is
   * handled even independently of the section-level chip). Other consumers
   * omit it — default behavior unchanged.
   */
  onCountdownExpire?: (endsAt: string) => void;
}

/**
 * Rating area shown on every card. Only approved reviews reach `summary`
 * (server-side). With zero approved reviews it renders the explicit
 * «بدون امتیاز» state — never a fabricated score or default stars.
 */
function ProductRating({ summary }: { summary?: RatingSummary }) {
  const count = summary?.count ?? 0;
  if (count <= 0 || !summary) {
    return (
      <p className="mb-2 text-[11px] text-sf-dim">بدون امتیاز</p>
    );
  }
  const average = summary.average;
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] text-sf-dim">
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              "h-3 w-3",
              star <= Math.round(average)
                ? "fill-amber-400 text-amber-400"
                : "text-sf-dim/40"
            )}
          />
        ))}
      </span>
      <span className="sr-only">
        امتیاز {average} از ۵ از {count} دیدگاه تأییدشده
      </span>
      <span aria-hidden="true">
        {average} ({count})
      </span>
    </div>
  );
}

/**
 * Product card (Session 50; Session 85 dark-glass restyle; Session 93
 * theme-agnostic redesign).
 *
 * Session 93 swaps every hard-coded dark literal (`text-white`, `bg-white/5`,
 * `border-white/10`, …) for storefront semantic tokens, so ONE card markup now
 * renders the dark glass language and the light card language:
 *  - `sf-surface` = glass card (dark) / elevated white card (light),
 *  - `bg-sf-image` / `bg-sf-skeleton` = image stage + shimmer,
 *  - `text-sf-price` = dominant price, `border-sf-line` = dividers/meta.
 *
 * Behavior contracts are untouched: server-computed effective pricing
 * (Session 77), countdown + onCountdownExpire (Session 78), the stretched
 * product link, customer-gated wishlist heart, supplier link, image allowlist
 * + fallback, and the disabled/out-of-stock add-to-cart. Badge/label TEXT is
 * unchanged («ناموجود», «تنها X عدد باقیست», «٪Y تخفیف», «افزودن به سبد
 * خرید») — the E2E text contracts hold.
 */
export function ProductCard({
  product,
  className,
  onCountdownExpire,
}: ProductCardProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
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
  const outOfStock = product.stock === 0;

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

  const handleAddToCart = () => {
    addItem({
      id: product._id,
      slug: product.slug || product._id,
      name: product.name,
      price: effectivePrice, // Session 77 — effective unit price
      maxQuantity: product.stock,
      image: product.images?.[0],
    });
    showToast.success(`${product.name} به سبد خرید اضافه شد`);
    // Micro-interaction: brief confirmation on the CTA itself.
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1200);
  };

  return (
    <div
      className={cn(
        // Session 93 — `sf-surface` = the reference glass card on dark and an
        // elevated white card on light (same geometry → no layout shift when
        // the theme changes). `group` + `relative` keep the stretched link and
        // the z-indexed actions working.
        "sf-surface group relative flex h-full flex-col overflow-hidden rounded-3xl",
        className
      )}
    >
      {/* Hover glow overlay (pointer-events-none; brand-tinted ring + glow —
          both tokens resolve to a soft shadow in the light theme). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          boxShadow:
            "inset 0 0 0 1px var(--sf-ring-glow), 0 0 42px var(--sf-glow)",
        }}
      />

      {/* Product Image */}
      <div className="relative aspect-square overflow-hidden bg-sf-image">
        {showImage ? (
          <>
            {/* Loading skeleton — shimmer until the (eager) image decodes. */}
            {!imageLoaded && (
              <div className="absolute inset-0 flex animate-pulse items-center justify-center bg-sf-skeleton">
                <span className="text-5xl font-bold text-sf-strong/10">
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
                "object-cover transition-all duration-500 group-hover:scale-[1.06]",
                imageLoaded ? "opacity-100" : "opacity-0",
                outOfStock && "opacity-70 grayscale-[35%]"
              )}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-sf-skeleton">
            {imageError ? (
              <ImageOff className="h-10 w-10 text-sf-dim/40" />
            ) : (
              <span className="text-5xl font-bold text-sf-strong/15">
                {product.name?.[0] || "?"}
              </span>
            )}
          </div>
        )}

        {/* Status badges — RTL start corner (top-right), gradient pills. All
            gradient stops keep white text ≥ WCAG AA (Session 61 convention;
            the axe gate scans the catalog/homepage). Text is byte-identical to
            the pre-Session-93 badges. */}
        <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
          {outOfStock && (
            <span className="rounded-lg bg-gradient-to-b from-red-600 to-red-800 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg shadow-black/25">
              ناموجود
            </span>
          )}
          {hasLowStock && (
            <span className="rounded-lg bg-gradient-to-b from-amber-700 to-amber-800 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg shadow-black/25">
              تنها {product.stock} عدد باقیست
            </span>
          )}
          {hasActiveDiscount && (
            <span className="rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg shadow-black/25">
              ٪{discountPercent} تخفیف
            </span>
          )}
        </div>

        {/* Wishlist heart (Session 35) — RTL end corner (top-left); z-20 lifts
            it above the stretched-link overlay so it stays an independent
            action. `bg-sf-overlay/15` is white-on-dark and slate-on-white, so
            the control stays legible in both themes. */}
        <button
          type="button"
          onClick={handleWishlist}
          aria-label={
            inWishlist ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"
          }
          aria-pressed={inWishlist}
          className={cn(
            "absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-sf-line-strong bg-sf-overlay/15 text-sf-strong shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-sf-overlay/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
            inWishlist && "border-rose-500/40"
          )}
        >
          <Heart
            className={cn(
              "h-4 w-4 transition-all duration-200",
              inWishlist && "scale-110 fill-rose-500 text-rose-500"
            )}
          />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        {/* Category */}
        <p className="mb-1 truncate text-[11px] font-medium text-sf-dim">
          {categoryName}
        </p>

        {/* Name — the STRETCHED product link (Session 68.3 UX): its transparent
            ::after overlay extends over the whole card (image, title, price),
            so clicking any of them navigates to /products/[slug]. The supplier
            link + wishlist + add-to-cart are stacked ABOVE the overlay with
            z-10, so they remain independent actions — no nested anchors, one
            keyboard tab stop for the product destination. */}
        <Link
          href={`/products/${product.slug || product._id}`}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background after:absolute after:inset-0 after:content-['']"
        >
          <h3 className="mb-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-foreground transition-colors group-hover:text-primary">
            {product.name}
          </h3>
        </Link>

        <ProductRating summary={product.ratingSummary} />

        {/* Price hierarchy — dominant effective price (the theme's strongest
            text token), struck-through original + supplier link secondary. */}
        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <span className="text-lg font-extrabold tracking-tight text-sf-price">
              {formatPrice(effectivePrice)}
            </span>
            {hasActiveDiscount && (
              <span className="text-xs text-sf-dim line-through">
                {formatPrice(product.price)}
              </span>
            )}
          </div>
          {supplierInfo && (
            <Link
              href={`/suppliers/${supplierInfo._id}`}
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 flex min-w-0 items-center gap-1 text-[11px] text-sf-dim transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              title={supplierInfo.businessName}
            >
              <Store className="h-3 w-3 flex-shrink-0" />
              <span className="max-w-[90px] truncate">
                {supplierInfo.businessName}
              </span>
            </Link>
          )}
        </div>

        {/* Discount countdown (Session 78) — only while the server reports an
            ACTIVE discount with a finite end. Presentation only; the server
            remains authoritative for pricing. */}
        {discountEndsAt && (
          <div className="mt-2">
            <DiscountCountdown
              endsAt={discountEndsAt}
              compact
              onExpire={() => onCountdownExpire?.(discountEndsAt)}
            />
          </div>
        )}

        {/* Add to cart — brand-gradient CTA (tokenised `blue-grad`), with a
            short-lived confirmation state. z-10 lifts it above the stretched
            product overlay. */}
        <Button
          className={cn(
            "relative z-10 mt-3 w-full gap-2 text-xs font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]",
            justAdded ? "bg-emerald-600 hover:bg-emerald-600" : "blue-grad"
          )}
          size="sm"
          disabled={outOfStock}
          onClick={handleAddToCart}
        >
          {/* Label text stays byte-identical (E2E contract); only the icon
              and the CTA colour acknowledge the click. */}
          {justAdded ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <ShoppingCart className="h-3.5 w-3.5" />
          )}
          {outOfStock ? "ناموجود" : "افزودن به سبد خرید"}
        </Button>
      </div>
    </div>
  );
}
