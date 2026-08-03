"use client";

import { Timer } from "lucide-react";
import { useHomeProductPool } from "@/hooks/use-home-product-pool";
import {
  useCountdown,
  msUntilEndOfToday,
  formatCountdown,
} from "@/hooks/use-countdown";
import { ProductRail } from "@/components/storefront/home/product-rail";
import { cn } from "@/lib/utils";

/**
 * Special Picks (Session 50) — «پیشنهادهای ویژه امروز».
 *
 * No discount data exists in the schema, so this section is HONEST:
 * a countdown to the end of the day + the best-value products (lowest price,
 * real prices only) drawn from the shared homepage product pool. No fake
 * percentages, no fake sales — the countdown simply marks "today's picks".
 */
export function SpecialPicks() {
  const { data, isLoading, isError } = useHomeProductPool();
  const countdown = useCountdown(Date.now() + msUntilEndOfToday());

  const pool = data?.data ?? [];
  // Cheapest first — today's value picks, real API prices.
  const picks = [...pool]
    .sort((a, b) => a.price - b.price)
    .slice(0, 12);

  return (
    <ProductRail
      title="پیشنهادهای ویژه امروز"
      subtitle="بهترین انتخاب‌ها با قیمت‌های واقعی"
      href="/products"
      icon={<Timer className="h-4.5 w-4.5" />}
      aside={
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold tabular-nums",
            countdown.expired
              ? "border-muted text-muted-foreground"
              : "border-primary/20 bg-primary/5 text-primary"
          )}
        >
          <Timer className="h-3.5 w-3.5" />
          {countdown.ready
            ? countdown.expired
              ? "اتمام امروز"
              : `پایان تا ${formatCountdown(countdown)}`
            : "پایان تا --:--:--"}
        </span>
      }
      products={picks}
      loading={isLoading}
      error={isError}
    />
  );
}
