"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Inbox, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PaginationControls } from "@/components/ui/pagination";
import {
  useNotifications,
  useMarkRead,
  useMarkAllRead,
} from "@/hooks/use-notifications";
// Session 80 — category icons/labels + relative time are shared with the
// admin header bell (one source of truth, no duplicated formatting).
import { CATEGORY_META, timeAgo } from "./notification-ui";
import type { NotificationCategory, NotificationItem } from "@/types";

const CATEGORY_TABS: Array<{ key: NotificationCategory | "all"; label: string }> = [
  { key: "all", label: "همه" },
  { key: "order", label: "سفارش‌ها" },
  { key: "payment", label: "پرداخت" },
  { key: "payout", label: "کیف پول" },
  // Session 68 — support-message notifications tab.
  { key: "support", label: "پشتیبانی" },
];

/**
 * Shared notifications inbox. Works in both the storefront (customer) and
 * supplier layouts — item `link` values are already role-appropriate
 * (e.g. "/orders/<id>" vs "/supplier/orders/<id>"), stored at event time.
 */
export function NotificationsList() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<NotificationCategory | "all">("all");

  const { data, isLoading } = useNotifications(page, {
    category: category === "all" ? undefined : category,
  });

  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = data?.data ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const handleItemClick = (item: NotificationItem) => {
    if (!item.isRead) markRead.mutate(item._id);
    if (item.link) router.push(item.link);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar: category tabs + mark-all-read */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setCategory(tab.key);
                setPage(1);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                category === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-4 w-4" />
            علامت‌گذاری همه ({unreadCount})
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Inbox className="h-10 w-10" />
          <p className="text-sm">اعلانی ندارید</p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((item) => {
            const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system;
            const Icon = meta.icon;
            return (
              <li key={item._id}>
                <button
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
                        "text-sm",
                        !item.isRead ? "font-medium" : "text-muted-foreground"
                      )}
                    >
                      {item.message}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{meta.label}</span>
                      <span>•</span>
                      <span>{timeAgo(item.createdAt)}</span>
                      {item.sentToTelegram && (
                        <span
                          className="inline-flex items-center gap-1 text-sky-600"
                          title="از طریق تلگرام نیز ارسال شد"
                        >
                          <Send className="h-3 w-3" />
                          تلگرام
                        </span>
                      )}
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

      {!isLoading && (data?.totalPages ?? 1) > 1 && (
        <PaginationControls
          page={page}
          totalPages={data?.totalPages ?? 1}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
