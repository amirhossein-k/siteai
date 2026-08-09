"use client";

import { Badge } from "@/components/ui/badge";
import type { ConversationStatus } from "@/types";

export const CONVERSATION_STATUS_CONFIG: Record<
  ConversationStatus,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }
> = {
  open: { label: "باز", variant: "warning" },
  pending: { label: "در انتظار پاسخ شما", variant: "default" },
  resolved: { label: "حل‌شده", variant: "success" },
  closed: { label: "بسته شده", variant: "secondary" },
};

interface ConversationStatusBadgeProps {
  status: ConversationStatus;
  className?: string;
}

/** Status badge for support conversations (Session 68). */
export function ConversationStatusBadge({
  status,
  className,
}: ConversationStatusBadgeProps) {
  const config = CONVERSATION_STATUS_CONFIG[status];
  if (!config) return null;
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

/** Short "you vs staff" label for the last-message author. */
export function lastMessageAuthorLabel(
  from: string | undefined,
  isCustomer: boolean
): string {
  if (from === "customer") return isCustomer ? "شما" : "مشتری";
  if (from === "admin") return "پشتیبانی";
  if (from === "supplier") return "فروشنده";
  return "";
}
