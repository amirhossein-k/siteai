"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface AdminTag {
  _id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TagFormData {
  name: string;
  slug: string;
  isActive?: boolean;
}

const fetchTags = async (): Promise<AdminTag[]> => {
  const { data } = await axios.get("/api/admin/tags");
  return data;
};

const createTag = async (data: TagFormData): Promise<AdminTag> => {
  const { data: result } = await axios.post("/api/admin/tags", data);
  return result;
};

const updateTag = async ({
  id,
  data,
}: {
  id: string;
  data: Partial<TagFormData>;
}): Promise<AdminTag> => {
  const { data: result } = await axios.put(`/api/admin/tags?id=${id}`, data);
  return result;
};

const deleteTag = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/tags?id=${id}`);
};

export function useTags() {
  return useQuery({
    queryKey: ["admin", "tags"],
    queryFn: fetchTags,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
    },
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tags"] });
    },
  });
}
