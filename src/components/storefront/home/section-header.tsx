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
    /* Session 85 — oversized/extrabold title (Productcarousel reference) with
       the icon chip + blue underline «مشاهده همه» link. Structure, slots
       (href/linkLabel/icon/aside) and semantic h2 are unchanged.
       Redesign pass — refined icon chip (inset ring), a short brand-gradient
       accent underline anchoring the title, and a cleaner side cluster. */
    <div className={cn("mb-6 flex items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          <span
            aria-hidden="true"
            className="mt-2 block h-1 w-12 rounded-full bg-gradient-to-l from-primary to-primary/25"
          />
          {subtitle && (
            /* Readability pass — was text-xs/12px in muted-foreground. */
            <p className="mt-2 sf-meta text-sf-dim">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {aside}
        {href && (
          <Link
            href={href}
            /* Readability pass — sf-label (14px) + a ≥36px hit target. */
            className="group inline-flex min-h-9 items-center gap-1 border-b border-primary/50 pb-0.5 sf-label font-medium text-primary transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {linkLabel}
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
