"use client";

import { Clock } from "lucide-react";
import {
  ORDER_STATUS_CONFIG,
  statusNoteLabel,
} from "@/components/orders/order-status-badge";
import type { OrderStatusV2 } from "@/types";

/**
 * Shared order timeline components (Session 57).
 *
 * Two renderings of the same immutable statusHistory:
 * - OrderEventTimeline (admin) — renders EVERY history entry as an event
 *   (including refund / cancelled events and machine-readable notes).
 * - OrderProgressTimeline (customer) — renders the ordered lifecycle STEPS up
 *   to the current status (+ cancelled), picking each step's timestamp from
 *   the matching history entry.
 */

export interface OrderHistoryEntry {
  status: string;
  at: string;
  note?: string;
  actor?: string;
}

/** Admin detail: one timeline item per statusHistory entry. */
export function OrderEventTimeline({
  entries,
  emptyLabel = "تاریخچه‌ای ثبت نشده است",
}: {
  entries?: OrderHistoryEntry[];
  emptyLabel?: string;
}) {
  if (!entries || entries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, idx) => {
        const config =
          ORDER_STATUS_CONFIG[entry.status as keyof typeof ORDER_STATUS_CONFIG];
        const Icon = config?.icon || Clock;
        const isLast = idx === entries.length - 1;
        return (
          <div key={idx} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Timeline line */}
            {!isLast && (
              <div className="absolute right-[15px] top-8 bottom-0 w-px bg-border" />
            )}
            {/* Icon circle */}
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                config?.color || "bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>
            {/* Content */}
            <div className="flex-1 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {config?.label || entry.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.at).toLocaleDateString("fa-IR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {entry.actor && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {entry.actor === "admin"
                      ? "مدیر"
                      : entry.actor === "customer"
                        ? "مشتری"
                        : entry.actor === "system"
                          ? "سیستم"
                          : entry.actor}
                  </span>
                )}
              </div>
              {statusNoteLabel(entry.note) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusNoteLabel(entry.note)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Customer detail: one item per lifecycle step (timestamps from history). */
export function OrderProgressTimeline({
  steps,
  history,
  emptyLabel = "اطلاعات وضعیت در دسترس نیست",
}: {
  steps: OrderStatusV2[];
  history?: OrderHistoryEntry[];
  emptyLabel?: string;
}) {
  if (!steps || steps.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {steps.map((status, idx) => {
        const config = ORDER_STATUS_CONFIG[status];
        const Icon = config?.icon || Clock;
        const isLast = idx === steps.length - 1;
        const isCancelled = status === "cancelled";

        // Find the actual timestamp from statusHistory if available
        const historyEntry = history?.find((h) => h.status === status);
        const timestamp = historyEntry?.at;

        return (
          <div key={status} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Timeline line */}
            {!isLast && (
              <div className="absolute right-[15px] top-8 bottom-0 w-px bg-border" />
            )}
            {/* Icon circle */}
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                config?.color || "bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>
            {/* Content */}
            <div className="flex-1 pt-1">
              <div
                className={`flex items-center gap-2 ${
                  isCancelled ? "text-destructive" : ""
                }`}
              >
                <span className="text-sm font-medium">
                  {config?.label || status}
                </span>
                {timestamp && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(timestamp).toLocaleDateString("fa-IR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
              {statusNoteLabel(historyEntry?.note) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusNoteLabel(historyEntry?.note)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
