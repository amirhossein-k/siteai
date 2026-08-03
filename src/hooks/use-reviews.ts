"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { ReviewsResponse, MyReviewsResponse, Review } from "@/types";

export const reviewKeys = {
  all: ["reviews"] as const,
  list: (productId: string, page = 1) =>
    [...reviewKeys.all, "list", productId, page] as const,
  mine: (productId: string) =>
    [...reviewKeys.all, "mine", productId] as const,
  product: (productId: string) =>
    [...reviewKeys.all, "product", productId] as const,
};

interface ReviewFilters {
  product?: string;
  page?: number;
  limit?: number;
}

const fetchReviews = async (
  filters: ReviewFilters
): Promise<ReviewsResponse> => {
  const params = new URLSearchParams();
  if (filters.product) params.set("product", filters.product);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const { data } = await axios.get(`/api/reviews${qs ? `?${qs}` : ""}`);
  return data;
};

const fetchMyReviews = async (productId: string): Promise<MyReviewsResponse> => {
  const { data } = await axios.get(`/api/reviews/mine?product=${productId}`);
  return data;
};

const submitReview = async ({
  productId,
  orderId,
  rating,
  text,
}: {
  productId: string;
  orderId: string;
  rating: number;
  text: string;
}): Promise<Review> => {
  const { data } = await axios.post("/api/reviews", {
    productId,
    orderId,
    rating,
    text,
  });
  return data;
};

/** Public approved reviews for a product (paginated) + ratingSummary */
export function useProductReviews(productId: string, page = 1) {
  return useQuery({
    queryKey: reviewKeys.list(productId, page),
    queryFn: () => fetchReviews({ product: productId, page }),
    enabled: !!productId,
  });
}

/** Authenticated customer's own reviews + eligible orders for the form gate */
export function useMyReviews(productId: string) {
  return useQuery({
    queryKey: reviewKeys.mine(productId),
    queryFn: () => fetchMyReviews(productId),
    enabled: !!productId,
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitReview,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: reviewKeys.mine(variables.productId),
      });
      queryClient.invalidateQueries({
        queryKey: reviewKeys.all,
      });
    },
  });
}
