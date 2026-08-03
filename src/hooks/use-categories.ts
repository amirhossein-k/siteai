"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface CategoryOption {
  _id: string;
  name: string;
  slug: string;
}

const fetchCategories = async (): Promise<CategoryOption[]> => {
  const { data } = await axios.get("/api/admin/categories");
  return data;
};

export function useCategories() {
  return useQuery({
    queryKey: ["admin", "categories"],
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000, // 5 minutes — categories rarely change
  });
}
