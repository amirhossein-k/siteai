"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { WalletInfo } from "@/types";

export const supplierWalletKeys = {
  all: ["supplier", "wallet"] as const,
  detail: () => [...supplierWalletKeys.all, "detail"] as const,
};

const fetchWalletInfo = async (): Promise<WalletInfo> => {
  const { data } = await axios.get("/api/supplier/wallet");
  return data;
};

const requestPayout = async ({
  amount,
  note,
}: {
  amount: number;
  note?: string;
}): Promise<{
  message: string;
  pendingReserve: number;
  availableBalance: number;
}> => {
  const { data } = await axios.post("/api/supplier/wallet", { amount, note });
  return data;
};

export function useSupplierWallet() {
  return useQuery({
    queryKey: supplierWalletKeys.detail(),
    queryFn: fetchWalletInfo,
    refetchInterval: 30_000, // auto-refresh every 30s
  });
}

export function useRequestPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: requestPayout,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: supplierWalletKeys.detail(),
      });
      queryClient.invalidateQueries({
        queryKey: ["supplier", "stats"],
      });
    },
  });
}
