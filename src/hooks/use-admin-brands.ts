"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface AdminBrand {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrandFormData {
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive?: boolean;
}

const fetchBrands = async (): Promise<AdminBrand[]> => {
  const { data } = await axios.get("/api/admin/brands");
  return data;
};

const createBrand = async (data: BrandFormData): Promise<AdminBrand> => {
  const { data: result } = await axios.post("/api/admin/brands", data);
  return result;
};

const updateBrand = async ({
  id,
  data,
}: {
  id: string;
  data: Partial<BrandFormData>;
}): Promise<AdminBrand> => {
  const { data: result } = await axios.put(`/api/admin/brands?id=${id}`, data);
  return result;
};

const deleteBrand = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/brands?id=${id}`);
};

export function useBrands() {
  return useQuery({
    queryKey: ["admin", "brands"],
    queryFn: fetchBrands,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateBrand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });
}

export function useUpdateBrand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });
}

export function useDeleteBrand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "brands"] });
    },
  });
}
