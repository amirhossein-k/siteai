"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminPayout } from "@/types";

export const adminPayoutKeys = {
  all: ["admin", "payouts"] as const,
  lists: () => [...adminPayoutKeys.all, "list"] as const,
  list: (filters: { status?: string } = {}) =>
    [...adminPayoutKeys.lists(), filters] as const,
};

const fetchPayouts = async (filters: { status?: string } = {}): Promise<AdminPayout[]> => {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const { data } = await axios.get(`/api/admin/payouts${qs ? `?${qs}` : ""}`);
  return data;
};

const reviewPayout = async ({
  transactionId,
  action,
  reason,
}: {
  transactionId: string;
  action: "approve" | "reject";
  reason?: string;
}): Promise<AdminPayout> => {
  const { data } = await axios.post("/api/admin/payouts", {
    transactionId,
    action,
    reason,
  });
  return data;
};

export function useAdminPayouts(filters: { status?: string } = {}) {
  return useQuery({
    queryKey: adminPayoutKeys.list(filters),
    queryFn: () => fetchPayouts(filters),
  });
}

export function useReviewPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reviewPayout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminPayoutKeys.lists() });
    },
  });
}
