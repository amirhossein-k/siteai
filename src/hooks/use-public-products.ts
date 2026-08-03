"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { PaginatedResponse, Product } from "@/types";

export const publicProductKeys = {
  all: ["public", "products"] as const,
  lists: () => [...publicProductKeys.all, "list"] as const,
  list: (filters: Record<string, string | number | undefined>) =>
    [...publicProductKeys.lists(), filters] as const,
  details: () => [...publicProductKeys.all, "detail"] as const,
  detail: (slug: string) => [...publicProductKeys.details(), slug] as const,
};

export interface ProductFilters {
  category?: string;
  supplier?: string;
  brand?: string;
  tag?: string;
  search?: string;
  sort?: string;
  minPrice?: string;
  maxPrice?: string;
  page?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

/**
 * Generalize query-string building (Session 47): iterate the filters object
 * instead of hand-listing each param, so future facets (brand, tag, …) are
 * picked up automatically. `undefined`/`null`/empty-string values are skipped
 * — identical output for all existing filters (behavior preserved).
 */
export const buildQueryString = (filters: ProductFilters): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
};

const fetchPublicProducts = async (
  filters: ProductFilters
): Promise<PaginatedResponse<Product>> => {
  const { data } = await axios.get(
    `/api/products${buildQueryString(filters)}`
  );
  return data;
};

export function usePublicProducts(filters: ProductFilters = {}) {
  return useQuery({
    queryKey: publicProductKeys.list(filters),
    queryFn: () => fetchPublicProducts(filters),
  });
}
