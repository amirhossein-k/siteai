"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { PublicBrand } from "@/types";

const fetchBrands = async (): Promise<PublicBrand[]> => {
  const { data } = await axios.get("/api/brands");
  return data;
};

export function usePublicBrands() {
  return useQuery({
    queryKey: ["public", "brands"],
    queryFn: fetchBrands,
    staleTime: 5 * 60 * 1000, // consistent with public categories
  });
}
