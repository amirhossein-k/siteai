"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, TrendingUp, ShoppingCart } from "lucide-react";
import { ReportNav } from "@/components/reports/report-nav";
import { ReportFilters } from "@/components/reports/report-filters";
import { ExportButton } from "@/components/reports/export-button";
import { PnlView } from "@/components/reports/pnl-view";
import {
  SummaryCards,
  summaryCardsFromSummary,
} from "@/components/reports/summary-cards";
import {
  buildReportQuery,
  defaultReportParams,
} from "@/components/reports/report-config";
import { useReportData } from "@/hooks/use-admin-reports";
import { formatPrice } from "@/lib/utils";
import type { DashboardReport } from "@/types";

const DASHBOARD_META = {
  title: "داشبورد گزارش‌ها",
  description: "نمای کلی مالی و عملیاتی",
  filters: { preset: true },
  columns: [],
  totalKeys: [],
};

/**
 * Reports dashboard content — wrapped in <Suspense> because
 * useSearchParams() is called (Next.js static-prerender requirement).
 */
function ReportsDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const params: Record<string, string> = useMemo(() => {
    const out = defaultReportParams();
    searchParams.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }, [searchParams]);

  const qs = useMemo(() => buildReportQuery(params), [params]);
  const { data, isLoading, isError, refetch } =
    useReportData<DashboardReport>("dashboard", qs);

  const setParams = (next: Record<string, string>) => {
    const query = buildReportQuery(next);
    router.replace(`/admin/reports${query ? `?${query}` : ""}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">داشبورد گزارش‌ها</h1>
          <p className="text-sm text-muted-foreground">
            فروش، سود، پرداخت‌ها، بازپرداخت‌ها و موجودی — بر اساس اسنپ‌شات‌های تاریخی سفارش‌ها
          </p>
        </div>
        <ExportButton report="dashboard" qs={qs} />
      </div>

      <ReportNav />
      <ReportFilters
        meta={DASHBOARD_META as never}
        params={params}
        onParamsChange={setParams}
      />

      {isError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                خطا در بارگذاری گزارش‌ها
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          <SummaryCards items={summaryCardsFromSummary(data.summary)} />

          <div className="grid gap-6 lg:grid-cols-2">
            {/* P&L */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">سود و زیان</CardTitle>
                <CardDescription>
                  {data.summary.from} تا {data.summary.to}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PnlView data={data.pnl} />
              </CardContent>
            </Card>

            {/* Daily net sales */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">فروش خالص روزانه</CardTitle>
                <CardDescription>{data.summary.from} تا {data.summary.to}</CardDescription>
              </CardHeader>
              <CardContent>
                <DailyChart data={data.byDay} />
              </CardContent>
            </Card>

            {/* Top products */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  پرفروش‌ترین محصولات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topProducts.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    در این بازه سفارشی ثبت نشده است
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.topProducts.map((p, i) => (
                      <div key={p.name + i} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                          {(i + 1).toLocaleString("fa-IR")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.quantity.toLocaleString("fa-IR")} عدد
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">
                          {formatPrice(p.netSales)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Status + payments split */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  وضعیت سفارش‌ها
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SplitList rows={data.ordersByStatus} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">وضعیت پرداخت‌ها</CardTitle>
              </CardHeader>
              <CardContent>
                <SplitList rows={data.paymentsSplit} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function ReportsDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">در حال بارگذاری...</p>
        </div>
      }
    >
      <ReportsDashboardContent />
    </Suspense>
  );
}

function DailyChart({ data }: { data: DashboardReport["byDay"] }) {
  const max = Math.max(...data.map((d) => d.netSales), 1);
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto">
      {data.map((d) => (
        <div
          key={d.date}
          className="group relative flex min-w-[6px] flex-1 flex-col justify-end"
          title={`${d.date} — ${formatPrice(d.netSales)} (${d.orders.toLocaleString("fa-IR")} سفارش)`}
        >
          <div
            className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
            style={{ height: `${Math.max((d.netSales / max) * 100, d.netSales > 0 ? 2 : 0)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function SplitList({ rows }: { rows: Array<{ label: string; count: number; amount: number }> }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">داده‌ای نیست</p>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm">{r.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-left text-xs font-semibold">
              {r.count.toLocaleString("fa-IR")}
            </span>
            <span className="w-24 shrink-0 text-left text-xs text-muted-foreground">
              {formatPrice(r.amount)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
