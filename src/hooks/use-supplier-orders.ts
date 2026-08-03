"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { SupplierOrder } from "@/types";

export const supplierOrderKeys = {
  all: ["supplier", "orders"] as const,
  lists: () => [...supplierOrderKeys.all, "list"] as const,
  details: () => [...supplierOrderKeys.all, "detail"] as const,
  detail: (id: string) => [...supplierOrderKeys.details(), id] as const,
};

const fetchSupplierOrders = async (): Promise<SupplierOrder[]> => {
  const { data } = await axios.get("/api/supplier/orders");
  return data;
};

const fetchSupplierOrder = async (id: string): Promise<SupplierOrder> => {
  const { data } = await axios.get(`/api/supplier/orders?id=${id}`);
  return data;
};

const updateSupplierOrderStatus = async ({
  id,
  status,
  note,
}: {
  id: string;
  status: string;
  note?: string;
}): Promise<SupplierOrder> => {
  const { data } = await axios.put(`/api/supplier/orders?id=${id}`, {
    status,
    note,
  });
  return data;
};

export function useSupplierOrders() {
  return useQuery({
    queryKey: supplierOrderKeys.lists(),
    queryFn: fetchSupplierOrders,
  });
}

export function useSupplierOrder(id: string) {
  return useQuery({
    queryKey: supplierOrderKeys.detail(id),
    queryFn: () => fetchSupplierOrder(id),
    enabled: !!id,
  });
}

export function useUpdateSupplierOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSupplierOrderStatus,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: supplierOrderKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: supplierOrderKeys.detail(data._id),
      });
    },
  });
}
