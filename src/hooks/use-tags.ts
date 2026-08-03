"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface TagOption {
  _id: string;
  name: string;
  slug: string;
}

const fetchTags = async (): Promise<TagOption[]> => {
  const { data } = await axios.get("/api/admin/tags");
  return data;
};

export function useTags() {
  return useQuery({
    queryKey: ["admin", "tags"],
    queryFn: fetchTags,
    staleTime: 5 * 60 * 1000,
  });
}
