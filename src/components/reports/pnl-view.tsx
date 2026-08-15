"use client";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/utils";
import type { ProfitLossReport } from "@/types";

function money(v: number | null): string {
  if (v === null) return "—";
  return formatPrice(v);
}

function percent(v: number | null): string {
  if (v === null) return "—";
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(v)}٪`;
}

function changeLabel(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const abs = Math.abs(v);
  const dir = v >= 0 ? "افزایش" : "کاهش";
  return `${dir} ${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(abs)}٪`;
}

const HIGHLIGHT_KEYS = new Set(["net", "grossProfit", "netProfit"]);

export function PnlView({ data }: { data: ProfitLossReport }) {
  const { current, previous, change } = data;

  const prevByKey = new Map<string, number | null>();
  for (const row of previous?.rows ?? []) {
    prevByKey.set(row.key, row.amount);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {change.netSales !== null && change.netSales !== undefined && (
          <span className="rounded-lg bg-muted px-2 py-1">
            فروش خالص نسبت به دوره قبل: {changeLabel(change.netSales)}
          </span>
        )}
        {change.grossProfit !== null && change.grossProfit !== undefined && (
          <span className="rounded-lg bg-muted px-2 py-1">
            سود ناخالص نسبت به دوره قبل: {changeLabel(change.grossProfit)}
          </span>
        )}
        {change.netProfit !== null && change.netProfit !== undefined && (
          <span className="rounded-lg bg-muted px-2 py-1">
            سود خالص نسبت به دوره قبل: {changeLabel(change.netProfit)}
          </span>
        )}
        {change.orders !== null && change.orders !== undefined && (
          <span className="rounded-lg bg-muted px-2 py-1">
            سفارش‌ها نسبت به دوره قبل: {changeLabel(change.orders)}
          </span>
        )}
        {previous && (
          <span className="rounded-lg bg-muted px-2 py-1">
            دوره قبل: {previous.summary.from} تا {previous.summary.to}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="px-4 py-2.5 text-right text-xs font-medium">عنوان</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium">
                مبلغ دوره جاری (تومان)
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium">درصد</th>
              {previous && (
                <th className="px-4 py-2.5 text-right text-xs font-medium">
                  مبلغ دوره قبل
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {current.rows.map((row) => {
              const highlighted = HIGHLIGHT_KEYS.has(row.key);
              return (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b last:border-0",
                    highlighted && "bg-muted/40 font-semibold"
                  )}
                >
                  <td className="px-4 py-2">{row.label}</td>
                  <td className="px-4 py-2 text-right">
                    {row.amount === null ? (
                      <span className="text-muted-foreground">نامشخص</span>
                    ) : (
                      money(row.amount)
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {row.percent === null ? "—" : percent(row.percent)}
                  </td>
                  {previous && (
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {prevByKey.has(row.key)
                        ? money(prevByKey.get(row.key) ?? null)
                        : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        بهای تمام‌شده از اسنپ‌شات FIFO هر اقلام سفارش (fifoUnitCost) یا قیمت خرید
        (supplierPrice) محاسبه می‌شود. سود خالص = سود ناخالص − هزینه‌های عملیاتی
        ثبت‌شده در دفتر هزینه‌ها (هزینه‌های باطل‌شده لحاظ نمی‌شوند). مالیات و هزینه
        ارسال ثبت نمی‌شوند؛ اگر هزینه‌ای در بازه ثبت نشده باشد، سود خالص برابر سود
        ناخالص است.
      </p>
    </div>
  );
}
