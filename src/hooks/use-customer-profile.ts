"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface CustomerProfile {
  _id: string;
  name: string;
  phone: string;
  role: string;
  address?: string;
  isActive: boolean;
  createdAt: string;
  // Session 64 — additive: whether the account has a password (false for
  // passwordless OTP-registered users → the security card shows the
  // "set your first password" flow instead of "change password").
  hasPassword: boolean;
}

export const customerProfileKeys = {
  all: ["customer", "profile"] as const,
};

const fetchCustomerProfile = async (): Promise<CustomerProfile> => {
  const { data } = await axios.get("/api/profile");
  return data;
};

const updateCustomerProfile = async (updates: {
  name?: string;
  address?: string;
}): Promise<CustomerProfile> => {
  const { data } = await axios.put("/api/profile", updates);
  return data;
};

export function useCustomerProfile() {
  return useQuery({
    queryKey: customerProfileKeys.all,
    queryFn: fetchCustomerProfile,
  });
}

export function useUpdateCustomerProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateCustomerProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerProfileKeys.all });
    },
  });
}
