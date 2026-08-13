"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  AccountingConfig,
  InitializeAccountingResponse,
  OpeningBalanceCandidate,
  OpeningBalanceItemInput,
} from "@/types";

export const accountingKeys = {
  all: ["admin", "accounting"] as const,
  config: ["admin", "accounting", "config"] as const,
  candidates: ["admin", "accounting", "candidates"] as const,
};

/** GET /api/admin/accounting/config */
export function useAccountingConfig() {
  return useQuery({
    queryKey: accountingKeys.config,
    queryFn: async (): Promise<AccountingConfig> => {
      const { data } = await axios.get("/api/admin/accounting/config");
      return data;
    },
    staleTime: 30_000,
  });
}

/** GET /api/admin/accounting/initialize — opening-balance wizard candidates. */
export function useOpeningCandidates() {
  return useQuery({
    queryKey: accountingKeys.candidates,
    queryFn: async (): Promise<{ candidates: OpeningBalanceCandidate[] }> => {
      const { data } = await axios.get("/api/admin/accounting/initialize");
      return data;
    },
    staleTime: 30_000,
  });
}

/** PATCH /api/admin/accounting/config — set the cutover date (before init). */
export function useSetCutoverDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cutoverDate: string) => {
      const { data } = await axios.patch("/api/admin/accounting/config", {
        cutoverDate,
      });
      return data as AccountingConfig;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.config });
    },
  });
}

/** POST /api/admin/accounting/initialize — run the cutover wizard. */
export function useInitializeAccounting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      cutoverDate?: string;
      confirmValuation: boolean;
      items: OpeningBalanceItemInput[];
    }) => {
      const { data } = await axios.post(
        "/api/admin/accounting/initialize",
        payload
      );
      return data as InitializeAccountingResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.config });
      void qc.invalidateQueries({ queryKey: accountingKeys.candidates });
    },
  });
}
