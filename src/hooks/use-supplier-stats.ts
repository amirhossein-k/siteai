"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { SupplierStat } from "@/types";

export const supplierStatsKeys = {
  all: ["supplier", "stats"] as const,
  detail: () => [...supplierStatsKeys.all, "detail"] as const,
};

const fetchSupplierStats = async (): Promise<SupplierStat> => {
  const { data } = await axios.get("/api/supplier/stats");
  return data;
};

export function useSupplierStats() {
  return useQuery({
    queryKey: supplierStatsKeys.detail(),
    queryFn: fetchSupplierStats,
    refetchInterval: 30_000, // auto-refresh every 30s
  });
}
