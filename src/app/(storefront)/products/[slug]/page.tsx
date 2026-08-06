"use client";

import { useState, use } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import {
  ShoppingCart,
  Package,
  ChevronRight,
  Store,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  CheckCircle2,
  Truck,
  ImageOff,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  ZoomIn,
  Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { cn, formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import { ImageLightbox } from "@/components/storefront/image-lightbox";
import { VariantSelector } from "@/components/storefront/variant-selector";
import { ReviewsSection } from "@/components/storefront/reviews-section";
import { ProductJsonLd } from "@/components/seo/json-ld-script";
import { useWishlistIds, useToggleWishlist } from "@/hooks/use-wishlist";
import type { Product, ProductVariant } from "@/types";

const fetchProductBySlug = async (slug: string): Promise<Product> => {
  const { data } = await axios.get(`/api/products?slug=${slug}`);
  return data;
};

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
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

  const {
    data: product,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["public", "products", "detail", slug],
    queryFn: () => fetchProductBySlug(slug),
    enabled: !!slug,
  });

  // Rules of Hooks: ALL hooks must run before any early return, otherwise the
  // hook count changes between renders → "Rendered more hooks than during the
  // previous render" (the loading/error/not-found returns below skip this).
  const addItem = useCartStore((s) => s.addItem);
  const { data: wishlist } = useWishlistIds();
  const toggleWishlist = useToggleWishlist();

  const inWishlist = !!wishlist?.ids?.includes(product?._id || "");

  // --- Loading State ---
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="mb-6 h-5 w-48" />
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // --- Error State ---
  if (isError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات محصول
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Not Found State ---
  if (!product) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="mb-3 h-8 w-8" />
            <p>محصول مورد نظر یافت نشد</p>
            <Button className="mt-4" asChild>
              <Link href="/products">مشاهده همه محصولات</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const categoryName =
    typeof product.category === "object"
      ? (product.category as { name: string }).name
      : "دسته‌بندی";

  const supplierInfo =
    typeof product.supplier === "object" && product.supplier
      ? (product.supplier as { _id: string; businessName: string })
      : null;
  const supplierName = supplierInfo?.businessName;

  const hasVariants = !!product.hasVariants && (product.variants?.length || 0) > 0;

  // Resolve the effective display data from the selected variant (if any)
  const activeVariant = hasVariants
    ? selectedVariant
    : null;

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

  const displayPrice = activeVariant ? activeVariant.price : product.price;
  const displayStock = activeVariant ? activeVariant.stock : product.stock;
  const variantLabel = activeVariant
    ? activeVariant.attributes.map((a) => `${a.name}: ${a.value}`).join("، ")
    : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          صفحه اصلی
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link
          href="/products"
          className="transition-colors hover:text-foreground"
        >
          محصولات
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Product Images Gallery */}
        <div className="space-y-3">
          {/* Main Image — click to open lightbox */}
          <div
            className="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-muted to-muted/50 cursor-pointer group"
            onClick={() =>
              displayImages.length > 0 && setLightboxOpen(true)
            }
          >
            {displayImages.length > 0 && !imageError[selectedImage] ? (
              <>
                {/* Loading skeleton */}
                {!imageLoaded[selectedImage] && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 animate-pulse">
                    <span className="text-8xl font-bold text-muted-foreground/10">
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
                    "object-cover transition-all duration-500",
                    imageLoaded[selectedImage]
                      ? "opacity-100"
                      : "opacity-0"
                  )}
                />

                {/* Click to enlarge hint */}
                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-background/60 px-2.5 py-1 text-[10px] text-foreground/60 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100">
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
                      className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-background hover:scale-110"
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-background hover:scale-110"
                    >
                      <ChevronRightIcon className="h-5 w-5" />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                {imageError[selectedImage] ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                    <ImageOff className="h-16 w-16" />
                    <span className="text-sm">بارگذاری تصویر با خطا مواجه شد</span>
                  </div>
                ) : (
                  <span className="text-8xl font-bold text-muted-foreground/20">
                    {product.name?.[0] || "?"}
                  </span>
                )}
              </div>
            )}

            {/* Badges overlay */}
            <div className="absolute left-4 top-4 flex flex-col gap-2">
              {displayStock === 0 ? (
                <Badge variant="destructive" className="text-sm px-3 py-1">
                  ناموجود
                </Badge>
              ) : displayStock <= 3 ? (
                <Badge variant="warning" className="text-sm px-3 py-1">
                  تنها {displayStock} عدد باقیست
                </Badge>
              ) : (
                <Badge variant="success" className="text-sm px-3 py-1">
                  موجود
                </Badge>
              )}
            </div>

            <div className="absolute right-4 top-4">
              <Badge variant="secondary" className="text-sm px-3 py-1">
                {categoryName}
              </Badge>
            </div>
          </div>

          {/* Thumbnails */}
          {displayImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
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
                    "relative aspect-square w-20 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-200 hover:opacity-90",
                    selectedImage === idx
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-transparent opacity-60 hover:opacity-80"
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

        {/* Product Info */}
        <div className="flex flex-col justify-center space-y-6">
          {/* Category */}
          <p className="text-sm font-medium text-muted-foreground">
            {categoryName}
          </p>

          {/* Name */}
          <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
            {product.name}
          </h1>

          {/* Price */}
          <div>
            <span className="text-3xl font-bold text-emerald-600">
              {formatPrice(displayPrice)}
            </span>
            {hasVariants && !activeVariant && (
              <span className="mr-2 text-sm text-muted-foreground">
                (از {formatPrice(product.price)})
              </span>
            )}
          </div>

          {/* Variant selector */}
          {hasVariants && (
            <VariantSelector
              variants={product.variants || []}
              onSelect={setSelectedVariant}
            />
          )}

          {/* Description */}
          {product.description && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">توضیحات محصول</h3>
              <p className="text-sm leading-7 text-muted-foreground whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}

          {/* Meta badges */}
          <div className="flex flex-wrap gap-3">
            {displayStock > 0 && (
              <Badge variant="success" className="gap-1.5 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                موجود در انبار
              </Badge>
            )}
            {activeVariant?.sku && (
              <Badge variant="secondary" className="gap-1.5 text-xs" dir="ltr">
                SKU: {activeVariant.sku}
              </Badge>
            )}
            {variantLabel && (
              <Badge variant="secondary" className="gap-1.5 text-xs">
                {variantLabel}
              </Badge>
            )}
            {supplierName && supplierInfo && (
              <Link href={`/suppliers/${supplierInfo._id}`}>
                <Badge
                  variant="secondary"
                  className="gap-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Store className="h-3 w-3" />
                  {supplierName}
                </Badge>
              </Link>
            )}
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <Truck className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs font-medium">ارسال سریع</p>
                <p className="text-[10px] text-muted-foreground">
                  ۲۴ تا ۴۸ ساعت
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs font-medium">ضمانت قیمت</p>
                <p className="text-[10px] text-muted-foreground">
                  بهترین قیمت بازار
                </p>
              </div>
            </div>
          </div>

          {/* Add to cart + wishlist */}
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1 gap-2 text-base"
              disabled={displayStock === 0 || (hasVariants && !activeVariant)}
              onClick={() => {
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
              }}
            >
              <ShoppingCart className="h-5 w-5" />
              {displayStock === 0
                ? "ناموجود"
                : hasVariants && !activeVariant
                ? "انتخاب تنوع"
                : "افزودن به سبد خرید"}
            </Button>

            {/* Wishlist (Session 35) */}
            <Button
              size="lg"
              variant="outline"
              className={cn(
                "gap-2 text-base",
                inWishlist && "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
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
                  inWishlist && "fill-rose-500 text-rose-500"
                )}
              />
              {inWishlist ? "در علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"}
            </Button>
          </div>
        </div>
      </div>

      {/* Reviews & Ratings (Session 34) — approved reviews + gated form */}
      <ReviewsSection productId={product._id} productName={product.name} />

      {/* Image Lightbox */}
      <ImageLightbox
        images={displayImages}
        initialIndex={selectedImage}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />

      {/* SEO: product structured data + aggregateRating synced to approved reviews */}
      <ProductJsonLd
        data={{
          name: product.name,
          description: product.description || "",
          image: displayImages,
          sku: activeVariant?.sku || undefined,
          brand: typeof product.brand === "object" && product.brand ? (product.brand as { name: string }).name : undefined,
          offers: {
            price: displayPrice,
            priceCurrency: "IRR",
            availability: displayStock > 0 ? "InStock" : "OutOfStock",
          },
          aggregateRating:
            product.ratingSummary && product.ratingSummary.count > 0
              ? {
                  ratingValue: product.ratingSummary.average,
                  reviewCount: product.ratingSummary.count,
                }
              : undefined,
        }}
      />
    </div>
  );
}
