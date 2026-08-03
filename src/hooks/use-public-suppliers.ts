"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { PaginatedResponse, PublicSupplier } from "@/types";

export const publicSupplierKeys = {
  all: ["public", "suppliers"] as const,
  lists: () => [...publicSupplierKeys.all, "list"] as const,
  list: (filters: Record<string, string | number | undefined>) =>
    [...publicSupplierKeys.lists(), filters] as const,
  details: () => [...publicSupplierKeys.all, "detail"] as const,
  detail: (id: string) => [...publicSupplierKeys.details(), id] as const,
};

interface SupplierFilters {
  page?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

const buildQueryString = (filters: SupplierFilters): string => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
};

const fetchPublicSuppliers = async (
  filters: SupplierFilters
): Promise<PaginatedResponse<PublicSupplier>> => {
  const { data } = await axios.get(
    `/api/suppliers${buildQueryString(filters)}`
  );
  return data;
};

export function usePublicSuppliers(filters: SupplierFilters = {}) {
  return useQuery({
    queryKey: publicSupplierKeys.list(filters),
    queryFn: () => fetchPublicSuppliers(filters),
  });
}

const fetchPublicSupplier = async (id: string): Promise<PublicSupplier> => {
  const { data } = await axios.get(`/api/suppliers/${id}`);
  return data;
};

export function usePublicSupplier(id: string | undefined) {
  return useQuery({
    queryKey: publicSupplierKeys.detail(id || ""),
    queryFn: () => fetchPublicSupplier(id as string),
    enabled: !!id,
  });
}
