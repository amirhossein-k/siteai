"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

/**
 * Session 82 Phase E — admin expense hooks.
 *
 * Straightforward React Query layer over the additive expense API. All
 * accounting rules live server-side (audited void with required reason,
 * non-void totals, rate limits).
 */

export const expenseKeys = {
  all: ["admin", "expenses"] as const,
  list: (params: string) => [...expenseKeys.all, "list", params] as const,
  detail: (id: string) => [...expenseKeys.all, "detail", id] as const,
};

export interface ExpenseView {
  _id: string;
  category: string;
  categoryLabel: string;
  description: string;
  amount: number;
  expenseDate: string | null;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  reference: string;
  payee: string;
  notes: string;
  status: string;
  statusLabel: string;
  createdByName: string;
  voidedAt: string | null;
  voidedByName: string;
  voidReason: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExpenseListResponse {
  expenses: ExpenseView[];
  page: number;
  totalPages: number;
  total: number;
}

export async function fetchExpenses(
  params: Record<string, string> = {}
): Promise<ExpenseListResponse> {
  const { data } = await axios.get("/api/admin/expenses", { params });
  return data;
}

export function useAdminExpenses(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: expenseKeys.list(qs),
    queryFn: () => fetchExpenses(params),
  });
}

export function useExpenseDetail(id: string | null) {
  return useQuery({
    queryKey: expenseKeys.detail(id ?? ""),
    queryFn: async (): Promise<{ expense: ExpenseView }> => {
      const { data } = await axios.get(`/api/admin/expenses/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await axios.post("/api/admin/expenses", body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useUpdateExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await axios.patch(`/api/admin/expenses/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function usePayExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(`/api/admin/expenses/${id}/pay`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useVoidExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (voidReason: string) => {
      const { data } = await axios.post(`/api/admin/expenses/${id}/void`, {
        voidReason,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}
