"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { PaginatedResponse, AdminReview } from "@/types";

export const adminReviewKeys = {
  all: ["admin", "reviews"] as const,
  lists: () => [...adminReviewKeys.all, "list"] as const,
  list: (filters: { status?: string; page?: number } = {}) =>
    [...adminReviewKeys.lists(), filters] as const,
};

const fetchAdminReviews = async (
  filters: { status?: string; page?: number } = {}
): Promise<PaginatedResponse<AdminReview>> => {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.page) params.set("page", String(filters.page));
  const qs = params.toString();
  const { data } = await axios.get(
    `/api/admin/reviews${qs ? `?${qs}` : ""}`
  );
  return data;
};

const moderateReview = async ({
  reviewId,
  action,
  reason,
}: {
  reviewId: string;
  action: "approve" | "reject";
  reason?: string;
}): Promise<AdminReview> => {
  const { data } = await axios.post(
    `/api/admin/reviews/${reviewId}/moderate`,
    { action, reason }
  );
  return data;
};

export function useAdminReviews(
  filters: { status?: string; page?: number } = {}
) {
  return useQuery({
    queryKey: adminReviewKeys.list(filters),
    queryFn: () => fetchAdminReviews(filters),
  });
}

export function useModerateReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: moderateReview,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminReviewKeys.lists() });
    },
  });
}
