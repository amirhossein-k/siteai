"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { PublicCouponsResponse } from "@/types";

export const publicCouponKeys = {
  all: ["public", "coupons"] as const,
  list: (page = 1) => [...publicCouponKeys.all, page] as const,
};

const fetchPublicCoupons = async (
  page = 1
): Promise<PublicCouponsResponse> => {
  const { data } = await axios.get(`/api/coupons/public?page=${page}`);
  return data;
};

/**
 * Session 44 — public marketing coupons (storefront page + checkout picker).
 * Public endpoint (no auth); staleTime 5min (marketing data changes rarely).
 */
export function usePublicCoupons(page = 1) {
  return useQuery({
    queryKey: publicCouponKeys.list(page),
    queryFn: () => fetchPublicCoupons(page),
    staleTime: 5 * 60 * 1000,
  });
}
