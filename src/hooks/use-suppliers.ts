"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface SupplierOption {
  _id: string;
  businessName: string;
  user: { _id: string; name: string };
}

const fetchSuppliers = async (): Promise<SupplierOption[]> => {
  const { data } = await axios.get("/api/admin/suppliers");
  return data;
};

export function useSuppliers() {
  return useQuery({
    queryKey: ["admin", "suppliers"],
    queryFn: fetchSuppliers,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
