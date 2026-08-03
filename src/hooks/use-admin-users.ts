"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminUser, UserRole } from "@/types";

export const adminUserKeys = {
  all: ["admin", "users"] as const,
  lists: () => [...adminUserKeys.all, "list"] as const,
  list: (roleFilter?: string | null) =>
    [...adminUserKeys.lists(), roleFilter].filter((f) => f !== undefined && f !== null) as readonly unknown[],
};

const fetchAdminUsers = async (roleFilter?: string | null): Promise<AdminUser[]> => {
  const params = roleFilter ? { role: roleFilter } : {};
  const { data } = await axios.get("/api/admin/users", { params });
  return data;
};

export function useAdminUsers(roleFilter?: string | null) {
  return useQuery({
    queryKey: adminUserKeys.list(roleFilter),
    queryFn: () => fetchAdminUsers(roleFilter),
  });
}

export interface CreateUserInput {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
}

/**
 * Mutation hook to create a new admin or supplier user.
 * Invalidates the users list on success.
 */
export function useCreateAdminUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateUserInput): Promise<AdminUser> => {
      const { data } = await axios.post("/api/admin/users", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() });
    },
  });
}

// ============================================================
// User Management Mutations
// ============================================================

export type UserAction = "toggle-active" | "change-role" | "reset-password";

interface UserActionInput {
  userId: string;
  action: UserAction;
  value?: string;
}

/**
 * Mutation hook to perform admin actions on users:
 * - Toggle active/inactive status
 * - Change user role
 * - Reset user password
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UserActionInput): Promise<Record<string, unknown>> => {
      const { data } = await axios.patch(`/api/admin/users?id=${input.userId}`, {
        action: input.action,
        value: input.value,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() });
    },
  });
}
