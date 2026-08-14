"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  InventoryMovementView,
  InventoryLayerRow,
  InventoryAdjustmentResponse,
} from "@/types";

/**
 * Session 82 Phase D — admin inventory hooks (adjustments, movements, layers).
 * All accounting rules live server-side (exactly-once adjustment claims,
 * stockVersion atomicity, FIFO layer semantics); the UI is a thin read/write
 * layer over the additive /api/admin/inventory/* endpoints.
 */
export const inventoryKeys = {
  all: ["admin", "inventory"] as const,
  movements: (qs: string) => [...inventoryKeys.all, "movements", qs] as const,
  layers: (qs: string) => [...inventoryKeys.all, "layers", qs] as const,
};

export interface PaginatedInventoryResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function fetchInventoryMovements(
  params: Record<string, string> = {}
): Promise<PaginatedInventoryResponse<InventoryMovementView>> {
  const { data } = await axios.get("/api/admin/inventory/movements", { params });
  return data;
}

export function useInventoryMovements(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: inventoryKeys.movements(qs),
    queryFn: () => fetchInventoryMovements(params),
  });
}

export async function fetchInventoryLayers(
  params: Record<string, string> = {}
): Promise<PaginatedInventoryResponse<InventoryLayerRow>> {
  const { data } = await axios.get("/api/admin/inventory/layers", { params });
  return data;
}

export function useInventoryLayers(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: inventoryKeys.layers(qs),
    queryFn: () => fetchInventoryLayers(params),
  });
}

export function useCreateInventoryAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await axios.post("/api/admin/inventory/adjustments", payload);
      return data as InventoryAdjustmentResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryKeys.all });
      // Stock changed — product lists may show it too.
      qc.invalidateQueries({ queryKey: ["admin", "products"] });
    },
  });
}
