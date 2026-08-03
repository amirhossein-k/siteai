"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface AttributeOption {
  _id: string;
  name: string;
  slug: string;
  type: "text" | "color" | "size" | "number";
  values: string[];
}

const fetchActiveAttributes = async (): Promise<AttributeOption[]> => {
  const { data } = await axios.get("/api/admin/attributes");
  // Admin endpoint returns all; suppliers get active only server-side.
  // Filter defensively on the client too.
  return (data as Array<AttributeOption & { isActive?: boolean }>).filter(
    (a) => a.isActive !== false
  );
};

export function useAttributes() {
  return useQuery({
    queryKey: ["attributes", "active"],
    queryFn: fetchActiveAttributes,
    staleTime: 5 * 60 * 1000, // 5 minutes — attributes rarely change
  });
}
