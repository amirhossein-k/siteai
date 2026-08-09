"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  ConversationStatus,
  CustomerConversation,
  EligibleConversationOrder,
  PaginatedResponse,
} from "@/types";

export const customerConversationKeys = {
  all: ["customer", "conversations"] as const,
  lists: () => [...customerConversationKeys.all, "list"] as const,
  list: (filters: CustomerConversationFilters = {}) =>
    [...customerConversationKeys.lists(), filters] as const,
  details: () => [...customerConversationKeys.all, "detail"] as const,
  detail: (id: string) => [...customerConversationKeys.details(), id] as const,
  eligible: ["customer", "conversations", "eligible-orders"] as const,
};

export interface CustomerConversationFilters {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
}

const fetchConversations = async (
  filters: CustomerConversationFilters = {}
): Promise<PaginatedResponse<CustomerConversation>> => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const { data } = await axios.get(`/api/conversations${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchConversation = async (id: string): Promise<CustomerConversation> => {
  const { data } = await axios.get(`/api/conversations/${id}`);
  return data;
};

const fetchEligibleOrders = async (): Promise<EligibleConversationOrder[]> => {
  const { data } = await axios.get("/api/conversations/eligible-orders");
  return data;
};

export function useCustomerConversations(
  filters: CustomerConversationFilters = {}
) {
  return useQuery({
    queryKey: customerConversationKeys.list(filters),
    queryFn: () => fetchConversations(filters),
  });
}

export function useCustomerConversation(id: string) {
  return useQuery({
    queryKey: customerConversationKeys.detail(id),
    queryFn: () => fetchConversation(id),
    enabled: !!id,
    // Session 68 real-time: ~15s polling + focus refetch (existing SSE bell
    // covers the notification badge — no WebSockets needed).
    refetchInterval: 15_000,
  });
}

export function useEligibleConversationOrders() {
  return useQuery({
    queryKey: customerConversationKeys.eligible,
    queryFn: fetchEligibleOrders,
  });
}

export interface CreateConversationInput {
  orderId: string;
  supplierOrderId: string;
  productId?: string;
  category?: string;
  subject: string;
  message: string;
}

const createConversation = async (
  input: CreateConversationInput
): Promise<CustomerConversation> => {
  const { data } = await axios.post("/api/conversations", input);
  return data;
};

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerConversationKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: customerConversationKeys.eligible,
      });
    },
  });
}

const sendMessage = async (id: string, text: string) => {
  const { data } = await axios.post(`/api/conversations/${id}/messages`, {
    text,
  });
  return data;
};

export function useSendConversationMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      sendMessage(id, text),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: customerConversationKeys.detail(vars.id),
      });
      queryClient.invalidateQueries({
        queryKey: customerConversationKeys.lists(),
      });
    },
  });
}

const updateStatus = async (id: string, status: ConversationStatus) => {
  const { data } = await axios.patch(`/api/conversations/${id}/status`, {
    status,
  });
  return data;
};

export function useUpdateConversationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ConversationStatus }) =>
      updateStatus(id, status),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: customerConversationKeys.detail(vars.id),
      });
      queryClient.invalidateQueries({
        queryKey: customerConversationKeys.lists(),
      });
    },
  });
}
