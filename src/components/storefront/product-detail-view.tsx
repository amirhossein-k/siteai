"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ShoppingCart,
  Store,
  Truck,
  TrendingUp,
  ImageOff,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  ZoomIn,
  Heart,
  Timer,
  Table2,
  FileText,
  MessageSquareText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import { ImageLightbox } from "@/components/storefront/image-lightbox";
import { VariantSelector } from "@/components/storefront/variant-selector";
import { ReviewsSection } from "@/components/storefront/reviews-section";
import { ProductDescription } from "@/components/storefront/product-description";
import { DiscountCountdown } from "@/components/storefront/discount-countdown";
import { useWishlistIds, useToggleWishlist } from "@/hooks/use-wishlist";
import type { Product, ProductVariant } from "@/types";

type DetailTab = "desc" | "specs" | "reviews";

const TABS: { id: DetailTab; label: string; icon: typeof FileText }[] = [
  { id: "desc", label: "توضیحات", icon: FileText },
  { id: "specs", label: "مشخصات فنی", icon: Table2 },
  { id: "reviews", label: "دیدگاه‌ها", icon: MessageSquareText },
];

/**
 * Client-side interactive product detail (Session 71; Session 85 Phase C —
 * dark-glass productPage restyle).
 *
 * The product is fetched SERVER-side (src/app/(storefront)/products/[slug]/page.tsx
 * — a Server Component) so the initial HTML carries title/meta description/
 * canonical/Open Graph/Twitter/JSON-LD before any JavaScript runs; this
 * component owns ONLY the interactive surface:
 *   - glass stage gallery + lightbox + glass thumbnails,
 *   - variant selection (restyled VariantSelector),
 *   - glass price card + countdown,
 *   - add-to-cart / wishlist (exact existing semantics — the cart store's
 *     addItem adds one line unit per click; NO quantity stepper was added
 *     because the store contract cannot add N units without touching cart
 *     logic, which is out of scope),
 *   - honest stock indicator (chips only — no fabricated capacity bar),
 *   - two glass perk tiles with the store's existing honest copy,
 *   - accessible tabs (توضیحات / مشخصات فنی / دیدگاه‌ها) over REAL data —
 *     specs render the selected variant's actual attributes or «در دسترس
 *     نیست»; reviews keep the full real ReviewsSection,
 *   - mobile-only sticky buy bar (glass-strong, safe-area aware, reuses the
 *     exact same add-to-cart handler as the main CTA).
 * Session 65 note: populated relations can be `null` at runtime (deleted
 * refs) — access them null-safely, never via `typeof x === "object"`.
 */
export function ProductDetailView({ product }: { product: Product }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isCustomer = session?.user?.role === "customer";
  const [selectedImage, setSelectedImage] = useState(0);
  const [imageError, setImageError] = useState<Record<number, boolean>>({});
  const [imageLoaded, setImageLoaded] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<DetailTab>("desc");
  // Session 78 — presentation-only expiry flag: set when the visible countdown
  // reaches zero while the page stays open. Hides the stale badge/
  // strikethrough and restores the original price LOCALLY. The server stays
  // authoritative — checkout re-reads the DB product and 409s on mismatch.
  const [discountExpiredLocally, setDiscountExpiredLocally] = useState(false);

  const addItem = useCartStore((s) => s.addItem);
  const { data: wishlist } = useWishlistIds();
  const toggleWishlist = useToggleWishlist();

  const inWishlist = !!wishlist?.ids?.includes(product._id);

  const categoryName =
    typeof product.category === "object" && product.category
      ? (product.category as { name: string }).name
      : "دسته‌بندی";

  const supplierInfo =
    typeof product.supplier === "object" && product.supplier
      ? (product.supplier as { _id: string; businessName: string })
      : null;
  const supplierName = supplierInfo?.businessName;

  const hasVariants = !!product.hasVariants && (product.variants?.length || 0) > 0;

  // Resolve the effective display data from the selected variant (if any)
  const activeVariant = hasVariants ? selectedVariant : null;

  // Session 61 — next/image throws at render on unconfigured hosts (native
  // <img> degraded to a broken image). Filtering ONCE here protects the main
  // gallery, the thumbnails AND the lightbox (its only caller); filtered-out
  // URLs fall back to the existing placeholder UI.
  const displayImages = (
    activeVariant
      ? activeVariant.images?.length
        ? activeVariant.images
        : product.images || []
      : product.images || []
  ).filter(isAllowedImageSrc);

  // Session 77 — server-computed effective pricing. displayPrice = the
  // effective (post-discount) unit price; the original price + badge render
  // ONLY when the server reports an ACTIVE discount (product.discount is the
  // active-only summary — null when no discount is running, so an expired/
  // future discount can never show a stale badge or price from a client clock).
  const displayOriginalPrice = activeVariant
    ? activeVariant.price
    : product.price;
  const serverEffectivePrice = activeVariant
    ? activeVariant.effectivePrice ?? activeVariant.price
    : product.effectivePrice ?? product.price;
  // Once the countdown expired locally, show the original price only (the
  // discount window has closed server-side too by the same clock).
  const displayPrice = discountExpiredLocally
    ? displayOriginalPrice
    : serverEffectivePrice;
  const hasActiveDiscount =
    !!product.discount &&
    serverEffectivePrice < displayOriginalPrice &&
    !discountExpiredLocally;
  // Session 78 — chip next to the badge only for a finite, currently-active
  // end (the server-returned active-only summary decides).
  const discountEndsAt = hasActiveDiscount
    ? product.discount?.endsAt ?? null
    : null;
  // Badge percent: configured value (percent type) at product level; for a
  // selected variant the per-variant reduction is computed from the pair.
  const discountPercent = hasActiveDiscount
    ? activeVariant
      ? Math.round((1 - displayPrice / displayOriginalPrice) * 100)
      : (product.discount?.percent ?? 0)
    : 0;
  const displayStock = activeVariant ? activeVariant.stock : product.stock;
  const variantLabel = activeVariant
    ? activeVariant.attributes.map((a) => `${a.name}: ${a.value}`).join("، ")
    : "";

  // Shared purchase action — the ONE add-to-cart implementation used by both
  // the main CTA and the mobile sticky bar (no second cart path).
  const handleAddToCart = useCallback(() => {
    const label = variantLabel || "";
    addItem({
      id: product._id,
      variantId: activeVariant?._id,
      sku: activeVariant?.sku,
      variantLabel: label || undefined,
      slug: product.slug || product._id,
      name: label ? `${product.name} — ${label}` : product.name,
      price: displayPrice,
      maxQuantity: displayStock,
      image: displayImages?.[0],
    });
    showToast.success(
      label
        ? `${product.name} (${label}) به سبد خرید اضافه شد`
        : `${product.name} به سبد خرید اضافه شد`
    );
  }, [
    addItem,
    product._id,
    product.slug,
    product.name,
    activeVariant,
    variantLabel,
    displayPrice,
    displayStock,
    displayImages,
  ]);

  const cartDisabled =
    displayStock === 0 || (hasVariants && !activeVariant);

  // Real specs for the «مشخصات فنی» tab: the SELECTED variant's attributes
  // (falls back to the first active variant when none is selected yet);
  // simple products have no attributes — honest «در دسترس نیست».
  const specsSource = hasVariants
    ? activeVariant ??
      product.variants?.find((v) => v.isActive !== false) ??
      null
    : null;
  const specs: { name: string; value: string }[] = specsSource
    ? specsSource.attributes
    : [];
  const specsAvailable = specs.length > 0;

  // Tablist keyboard navigation (RTL: ArrowLeft advances, ArrowRight goes
  // back — reading direction; Home/End jump).
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowLeft") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowRight") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    setActiveTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 lg:px-8 lg:pb-8">
      <div className="grid gap-8 lg:grid-cols-2 xl:gap-14">
        {/* ── Product Images Gallery (glass stage) ── */}
        {/* min-w-0: grid items default to min-width:auto — nowrap content
            (CTA buttons, countdown) would force the column wider than the
            viewport at 390px (pre-existing overflow). */}
        <div className="min-w-0 space-y-3">
          {/* Stage — blue-tinted glass panel with a radial glow behind the
              real product image (productPage reference). Click opens the
              existing lightbox. */}
          <div
            className="glass-panel group relative aspect-square cursor-pointer overflow-hidden rounded-[2rem]"
            onClick={() => displayImages.length > 0 && setLightboxOpen(true)}
          >
            {/* Radial floor glow behind the image */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(60,120,255,0.18), transparent 65%)",
              }}
            />

            {displayImages.length > 0 && !imageError[selectedImage] ? (
              <>
                {/* Loading skeleton */}
                {!imageLoaded[selectedImage] && (
                  <div className="absolute inset-0 z-[1] flex items-center justify-center animate-pulse">
                    <span className="text-8xl font-bold text-sf-strong/10">
                      {product.name?.[0] || "?"}
                    </span>
                  </div>
                )}
                <Image
                  src={displayImages[selectedImage]}
                  alt={product.name}
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  loading="eager"
                  onLoad={() =>
                    setImageLoaded((prev) => ({ ...prev, [selectedImage]: true }))
                  }
                  onError={() =>
                    setImageError((prev) => ({ ...prev, [selectedImage]: true }))
                  }
                  className={cn(
                    "z-[1] object-cover transition-all duration-500",
                    imageLoaded[selectedImage] ? "opacity-100" : "opacity-0"
                  )}
                />

                {/* Click to enlarge hint */}
                <div className="pointer-events-none absolute bottom-3 left-3 z-[2] flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                  <ZoomIn className="h-3 w-3" />
                  بزرگ‌نمایی
                </div>

                {/* Image navigation arrows */}
                {displayImages.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage((prev) =>
                          prev === 0 ? displayImages.length - 1 : prev - 1
                        );
                      }}
                      aria-label="تصویر قبلی"
                      className="absolute left-3 top-1/2 z-[2] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur transition-all hover:scale-110 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage((prev) =>
                          prev === displayImages.length - 1 ? 0 : prev + 1
                        );
                      }}
                      aria-label="تصویر بعدی"
                      className="absolute right-3 top-1/2 z-[2] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur transition-all hover:scale-110 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <ChevronRightIcon className="h-5 w-5" />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="relative z-[1] flex h-full w-full items-center justify-center">
                {imageError[selectedImage] ? (
                  <div className="flex flex-col items-center gap-2 text-sf-dim/60">
                    <ImageOff className="h-16 w-16" />
                    <span className="text-sm">بارگذاری تصویر با خطا مواجه شد</span>
                  </div>
                ) : (
                  <span className="text-8xl font-bold text-sf-strong/20">
                    {product.name?.[0] || "?"}
                  </span>
                )}
              </div>
            )}

            {/* Badges on the stage — RTL start (right): discount; end (left):
                stock. Gradient pills, same text contracts as before. */}
            <div className="absolute right-4 top-4 z-[2] flex flex-col items-end gap-2">
              {hasActiveDiscount && (
                <span className="rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-black/40">
                  ٪{discountPercent} تخفیف
                </span>
              )}
            </div>
            <div className="absolute left-4 top-4 z-[2] flex flex-col items-start gap-2">
              {displayStock === 0 ? (
                <span className="rounded-lg bg-gradient-to-b from-red-600 to-red-800 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-black/40">
                  ناموجود
                </span>
              ) : displayStock <= 3 ? (
                <span className="rounded-lg bg-gradient-to-b from-amber-700 to-amber-800 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-black/40">
                  تنها {displayStock} عدد باقیست
                </span>
              ) : null}
            </div>
          </div>

          {/* Glass thumbnail tiles — active gets the blue ring + glow
              (productPage reference). */}
          {displayImages.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {displayImages.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setSelectedImage(idx);
                    // Retry loading on manual click
                    if (imageError[idx]) {
                      setImageError((prev) => ({ ...prev, [idx]: false }));
                    }
                  }}
                  className={cn(
                    "relative aspect-square w-20 flex-shrink-0 overflow-hidden rounded-2xl border bg-sf-image transition-all duration-200 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                    selectedImage === idx
                      ? "border-primary shadow-[0_0_22px_var(--sf-ring-glow)]"
                      : "border-sf-line opacity-55 hover:opacity-85"
                  )}
                >
                  <Image
                    src={img}
                    alt={`${product.name} - ${idx + 1}`}
                    fill
                    sizes="80px"
                    loading="eager"
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Product Info ── */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Chips — category (blue glass) + honest stock state */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
              {categoryName}
            </span>
            {displayStock === 0 ? (
              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-[11px] font-bold text-destructive">
                ناموجود
              </span>
            ) : displayStock <= 3 ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-sf-warning">
                تنها {displayStock} عدد باقیست
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-sf-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sf-success" />
                موجود در انبار
              </span>
            )}
          </div>

          {/* Name */}
          <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
            {product.name}
          </h1>

          {/* No subtitle here: the description renders once, inside the
              «توضیحات» tab (visible by default). A second inline copy would
              duplicate the text node and break single-match E2E contracts. */}

          {/* Price card (glass) — original struck through when a discount is
              active, effective price dominant, countdown in glass tiles. */}
          <div className="rounded-2xl border border-sf-line bg-sf-card/70 p-5 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                {hasActiveDiscount && (
                  <div className="mb-1 text-sm text-muted-foreground line-through">
                    {formatPrice(displayOriginalPrice)}
                  </div>
                )}
                <div className="text-3xl font-black tracking-tight text-sf-price sm:text-4xl">
                  {formatPrice(displayPrice)}
                </div>
              </div>
              {discountEndsAt && (
                <div className="text-left">
                  <div className="mb-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Timer className="h-3 w-3" />
                    پایان تخفیف ویژه تا:
                  </div>
                  <DiscountCountdown
                    endsAt={discountEndsAt}
                    compact={false}
                    onExpire={() => setDiscountExpiredLocally(true)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Variant selector (glass restyle) */}
          {hasVariants && (
            <VariantSelector
              variants={product.variants || []}
              onSelect={setSelectedVariant}
            />
          )}

          {/* Meta badges — SKU / variant label / supplier (real data) */}
          <div className="flex flex-wrap gap-2">
            {activeVariant?.sku && (
              <span
                className="rounded-full border border-sf-line bg-sf-chip px-3 py-1 text-[11px] text-sf-dim"
                dir="ltr"
              >
                SKU: {activeVariant.sku}
              </span>
            )}
            {variantLabel && (
              <span className="rounded-full border border-sf-line bg-sf-chip px-3 py-1 text-[11px] text-sf-dim">
                {variantLabel}
              </span>
            )}
            {supplierName && supplierInfo && (
              <Link href={`/suppliers/${supplierInfo._id}`}>
                <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/20">
                  <Store className="h-3 w-3" />
                  {supplierName}
                </span>
              </Link>
            )}
          </div>

          {/* Purchase area — blue-gradient CTA + glass wishlist (exact same
              semantics as before; no quantity stepper — the cart store's
              addItem cannot add N units without touching cart logic).
              flex-wrap: on narrow screens the nowrap wishlist button wraps
              below the flex-1 CTA instead of forcing column overflow. */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className="blue-grad flex-1 gap-2 text-base font-bold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.99]"
              disabled={cartDisabled}
              onClick={handleAddToCart}
            >
              <ShoppingCart className="h-5 w-5" />
              {displayStock === 0
                ? "ناموجود"
                : hasVariants && !activeVariant
                ? "انتخاب تنوع"
                : "افزودن به سبد خرید"}
            </Button>

            {/* Wishlist (Session 35) — glass button, rose when active */}
            <Button
              size="lg"
              variant="outline"
              className={cn(
                "gap-2 border-sf-line bg-sf-chip text-base text-sf-dim transition-all hover:bg-sf-chip/60 hover:text-sf-strong",
                inWishlist &&
                  "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
              )}
              onClick={() => {
                if (!isCustomer) {
                  showToast.info("برای افزودن به علاقه‌مندی‌ها وارد شوید");
                  router.push("/login");
                  return;
                }
                // Session 43: SAVE the selected variant — never silently pick
                // a default. activeVariant = the user's current selection
                // (VariantSelector auto-selects the first in-stock one, so
                // variant products always carry the shown variant). Simple
                // products (no variants) → variantId undefined → product-level
                // row.
                //
                // REMOVE (inList=true) → variantId undefined → remove-ALL-rows
                // semantics (same as the product-card heart). This heart is a
                // PRODUCT-level toggle (ids is deduped), so removing a specific
                // variantId here could no-op when a DIFFERENT variant was saved
                // — leaving the heart filled and the optimistic cache
                // flickering until refetch. Per-variant removal happens on the
                // /wishlist page rows.
                toggleWishlist.mutate({
                  productId: product._id,
                  inList: inWishlist,
                  variantId: inWishlist
                    ? undefined
                    : hasVariants
                    ? activeVariant?._id
                    : undefined,
                });
              }}
            >
              <Heart
                className={cn(
                  "h-5 w-5",
                  inWishlist && "fill-destructive text-destructive"
                )}
              />
              {inWishlist ? "در علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
            </Button>
          </div>

          {/* Honest stock indicator — NO fabricated capacity bar (the data
              model has no max-stock denominator), only real stock states. */}
          {displayStock > 0 && displayStock <= 10 && (
            <p className="text-xs font-bold text-sf-warning">
              🔥 تنها {displayStock} عدد در انبار باقی مانده
            </p>
          )}

          {/* Perk tiles — the store's EXISTING honest copy, glass-styled
              (the reference's 24h/18-month/7-day demo claims are NOT copied). */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-sf-line bg-sf-card/60 p-3 text-center backdrop-blur">
              <Truck className="mx-auto mb-1 h-5 w-5 text-primary" />
              <p className="text-xs font-medium">ارسال سریع</p>
              <p className="text-[10px] text-muted-foreground">۲۴ تا ۴۸ ساعت</p>
            </div>
            <div className="rounded-xl border border-sf-line bg-sf-card/60 p-3 text-center backdrop-blur">
              <TrendingUp className="mx-auto mb-1 h-5 w-5 text-primary" />
              <p className="text-xs font-medium">ضمانت قیمت</p>
              <p className="text-[10px] text-muted-foreground">
                بهترین قیمت بازار
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail tabs (توضیحات / مشخصات فنی / دیدگاه‌ها) — real data only ── */}
      <div className="mt-14">
        <div
          role="tablist"
          aria-label="جزئیات محصول"
          className="mb-6 flex flex-wrap gap-2"
        >
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  active
                    ? "blue-grad text-white shadow-lg"
                    : "border border-sf-line bg-sf-chip text-sf-dim hover:bg-sf-chip/60 hover:text-sf-strong"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-3xl border border-sf-line bg-sf-card/50 p-6 shadow-lg sm:p-10">
          {/* توضیحات */}
          <div
            role="tabpanel"
            id="panel-desc"
            aria-labelledby="tab-desc"
            hidden={activeTab !== "desc"}
          >
            {product.descriptionRich?.length ? (
              <ProductDescription value={product.descriptionRich} />
            ) : (
              <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">
                {product.description || "توضیحاتی برای این محصول ثبت نشده است"}
              </p>
            )}
          </div>

          {/* مشخصات فنی — real variant attributes only */}
          <div
            role="tabpanel"
            id="panel-specs"
            aria-labelledby="tab-specs"
            hidden={activeTab !== "specs"}
          >
            {specsAvailable ? (
              <dl className="grid gap-x-12 md:grid-cols-2">
                {specs.map((spec) => (
                  <div
                    key={`${spec.name}:${spec.value}`}
                    className="flex justify-between gap-4 border-b border-sf-line py-3.5 text-sm"
                  >
                    <dt className="text-muted-foreground">{spec.name}</dt>
                    <dd className="font-medium text-foreground">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                اطلاعاتی ثبت نشده است
              </p>
            )}
          </div>

          {/* دیدگاه‌ها — the real review system, untouched */}
          <div
            role="tabpanel"
            id="panel-reviews"
            aria-labelledby="tab-reviews"
            hidden={activeTab !== "reviews"}
          >
            <ReviewsSection productId={product._id} productName={product.name} />
          </div>
        </div>
      </div>

      {/* Spacer so the mobile sticky bar never covers content */}
      <div className="h-16 lg:hidden" aria-hidden="true" />

      {/* Image Lightbox */}
      <ImageLightbox
        images={displayImages}
        initialIndex={selectedImage}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />

      {/* ── Mobile sticky buy bar (lg:hidden) — glass-strong, safe-area aware,
          reuses the exact same add-to-cart handler + disabled state as the
          main CTA. Never duplicates the desktop action. ── */}
      <div
        className="glass-strong fixed inset-x-0 bottom-0 z-40 border-t border-sf-line lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {hasActiveDiscount && (
              <div className="text-[10px] text-muted-foreground line-through">
                {formatPrice(displayOriginalPrice)}
              </div>
            )}
            <div className="truncate text-lg font-black text-sf-price">
              {formatPrice(displayPrice)}
            </div>
          </div>
          <Button
            className="blue-grad shrink-0 gap-2 px-6 py-3 text-sm font-bold text-white shadow-lg"
            disabled={cartDisabled}
            onClick={handleAddToCart}
          >
            <ShoppingCart className="h-4 w-4" />
            {displayStock === 0
              ? "ناموجود"
              : hasVariants && !activeVariant
              ? "انتخاب تنوع"
              : "افزودن به سبد خرید"}
          </Button>
        </div>
      </div>
    </div>
  );
}
