"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ArrowLeft,
  ShoppingBag,
  CreditCard,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";

/**
 * Cart (Session 93 — UI/UX modernization).
 *
 * Presentation-only rewrite: the cart store API (`items`, `updateQuantity`,
 * `removeItem`), the pricing arithmetic and every route are untouched. What
 * changed:
 *  - all surfaces/borders/text now use the theme-agnostic `sf-*` tokens, so
 *    the cart is correct in BOTH the dark and the light theme;
 *  - each line is a single, readable row on mobile (image → details → controls
 *    → line total) instead of a squeezed 3-column desktop layout;
 *  - quantity steppers are 36px with 44px tap padding and carry aria-labels;
 *  - the summary is a sticky, clearly-hierarchised card with a brand CTA.
 */
const CARD =
  "rounded-2xl border border-sf-line bg-sf-card/60 backdrop-blur-sm";

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const totalPrice = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  // --- Empty State ---
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex animate-in fade-in flex-col items-center justify-center py-20 text-center duration-300">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-sf-line bg-sf-chip">
            <ShoppingCart className="h-9 w-9 text-sf-dim" />
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">
            سبد خرید خالی است
          </h1>
          <p className="mb-8 text-sf-dim">
            هنوز محصولی به سبد خرید خود اضافه نکرده‌اید
          </p>
          <Button size="lg" className="blue-grad gap-2 font-bold text-white" asChild>
            <Link href="/products">
              <ShoppingBag className="h-5 w-5" />
              مشاهده محصولات
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            سبد خرید
          </h1>
          <p className="mt-1 text-sm text-sf-dim">
            {totalItems.toLocaleString("fa-IR")} کالا
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="gap-2 text-sf-dim hover:bg-sf-chip hover:text-sf-strong"
        >
          <ArrowLeft className="h-4 w-4" />
          ادامه خرید
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        {/* Cart Items */}
        <ul className="space-y-4 lg:col-span-2">
          {items.map((item) => {
            const lineTotal = item.price * item.quantity;
            return (
              <li
                key={item.key}
                className={`animate-in fade-in duration-200 ${CARD} p-3 sm:p-4`}
              >
                <div className="flex gap-3 sm:gap-4">
                  {/* Product image */}
                  <Link
                    href={`/products/${item.slug}`}
                    className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-sf-line bg-sf-image transition-opacity hover:opacity-90 sm:h-24 sm:w-24"
                  >
                    {item.image &&
                    !imgErrors[item.key] &&
                    isAllowedImageSrc(item.image) ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="96px"
                        loading="eager"
                        className="object-cover"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [item.key]: true }))
                        }
                      />
                    ) : (
                      <span className="text-2xl font-bold text-sf-dim/40">
                        {item.image ? (
                          <ImageOff className="h-6 w-6" />
                        ) : (
                          item.name[0] || "?"
                        )}
                      </span>
                    )}
                  </Link>

                  {/* Item details + controls */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/products/${item.slug}`}
                          className="line-clamp-2 text-sm font-semibold leading-5 transition-colors hover:text-primary"
                        >
                          {item.name}
                        </Link>
                        {item.variantLabel && (
                          <p className="mt-1 text-xs text-sf-dim">
                            {item.variantLabel}
                          </p>
                        )}
                        {item.sku && (
                          <p
                            className="mt-0.5 font-mono text-[10px] text-sf-dim"
                            dir="ltr"
                          >
                            SKU: {item.sku}
                          </p>
                        )}
                      </div>

                      {/* Remove */}
                      <button
                        type="button"
                        aria-label={`حذف ${item.name} از سبد خرید`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sf-dim transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60"
                        onClick={() => {
                          removeItem(item.key);
                          showToast.info(`${item.name} از سبد خرید حذف شد`);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      {/* Quantity stepper */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center overflow-hidden rounded-xl border border-sf-line bg-sf-image">
                          <button
                            type="button"
                            aria-label={`کاهش تعداد ${item.name}`}
                            className="flex h-9 w-9 items-center justify-center text-sf-dim transition-colors hover:bg-sf-chip hover:text-sf-strong disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                            onClick={() =>
                              updateQuantity(item.key, item.quantity - 1)
                            }
                            disabled={item.quantity <= 1}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span
                            aria-live="polite"
                            className="flex h-9 min-w-[2.5rem] items-center justify-center border-x border-sf-line px-1 text-sm font-bold tabular-nums"
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`افزایش تعداد ${item.name}`}
                            className="flex h-9 w-9 items-center justify-center text-sf-dim transition-colors hover:bg-sf-chip hover:text-sf-strong disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                            onClick={() =>
                              updateQuantity(item.key, item.quantity + 1)
                            }
                            disabled={item.quantity >= item.maxQuantity}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="text-[11px] text-sf-dim">
                          {item.quantity >= item.maxQuantity
                            ? "حداکثر موجودی"
                            : `${item.maxQuantity} عدد موجود`}
                        </span>
                      </div>

                      {/* Line total */}
                      <div className="text-left">
                        <p className="text-sm font-extrabold text-sf-price">
                          {formatPrice(lineTotal)}
                        </p>
                        <p className="text-[11px] text-sf-dim">
                          هر عدد {formatPrice(item.price)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className={`${CARD} sticky top-24 p-5`}>
            <h2 className="mb-4 text-lg font-bold">خلاصه سفارش</h2>
            <div className="space-y-3.5">
              {/* Items count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-sf-dim">تعداد کالا</span>
                <span className="font-medium">
                  {totalItems.toLocaleString("fa-IR")}
                </span>
              </div>

              {/* Subtotal */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-sf-dim">جمع جزء</span>
                <span className="font-medium">{formatPrice(totalPrice)}</span>
              </div>

              {/* Shipping */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-sf-dim">هزینه ارسال</span>
                <Badge variant="secondary" className="text-xs">
                  متغیر
                </Badge>
              </div>

              <div className="border-t border-sf-line pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">جمع کل</span>
                  <span className="text-xl font-black text-sf-price">
                    {formatPrice(totalPrice)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-sf-dim">
                  هزینه ارسال در مرحله بعد محاسبه می‌شود
                </p>
              </div>

              {/* Checkout CTA */}
              <Button
                className="blue-grad w-full gap-2 font-bold text-white"
                size="lg"
                asChild
              >
                <Link href="/checkout">
                  <CreditCard className="h-5 w-5" />
                  تسویه حساب
                </Link>
              </Button>

              {/* Continue shopping */}
              <Button
                variant="outline"
                className="w-full gap-2 border-sf-line bg-sf-chip text-sf-dim hover:bg-sf-chip/60 hover:text-sf-strong"
                asChild
              >
                <Link href="/products">
                  <ShoppingBag className="h-4 w-4" />
                  ادامه خرید
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
