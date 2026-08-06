"use client";

import { useRef, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { useSearchSuggestions } from "@/hooks/use-search-suggestions";
import { Skeleton } from "@/components/ui/skeleton";

interface SearchSuggestionsProps {
  /** The current search input value (immediate, not debounced). */
  query: string;
  /** Called when the user clicks a suggestion — replaces the search input. */
  onSelect: (suggestion: string) => void;
  /** Called when the user presses Enter on a suggestion — same as onSelect. */
  onClose: () => void;
  /** Whether the parent considers the dropdown visible. */
  visible: boolean;
}

/**
 * Search suggestions dropdown (Session 49).
 *
 * Appears below the catalog search input when the user has typed 2+ characters
 * and paused briefly. Shows matching product/brand names from the autocomplete
 * endpoint. Clicking a suggestion fills the search input and closes the dropdown.
 *
 * Uses the 300ms debounced query from useCatalogFilters to avoid firing a
 * request on every keystroke — the same debounce that controls the products
 * fetch (Session 48).
 */
export function SearchSuggestions({
  query,
  onSelect,
  onClose,
  visible,
}: SearchSuggestionsProps) {
  const { data, isLoading, isError } = useSearchSuggestions(query);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const suggestions = data?.suggestions || [];

  // Close on click outside
  useEffect(() => {
    if (!visible) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    // Delay registration so the same click that opened the dropdown doesn't
    // immediately close it.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [visible, onClose]);

  const handleSelect = useCallback(
    (suggestion: string) => {
      onSelect(suggestion);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!visible || query.length < 2) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-card shadow-lg"
    >
      {isLoading ? (
        <div className="space-y-2 p-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : isError ? (
        <div className="p-3 text-center text-xs text-muted-foreground">
          خطا در دریافت پیشنهادات
        </div>
      ) : suggestions.length === 0 ? (
        <div className="p-3 text-center text-xs text-muted-foreground">
          موردی یافت نشد
        </div>
      ) : (
        <ul className="py-1" role="listbox" aria-label="پیشنهادات جستجو">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion}
              role="option"
              // Session 61 — WAI-ARIA: listbox options must expose aria-selected.
              // No keyboard-activation model exists (pointer-only dropdown), so
              // every option reports unselected; adding arrow-key navigation is
              // explicitly OUT of scope (behavior change).
              aria-selected={false}
              onMouseDown={(e) => {
                // Use mouseDown not click to fire before the input blur
                e.preventDefault();
                handleSelect(suggestion);
              }}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{suggestion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}