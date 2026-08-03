"use client";

import { useEffect, useState } from "react";

/** Milliseconds until the end of the current day (local time). */
export function msUntilEndOfToday(): number {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return Math.max(0, end.getTime() - now.getTime());
}

export interface CountdownParts {
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
  /** False until the first tick after mount (avoids SSR paint flash). */
  ready: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Countdown to an absolute target timestamp, ticking every second.
 * Starts at 0 on first render and syncs after mount — avoids SSR hydration
 * mismatches (server and client compute different "now" values).
 */
export function useCountdown(targetMs: number): CountdownParts {
  const [remainingMs, setRemainingMs] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const tick = () =>
      setRemainingMs(Math.max(0, targetMs - Date.now()));
    tick();
    setReady(true);
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: remainingMs <= 0 && ready,
    ready,
  };
}

/** Formatted countdown like ۰۵:۲۳:۴۵ using western digits + colons. */
export function formatCountdown(parts: CountdownParts): string {
  return `${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}`;
}
