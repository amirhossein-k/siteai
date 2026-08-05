"use client";

import { Badge } from "@/components/ui/badge";
import {
  Ban,
  CheckCircle2,
  Clock,
  Package,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatusV2 } from "@/types";

/**
 * Shared order-status + payment-status configuration and badge components
 * (Session 57). Extracted from the duplicated maps that lived in the admin
 * and customer order detail pages so every order surface renders identically.
 *
 * Order statuses belong to the ORDER domain (pending_payment … cancelled);
 * payment states (failed / canceled / refunded) are surfaced as PAYMENT
 * badges — never as order statuses.
 */

/** Order statuses plus the refund event (statusHistory may carry "refunded"). */
export type OrderStatusWithRefund = OrderStatusV2 | "refunded";

export interface OrderStatusConfigEntry {
  label: string;
  variant: "default" | "secondary" | "destructive" | "success" | "warning";
  icon: LucideIcon;
  color: string;
}

export const ORDER_STATUS_CONFIG: Record<
  OrderStatusWithRefund,
  OrderStatusConfigEntry
> = {
  pending_payment: {
    label: "در انتظار پرداخت",
    variant: "secondary",
    icon: Clock,
    color: "text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
  },
  processing: {
    label: "در حال پردازش",
    variant: "warning",
    icon: Package,
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
  },
  confirmed: {
    label: "تأیید شده",
    variant: "default",
    icon: CheckCircle2,
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300",
  },
  shipped: {
    label: "ارسال شده",
    variant: "default",
    icon: Truck,
    color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300",
  },
  delivered: {
    label: "تحویل شده",
    variant: "success",
    icon: CheckCircle2,
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
  },
  cancelled: {
    label: "لغو شده",
    variant: "destructive",
    icon: Ban,
    color: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300",
  },
  refunded: {
    label: "بازپرداخت شده",
    variant: "secondary",
    icon: Undo2,
    color: "text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-300",
  },
};

export interface PaymentStatusConfigEntry {
  label: string;
  variant: "default" | "secondary" | "destructive" | "success" | "warning";
}

export const PAYMENT_STATUS_CONFIG: Record<
  string,
  PaymentStatusConfigEntry
> = {
  paid: { label: "پرداخت شده", variant: "success" },
  pending: { label: "در انتظار", variant: "warning" },
  failed: { label: "ناموفق", variant: "destructive" },
  canceled: { label: "لغو شده", variant: "destructive" },
  refunded: { label: "بازپرداخت شده", variant: "secondary" },
};

/**
 * statusHistory notes are machine-readable audit keys (Session 46) — map
 * known keys to Persian labels for display; passthrough for human-entered
 * notes (admin writes Persian/empty notes today).
 */
const STATUS_NOTE_LABELS: Record<string, string> = {
  customer_cancelled: "لغو توسط مشتری",
};

export function statusNoteLabel(note?: string): string | undefined {
  if (!note) return undefined;
  return STATUS_NOTE_LABELS[note] || note;
}

/** Badge for the ORDER status (never a payment state). */
export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatusWithRefund;
  className?: string;
}) {
  const config = ORDER_STATUS_CONFIG[status];
  if (!config) return null;
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

/** Badge for the PAYMENT status (money state — separate domain). */
export function PaymentStatusBadge({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  const config = PAYMENT_STATUS_CONFIG[status || ""];
  return (
    <Badge variant={config?.variant || "secondary"} className={className}>
      {config?.label || status || "—"}
    </Badge>
  );
}
