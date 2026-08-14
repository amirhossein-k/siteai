"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { PurchaseOrderView } from "@/types";

/**
 * Session 82 Phase B — admin purchase hooks.
 *
 * Straightforward React Query layer over the additive purchase API. All money
 * rules live server-side (receive creates inventory; pay never does; unit cost
 * comes from the purchase line).
 */
export const purchaseKeys = {
  all: ["admin", "purchases"] as const,
  list: (params: string) => [...purchaseKeys.all, "list", params] as const,
  detail: (id: string) => [...purchaseKeys.all, "detail", id] as const,
};

export interface PurchaseListResponse {
  purchases: PurchaseOrderView[];
  page: number;
  totalPages: number;
  total: number;
}

export async function fetchPurchases(
  params: Record<string, string> = {}
): Promise<PurchaseListResponse> {
  const { data } = await axios.get("/api/admin/purchases", { params });
  return data;
}

export function useAdminPurchases(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: purchaseKeys.list(qs),
    queryFn: () => fetchPurchases(params),
  });
}

export function usePurchaseDetail(id: string | null) {
  return useQuery({
    queryKey: purchaseKeys.detail(id ?? ""),
    queryFn: async (): Promise<{ purchase: PurchaseOrderView }> => {
      const { data } = await axios.get(`/api/admin/purchases/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await axios.post("/api/admin/purchases", payload);
      return data as { purchase: PurchaseOrderView };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all });
    },
  });
}

export function useUpdatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await axios.patch(`/api/admin/purchases/${id}`, payload);
      return data as { purchase: PurchaseOrderView };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all });
      qc.invalidateQueries({ queryKey: purchaseKeys.detail(vars.id) });
    },
  });
}

export function useOrderPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await axios.patch(`/api/admin/purchases/${id}`, {
        action: "order",
      });
      return data as { purchase: PurchaseOrderView };
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all });
      qc.invalidateQueries({ queryKey: purchaseKeys.detail(id) });
    },
  });
}

export function useReceivePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      items,
      key,
    }: {
      id: string;
      items: Array<{ itemId: string; quantity: number }>;
      key: string;
    }) => {
      const { data } = await axios.post(
        `/api/admin/purchases/${id}/receive`,
        { items, key }
      );
      return data as {
        purchase: PurchaseOrderView;
        idempotent?: boolean;
      };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all });
      qc.invalidateQueries({ queryKey: purchaseKeys.detail(vars.id) });
    },
  });
}

export function usePayPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const { data } = await axios.post(`/api/admin/purchases/${id}/pay`, {
        amount,
      });
      return data as { purchase: PurchaseOrderView; paidAmount: number };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all });
      qc.invalidateQueries({ queryKey: purchaseKeys.detail(vars.id) });
    },
  });
}

export function useCancelPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await axios.post(`/api/admin/purchases/${id}/cancel`, {
        reason,
      });
      return data as { purchase: PurchaseOrderView };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all });
      qc.invalidateQueries({ queryKey: purchaseKeys.detail(vars.id) });
    },
  });
}
