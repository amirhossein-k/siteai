"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { AdminAnalytics } from "@/types";

export const adminAnalyticsKeys = {
  all: ["admin", "analytics"] as const,
  detail: (range: number) => [...adminAnalyticsKeys.all, { range }] as const,
};

const fetchAdminAnalytics = async (range: number): Promise<AdminAnalytics> => {
  const { data } = await axios.get("/api/admin/analytics", { params: { range } });
  return data;
};

export function useAdminAnalytics(range: number) {
  return useQuery({
    queryKey: adminAnalyticsKeys.detail(range),
    queryFn: () => fetchAdminAnalytics(range),
    staleTime: 30_000,
  });
}
