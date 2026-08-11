"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parsePageParam } from "@/lib/pagination";

export interface CatalogFilterValues {
  search?: string;
  category?: string;
  brand?: string;
  tag?: string;
  sort: string;
  /**
   * Attribute facet selections (Session 47 extension): the KEY is the nested
   * query-param name `attributes[<slug>]`, consumed by the generic
   * buildQueryString without any data-flow changes — the Session 47 seam.
   */
  [key: string]: string | number | undefined;
}

/**
 * Shared catalog filter state (Session 47).
 *
 * Owns the filter state for the storefront catalog page and maps it to the
 * query params consumed by usePublicProducts. Centralizes the concerns that
 * the page previously duplicated per filter:
 *   - filter state (useState — filters stay LOCAL state, per locked design)
 *   - PAGE state (Session 76 — URL-DRIVEN: derived from `?page=` via
 *     useSearchParams; the URL is the single source of truth so pagination
 *     links are real crawlable <a> elements, back/forward works, and direct
 *     URL loading lands on the right page)
 *   - page reset whenever any filter changes (strips `?page` from the URL)
 *   - active filter count + query-param mapping
 *
 * Session 47 extension: attribute facets are stored as a `selectedAttributes`
 * slug → value map and serialized into `attributes[<slug>]=<value>` params.
 * Adding a future facet = one more state field + one entry in queryParams +
 * one FilterChipGroup in the page. No flow rewrite.
 */
export function useCatalogFilters() {
  const [searchQuery, setSearchQuery] = useState("");
  // Session 48: 300ms search debounce. The input value stays immediate
  // (searchQuery), but the term is only pushed into queryParams after a quiet
  // pause, so every keystroke no longer triggers a network request. Keeps the
  // useState architecture — no useSearchParams migration.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({});
  const [sortBy, setSortBy] = useState("newest");

  // Session 76 — URL-driven page. Derived from `?page=` (parsePageParam
  // coerces missing/malformed values to 1); the URL is the single source of
  // truth for the page, so the real <a> pagination links + back/forward +
  // direct loads all work natively.
  const searchParams = useSearchParams();
  const router = useRouter();
  const page = parsePageParam(searchParams.get("page"));

  // Debounce the search term (Session 48): commit the query value 300ms after
  // the last keystroke (timer effect — the async commit in the callback is
  // the legitimate effect use). An empty term is cleared synchronously below
  // via a guarded render-phase adjustment, not in the effect body.
  useEffect(() => {
    if (!searchQuery) return;
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Clear the committed (debounced) term the moment the input empties — the
  // React-documented "adjust state during render" pattern (guarded, so it only
  // fires when they actually differ; compliant with set-state-in-effect).
  if (!searchQuery && debouncedSearch !== "") {
    setDebouncedSearch("");
  }

  // Session 50 — one-time URL param seed. Links from the homepage
  // (/products?category=…&brand=…&search=…&sort=…) pre-filter the catalog on
  // first mount. With no params present this changes nothing — the state
  // architecture stays untouched (useState remains the source of truth).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const category = params.get("category");
    const brand = params.get("brand");
    const tag = params.get("tag");
    const search = params.get("search");
    const sort = params.get("sort");
    // INTENTIONAL: one-time post-hydration URL seed (Session 50). Initializing
    // state from the URL during render would mismatch the server HTML
    // (hydration warning); a lazy initializer can't read window on the server
    // either. Deferring to an effect is the only SSR-safe option, so the rule
    // is disabled for this effect body.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (category) setSelectedCategory(category);
    if (brand) setSelectedBrand(brand);
    if (tag) setSelectedTag(tag);
    if (search) setSearchQuery(search);
    if (
      sort &&
      ["newest", "best_selling", "price_asc", "price_desc", "name", "oldest"].includes(sort)
    ) {
      setSortBy(sort);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Reset to page 1 whenever any filter changes. Page is DERIVED from the
  // URL, so the reset is: strip `?page` from the URL when a filter actually
  // changed. The ref compares the PREVIOUS fingerprint — initialized to the
  // initial value so the MOUNT run is a no-op (a direct `?page=N` load must
  // keep its page; the reviewer-caught bug: a null-initialized guard stripped
  // the page on every fresh load). Bounded: the write only happens when a
  // page param is present, so typing in the search box from a clean URL never
  // touches the URL, and a filter change from `?page=N` strips exactly once.
  const filterFingerprint =
    searchQuery +
    "|" +
    selectedCategory +
    "|" +
    selectedBrand +
    "|" +
    selectedTag +
    "|" +
    JSON.stringify(selectedAttributes) +
    "|" +
    sortBy;
  const prevFingerprintRef = useRef(filterFingerprint);
  useEffect(() => {
    if (prevFingerprintRef.current === filterFingerprint) return;
    prevFingerprintRef.current = filterFingerprint;
    if (searchParams.get("page") !== null) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `/products?${qs}` : "/products", { scroll: false });
    }
  }, [filterFingerprint, searchParams, router]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery) count++;
    if (selectedCategory) count++;
    if (selectedBrand) count++;
    if (selectedTag) count++;
    count += Object.keys(selectedAttributes).length;
    if (sortBy !== "newest") count++;
    return count;
  }, [
    searchQuery,
    selectedCategory,
    selectedBrand,
    selectedTag,
    selectedAttributes,
    sortBy,
  ]);

  const queryParams = useMemo<CatalogFilterValues>(() => {
    const params: CatalogFilterValues = {
      search: debouncedSearch || undefined,
      category: selectedCategory || undefined,
      brand: selectedBrand || undefined,
      tag: selectedTag || undefined,
      sort: sortBy,
    };
    // Attribute facets serialize as nested attributes[<slug>]=<value> params.
    for (const [slug, value] of Object.entries(selectedAttributes)) {
      if (value) params[`attributes[${slug}]`] = value;
    }
    return params;
  }, [
    debouncedSearch,
    selectedCategory,
    selectedBrand,
    selectedTag,
    selectedAttributes,
    sortBy,
  ]);

  /** Set/clear one attribute value (empty value clears the selection). */
  const setAttribute = useCallback((slug: string, value: string) => {
    setSelectedAttributes((prev) => {
      const next = { ...prev };
      if (value) next[slug] = value;
      else delete next[slug];
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearch("");
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedTag("");
    setSelectedAttributes({});
    setSortBy("newest");
  }, []);

  /**
   * Session 76 — build the real `<a>` href for a catalog page number,
   * preserving every current URL param (seed params like category/brand/
   * search/sort survive paging). The catalog component stays mounted across
   * the client-side navigation, so the local filter state survives too.
   */
  const pageHref = useCallback(
    (n: number) => {
      const next = new URLSearchParams(searchParams.toString());
      // Page 1 → the CLEAN /products URL (never a ?page=1 that would duplicate
      // the canonical form); page 2+ carry ?page=N.
      if (n === 1) next.delete("page");
      else next.set("page", String(n));
      const qs = next.toString();
      return qs ? `/products?${qs}` : "/products";
    },
    [searchParams]
  );

  return {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedBrand,
    setSelectedBrand,
    selectedTag,
    setSelectedTag,
    selectedAttributes,
    setAttribute,
    sortBy,
    setSortBy,
    page,
    pageHref,
    activeFilterCount,
    queryParams,
    clearFilters,
  };
}
