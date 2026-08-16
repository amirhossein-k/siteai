"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProductVariant } from "@/types";

interface VariantSelectorProps {
  variants: ProductVariant[];
  onSelect?: (variant: ProductVariant | null) => void;
}

/** Group attribute options by attribute name, in first-seen order */
function groupAttributes(variants: ProductVariant[]) {
  const groups: Array<{
    name: string;
    values: string[];
  }> = [];

  for (const variant of variants) {
    if (variant.isActive === false) continue;
    for (const attr of variant.attributes) {
      let group = groups.find((g) => g.name === attr.name);
      if (!group) {
        group = { name: attr.name, values: [] };
        groups.push(group);
      }
      if (!group.values.includes(attr.value)) {
        group.values.push(attr.value);
      }
    }
  }
  return groups;
}

export function VariantSelector({ variants, onSelect }: VariantSelectorProps) {
  const groups = useMemo(() => groupAttributes(variants), [variants]);

  // Selected value per attribute group (name -> value).
  // Lazily pre-select the first available variant (in-stock active variant,
  // falling back to any active variant) so the customer immediately sees the
  // resolved price/stock/images instead of a blank "انتخاب تنوع" state.
  // Safe to initialize here because this component only mounts after the
  // product query resolves — `variants` is populated on the first render.
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    const initial =
      variants.find((v) => v.isActive !== false && v.stock > 0) ||
      variants.find((v) => v.isActive !== false);
    if (!initial) return {};
    const initialSelection: Record<string, string> = {};
    for (const attr of initial.attributes) {
      initialSelection[attr.name] = attr.value;
    }
    return initialSelection;
  });

  // Find the variant that matches the current selection
  const selectedVariant = useMemo(() => {
    const selectedEntries = Object.entries(selection).filter(([, v]) => v);
    if (selectedEntries.length === 0) return null;

    return (
      variants.find((variant) => {
        if (variant.isActive === false) return false;
        return selectedEntries.every(
          ([name, value]) =>
            variant.attributes.some(
              (a) => a.name === name && a.value === value
            )
        );
      }) || null
    );
  }, [variants, selection]);

  // Compute whether a given (group, value) is available given current selection
  const isValueAvailable = (groupName: string, value: string): boolean => {
    const candidateSelection = { ...selection, [groupName]: value };
    const candidateEntries = Object.entries(candidateSelection).filter(
      ([, v]) => v
    );
    // A value is available if some active variant matches the full candidate selection
    return variants.some((variant) => {
      if (variant.isActive === false) return false;
      return candidateEntries.every(
        ([name, v]) =>
          variant.attributes.some((a) => a.name === name && a.value === v)
      );
    });
  };

  const handleSelect = (groupName: string, value: string) => {
    const next = {
      ...selection,
      [groupName]: selection[groupName] === value ? "" : value,
    };
    setSelection(next);
  };

  // Notify parent of the resolved variant whenever selection changes
  useEffect(() => {
    onSelect?.(selectedVariant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant]);

  const resolved = selectedVariant;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.name}>
          <p className="mb-2 text-sm font-semibold">{group.name}</p>
          <div className="flex flex-wrap gap-2">
            {group.values.map((value) => {
              const isSelected = selection[group.name] === value;
              const isAvailable = isValueAvailable(group.name, value);
              return (
                <button
                  key={value}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => handleSelect(group.name, value)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-medium transition-all",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground shadow-[0_0_16px_rgba(59,130,246,0.4)]"
                      : isAvailable
                      ? "border-white/10 bg-white/5 text-foreground backdrop-blur hover:border-primary/60 hover:bg-white/10 hover:shadow-[0_0_12px_rgba(59,130,246,0.25)]"
                      : "cursor-not-allowed border-white/5 bg-white/[0.02] text-muted-foreground/40 line-through"
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {resolved && (
        <p className="text-xs text-muted-foreground">
          SKU: <span className="font-mono" dir="ltr">{resolved.sku}</span>
        </p>
      )}
    </div>
  );
}

export type { ProductVariant };
