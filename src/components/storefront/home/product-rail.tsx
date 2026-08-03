"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, PackageOpen } from "lucide-react";
import { ProductCard } from "@/components/storefront/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { ReactNode } from "react";
import type { Product } from "@/types";

interface ProductRailProps {
  title: string;
  subtitle?: string;
  /** Optional «مشاهده همه» link */
  href?: string;
  linkLabel?: string;
  icon?: ReactNode;
  /** Extra node rendered in the header (e.g. countdown chip) */
  aside?: ReactNode;
  products: Product[];
  loading?: boolean;
  error?: boolean;
}

const SKELETON_COUNT = 6;

/**
 * Horizontal scroll-snap product rail (Session 50).
 * Native CSS scroll + arrow buttons — no carousel dependency. Renders the
 * existing ProductCard unchanged (wishlist/cart/skeleton all preserved).
 */
export function ProductRail({
  title,
  subtitle,
  href,
  linkLabel,
  icon,
  aside,
  products,
  loading = false,
  error = false,
}: ProductRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollByWidth = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const showEmpty =
    !loading && !error && products.length === 0;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        href={href}
        linkLabel={linkLabel}
        icon={icon}
        aside={aside}
      />

      {error ? (
        <div className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          خطا در دریافت محصولات — لطفاً بعداً دوباره تلاش کنید
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 p-8 text-center">
          <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            هنوز محصولی برای نمایش وجود ندارد
          </p>
        </div>
      ) : (
        <div className="relative group/rail">
          {/* Prev / Next arrows (desktop) */}
          {/* Mobile-only arrows — on md+ the track becomes a static grid,
              so desktop needs no scroll controls (review fix). */}
          {products.length > 2 && (
            <>
              <button
                type="button"
                aria-label="اسکرول به راست"
                onClick={() => scrollByWidth(1)}
                className="absolute -right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-all hover:scale-105 hover:text-foreground md:hidden"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="اسکرول به چپ"
                onClick={() => scrollByWidth(-1)}
                className="absolute -left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-all hover:scale-105 hover:text-foreground md:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}

          {/* Scroll-snap track — desktop: 6-up; mobile: ~2-up snap */}
          <div
            ref={trackRef}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-none md:grid md:grid-cols-2 md:snap-none md:overflow-visible md:pb-0 lg:grid-cols-3 xl:grid-cols-6"
          >
            {products.map((product) => (
              <div
                key={product._id}
                className="w-[44%] shrink-0 snap-start sm:w-[30%] md:w-auto"
              >
                <ProductCard product={product} className="h-full" />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
