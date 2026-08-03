"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminCoupon } from "@/types";

export interface CouponFormData {
  code: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotal: number;
  maxDiscount: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  /** Session 44 — public marketing coupon (shown on the storefront + checkout picker) */
  isPublic: boolean;
  usageLimit: number;
  perUserLimit: number;
}

const fetchCoupons = async (): Promise<AdminCoupon[]> => {
  const { data } = await axios.get("/api/admin/coupons");
  return data;
};

const createCoupon = async (data: CouponFormData): Promise<AdminCoupon> => {
  const { data: result } = await axios.post("/api/admin/coupons", data);
  return result;
};

const updateCoupon = async ({
  id,
  data,
}: {
  id: string;
  data: Partial<CouponFormData>;
}): Promise<AdminCoupon> => {
  const { data: result } = await axios.put(`/api/admin/coupons/${id}`, data);
  return result;
};

const deleteCoupon = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/coupons/${id}`);
};

export function useCoupons() {
  return useQuery({
    queryKey: ["admin", "coupons"],
    queryFn: fetchCoupons,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCoupon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
  });
}

export function useUpdateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCoupon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
  });
}

export function useDeleteCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCoupon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "coupons"] });
    },
  });
}
