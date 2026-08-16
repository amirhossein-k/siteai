"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

interface LazySectionProps {
  children: ReactNode;
  /** Minimum placeholder height while the section is off-screen */
  minHeight?: number;
  className?: string;
}

/**
 * Session 50 — below-the-fold lazy mount.
 *
 * Children stay unmounted until the wrapper approaches the viewport, which
 * defers the section's React Query fetch until the user actually scrolls
 * near it (queries only fire when a component mounts). Falls back to a
 * skeleton placeholder meanwhile. Once in view it stays mounted.
 */
export function LazySection({
  children,
  minHeight = 320,
  className = "",
}: LazySectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "250px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ minHeight: inView ? undefined : minHeight }}>
      {inView ? (
        children
      ) : (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-7 w-48" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              /* Session 85 — glass skeleton surface (dark reference). */
              <div key={i} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-5 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
