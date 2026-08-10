import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

/**
 * Storefront breadcrumb (Session 72) — Server Component.
 *
 * Rendered in the INITIAL server HTML (no client JS required): semantic
 * `<nav aria-label="مسیر دسترسی">` + ordered list, RTL/Persian friendly,
 * each navigable item is a real internal link, the current page is plain
 * text with `aria-current="page"` (never a self-link), and `flex-wrap`
 * keeps long Persian names from overflowing on mobile.
 *
 * No `dangerouslySetInnerHTML`, no client-side behavior. The same
 * `BreadcrumbItem[]` fed to the visible UI also feeds the page's
 * BreadcrumbList JSON-LD, so the two always agree.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="مسیر دسترسی" className="mb-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1.5">
              {index > 0 && (
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground/50"
                  aria-hidden="true"
                />
              )}
              {item.url && !isLast ? (
                <Link
                  href={item.url}
                  className="transition-colors hover:text-foreground"
                >
                  {item.name}
                </Link>
              ) : (
                <span
                  className={isLast ? "font-medium text-foreground" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.name}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
