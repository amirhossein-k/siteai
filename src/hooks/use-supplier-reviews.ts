"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { PaginatedResponse, SupplierReview } from "@/types";

export const supplierReviewKeys = {
  all: ["supplier-reviews"] as const,
  list: (page = 1, status?: string) =>
    [...supplierReviewKeys.all, "list", page, status || "all"] as const,
};

/** Paginated review queue for the supplier's own products. */
export function useSupplierReviews(page = 1, status?: string) {
  return useQuery({
    queryKey: supplierReviewKeys.list(page, status),
    queryFn: async (): Promise<PaginatedResponse<SupplierReview>> => {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      const { data } = await axios.get(
        `/api/supplier/reviews?${params.toString()}`
      );
      return data;
    },
  });
}

/** Post a single supplier reply to an approved review. */
export function useReplyToReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      reviewId,
      text,
    }: {
      reviewId: string;
      text: string;
    }): Promise<SupplierReview> => {
      const { data } = await axios.post(
        `/api/supplier/reviews/${reviewId}/reply`,
        { text }
      );
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: supplierReviewKeys.all });
    },
  });
}
