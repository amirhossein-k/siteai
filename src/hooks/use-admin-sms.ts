"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  AdminSmsTemplate,
  AdminSmsLogsResponse,
  SmsSendResponse,
  AdminSmsProviderStatus,
  SmsIrTemplate,
  SmsIrTemplatesResult,
  SmsIrTemplateStatus,
} from "@/types";

/**
 * Session 90 — admin business-SMS hooks (Phase 1c).
 *
 * Templates (CRUD), logs (filterable list) and the manual send. Send
 * success/failure invalidates the logs list so the new row appears instantly.
 */
export const adminSmsKeys = {
  templates: ["admin", "sms", "templates"] as const,
  logs: (params: {
    page: number;
    status?: string;
    messageType?: string;
    q?: string;
  }) => ["admin", "sms", "logs", params] as const,
};

export function useAdminSmsTemplates() {
  return useQuery({
    queryKey: adminSmsKeys.templates,
    queryFn: async (): Promise<AdminSmsTemplate[]> => {
      const { data } = await axios.get("/api/admin/sms/templates");
      return data;
    },
  });
}

export interface SmsTemplateInput {
  name: string;
  type: string;
  providerTemplateId?: string;
  body: string;
  isActive?: boolean;
}

function invalidateTemplates(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: adminSmsKeys.templates });
}

export function useCreateSmsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SmsTemplateInput): Promise<{ _id: string }> => {
      const { data } = await axios.post("/api/admin/sms/templates", input);
      return data;
    },
    onSuccess: () => invalidateTemplates(queryClient),
  });
}

export function useUpdateSmsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SmsTemplateInput & { id: string }) => {
      const { id, ...payload } = input;
      const { data } = await axios.put(
        `/api/admin/sms/templates?id=${id}`,
        payload
      );
      return data;
    },
    onSuccess: () => invalidateTemplates(queryClient),
  });
}

export function useDeleteSmsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await axios.delete(`/api/admin/sms/templates?id=${id}`);
      return data;
    },
    onSuccess: () => invalidateTemplates(queryClient),
  });
}

export function useAdminSmsLogs(params: {
  page: number;
  status?: string;
  messageType?: string;
  q?: string;
}) {
  return useQuery({
    queryKey: adminSmsKeys.logs(params),
    queryFn: async (): Promise<AdminSmsLogsResponse> => {
      const search = new URLSearchParams();
      search.set("page", String(params.page));
      if (params.status) search.set("status", params.status);
      if (params.messageType) search.set("messageType", params.messageType);
      if (params.q) search.set("q", params.q);
      const { data } = await axios.get(
        `/api/admin/sms/logs?${search.toString()}`
      );
      return data;
    },
  });
}

export interface ManualSmsSendInput {
  phone: string;
  templateId?: string;
  variables?: Record<string, string>;
  message?: string;
}

export function useSendManualSms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ManualSmsSendInput): Promise<SmsSendResponse> => {
      const { data } = await axios.post("/api/admin/sms/send", input);
      return data;
    },
    // A send (sent OR failed) creates/updates the audit trail — refresh logs.
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "sms", "logs"],
      });
    },
    onError: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "sms", "logs"],
      });
    },
  });
}

// ============================================================
// Provider monitoring (Phase 1 — read-only probe)
// ============================================================

export const adminSmsStatusKey = ["admin", "sms", "status"] as const;

/**
 * GET /api/admin/sms/status — read-only SMS.ir provider probe. Soft-refresh
 * cache (30s) keeps dashboard polling from hammering the provider; the probe
 * itself is rate-limited server-side too (SMS_STATUS_LIMIT).
 */
export function useAdminSmsStatus() {
  return useQuery({
    queryKey: adminSmsStatusKey,
    queryFn: async (): Promise<AdminSmsProviderStatus> => {
      const { data } = await axios.get("/api/admin/sms/status");
      return data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ============================================================
// Provider templates (Phase 1 — read-only SMS.ir template listing)
// ============================================================

export const adminSmsProviderTemplatesKey = [
  "admin",
  "sms",
  "provider",
  "templates",
] as const;

/**
 * GET /api/admin/sms/provider/templates — read-only list of SMS.ir templates.
 * Results are cached for 30s to avoid hammering the provider.
 */
export function useAdminSmsProviderTemplates(params: {
  pageNumber?: number;
  pageSize?: number;
  status?: number;
}) {
  return useQuery({
    queryKey: [...adminSmsProviderTemplatesKey, params] as const,
    queryFn: async (): Promise<SmsIrTemplatesResult> => {
      const search = new URLSearchParams();
      if (params.pageNumber) search.set("pageNumber", String(params.pageNumber));
      if (params.pageSize) search.set("pageSize", String(params.pageSize));
      if (params.status !== undefined) search.set("status", String(params.status));
      const { data } = await axios.get(
        `/api/admin/sms/provider/templates?${search.toString()}`
      );
      return data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * GET /api/admin/sms/provider/templates/:templateId — read-only single template.
 */
export function useAdminSmsProviderTemplate(templateId: number | null) {
  return useQuery({
    queryKey: [...adminSmsProviderTemplatesKey, templateId] as const,
    queryFn: async (): Promise<SmsIrTemplate> => {
      if (templateId == null) throw new Error("templateId is required");
      const { data } = await axios.get(
        `/api/admin/sms/provider/templates/${templateId}`
      );
      return data.template;
    },
    enabled: templateId != null,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
