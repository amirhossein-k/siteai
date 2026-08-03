"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { ProductImportReport } from "@/types";
import { adminProductKeys } from "@/hooks/use-admin-products";
import { supplierProductKeys } from "@/hooks/use-supplier-products";

async function postImport(path: string, csv: string): Promise<ProductImportReport> {
  const { data } = await axios.post(path, { csv });
  return data;
}

/**
 * Admin bulk product CSV import (Session 51).
 * Invalidates the admin products list so the table refreshes after import.
 */
export function useAdminProductImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) => postImport("/api/admin/products/import", csv),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminProductKeys.lists() });
    },
  });
}

/**
 * Supplier bulk product CSV import (Session 51).
 * Rows are auto-assigned to the calling supplier.
 */
export function useSupplierProductImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) => postImport("/api/supplier/products/import", csv),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplierProductKeys.lists() });
    },
  });
}
