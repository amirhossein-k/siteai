"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { AdminStat } from "@/types";

export const adminStatsKeys = {
  all: ["admin", "stats"] as const,
  detail: () => [...adminStatsKeys.all, "detail"] as const,
};

const fetchAdminStats = async (): Promise<AdminStat> => {
  const { data } = await axios.get("/api/admin/stats");
  return data;
};

export function useAdminStats() {
  return useQuery({
    queryKey: adminStatsKeys.detail(),
    queryFn: fetchAdminStats,
    refetchInterval: 30_000, // auto-refresh every 30s
  });
}
