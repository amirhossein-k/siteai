"use client";

import { ShoppingCart, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StickyMobileBuyBarProps {
  productName: string;
  price: number;
  effectivePrice: number;
  discountPercent?: number;
  inStock: boolean;
  onAddToCart: () => void;
  added?: boolean;
}

/**
 * Sticky Mobile Add-to-Cart Bar (UI/UX Conversion Upgrade).
 *
 * Keeps the primary CTA and final price pinned to the bottom of the screen
 * on mobile viewports (`md:hidden`) while the user scrolls through long
 * descriptions or reviews.
 */
export function StickyMobileBuyBar({
  productName,
  price,
  effectivePrice,
  discountPercent = 0,
  inStock,
  onAddToCart,
  added = false,
}: StickyMobileBuyBarProps) {
  return (
    <div
      role="region"
      aria-label={`خرید سریع ${productName}`}
      className="glass-strong fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-sf-line px-4 py-3 shadow-2xl md:hidden"
    >
      <div className="flex flex-col">
        {discountPercent > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
              {discountPercent}٪ تخفیف
            </span>
            <span className="text-xs text-sf-dim line-through">
              {price.toLocaleString("fa-IR")}
            </span>
          </div>
        )}
        <div className="flex items-baseline gap-1">
          <span className="text-base font-extrabold text-sf-strong">
            {effectivePrice.toLocaleString("fa-IR")}
          </span>
          <span className="text-xs text-sf-dim">تومان</span>
        </div>
      </div>

      <button
        type="button"
        disabled={!inStock}
        onClick={onAddToCart}
        className={cn(
          "flex h-11 min-w-[160px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white shadow-lg transition",
          !inStock
            ? "cursor-not-allowed bg-zinc-700 text-zinc-400"
            : added
            ? "bg-emerald-600"
            : "bg-indigo-600 hover:bg-indigo-500 active:scale-95"
        )}
      >
        {!inStock ? (
          <span>ناموجود</span>
        ) : added ? (
          <>
            <Check className="h-4 w-4" />
            <span>به سبد اضافه شد</span>
          </>
        ) : (
          <>
            <ShoppingCart className="h-4 w-4" />
            <span>افزودن به سبد خرید</span>
          </>
        )}
      </button>
    </div>
  );
}
