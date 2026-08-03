"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface AdminAttribute {
  _id: string;
  name: string;
  slug: string;
  type: "text" | "color" | "size" | "number";
  values: string[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttributeFormData {
  name: string;
  slug: string;
  type: "text" | "color" | "size" | "number";
  values: string[];
  isActive?: boolean;
}

const fetchAttributes = async (): Promise<AdminAttribute[]> => {
  const { data } = await axios.get("/api/admin/attributes");
  return data;
};

const createAttribute = async (data: AttributeFormData): Promise<AdminAttribute> => {
  const { data: result } = await axios.post("/api/admin/attributes", data);
  return result;
};

const updateAttribute = async ({
  id,
  data,
}: {
  id: string;
  data: Partial<AttributeFormData>;
}): Promise<AdminAttribute> => {
  const { data: result } = await axios.put(`/api/admin/attributes?id=${id}`, data);
  return result;
};

const deleteAttribute = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/attributes?id=${id}`);
};

export function useAttributes() {
  return useQuery({
    queryKey: ["admin", "attributes"],
    queryFn: fetchAttributes,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateAttribute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAttribute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });
}

export function useUpdateAttribute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAttribute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });
}

export function useDeleteAttribute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAttribute,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "attributes"] });
    },
  });
}
