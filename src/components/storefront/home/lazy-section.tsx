"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

interface LazySectionProps {
  children: ReactNode;
  /** Minimum placeholder height while the section is off-screen */
  minHeight?: number;
  className?: string;
  /**
   * SEO Upgrade: When true (default), children stay mounted in the initial
   * SSR HTML so Googlebot indexes all homepage product rails and internal
   * links without needing scroll events. Uses CSS content-visibility for
   * rendering performance instead of unmounting DOM nodes.
   */
  seoPreRender?: boolean;
}

/**
 * Below-the-fold section wrapper (SEO-friendly upgrade).
 *
 * Previously, `inView` defaulted to `false` and omitted `children` from the
 * initial HTML, causing search engine crawlers to see an almost empty homepage.
 * Now `seoPreRender = true` keeps children in the DOM with `content-visibility: auto`
 * so crawlers index all sections while browsers still defer off-screen layout/paint.
 */
export function LazySection({
  children,
  minHeight = 320,
  className = "",
  seoPreRender = true,
}: LazySectionProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(seoPreRender);

  useEffect(() => {
    if (seoPreRender) return;
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
      { rootMargin: "300px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seoPreRender]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        minHeight,
        contentVisibility: "auto",
        containIntrinsicSize: `0 ${minHeight}px`,
      }}
    >
      {inView ? (
        children
      ) : (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="mb-6 h-7 w-48 rounded-lg bg-sf-chip" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="glass rounded-2xl border border-sf-line p-3"
              >
                <Skeleton className="mb-3 aspect-square w-full rounded-xl bg-sf-chip" />
                <Skeleton className="mb-2 h-4 w-3/4 rounded bg-sf-chip" />
                <Skeleton className="h-4 w-1/2 rounded bg-sf-chip" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
