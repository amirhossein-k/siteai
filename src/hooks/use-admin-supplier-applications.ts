"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { AdminSupplierApplication } from "@/types";
import { adminSupplierKeys } from "@/hooks/use-admin-suppliers";
import { adminUserKeys } from "@/hooks/use-admin-users";

/**
 * Session 67 — admin supplier-application queue hooks.
 *
 * `useAdminSupplierApplications` — the approval queue (pending first).
 * `useAdminSupplierApplicationDecision` — atomic approve/reject: the server
 * provisions the Supplier doc from the application, flips the role + revokes
 * the applicant's sessions (approve) or leaves the role untouched (reject).
 * On success the applications, suppliers AND users queries are invalidated
 * (approval changes a user's role + creates a supplier).
 */
export const adminApplicationKeys = {
  all: ["admin", "supplier-applications"] as const,
};

const fetchAdminApplications = async (): Promise<AdminSupplierApplication[]> => {
  const { data } = await axios.get("/api/admin/supplier-applications");
  return data;
};

export function useAdminSupplierApplications() {
  return useQuery({
    queryKey: adminApplicationKeys.all,
    queryFn: fetchAdminApplications,
  });
}

export interface DecideApplicationInput {
  id: string;
  action: "approve" | "reject";
  note?: string;
}

export function useAdminSupplierApplicationDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: DecideApplicationInput
    ): Promise<{ message: string }> => {
      const { data } = await axios.patch(
        `/api/admin/supplier-applications?id=${input.id}`,
        { action: input.action, note: input.note || "" }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminApplicationKeys.all });
      // Approval provisions a Supplier + flips a User role — both lists stale.
      queryClient.invalidateQueries({ queryKey: adminSupplierKeys.all });
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
    },
  });
}
