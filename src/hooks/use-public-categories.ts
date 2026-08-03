"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface PublicCategory {
  _id: string;
  name: string;
  slug: string;
  image?: string;
}

const fetchCategories = async (): Promise<PublicCategory[]> => {
  const { data } = await axios.get("/api/categories");
  return data;
};

export function usePublicCategories() {
  return useQuery({
    queryKey: ["public", "categories"],
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
