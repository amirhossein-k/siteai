"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export const searchSuggestKeys = {
  all: ["search", "suggest"] as const,
  list: (q: string) => [...searchSuggestKeys.all, q] as const,
};

interface SearchSuggestResponse {
  suggestions: string[];
}

/**
 * Fetch search suggestions for the given prefix.
 * Only enabled when q length >= 2, so we never fire a useless request for
 * single-character input (the API returns empty anyway). 5min staleTime
 * since suggestions change rarely (product/brand names are almost static).
 */
const fetchSuggestions = async (
  q: string
): Promise<SearchSuggestResponse> => {
  const { data } = await axios.get(
    `/api/search/suggest?q=${encodeURIComponent(q)}`
  );
  return data;
};

export function useSearchSuggestions(q: string) {
  return useQuery({
    queryKey: searchSuggestKeys.list(q),
    queryFn: () => fetchSuggestions(q),
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}