"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminOrder, PaginatedResponse } from "@/types";

export const adminOrderKeys = {
  all: ["admin", "orders"] as const,
  lists: () => [...adminOrderKeys.all, "list"] as const,
  list: (filters: AdminOrderFilters = {}) =>
    [...adminOrderKeys.lists(), filters] as const,
  details: () => [...adminOrderKeys.all, "detail"] as const,
  detail: (id: string) => [...adminOrderKeys.details(), id] as const,
};

export interface AdminOrderFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

const fetchAdminOrders = async (
  filters: AdminOrderFilters = {}
): Promise<PaginatedResponse<AdminOrder>> => {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const { data } = await axios.get(`/api/admin/orders${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchAdminOrder = async (id: string): Promise<AdminOrder> => {
  const { data } = await axios.get(`/api/admin/orders?id=${id}`);
  return data;
};

const updateOrderStatus = async ({
  id,
  status,
  note,
}: {
  id: string;
  status: string;
  note?: string;
}): Promise<AdminOrder> => {
  const { data } = await axios.put(`/api/admin/orders?id=${id}`, {
    status,
    note,
  });
  return data;
};

const refundOrder = async ({
  orderId,
  reason,
}: {
  orderId: string;
  reason: string;
}): Promise<AdminOrder> => {
  const { data } = await axios.post("/api/admin/orders/refund", {
    orderId,
    reason,
  });
  return data;
};

export function useAdminOrders(filters: AdminOrderFilters = {}) {
  return useQuery({
    queryKey: adminOrderKeys.list(filters),
    queryFn: () => fetchAdminOrders(filters),
  });
}

export function useAdminOrder(id: string) {
  return useQuery({
    queryKey: adminOrderKeys.detail(id),
    queryFn: () => fetchAdminOrder(id),
    enabled: !!id,
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateOrderStatus,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: adminOrderKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: adminOrderKeys.detail(data._id),
      });
    },
  });
}

export function useRefundOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: refundOrder,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: adminOrderKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: adminOrderKeys.detail(data._id),
      });
    },
  });
}
