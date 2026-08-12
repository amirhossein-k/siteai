"use client";

import { useEffect, useRef } from "react";
import { Timer } from "lucide-react";
import { useCountdown } from "@/hooks/use-countdown";
import { formatPersianRemaining } from "@/lib/discount-countdown";
import { cn } from "@/lib/utils";

interface DiscountCountdownProps {
  /** Discount expiry (`discount.endsAt` from the server) — ISO string, epoch ms, or Date. */
  endsAt: string | number | Date;
  /** Compact pill for cards/rail; slightly larger when false. */
  compact?: boolean;
  /**
   * Fired exactly ONCE when the countdown reaches zero. Presentation-only —
   * pricing authority always stays server-side (the caller typically
   * refetches / hides the stale badge here).
   */
  onExpire?: () => void;
  className?: string;
}

/**
 * Reusable discount countdown chip (Session 78).
 *
 * SSR/hydration-safe: renders NOTHING until the hook is ready (the 1-second
 * ticker starts at 0 and syncs after mount — no hydration mismatch), and
 * renders nothing after expiry (the chip disappears on its own; `onExpire`
 * is the hook for any caller reaction). Uses the existing `useCountdown`
 * unchanged and the existing lucide `Timer` icon.
 */
export function DiscountCountdown({
  endsAt,
  compact = true,
  onExpire,
  className,
}: DiscountCountdownProps) {
  const targetMs = new Date(endsAt).getTime();
  const countdown = useCountdown(Number.isFinite(targetMs) ? targetMs : 0);
  const firedRef = useRef(false);

  // Fire `onExpire` exactly once per target: the guard resets when the target
  // changes (useCountdown restarts) and stays latched while expired — so a
  // refetch that keeps returning the same (now-past) endsAt can never loop.
  useEffect(() => {
    if (countdown.expired) {
      if (!firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    } else {
      firedRef.current = false;
    }
  }, [countdown.expired, onExpire]);

  if (!Number.isFinite(targetMs)) return null;
  if (!countdown.ready || countdown.expired) return null;
  const text = formatPersianRemaining(countdown);
  if (!text) return null;

  return (
    <span
      role="timer"
      aria-label={text}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/20 bg-primary/5 font-medium text-primary",
        compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
        className
      )}
    >
      <Timer className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {text}
    </span>
  );
}
