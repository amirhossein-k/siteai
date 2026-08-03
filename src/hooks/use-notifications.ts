"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import axios from "axios";
import type {
  NotificationsResponse,
  NotificationItem,
  UnreadCountResponse,
  NotificationStreamEvent,
} from "@/types";

export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => [...notificationKeys.all, "list"] as const,
  list: (page = 1, unreadOnly = false, category?: string) =>
    [
      ...notificationKeys.lists(),
      page,
      unreadOnly ? "unread" : "all",
      category || "all",
    ] as const,
  unread: () => [...notificationKeys.all, "unread"] as const,
};

const fetchInbox = async (
  page = 1,
  unreadOnly = false,
  category?: string
): Promise<NotificationsResponse> => {
  const params = new URLSearchParams({ page: String(page) });
  if (unreadOnly) params.set("unreadOnly", "1");
  if (category) params.set("category", category);
  const { data } = await axios.get(`/api/notifications?${params.toString()}`);
  return data;
};

/**
 * Live SSE stream (Session 40). Opens one EventSource per authenticated
 * session and invalidates every notification React Query key when a new
 * notification is pushed. The existing 30s polling in useUnreadCount stays
 * untouched as the automatic fallback, so a dropped stream never breaks the
 * badge/inbox — worst case the UI is as fresh as the polling interval.
 */
export function useNotificationStream() {
  const { status } = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== "authenticated") return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let consecutiveFailures = 0;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/notifications/stream");

      // A successful open is the healthy signal — reset the failure counter
      // (SSE comment frames like the server's `: ping` heartbeat don't fire
      // onmessage, so we can't rely on messages alone to prove health).
      es.onopen = () => {
        consecutiveFailures = 0;
      };

      es.onmessage = (event) => {
        try {
          const notif = JSON.parse(event.data) as NotificationStreamEvent;
          if (!notif?.id) return;
          // Invalidate ALL notification queries (badge + any inbox page). The
          // refetch reads the authoritative MongoDB data — never the event.
          queryClient.invalidateQueries({ queryKey: notificationKeys.all });
        } catch {
          // Non-JSON frames (comments/pings) are ignored.
        }
      };

      es.onerror = () => {
        if (closed) return;
        es?.close();
        es = null;
        // Give up after repeated failures (e.g. persistent 401 after session
        // expiry, or 429 from the connection cap) — the 30s polling fallback
        // keeps the badge/inbox fresh; a fresh mount/session re-establishes
        // the stream.
        consecutiveFailures++;
        if (consecutiveFailures >= 10) return;
        retryTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      es = null;
    };
  }, [status, queryClient]);
}

/** Lightweight unread badge count for the header bell. */
export function useUnreadCount() {
  const { status } = useSession();

  return useQuery<UnreadCountResponse>({
    queryKey: notificationKeys.unread(),
    queryFn: async () => {
      const { data } = await axios.get("/api/notifications/unread-count");
      return data;
    },
    enabled: status === "authenticated",
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Paginated inbox for the notifications page. */
export function useNotifications(
  page = 1,
  opts?: { unreadOnly?: boolean; category?: string }
) {
  const { status } = useSession();
  const unreadOnly = opts?.unreadOnly ?? false;
  const category = opts?.category;

  return useQuery<NotificationsResponse>({
    queryKey: notificationKeys.list(page, unreadOnly, category),
    queryFn: () => fetchInbox(page, unreadOnly, category),
    enabled: status === "authenticated",
  });
}

/** Mark a single notification as read (idempotent server-side). */
export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<NotificationItem> => {
      const { data } = await axios.put(`/api/notifications/${id}/read`);
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Mark all notifications as read. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await axios.put("/api/notifications/read-all");
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
