"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface FilterChipOption {
  _id: string;
  name: string;
}

interface FilterChipGroupProps {
  title: string;
  options: FilterChipOption[];
  selected: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  /** Optional per-option facet counts (attribute facets) — backward compatible. */
  counts?: Record<string, number>;
}

/**
 * Reusable facet chip row (Session 47).
 * Renders «همه» + one toggle chip per option; clicking the selected chip
 * clears the selection. Used for category, brand, tag and attribute facet
 * groups on the storefront catalog page. Presentational only — state lives
 * in useCatalogFilters. `counts` renders a small count badge per chip.
 */
export function FilterChipGroup({
  title,
  options,
  selected,
  onSelect,
  loading = false,
  counts,
}: FilterChipGroupProps) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">{title}</label>
      {loading ? (
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={!selected ? "default" : "outline"}
            size="sm"
            onClick={() => onSelect("")}
          >
            همه
          </Button>
          {options.map((opt) => {
            const count = counts?.[opt._id];
            return (
              <Button
                key={opt._id}
                variant={selected === opt._id ? "default" : "outline"}
                size="sm"
                onClick={() => onSelect(selected === opt._id ? "" : opt._id)}
                className="gap-1"
              >
                {opt.name}
                {count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      selected === opt._id
                        ? "bg-background/20 text-background"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
