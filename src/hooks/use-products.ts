"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { Product } from "@/types";

// --- Query Keys ---
export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...productKeys.lists(), filters] as const,
  details: () => [...productKeys.all, "detail"] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
};

// --- Fetch functions ---
const fetchProducts = async (): Promise<Product[]> => {
  const { data } = await axios.get("/api/products");
  return data;
};

const fetchProduct = async (id: string): Promise<Product> => {
  const { data } = await axios.get(`/api/products/${id}`);
  return data;
};

const createProduct = async (product: Partial<Product>): Promise<Product> => {
  const { data } = await axios.post("/api/products", product);
  return data;
};

const updateProduct = async ({
  id,
  ...product
}: Partial<Product> & { id: string }): Promise<Product> => {
  const { data } = await axios.put(`/api/products/${id}`, product);
  return data;
};

const deleteProduct = async (id: string): Promise<void> => {
  await axios.delete(`/api/products/${id}`);
};

// --- Hooks ---
export function useProducts() {
  return useQuery({
    queryKey: productKeys.lists(),
    queryFn: fetchProducts,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: () => fetchProduct(id),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProduct,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      queryClient.invalidateQueries({ queryKey: productKeys.detail(data._id) });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}
