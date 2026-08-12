"use client";

import { useCallback, useRef } from "react";
import { BadgePercent } from "lucide-react";
import { usePublicProducts } from "@/hooks/use-public-products";
import { ProductRail } from "@/components/storefront/home/product-rail";
import { DiscountCountdown } from "@/components/storefront/discount-countdown";
import { findNearestDiscountEndsAt } from "@/lib/discount-countdown";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * «محصولات تخفیف‌دار» (Session 77) — products with a discount ACTIVE at
 * request time.
 *
 * The `discounted=true` filter is evaluated SERVER-side by the public products
 * API with the exact getEffectivePrice time semantics (enabled + in-window,
 * start inclusive / end exclusive), so expired, future and disabled discounts
 * never appear — and the list rules already exclude inactive and out-of-stock
 * products. No fake percentages, no pool derivation: the rail only ever shows
 * what the server computes as currently discounted. The empty state stays
 * honest (the rail renders nothing when no discount is live).
 *
 * Session 78 — section-level countdown + automatic expiry:
 *   - The nearest finite `discount.endsAt` among the CURRENT rail products
 *     drives a countdown chip in the ProductRail `aside` slot (reused
 *     unchanged). Open-ended discounts (endsAt null) never schedule one.
 *   - When that countdown reaches zero, DiscountCountdown fires `onExpire`
 *     exactly once → ONE refetch of the discounted list. The server
 *     recomputes the window at request time, the expired product leaves the
 *     list, `findNearestDiscountEndsAt` yields the next finite expiry, the
 *     chip restarts against it, and the cycle continues — no per-second
 *     polling, no per-product requests, and React Query's
 *     refetchOnWindowFocus stays untouched.
 */
export function DiscountedProducts({
  section,
}: HomepageSectionRendererProps) {
  const maxItems = Math.min(
    section.presentation?.behavior?.maxItems ?? 12,
    24
  );
  const { data, isLoading, isError, refetch } = usePublicProducts({
    discounted: "true",
    limit: maxItems,
  });
  const products = data?.data ?? [];

  // Nearest finite expiry among the currently-rendered products (null when
  // every active discount is open-ended — then no chip and no refetch). A
  // trivial ≤24-item scan on parent re-renders (the ticking lives in the
  // child), so no memoization is needed.
  const nearestEndsAt = findNearestDiscountEndsAt(products);

  // Session 78.1 — exactly ONE refetch per expiry EVENT, keyed by the expired
  // target: the aside chip AND every rail card's own countdown report through
  // this handler, and any number of chips hitting the same end time collapse
  // into a single refetch. After the refetch the expired product leaves the
  // list (server recomputes the window at request time), the next target
  // becomes current and the cycle continues — no per-second polling, no
  // per-product requests.
  const lastExpiredTargetRef = useRef<number | null>(null);
  const handleExpire = useCallback(
    (endsAt: number | string) => {
      const ms =
        typeof endsAt === "number" ? endsAt : new Date(endsAt).getTime();
      if (!Number.isFinite(ms) || lastExpiredTargetRef.current === ms) return;
      lastExpiredTargetRef.current = ms;
      void refetch();
    },
    [refetch]
  );

  return (
    <ProductRail
      title={section.title || "محصولات تخفیف‌دار"}
      subtitle={section.subtitle || "تخفیف‌های فعال همین حالا"}
      href="/products?discounted=true"
      icon={<BadgePercent className="h-4.5 w-4.5" />}
      aside={
        nearestEndsAt !== null ? (
          <DiscountCountdown
            endsAt={nearestEndsAt}
            compact
            onExpire={() => handleExpire(nearestEndsAt)}
          />
        ) : undefined
      }
      products={products}
      loading={isLoading}
      error={isError}
      onCardCountdownExpire={handleExpire}
    />
  );
}
