"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/use-admin-categories";
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  PURCHASE_STATUSES,
  PURCHASE_PAYMENT_STATUSES,
  EXPENSE_STATUSES,
  EXPENSE_CATEGORIES,
} from "@/lib/report-utils";
import type { ReportMeta } from "@/components/reports/report-config";
import { REPORT_TITLES } from "@/lib/report-titles";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ value: string; label: string }> = [
  { value: "today", label: "امروز" },
  { value: "yesterday", label: "دیروز" },
  { value: "week", label: "هفته جاری" },
  { value: "month", label: "ماه جاری" },
  { value: "lastMonth", label: "ماه گذشته" },
  { value: "year", label: "سال جاری" },
  { value: "custom", label: "سفارشی" },
];

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "در انتظار پرداخت",
  processing: "در حال پردازش",
  confirmed: "تأیید شده",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  cancelled: "لغو شده",
  draft: "پیش‌نویس",
  ordered: "ثبت سفارش",
  partially_received: "دریافت جزئی",
  received: "دریافت کامل",
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: "در انتظار پرداخت",
  paid: "پرداخت شده",
  failed: "ناموفق",
  canceled: "لغو شده",
  refunded: "بازپرداخت شده",
  unpaid: "پرداخت نشده",
  partial: "پرداخت جزئی",
};

const isPurchaseReport = (meta: ReportMeta) => meta.title === REPORT_TITLES.purchases;

const isExpenseReport = (meta: ReportMeta) => meta.title === REPORT_TITLES.expenses;

const EXPENSE_STATUS_LABELS: Record<string, string> = {
  paid: "پرداخت شده",
  pending: "در انتظار پرداخت",
  void: "باطل شده",
};

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  shipping: "حمل‌ونقل",
  packaging: "بسته‌بندی",
  advertising: "تبلیغات",
  gateway_fees: "کارمزد درگاه پرداخت",
  rent: "اجاره",
  utilities: "قبوض (آب/برق/گاز)",
  salaries: "حقوق و دستمزد",
  software: "نرم‌افزار و سرویس‌ها",
  maintenance: "تعمیر و نگهداری",
  other: "سایر",
};

const METHOD_LABELS: Record<string, string> = {
  zarinpal: "زرین‌پال",
  manual: "دستی",
};

interface ReportFiltersProps {
  meta: ReportMeta;
  params: Record<string, string>;
  onParamsChange: (next: Record<string, string>) => void;
}

export function ReportFilters({ meta, params, onParamsChange }: ReportFiltersProps) {
  const { data: categories } = useCategories();
  const filters = meta.filters;
  const isCustom = params.preset === "custom";

  const [drafts, setDrafts] = useState({
    q: params.q ?? "",
    coupon: params.coupon ?? "",
  });
  // Render-phase sync (the project's lint-compliant pattern — see the admin
  // orders page): when filters change externally (nav click etc.) reset the
  // text drafts without an effect-triggered cascade.
  const [prevParams, setPrevParams] = useState({
    q: params.q,
    coupon: params.coupon,
  });
  if (prevParams.q !== params.q || prevParams.coupon !== params.coupon) {
    setPrevParams({ q: params.q, coupon: params.coupon });
    setDrafts({ q: params.q ?? "", coupon: params.coupon ?? "" });
  }

  const set = (patch: Record<string, string>) => {
    const next = { ...params, ...patch };
    if (patch.preset) {
      // Changing the preset clears custom dates; changing to custom keeps them.
      delete next.page;
      if (patch.preset !== "custom") {
        delete next.from;
        delete next.to;
      }
    }
    onParamsChange(next);
  };

  const applyText = () => {
    const next: Record<string, string> = { ...params };
    if (meta.filters.q) next.q = drafts.q.trim();
    if (meta.filters.coupon) next.coupon = drafts.coupon.trim().toUpperCase();
    delete next.page;
    onParamsChange(next);
  };

  const reset = () => onParamsChange({ preset: "month" });

  const clear = (keys: string[]) => {
    const next: Record<string, string> = { ...params };
    for (const k of keys) delete next[k];
    delete next.page;
    onParamsChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Preset segmented control */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => set({ preset: p.value })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                params.preset === p.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        {isCustom && (
          <div className="flex items-center gap-2 text-sm">
            <Input
              type="date"
              value={params.from ?? ""}
              onChange={(e) => set({ from: e.target.value })}
              className="w-36"
              aria-label="تاریخ شروع"
            />
            <span className="text-muted-foreground">تا</span>
            <Input
              type="date"
              value={params.to ?? ""}
              onChange={(e) => set({ to: e.target.value })}
              className="w-36"
              aria-label="تاریخ پایان"
            />
          </div>
        )}

        {/* Status / payment / method */}
        {filters.status && (
          <select
            value={params.status ?? ""}
            onChange={(e) =>
              e.target.value ? set({ status: e.target.value }) : clear(["status"])
            }
            className="h-9 rounded-lg border bg-card px-2 text-sm"
            aria-label="وضعیت"
          >
            <option value="">
              {isPurchaseReport(meta)
                ? "وضعیت خرید: همه"
                : isExpenseReport(meta)
                  ? "وضعیت هزینه: همه"
                  : "وضعیت سفارش: همه"}
            </option>
            {(isPurchaseReport(meta)
              ? PURCHASE_STATUSES
              : isExpenseReport(meta)
                ? EXPENSE_STATUSES
                : ORDER_STATUSES
            ).map((s) => (
              <option key={s} value={s}>
                {isExpenseReport(meta) ? (EXPENSE_STATUS_LABELS[s] ?? s) : (STATUS_LABELS[s] ?? s)}
              </option>
            ))}
          </select>
        )}

        {filters.paymentStatus && (
          <select
            value={params.paymentStatus ?? ""}
            onChange={(e) =>
              e.target.value ? set({ paymentStatus: e.target.value }) : clear(["paymentStatus"])
            }
            className="h-9 rounded-lg border bg-card px-2 text-sm"
            aria-label="وضعیت پرداخت"
          >
            <option value="">وضعیت پرداخت: همه</option>
            {(isPurchaseReport(meta) ? PURCHASE_PAYMENT_STATUSES : PAYMENT_STATUSES).map((s) => (
              <option key={s} value={s}>
                {PAYMENT_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        )}

        {filters.method && (
          <select
            value={params.method ?? ""}
            onChange={(e) =>
              e.target.value ? set({ method: e.target.value }) : clear(["method"])
            }
            className="h-9 rounded-lg border bg-card px-2 text-sm"
            aria-label="روش پرداخت"
          >
            <option value="">روش پرداخت: همه</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </select>
        )}

        {filters.category &&
          (isExpenseReport(meta) ? (
            <select
              value={params.category ?? ""}
              onChange={(e) =>
                e.target.value ? set({ category: e.target.value }) : clear(["category"])
              }
              className="h-9 rounded-lg border bg-card px-2 text-sm"
              aria-label="دسته‌بندی هزینه"
            >
              <option value="">دسته‌بندی هزینه: همه</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={params.category ?? ""}
              onChange={(e) =>
                e.target.value ? set({ category: e.target.value }) : clear(["category"])
              }
              className="h-9 rounded-lg border bg-card px-2 text-sm"
              aria-label="دسته‌بندی"
            >
              <option value="">دسته‌بندی: همه</option>
              {(categories ?? []).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          ))}

        <Button variant="ghost" size="sm" onClick={reset}>
          بازنشانی
        </Button>
      </div>

      {/* Text filters (applied on Enter / button) */}
      {(filters.q || filters.coupon) && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.q && (
            <div className="relative">
              <Input
                placeholder={
                  meta.title === "گزارش مشتریان"
                    ? "جستجوی نام یا تلفن مشتری..."
                    : "جستجو..."
                }
                value={drafts.q}
                onChange={(e) => setDrafts({ ...drafts, q: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyText()}
                className="w-56"
              />
            </div>
          )}
          {filters.coupon && (
            <Input
              placeholder="کد تخفیف..."
              value={drafts.coupon}
              onChange={(e) => setDrafts({ ...drafts, coupon: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && applyText()}
              className="w-40 font-mono"
              dir="ltr"
            />
          )}
          <Button variant="outline" size="sm" onClick={applyText}>
            اعمال
          </Button>
        </div>
      )}
    </div>
  );
}
