"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface SupplierSettings {
  _id: string;
  telegramChatId?: string;
  businessName: string;
  contactPhone: string;
  logo?: string;
  description?: string;
  bankAccount?: {
    cardNumber: string;
    iban: string;
    ownerName: string;
  };
}

export const supplierSettingsKeys = {
  all: ["supplier", "settings"] as const,
};

const fetchSupplierSettings = async (): Promise<SupplierSettings> => {
  const { data } = await axios.get("/api/supplier/settings");
  return data;
};

const updateTelegramChatId = async (
  telegramChatId: string
): Promise<{ message: string; telegramChatId: string }> => {
  const { data } = await axios.put("/api/supplier/settings", {
    telegramChatId,
  });
  return data;
};

interface PublicProfileInput {
  logo?: string;
  description?: string;
}

const updatePublicProfile = async (
  input: PublicProfileInput
): Promise<{ message: string; logo: string; description: string }> => {
  const { data } = await axios.put("/api/supplier/settings", input);
  return data;
};

export function useSupplierSettings() {
  return useQuery({
    queryKey: supplierSettingsKeys.all,
    queryFn: fetchSupplierSettings,
  });
}

export function useUpdateTelegramChatId() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTelegramChatId,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierSettingsKeys.all });
    },
  });
}

export function useUpdatePublicProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePublicProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierSettingsKeys.all });
    },
  });
}

const sendTestTelegram = async (): Promise<{ message: string }> => {
  const { data } = await axios.post("/api/supplier/settings");
  return data;
};

export function useTestTelegram() {
  return useMutation({
    mutationFn: sendTestTelegram,
  });
}
