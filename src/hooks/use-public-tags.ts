"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { PublicTag } from "@/types";

const fetchTags = async (): Promise<PublicTag[]> => {
  const { data } = await axios.get("/api/tags");
  return data;
};

export function usePublicTags() {
  return useQuery({
    queryKey: ["public", "tags"],
    queryFn: fetchTags,
    staleTime: 5 * 60 * 1000, // consistent with public categories
  });
}
