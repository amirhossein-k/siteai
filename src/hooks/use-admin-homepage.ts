"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type { HomepagePresentation } from "@/types";

// ============================================================
// Types (mirror of the admin API responses)
// ============================================================

export type HomepageContentType =
  | "hero-slide"
  | "campaign-banner"
  | "gift-collection"
  | "trust-badge";

const PLURAL: Record<HomepageContentType, string> = {
  "hero-slide": "hero-slides",
  "campaign-banner": "campaign-banners",
  "gift-collection": "gift-collections",
  "trust-badge": "trust-badges",
};

export interface AdminHomepageSection {
  _id: string;
  slug: string;
  component: string;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  presentation: HomepagePresentation;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminHomepageContentRow {
  _id: string;
  sectionSlug: string;
  title: string;
  subtitle: string;
  tagline?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageDesktop?: string;
  imageMobile?: string;
  themeColor?: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  status: "draft" | "published";
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type HomepageContentFormData = Partial<AdminHomepageContentRow>;

// ============================================================
// Sections
// ============================================================

const fetchSections = async (): Promise<AdminHomepageSection[]> => {
  const { data } = await axios.get("/api/admin/homepage/sections");
  return data.sections;
};

const createSection = async (body: {
  slug: string;
  component: string;
  title?: string;
  subtitle?: string;
  enabled?: boolean;
  sortOrder?: number;
}): Promise<AdminHomepageSection> => {
  const { data } = await axios.post("/api/admin/homepage/sections", body);
  return data.section;
};

const updateSection = async ({
  id,
  data,
}: {
  id: string;
  data: Partial<{
    title: string;
    subtitle: string;
    enabled: boolean;
    sortOrder: number;
    presentation: HomepagePresentation;
  }>;
}): Promise<AdminHomepageSection> => {
  const { data: result } = await axios.put(
    `/api/admin/homepage/sections?id=${id}`,
    data
  );
  return result.section;
};

const deleteSection = async (id: string): Promise<void> => {
  await axios.delete(`/api/admin/homepage/sections?id=${id}`);
};

export function useAdminHomepageSections() {
  return useQuery({
    queryKey: ["admin", "homepage", "sections"],
    queryFn: fetchSections,
    staleTime: 60 * 1000,
  });
}

export function useCreateHomepageSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "homepage"] }),
  });
}

export function useUpdateHomepageSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateSection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "homepage"] }),
  });
}

export function useDeleteHomepageSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "homepage"] }),
  });
}

// ============================================================
// Content (per type)
// ============================================================

const fetchContent = async (
  type: HomepageContentType,
  sectionSlug: string
): Promise<AdminHomepageContentRow[]> => {
  const { data } = await axios.get(
    `/api/admin/homepage/${PLURAL[type]}?sectionSlug=${encodeURIComponent(sectionSlug)}`
  );
  return data.rows;
};

const createContent = async (
  type: HomepageContentType,
  body: HomepageContentFormData
): Promise<AdminHomepageContentRow> => {
  const { data } = await axios.post(`/api/admin/homepage/${PLURAL[type]}`, body);
  return data.row;
};

const updateContent = async ({
  type,
  id,
  data,
}: {
  type: HomepageContentType;
  id: string;
  data: HomepageContentFormData;
}): Promise<AdminHomepageContentRow> => {
  const { data: result } = await axios.put(
    `/api/admin/homepage/${PLURAL[type]}?id=${id}`,
    data
  );
  return result.row;
};

const deleteContent = async (type: HomepageContentType, id: string): Promise<void> => {
  await axios.delete(`/api/admin/homepage/${PLURAL[type]}?id=${id}`);
};

export function useAdminHomepageContent(type: HomepageContentType, sectionSlug: string) {
  return useQuery({
    queryKey: ["admin", "homepage", "content", type, sectionSlug],
    queryFn: () => fetchContent(type, sectionSlug),
    enabled: Boolean(sectionSlug),
    staleTime: 30 * 1000,
  });
}

export function useCreateHomepageContent(type: HomepageContentType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: HomepageContentFormData) => createContent(type, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "homepage", "content"] }),
  });
}

export function useUpdateHomepageContent(type: HomepageContentType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: HomepageContentFormData }) =>
      updateContent({ type, id, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "homepage", "content"] }),
  });
}

export function useDeleteHomepageContent(type: HomepageContentType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContent(type, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "homepage", "content"] }),
  });
}
