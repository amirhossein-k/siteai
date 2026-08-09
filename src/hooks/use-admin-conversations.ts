"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  ConversationStatus,
  CustomerConversation,
  PaginatedResponse,
} from "@/types";

export const adminConversationKeys = {
  all: ["admin", "conversations"] as const,
  lists: () => [...adminConversationKeys.all, "list"] as const,
  list: (filters: AdminConversationFilters = {}) =>
    [...adminConversationKeys.lists(), filters] as const,
  details: () => [...adminConversationKeys.all, "detail"] as const,
  detail: (id: string) => [...adminConversationKeys.details(), id] as const,
};

export interface AdminConversationFilters {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
  search?: string;
}

const fetchConversations = async (
  filters: AdminConversationFilters = {}
): Promise<PaginatedResponse<CustomerConversation>> => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  const { data } = await axios.get(`/api/admin/conversations${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchConversation = async (id: string): Promise<CustomerConversation> => {
  const { data } = await axios.get(`/api/admin/conversations/${id}`);
  return data;
};

export function useAdminConversations(filters: AdminConversationFilters = {}) {
  return useQuery({
    queryKey: adminConversationKeys.list(filters),
    queryFn: () => fetchConversations(filters),
  });
}

export function useAdminConversation(id: string) {
  return useQuery({
    queryKey: adminConversationKeys.detail(id),
    queryFn: () => fetchConversation(id),
    enabled: !!id,
    // Session 68 real-time: ~15s polling + focus refetch.
    refetchInterval: 15_000,
  });
}

const sendMessage = async (id: string, text: string) => {
  const { data } = await axios.post(`/api/admin/conversations/${id}/messages`, {
    text,
  });
  return data;
};

export function useAdminSendConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      sendMessage(id, text),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: adminConversationKeys.detail(vars.id),
      });
      queryClient.invalidateQueries({
        queryKey: adminConversationKeys.lists(),
      });
    },
  });
}

const updateStatus = async (id: string, status: ConversationStatus) => {
  const { data } = await axios.patch(`/api/admin/conversations/${id}/status`, {
    status,
  });
  return data;
};

export function useAdminUpdateConversationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ConversationStatus }) =>
      updateStatus(id, status),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: adminConversationKeys.detail(vars.id),
      });
      queryClient.invalidateQueries({
        queryKey: adminConversationKeys.lists(),
      });
    },
  });
}
