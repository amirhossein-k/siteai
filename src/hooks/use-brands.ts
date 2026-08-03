"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface BrandOption {
  _id: string;
  name: string;
  slug: string;
  logo?: string;
}

const fetchBrands = async (): Promise<BrandOption[]> => {
  const { data } = await axios.get("/api/admin/brands");
  return data;
};

export function useBrands() {
  return useQuery({
    queryKey: ["admin", "brands"],
    queryFn: fetchBrands,
    staleTime: 5 * 60 * 1000, // 5 minutes — brands rarely change
  });
}
