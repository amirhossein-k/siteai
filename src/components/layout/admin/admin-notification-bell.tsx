"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useNotificationStream,
  useUnreadCount,
  useNotifications,
  useMarkRead,
  useMarkAllRead,
} from "@/hooks/use-notifications";
// Session 80 — shared category icons/labels + relative time (same source of
// truth as the full inbox).
import { CATEGORY_META, timeAgo } from "@/components/notifications/notification-ui";
import type { NotificationItem } from "@/types";

/** Max items shown in the compact dropdown panel (the full inbox has more). */
const PANEL_ITEM_LIMIT = 8;

/**
 * Admin header notification bell (Session 80).
 *
 * Replaces the previously decorative bell with a REAL, fully functional
 * notification surface wired to the existing role-agnostic notification
 * system (Session 36 model + facade, Session 40 SSE stream, React Query
 * hooks). The bell is a pure CONSUMER — no notification is ever created by
 * opening it; it only renders persisted Notification documents.
 *
 * Live updates: useNotificationStream() opens the owner-scoped SSE stream and
 * invalidates every notification query on push; useUnreadCount keeps the 30s
 * polling + window-focus refetch as the automatic fallback.
 */
export function AdminNotificationBell() {
  useNotificationStream(); // live SSE → instant badge/panel updates (fail-silent)

  const { data: unreadData } = useUnreadCount();
  const { data, isLoading } = useNotifications(1);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unreadCount = unreadData?.count ?? 0;
  const items = data?.data ?? [];

  // Close on outside click and Escape (open state is local to this bell).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Mark read (when unread) then navigate to the stored deep link. */
  const handleItemClick = (item: NotificationItem) => {
    if (!item.isRead) markRead.mutate(item._id);
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="اعلان‌ها"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sky-600 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="پنل اعلان‌ها"
          className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-card shadow-lg max-sm:fixed max-sm:inset-x-4 max-sm:top-[4.5rem] max-sm:w-auto max-sm:max-w-none"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">اعلان‌ها</p>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                علامت‌گذاری همه
              </Button>
            )}
          </div>

          {/* Panel body */}
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">اعلانی وجود ندارد</p>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y">
              {items.slice(0, PANEL_ITEM_LIMIT).map((item) => {
                const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system;
                const Icon = meta.icon;
                return (
                  <li key={item._id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(item)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-right transition-colors hover:bg-accent/50",
                        !item.isRead && "bg-primary/5"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          item.isRead
                            ? "bg-muted text-muted-foreground"
                            : "bg-sky-100 text-sky-700"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "line-clamp-2 text-sm leading-snug",
                            !item.isRead
                              ? "font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {item.message}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{meta.label}</span>
                          <span>•</span>
                          <span>{timeAgo(item.createdAt)}</span>
                        </p>
                      </div>

                      {!item.isRead && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-600" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Panel footer — full inbox */}
          <div className="border-t">
            <Link
              href="/admin/notifications"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors hover:bg-accent/50"
            >
              مشاهده همه اعلان‌ها
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
