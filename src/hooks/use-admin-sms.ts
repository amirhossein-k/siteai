"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import type {
  AdminSmsTemplate,
  AdminSmsLogsResponse,
  SmsSendResponse,
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
