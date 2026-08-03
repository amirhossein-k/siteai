"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface AdminCategory {
  _id: string;
  name: string;
  slug: string;
  parent?: { _id: string; name: string; slug: string } | null;
  icon?: string;
  image?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CategoryFormData {
  name: string;
  slug: string;
  parent?: string;
  icon?: string;
  image?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  metaTitle?: string;
  metaDescription?: string;
}

const fetchCategories = async (): Promise<AdminCategory[]> => {
  const { data } = await axios.get("/api/admin/categories?all=true");
  return data;
};

const createCategory = async (data: CategoryFormData): Promise<AdminCategory> => {
  const { data: result } = await axios.post("/api/admin/categories", data);
  return result;
};

const updateCategory = async ({
  id,
  data,
}: {
  id: string;
  data: Partial<CategoryFormData>;
}): Promise<AdminCategory> => {
  const { data: result } = await axios.put(`/api/admin/categories?id=${id}`, data);
  return result;
};

const deleteCategory = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/categories?id=${id}`);
};

export function useCategories() {
  return useQuery({
    queryKey: ["admin", "categories", "all"],
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
    },
  });
}
