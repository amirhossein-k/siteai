import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/**
 * Spinner component for loading states
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-5 w-5 animate-spin text-zinc-500", className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * Full page loading state
 */
export function PageLoader({ text = "در حال بارگذاری..." }: { text?: string }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
      <Spinner className="h-8 w-8" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{text}</p>
    </div>
  );
}

/**
 * Product card skeleton for loading state
 */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <Skeleton className="mb-4 aspect-square w-full rounded-lg" />
      <Skeleton className="mb-2 h-4 w-3/4" />
      <Skeleton className="mb-4 h-4 w-1/2" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

/**
 * Product grid skeleton
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Table row skeleton
 */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}
