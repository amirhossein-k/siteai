"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, PackageOpen } from "lucide-react";
import { ProductCard } from "@/components/storefront/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/storefront/home/section-header";
import { cn } from "@/lib/utils";
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
  /**
   * Session 78.1 — optional hook forwarded to every card's countdown expiry
   * (the discounted rail refetches once per expired target). Omit for the
   * default (cards just hide their chip on expiry).
   */
  onCardCountdownExpire?: (endsAt: string) => void;
  products: Product[];
  loading?: boolean;
  error?: boolean;
}

const SKELETON_COUNT = 6;

/** Fixed card widths shared by the track and the skeleton placeholders so the
 *  loading state mirrors the real carousel layout (Session 85 Phase B). */
const CARD_WIDTH =
  "w-[44%] sm:w-[30%] md:w-[280px] xl:w-[300px] shrink-0 snap-start";

/**
 * Horizontal scroll-snap product rail (Session 50; Session 85 Phase B —
 * reference-style carousel on ALL breakpoints).
 *
 * Native CSS scroll + arrow buttons — no carousel dependency. On desktop the
 * track is a true horizontal scroll-snap carousel (replacing the old static
 * grid) with flanking glass circular nav buttons (Productcarousel reference);
 * mobile keeps the touch/snap behavior plus the existing floating arrows.
 * RTL-correct: the flanking stack renders on the start (right) side and the
 * forward button scrolls toward the end of the RTL rail.
 *
 * Keyboard: the track is a focusable region (arrow keys scroll it natively
 * once focused) and the nav buttons carry focus-visible rings + aria-labels.
 */
export function ProductRail({
  title,
  subtitle,
  href,
  linkLabel,
  icon,
  aside,
  onCardCountdownExpire,
  products,
  loading = false,
  error = false,
}: ProductRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  /** Scroll by one card + gap (snap-friendly); falls back to 80% of the track
   *  width when no card is measurable. In RTL, scrollLeft is 0 at the start
   *  (right edge) and NEGATIVE toward the end, so dir=-1 scrolls INTO the
   *  rail (reveals more products) and dir=+1 scrolls back toward the start. */
  const scrollByCard = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = card
      ? card.getBoundingClientRect().width + 20
      : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  const showEmpty = !loading && !error && products.length === 0;

  const navButton =
    "flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted-foreground backdrop-blur transition-all duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

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
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
          خطا در دریافت محصولات — لطفاً بعداً دوباره تلاش کنید
        </div>
      ) : loading ? (
        <div className="flex gap-5 overflow-hidden pb-2">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div
              key={i}
              className={cn(
                CARD_WIDTH,
                "overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]"
              )}
            >
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            هنوز محصولی برای نمایش وجود ندارد
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Mobile-only floating arrows (unchanged behavior from Session 50) */}
          {products.length > 2 && (
            <>
              <button
                type="button"
                aria-label="اسکرول به راست"
                onClick={() => scrollByCard(1)}
                className="absolute -right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-muted-foreground shadow-md backdrop-blur transition-all hover:scale-105 hover:text-white md:hidden"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="اسکرول به چپ"
                onClick={() => scrollByCard(-1)}
                className="absolute -left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-muted-foreground shadow-md backdrop-blur transition-all hover:scale-105 hover:text-white md:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          )}

          <div className="flex items-center gap-4">
            {/* Desktop flanking nav (Productcarousel reference) — in RTL this
                column is the FIRST flex child, so it sits on the right (the
                rail's start side).

                RTL scroll semantics (verified): scrollLeft is 0 at the start
                (right edge) and goes NEGATIVE toward the end. So scrolling
                INTO the rail (revealing more products, the "next" action) is
                scrollBy(-step); scrolling back to the start is scrollBy(+step)
                (clamped at 0). The reference demo's own mapping is inverted
                (its top button scrolls +280 = toward the start); the
                requirement explicitly demands RTL-correct behavior, so the
                buttons below use the correct direction and their aria-labels
                describe the ACTUAL scroll direction, consistent with the
                mobile arrows. */}
            <div className="hidden shrink-0 flex-col gap-3 md:flex">
              <button
                type="button"
                aria-label="اسکرول به چپ"
                onClick={() => scrollByCard(-1)}
                className={navButton}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="اسکرول به راست"
                onClick={() => scrollByCard(1)}
                className={navButton}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Scroll-snap track — fixed-width cards on every breakpoint
                (desktop: true carousel; mobile: ~2-up snap). */}
            <div
              ref={trackRef}
              role="region"
              aria-label={title}
              tabIndex={0}
              className="flex flex-1 snap-x snap-mandatory gap-5 overflow-x-auto pb-2 scrollbar-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {products.map((product) => (
                <div key={product._id} className={CARD_WIDTH}>
                  <ProductCard
                    product={product}
                    className="h-full"
                    onCountdownExpire={onCardCountdownExpire}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
