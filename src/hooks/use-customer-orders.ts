"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  AdminOrder,
  CancelOrderResponse,
  PaginatedResponse,
} from "@/types";

export const customerOrderKeys = {
  all: ["customer", "orders"] as const,
  lists: () => [...customerOrderKeys.all, "list"] as const,
  list: (filters: CustomerOrderFilters = {}) =>
    [...customerOrderKeys.lists(), filters] as const,
  details: () => [...customerOrderKeys.all, "detail"] as const,
  detail: (id: string) => [...customerOrderKeys.details(), id] as const,
};

export interface CustomerOrderFilters {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

const fetchCustomerOrders = async (
  filters: CustomerOrderFilters = {}
): Promise<PaginatedResponse<AdminOrder>> => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  const { data } = await axios.get(`/api/orders${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchCustomerOrder = async (id: string): Promise<AdminOrder> => {
  const { data } = await axios.get(`/api/orders?id=${id}`);
  return data;
};

export function useCustomerOrders(filters: CustomerOrderFilters = {}) {
  return useQuery({
    queryKey: customerOrderKeys.list(filters),
    queryFn: () => fetchCustomerOrders(filters),
  });
}

export function useCustomerOrder(id: string) {
  return useQuery({
    queryKey: customerOrderKeys.detail(id),
    queryFn: () => fetchCustomerOrder(id),
    enabled: !!id,
  });
}

const cancelCustomerOrder = async (
  orderId: string
): Promise<CancelOrderResponse> => {
  const { data } = await axios.post(`/api/orders/${orderId}/cancel`);
  return data;
};

/**
 * POST /api/orders/[id]/cancel — customer self-service cancellation (Session 46).
 * Only allowed while the order is awaiting payment; the server enforces the
 * atomic claim (pending_payment + payment pending → cancelled).
 */
export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => cancelCustomerOrder(orderId),
    onSuccess: (_data, orderId) => {
      queryClient.invalidateQueries({ queryKey: customerOrderKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerOrderKeys.details() });
      queryClient.invalidateQueries({
        queryKey: customerOrderKeys.detail(orderId),
      });
    },
  });
}
