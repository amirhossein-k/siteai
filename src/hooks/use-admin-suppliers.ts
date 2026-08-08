"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminSupplier } from "@/types";

/**
 * Session 66 — Admin supplier-management hook.
 *
 * `useAdminSuppliers` fetches the FULL supplier list (active + inactive) from
 * GET /api/admin/suppliers?all=true (the management shape). The dropdown
 * consumer (useSuppliers) is untouched — it still calls the no-param active
 * list.
 */
export const adminSupplierKeys = {
  all: ["admin", "suppliers"] as const,
  management: () => [...adminSupplierKeys.all, "management"] as const,
};

const fetchAdminSuppliers = async (): Promise<AdminSupplier[]> => {
  const { data } = await axios.get("/api/admin/suppliers", {
    params: { all: "true" },
  });
  return data;
};

export function useAdminSuppliers() {
  return useQuery({
    queryKey: adminSupplierKeys.management(),
    queryFn: fetchAdminSuppliers,
  });
}

/** Invalidate the management list (after create/promote/toggle). */
export function useInvalidateAdminSuppliers() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: adminSupplierKeys.all });
    // Suppliers are Users too — role/active changes also stale the user list.
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };
}

/**
 * Deactivate/reactivate a supplier. Goes through the EXISTING admin users
 * PATCH (action: toggle-active) — Session 66 deliberately does NOT add a
 * duplicate supplier-status API. Server-side the linked Supplier.isActive is
 * flipped alongside User.isActive, and deactivation revokes the session.
 */
export function useToggleSupplierActive() {
  const invalidate = useInvalidateAdminSuppliers();

  return useMutation({
    mutationFn: async (userId: string): Promise<{ isActive: boolean }> => {
      const { data } = await axios.patch(
        `/api/admin/users?id=${userId}`,
        { action: "toggle-active" }
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Promote an existing customer (or any user) to supplier. Reuses the EXISTING
 * admin users PATCH (action: change-role) — the server auto-provisions a
 * Supplier document and revokes the user's old-role sessions.
 */
export function usePromoteToSupplier() {
  const invalidate = useInvalidateAdminSuppliers();

  return useMutation({
    mutationFn: async (userId: string): Promise<unknown> => {
      const { data } = await axios.patch(
        `/api/admin/users?id=${userId}`,
        { action: "change-role", value: "supplier" }
      );
      return data;
    },
    onSuccess: invalidate,
  });
}
