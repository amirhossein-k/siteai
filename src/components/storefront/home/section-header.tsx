import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SectionHeaderProps {
  /** Section title (Persian) */
  title: string;
  /** Optional supporting line under the title */
  subtitle?: string;
  /** When set, renders a «مشاهده همه» link on the side */
  href?: string;
  linkLabel?: string;
  /** Optional decorative icon at the start of the title */
  icon?: ReactNode;
  /** Optional extra node on the header side (e.g. countdown chip) */
  aside?: ReactNode;
  className?: string;
}

/**
 * Consistent section header used by every homepage section.
 * Pure presentational component — no hooks, safe anywhere.
 */
export function SectionHeader({
  title,
  subtitle,
  href,
  linkLabel = "مشاهده همه",
  icon,
  aside,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-3", className)}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/5 text-primary">
            {icon}
          </span>
        )}
        <div>
          <h2 className="text-lg font-bold text-foreground sm:text-xl">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {aside}
        {href && (
          <Link
            href={href}
            className="group inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 sm:text-sm"
          >
            {linkLabel}
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
