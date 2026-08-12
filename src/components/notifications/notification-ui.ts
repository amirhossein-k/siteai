/**
 * Shared notification UI helpers (Session 80).
 *
 * Extracted from the notifications inbox so the admin header bell and the
 * role-agnostic NotificationsList render identical category icons/labels and
 * relative timestamps — one source of truth, no duplicated formatting.
 */
import {
  Bell,
  CreditCard,
  MessageSquareText,
  Package,
  Wallet,
} from "lucide-react";
import type { NotificationCategory } from "@/types";

/** Category → icon + Persian label (shared by the inbox list and the admin bell). */
export const CATEGORY_META: Record<
  NotificationCategory,
  { icon: typeof Package; label: string }
> = {
  order: { icon: Package, label: "سفارش" },
  payment: { icon: CreditCard, label: "پرداخت" },
  payout: { icon: Wallet, label: "کیف پول" },
  system: { icon: Bell, label: "سیستم" },
  support: { icon: MessageSquareText, label: "پشتیبانی" },
};

/** Persian relative time ("همین حالا" / "۵ دقیقه پیش" / "۲ روز پیش" / ...). */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "همین حالا";
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} روز پیش`;
  return new Intl.DateTimeFormat("fa-IR").format(new Date(iso));
}
