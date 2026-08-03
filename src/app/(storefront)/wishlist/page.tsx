"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Heart, PackageX, HeartOff, AlertCircle, RefreshCw, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import { ProductCard } from "@/components/storefront/product-card";
import { useWishlistItems, useToggleWishlist } from "@/hooks/use-wishlist";
import { useAddWishlistToCart } from "@/hooks/use-wishlist-cart";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import type { Product } from "@/types";

/**
 * Customer Wishlist page (Session 35).
 * Renders the saved products (newest first). Deleted products are kept as
 * rows with `product: null` → shown as an "unavailable" placeholder so the
 * customer can remove them; inactive products render via ProductCard with
 * their nameوضعیت (ناموجود badge) intact.
 */
export default function WishlistPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useWishlistItems(page);
  const toggleWishlist = useToggleWishlist();
  const addWishlistToCart = useAddWishlistToCart();
  const addItem = useCartStore((s) => s.addItem);
  const setCartOpen = useCartStore((s) => s.setCartOpen);

  /**
   * «افزودن همه به سبد» (Session 38) — resolves the wishlist rows against
   * FRESH product/variant state server-side, then adds each returned payload
   * to the client cart store. Wishlist rows are NOT modified (keep-in-wishlist
   * design). Partial success is surfaced via toast + inline note.
   *
   * Session 43 note: with coexisting rows, the resolver emits ONE entry per
   * wishlist row — so a product holding a product-level row + a variant row
   * may produce two entries (the product-level fallback variant and the saved
   * variant). If both land on the same variant the cart merges them to
   * quantity 2. Intentional: the resolver stays byte-for-byte unchanged.
   */
  const handleAddAllToCart = () => {
    addWishlistToCart.mutate(undefined, {
      onSuccess: (res) => {
        // Add every resolvable item to the client cart (idempotent merge:
        // existing key → quantity increment capped at maxQuantity).
        res.added.forEach((item) => {
          addItem({
            id: item.id,
            variantId: item.variantId,
            sku: item.sku,
            variantLabel: item.variantLabel,
            slug: item.slug,
            name: item.name,
            price: item.price,
            maxQuantity: item.maxQuantity,
            image: item.image,
          });
        });

        // Nothing addable — the button is hidden for an empty list, so this
        // only fires when every row is a deleted/inactive/out-of-stock item.
        if (res.addedCount === 0) {
          showToast.error(
            "هیچ‌کدام از محصولات علاقه‌مندی در دسترس نیستند"
          );
          return;
        }

        if (res.skippedCount > 0) {
          showToast.info(
            `${res.addedCount} محصول به سبد خرید اضافه شد؛ ${res.skippedCount} مورد در دسترس نیست`
          );
        } else {
          showToast.success(
            `${res.addedCount} محصول به سبد خرید اضافه شد`
          );
        }
        setCartOpen(true);
      },
      onError: () => {
        showToast.error("خطا در افزودن به سبد خرید");
      },
    });
  };

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!session || session.user.role !== "customer") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <Heart className="mx-auto mb-4 h-12 w-12 text-rose-400" />
        <h1 className="mb-2 text-2xl font-bold">علاقه‌مندی‌ها</h1>
        <p className="mb-6 text-muted-foreground">
          برای دیدن علاقه‌مندی‌های خود وارد حساب شوید
        </p>
        <Button onClick={() => router.push("/login")}>ورود</Button>
      </div>
    );
  }

  const items = data?.data || [];
  const unavailableCount = items.filter((i) => !i.product).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Heart className="h-6 w-6 fill-rose-500 text-rose-500" />
            علاقه‌مندی‌ها
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? "..."
              : `${data?.total ?? 0} محصول ذخیره شده`}
            {unavailableCount > 0 && (
              <span className="mr-2 text-xs text-destructive">
                ({unavailableCount} مورد در دسترس نیست)
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* افزودن همه به سبد (Session 38). The resolver processes ALL wishlist
              pages (not just the current page), so disable only while loading or
              when the wishlist is completely empty — placeholder rows resolve to
              skipped items and surface via the toast instead. */}
          <Button
            className="gap-2"
            loading={addWishlistToCart.isPending}
            disabled={isLoading || !data || data.total === 0}
            onClick={handleAddAllToCart}
          >
            <ShoppingCart className="h-4 w-4" />
            افزودن همه به سبد
          </Button>
          <Button variant="outline" asChild>
            <Link href="/products">مشاهده همه محصولات</Link>
          </Button>
        </div>
      </div>

      {/* Content */}
      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">خطا در دریافت علاقه‌مندی‌ها</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Heart className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h2 className="mb-2 text-lg font-semibold">
              هنوز محصولی به علاقه‌مندی‌ها اضافه نکرده‌اید
            </h2>
            <p className="mb-6 max-w-sm text-sm text-muted-foreground">
              با کلیک روی آیکون قلب در کنار محصولات، آنها را برای خرید بعدی
              ذخیره کنید.
            </p>
            <Button asChild>
              <Link href="/products">مشاهده محصولات</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) =>
              item.product ? (
                <div key={item._id}>
                  <ProductCard product={item.product as Product} />
                  {/* Variant-level row (Session 43): annotate the card with the
                      SAVED variant (label + sku) so the customer knows exactly
                      which size/color/... was wishlisted. In-flow strip BELOW
                      the card (NOT an overlay — an absolute badge would cover
                      the card's add-to-cart button). The card's own heart
                      removes ALL rows for the product (product-level semantics). */}
                  {item.variantId && (
                    <div
                      className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed bg-muted/40 px-2 py-1.5 text-center text-[11px] font-medium text-foreground"
                      dir="rtl"
                    >
                      <span>{item.variantSnapshot?.label || "تنوع انتخاب‌شده"}</span>
                      {item.variantSnapshot?.sku && (
                        <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                          SKU: {item.variantSnapshot.sku}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Deleted product → unavailable placeholder (row kept) */
                <div
                  key={item._id}
                  className="relative flex aspect-[3/4] flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-dashed bg-muted/30 p-4 text-center"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <PackageX className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    این محصول دیگر در دسترس نیست
                  </p>
                  {/* Deleted variant row — keep the snapshot label so the
                      customer can identify what was saved. */}
                  {item.variantId && item.variantSnapshot?.label && (
                    <p className="text-xs text-muted-foreground" dir="rtl">
                      {item.variantSnapshot.label}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() =>
                      // variantId passed → remove exactly this (variant) row
                      toggleWishlist.mutate({
                        productId: item.productId,
                        inList: true,
                        variantId: item.variantId || undefined,
                      })
                    }
                  >
                    <HeartOff className="h-3.5 w-3.5" />
                    حذف از علاقه‌مندی‌ها
                  </Button>
                </div>
              )
            )}
          </div>

          {data && data.totalPages > 1 && (
            <PaginationControls
              page={data.page}
              totalPages={data.totalPages}
              onPageChange={setPage}
              className="mt-8"
            />
          )}
        </>
      )}
    </div>
  );
}
