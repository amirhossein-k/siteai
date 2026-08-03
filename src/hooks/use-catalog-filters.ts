"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

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
 * query params consumed by usePublicProducts. Centralizes the three concerns
 * that the page previously duplicated per filter:
 *   - filter state (useState — NOT useSearchParams, per locked design)
 *   - page reset whenever any filter changes
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
  const [page, setPage] = useState(1);

  // Debounce the search term (Session 48): commit the query value 300ms after
  // the last keystroke; an empty term clears immediately.
  useEffect(() => {
    if (!searchQuery) {
      setDebouncedSearch("");
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
    if (category) setSelectedCategory(category);
    if (brand) setSelectedBrand(brand);
    if (tag) setSelectedTag(tag);
    if (search) setSearchQuery(search);
    if (
      sort &&
      ["newest", "price_asc", "price_desc", "name", "oldest"].includes(sort)
    ) {
      setSortBy(sort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [
    searchQuery,
    selectedCategory,
    selectedBrand,
    selectedTag,
    selectedAttributes,
    sortBy,
  ]);

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
    setPage,
    activeFilterCount,
    queryParams,
    clearFilters,
  };
}
