"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  ConversationStatus,
  CustomerConversation,
  PaginatedResponse,
} from "@/types";

export const supplierConversationKeys = {
  all: ["supplier", "conversations"] as const,
  lists: () => [...supplierConversationKeys.all, "list"] as const,
  list: (filters: SupplierConversationFilters = {}) =>
    [...supplierConversationKeys.lists(), filters] as const,
  details: () => [...supplierConversationKeys.all, "detail"] as const,
  detail: (id: string) => [...supplierConversationKeys.details(), id] as const,
};

export interface SupplierConversationFilters {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
}

const fetchConversations = async (
  filters: SupplierConversationFilters = {}
): Promise<PaginatedResponse<CustomerConversation>> => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const { data } = await axios.get(`/api/supplier/conversations${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchConversation = async (id: string): Promise<CustomerConversation> => {
  const { data } = await axios.get(`/api/supplier/conversations/${id}`);
  return data;
};

export function useSupplierConversations(
  filters: SupplierConversationFilters = {}
) {
  return useQuery({
    queryKey: supplierConversationKeys.list(filters),
    queryFn: () => fetchConversations(filters),
  });
}

export function useSupplierConversation(id: string) {
  return useQuery({
    queryKey: supplierConversationKeys.detail(id),
    queryFn: () => fetchConversation(id),
    enabled: !!id,
    // Session 68 real-time: ~15s polling + focus refetch.
    refetchInterval: 15_000,
  });
}

const sendMessage = async (id: string, text: string) => {
  const { data } = await axios.post(`/api/supplier/conversations/${id}/messages`, {
    text,
  });
  return data;
};

export function useSupplierSendConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      sendMessage(id, text),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: supplierConversationKeys.detail(vars.id),
      });
      queryClient.invalidateQueries({
        queryKey: supplierConversationKeys.lists(),
      });
    },
  });
}
