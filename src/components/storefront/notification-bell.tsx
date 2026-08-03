"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import {
  useUnreadCount,
  useNotificationStream,
} from "@/hooks/use-notifications";

interface NotificationBellProps {
  /** Destination for the bell link, e.g. "/notifications" or "/supplier/notifications" */
  href: string;
  className?: string;
}

/**
 * Header bell with live unread badge. Renders a link so it works in any
 * layout (storefront header, supplier header). Uses the lightweight
 * /api/notifications/unread-count endpoint (30s refetch + window focus) as
 * the source of truth, PLUS a live SSE stream (Session 40) that invalidates
 * the count immediately when a new notification is pushed — the 30s polling
 * remains as the automatic fallback.
 */
export function NotificationBell({ href, className = "" }: NotificationBellProps) {
  useNotificationStream(); // live SSE → instant badge updates (fail-silent)
  const { data } = useUnreadCount();
  const count = data?.count ?? 0;

  return (
    <Link
      href={href}
      title="اعلان‌ها"
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${className}`}
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sky-600 px-1 text-[9px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
