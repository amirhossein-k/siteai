"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
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

  return (
    <nav
      className={cn(
        "flex items-center justify-center gap-1.5 flex-wrap",
        className
      )}
      aria-label="صفحه‌بندی"
    >
      <Button
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronRight className="h-4 w-4" />
        قبلی
      </Button>

      {pageNumbers.map((num, idx) =>
        typeof num === "number" ? (
          <Button
            key={`${num}-${idx}`}
            variant={num === page ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-9 min-w-9 px-2",
              num === page && "pointer-events-none"
            )}
            onClick={() => onPageChange(num)}
          >
            {num}
          </Button>
        ) : (
          <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground">
            …
          </span>
        )
      )}

      <Button
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        بعدی
        <ChevronLeft className="h-4 w-4" />
      </Button>
    </nav>
  );
}
