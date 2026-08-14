"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  DollarSign,
  ShoppingCart,
  Package,
  Percent,
  TrendingDown,
  Wallet,
  Ban,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { ReportSummary } from "@/types";

export interface SummaryCardItem {
  title: string;
  value: string;
  hint?: string;
  icon: typeof DollarSign;
}

function money(v: number | null): string {
  if (v === null) return "نامشخص";
  return formatPrice(v);
}

function count(v: number): string {
  return new Intl.NumberFormat("fa-IR").format(v);
}

export function summaryCardsFromSummary(s: ReportSummary): SummaryCardItem[] {
  return [
    {
      title: "فروش ناخالص",
      value: money(s.grossSales),
      hint: `${count(s.unitsSold)} واحد در ${count(s.orders)} سفارش`,
      icon: DollarSign,
    },
    {
      title: "تخفیف‌ها",
      value: money(s.productDiscount + s.couponDiscount),
      hint: `محصول: ${money(s.productDiscount)} · کوپن: ${money(s.couponDiscount)}`,
      icon: TrendingDown,
    },
    {
      title: "فروش خالص",
      value: money(s.netSales),
      hint: "پس از تخفیف‌ها",
      icon: ShoppingCart,
    },
    {
      title: "سود ناخالص",
      value: money(s.grossProfit),
      hint:
        s.grossMargin !== null
          ? `حاشیه: ${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(s.grossMargin)}٪`
          : "حاشیه در دسترس نیست",
      icon: Percent,
    },
    {
      title: "بازپرداخت‌ها",
      value: money(s.refunds),
      hint: `${count(s.refundedOrders)} سفارش`,
      icon: Ban,
    },
    {
      title: "پرداخت‌شده",
      value: money(s.paidAmount),
      hint: `معوق: ${money(s.outstandingAmount)}`,
      icon: Wallet,
    },
    {
      title: "ارزش موجودی",
      value: money(s.inventoryValue),
      hint: "به بهای تمام‌شده",
      icon: Package,
    },
  ];
}

/**
 * Purchase-labeled summary cards (Session 82 Phase B). The purchases report
 * uses purchase semantics (subtotal/discount/total/paid/outstanding) — never
 * the order-labeled generic cards (no COGS/profit claims on procurement data).
 */
export function purchaseSummaryCardsFromSummary(
  s: ReportSummary
): SummaryCardItem[] {
  return [
    {
      title: "تعداد خرید",
      value: count(s.orders),
      hint: `${count(s.unitsSold)} واحد سفارش‌شده`,
      icon: ShoppingCart,
    },
    {
      title: "جمع جزء خرید",
      value: money(s.grossSales),
      hint: `تخفیف: ${money(s.productDiscount)} · هزینه اضافی: ${money(
        s.netSales - s.grossSales + s.productDiscount
      )}`,
      icon: DollarSign,
    },
    {
      title: "جمع کل خرید",
      value: money(s.netSales),
      hint: "پس از تخفیف و هزینه‌های اضافی",
      icon: Wallet,
    },
    {
      title: "پرداخت‌شده به تأمین‌کننده",
      value: money(s.paidAmount),
      hint: `مانده: ${money(s.outstandingAmount)}`,
      icon: TrendingDown,
    },
    {
      title: "مانده پرداخت",
      value: money(s.outstandingAmount),
      hint: "مبلغ پرداخت‌نشده",
      icon: Ban,
    },
  ];
}

export function SummaryCards({ items }: { items: SummaryCardItem[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.title}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{item.title}</p>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                </div>
              </div>
              <p className="mt-2 text-base font-bold">{item.value}</p>
              {item.hint && (
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {item.hint}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
