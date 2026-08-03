"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { AttributeFacetsResponse } from "@/types";
import { buildQueryString, type ProductFilters } from "@/hooks/use-public-products";

export const publicAttributeFacetKeys = {
  all: ["public", "attribute-facets"] as const,
  list: (filters: Record<string, string | number | undefined>) =>
    [...publicAttributeFacetKeys.all, filters] as const,
};

// Facet counts are independent of sort/page — strip them so the query key
// stays stable when only pagination/sorting change (avoids refetch churn).
const FACET_IRRELEVANT_PARAMS = ["sort", "page", "limit"];

/**
 * Attribute facet counts for the storefront catalog (Session 47 extension).
 *
 * Consumes the SAME `queryParams` object as usePublicProducts — the nested
 * `attributes[<slug>]=<value>` keys are already part of it, so the generic
 * buildQueryString carries them through unchanged. This is the Session 47
 * extensibility claim in action: no new param plumbing was required.
 */
export function usePublicAttributeFacets(
  filters: ProductFilters = {}
) {
  const facetFilters = Object.fromEntries(
    Object.entries(filters).filter(
      ([key]) => !FACET_IRRELEVANT_PARAMS.includes(key)
    )
  );

  return useQuery({
    queryKey: publicAttributeFacetKeys.list(facetFilters),
    queryFn: async () => {
      const { data } = await axios.get<AttributeFacetsResponse>(
        `/api/attributes/facets${buildQueryString(filters)}`
      );
      return data.facets;
    },
    staleTime: 5 * 60 * 1000, // consistent with public categories/brands/tags
  });
}
