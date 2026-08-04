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
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Special Picks (Session 50) — «پیشنهادهای ویژه امروز».
 *
 * No discount data exists in the schema, so this section is HONEST:
 * a countdown + the best-value products (lowest price, real prices only)
 * drawn from the shared homepage product pool. No fake percentages, no fake
 * sales — the countdown simply marks "today's picks".
 *
 * Session 53 — countdown + limits come from the CMS:
 *   - presentation.behavior.countdownEnabled (false hides the chip);
 *   - countdownTarget: "end_of_day" | "fixed" | "off";
 *   - countdownEndsAt: when target = "fixed";
 *   - maxItems: how many products to show.
 */
export function SpecialPicks({ section }: HomepageSectionRendererProps) {
  const { data, isLoading, isError } = useHomeProductPool();
  const behavior = section.presentation?.behavior;

  const maxItems = Math.min(behavior?.maxItems ?? 12, 24);
  const countdownEnabled = behavior?.countdownEnabled ?? true;
  const countdownTarget = behavior?.countdownTarget ?? "end_of_day";
  const countdownEndsAt = behavior?.countdownEndsAt
    ? new Date(behavior.countdownEndsAt)
    : null;

  const target =
    countdownTarget === "fixed" && countdownEndsAt
      ? countdownEndsAt.getTime()
      : Date.now() + msUntilEndOfToday();
  const countdown = useCountdown(target);
  const showCountdown = countdownEnabled && countdownTarget !== "off";

  const pool = data?.data ?? [];
  // Cheapest first — today's value picks, real API prices.
  const picks = [...pool].sort((a, b) => a.price - b.price).slice(0, maxItems);

  return (
    <ProductRail
      title={section.title || "پیشنهادهای ویژه امروز"}
      subtitle={section.subtitle || "بهترین انتخاب‌ها با قیمت‌های واقعی"}
      href="/products"
      icon={<Timer className="h-4.5 w-4.5" />}
      aside={
        showCountdown ? (
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
        ) : undefined
      }
      products={picks}
      loading={isLoading}
      error={isError}
    />
  );
}
