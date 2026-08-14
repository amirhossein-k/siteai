"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminProduct, PaginatedResponse } from "@/types";
import type { ProductFormData } from "@/lib/validations/product";

export const adminProductKeys = {
  all: ["admin", "products"] as const,
  lists: () => [...adminProductKeys.all, "list"] as const,
  list: (filters: AdminProductFilters = {}) =>
    [...adminProductKeys.lists(), filters] as const,
  details: () => [...adminProductKeys.all, "detail"] as const,
  detail: (id: string) => [...adminProductKeys.details(), id] as const,
};

export interface AdminProductFilters {
  page?: number;
  limit?: number;
  search?: string;
  /** Session 82 Phase B — the purchase form restricts the picker to purchased products. */
  sourcing?: "purchased" | "consignment";
}

const fetchAdminProducts = async (
  filters: AdminProductFilters = {}
): Promise<PaginatedResponse<AdminProduct>> => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.search) params.set("search", filters.search);
  if (filters.sourcing) params.set("sourcing", filters.sourcing);
  const qs = params.toString();
  const { data } = await axios.get(`/api/admin/products${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchAdminProduct = async (id: string): Promise<AdminProduct> => {
  const { data } = await axios.get(`/api/admin/products?id=${id}`);
  return data;
};

const createAdminProduct = async (
  product: ProductFormData
): Promise<AdminProduct> => {
  const { data } = await axios.post("/api/admin/products", product);
  return data;
};

const updateAdminProduct = async ({
  id,
  ...product
}: ProductFormData & { id: string }): Promise<AdminProduct> => {
  const { data } = await axios.put(`/api/admin/products?id=${id}`, product);
  return data;
};

const deleteAdminProduct = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/products?id=${id}`);
};

export function useAdminProducts(filters: AdminProductFilters = {}) {
  return useQuery({
    queryKey: adminProductKeys.list(filters),
    queryFn: () => fetchAdminProducts(filters),
  });
}

export function useAdminProduct(id: string) {
  return useQuery({
    queryKey: adminProductKeys.detail(id),
    queryFn: () => fetchAdminProduct(id),
    enabled: !!id,
  });
}

export function useCreateAdminProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAdminProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminProductKeys.lists() });
    },
  });
}

export function useUpdateAdminProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateAdminProduct,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: adminProductKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: adminProductKeys.detail(data._id),
      });
    },
  });
}

export function useDeleteAdminProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAdminProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminProductKeys.lists() });
    },
  });
}
