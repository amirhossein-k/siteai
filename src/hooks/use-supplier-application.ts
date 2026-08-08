"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { SupplierApplication } from "@/types";

/**
 * Session 67 — customer-side supplier application.
 *
 * `useMySupplierApplication` fetches the applicant's own latest application
 * (null when never applied) — drives the «فروشنده شوید» page state.
 * `useSubmitSupplierApplication` POSTs a new application (customer only;
 * the server rate-limits + enforces one open pending application).
 */
export const supplierApplicationKeys = {
  all: ["supplier-application"] as const,
  mine: () => [...supplierApplicationKeys.all, "mine"] as const,
};

const fetchMyApplication = async (): Promise<SupplierApplication | null> => {
  const { data } = await axios.get("/api/supplier-applications/me");
  return data;
};

export function useMySupplierApplication() {
  return useQuery({
    queryKey: supplierApplicationKeys.mine(),
    queryFn: fetchMyApplication,
    // A rejected applicant may re-apply — keep the cached status fresh.
    staleTime: 30_000,
  });
}

export interface SubmitSupplierApplicationInput {
  businessName: string;
  description?: string;
  contactPhone?: string;
}

export function useSubmitSupplierApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: SubmitSupplierApplicationInput
    ): Promise<{ id: string; status: string }> => {
      const { data } = await axios.post("/api/supplier-applications", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierApplicationKeys.all });
    },
  });
}
