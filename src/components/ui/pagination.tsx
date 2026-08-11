"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  /** Button mode (default). Optional because the URL-driven hrefFor mode
   *  does not use it — the two modes are mutually exclusive at call sites. */
  onPageChange?: (page: number) => void;
  /**
   * URL-driven mode (Session 76) — STRICTLY additive. When provided, the
   * controls render real crawlable `<a>` (next/link) elements instead of
   * buttons, so crawlers can discover every paginated page and back/forward
   * + direct URL loading work natively. The current page is NOT a self-link:
   * it renders as a span with `aria-current="page"` (same convention as the
   * breadcrumbs).
   *
   * Exactly one of the two link sources must be provided (the modes are
   * mutually exclusive at call sites):
   *   - `hrefFor(page) => string` — a FUNCTION, usable only from CLIENT
   *     components (a Server Component cannot pass functions as props).
   *   - `pageHrefs: string[]` — a SERIALIZABLE array indexed by page number
   *     (index 0 unused), for SERVER components (e.g. the category page).
   *
   * Without either, the controls behave EXACTLY as before (buttons +
   * onPageChange) — all non-catalog consumers (notifications, wishlist,
   * orders, suppliers, support, admin lists) are untouched.
   */
  hrefFor?: (page: number) => string;
  /** Serializable 1-based hrefs (index 0 unused) — server-component mode. */
  pageHrefs?: string[];
  className?: string;
}

/**
 * Reusable pagination controls (RTL, Persian labels).
 * Renders nothing when there is only one page.
 */
export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  hrefFor,
  pageHrefs,
  className,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  // Build a compact list of page numbers with ellipsis when needed
  const pageNumbers: (number | "…")[] = [];
  const maxShown = 7;

  if (totalPages <= maxShown) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) pageNumbers.push("…");
    for (let i = start; i <= end; i++) pageNumbers.push(i);
    if (end < totalPages - 1) pageNumbers.push("…");
    pageNumbers.push(totalPages);
  }

  const linkMode = typeof hrefFor === "function" || Array.isArray(pageHrefs);
  const linkHref = (n: number) =>
    hrefFor ? hrefFor(n) : pageHrefs?.[n] ?? "";

  return (
    <nav
      className={cn(
        "flex items-center justify-center gap-1.5 flex-wrap",
        className
      )}
      aria-label="صفحه‌بندی"
    >
      {linkMode ? (
        page > 1 ? (
          <Link
            href={linkHref(page - 1)}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronRight className="h-4 w-4" />
            قبلی
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center gap-1 rounded-md border border-input px-3 text-sm font-medium text-muted-foreground opacity-50">
            <ChevronRight className="h-4 w-4" />
            قبلی
          </span>
        )
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={page <= 1}
          onClick={() => onPageChange?.(page - 1)}
        >
          <ChevronRight className="h-4 w-4" />
          قبلی
        </Button>
      )}

      {pageNumbers.map((num, idx) =>
        typeof num === "number" ? (
          linkMode ? (
            num === page ? (
              <span
                key={`${num}-${idx}`}
                aria-current="page"
                className="inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-primary px-2 text-sm font-semibold text-primary-foreground"
              >
                {num}
              </span>
            ) : (
              <Link
                key={`${num}-${idx}`}
                href={linkHref(num)}
                className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {num}
              </Link>
            )
          ) : (
            <Button
              key={`${num}-${idx}`}
              variant={num === page ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-9 min-w-9 px-2",
                num === page && "pointer-events-none"
              )}
              onClick={() => onPageChange?.(num)}
            >
              {num}
            </Button>
          )
        ) : (
          <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground">
            …
          </span>
        )
      )}

      {linkMode ? (
        page < totalPages ? (
          <Link
            href={linkHref(page + 1)}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            بعدی
            <ChevronLeft className="h-4 w-4" />
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center gap-1 rounded-md border border-input px-3 text-sm font-medium text-muted-foreground opacity-50">
            بعدی
            <ChevronLeft className="h-4 w-4" />
          </span>
        )
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={page >= totalPages}
          onClick={() => onPageChange?.(page + 1)}
        >
          بعدی
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
    </nav>
  );
}
