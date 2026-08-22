"use client";

import { Suspense, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, PackageOpen } from "lucide-react";
import { ReportNav } from "@/components/reports/report-nav";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { ExportButton } from "@/components/reports/export-button";
import { PnlView } from "@/components/reports/pnl-view";
import { ProfitabilityView, type ProfitabilityViewProps } from "@/components/reports/profitability-view";
import {
  SummaryCards,
  summaryCardsFromSummary,
  purchaseSummaryCardsFromSummary,
  expenseSummaryCardsFromSummary,
} from "@/components/reports/summary-cards";
import {
  buildReportQuery,
  defaultReportParams,
  REPORT_META,
  type ReportMeta,
} from "@/components/reports/report-config";
import { PaginationControls } from "@/components/ui/pagination";
import { useReportData } from "@/hooks/use-admin-reports";
import { REPORT_NAV } from "@/components/reports/report-config";
import type { ProfitLossReport, ReportEnvelope } from "@/types";

const PNL_META: ReportMeta = {
  title: "سود و زیان",
  description: "صورت سود و زیان با مقایسه دوره قبل",
  filters: { preset: true },
  columns: [],
  totalKeys: [],
};

/**
 * Report detail content — wrapped in <Suspense> because
 * useSearchParams() is called (Next.js static-prerender requirement).
 */
function ReportDetailContent() {
  const { report } = useParams<{ report: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isPnl = report === "pnl";
  const isProfitability = report === "profitability";
  const meta = isPnl || isProfitability ? PNL_META : REPORT_META[report];
  const known = REPORT_NAV.some((n) => n.report === report);

  const params: Record<string, string> = useMemo(() => {
    const out = defaultReportParams();
    searchParams.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }, [searchParams]);

  const qs = useMemo(() => buildReportQuery(params), [params]);

  const setParams = (next: Record<string, string>) => {
    const query = buildReportQuery(next);
    router.replace(
      `/admin/reports/${report}${query ? `?${query}` : ""}`,
      { scroll: false }
    );
  };

  // Single query per report+qs — pnl returns a ProfitLossReport, everything
  // else returns a ReportEnvelope (cast at the render site).
  const { data, isLoading, isError, refetch } =
    useReportData<ProfitLossReport | ReportEnvelope<Record<string, unknown>>>(
      report,
      qs
    );

  if (!known || !meta) {
    return (
      <div className="space-y-6">
        <ReportNav />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            گزارش نامعتبر است
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <ExportButton report={report} qs={qs} />
      </div>

      <ReportNav />
      <ReportFilters meta={meta} params={params} onParamsChange={setParams} />

      {isError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                خطا در بارگذاری گزارش
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
        <Card>
          <CardContent className="p-4">
            <ReportTable columns={meta.columns} rows={[]} loading />
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && data && (
        <>
          {isProfitability ? (
            <ProfitabilityView
              {...(data as unknown as ProfitabilityViewProps)}
            />
          ) : isPnl ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">سود و زیان</CardTitle>
                <CardDescription>
                  {(data as ProfitLossReport).current.summary.from} تا{" "}
                  {(data as ProfitLossReport).current.summary.to}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PnlView data={data as ProfitLossReport} />
              </CardContent>
            </Card>
          ) : (
            <>
              <SummaryCards
                items={
                  report === "purchases"
                    ? purchaseSummaryCardsFromSummary(
                        (data as ReportEnvelope<Record<string, unknown>>).summary
                      )
                    : report === "expenses"
                      ? expenseSummaryCardsFromSummary(
                          (data as ReportEnvelope<Record<string, unknown>>).summary
                        )
                      : summaryCardsFromSummary(
                          (data as ReportEnvelope<Record<string, unknown>>).summary
                        )
                }
              />
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">جزئیات</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {(data as ReportEnvelope<Record<string, unknown>>).total.toLocaleString(
                      "fa-IR"
                    )}{" "}
                    ردیف
                  </span>
                </CardHeader>
                <CardContent className="p-0">
                  <ReportTable
                    columns={meta.columns}
                    rows={
                      (data as ReportEnvelope<Record<string, unknown>>).rows as Array<
                        Record<string, unknown>
                      >
                    }
                    totals={
                      (data as ReportEnvelope<Record<string, unknown>>).totals
                    }
                    totalKeys={meta.totalKeys}
                    emptyText="داده‌ای برای نمایش وجود ندارد"
                  />
                </CardContent>
              </Card>

              {(data as ReportEnvelope<Record<string, unknown>>).total > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
                  <p>
                    نمایش{" "}
                    {(data as ReportEnvelope<Record<string, unknown>>).rows.length.toLocaleString(
                      "fa-IR"
                    )}{" "}
                    از{" "}
                    {(data as ReportEnvelope<Record<string, unknown>>).total.toLocaleString(
                      "fa-IR"
                    )}{" "}
                    ردیف
                  </p>
                  <PaginationControls
                    page={(data as ReportEnvelope<Record<string, unknown>>).page}
                    totalPages={Math.max(
                      1,
                      Math.ceil(
                        (data as ReportEnvelope<Record<string, unknown>>).total /
                          (data as ReportEnvelope<Record<string, unknown>>).limit
                      )
                    )}
                    onPageChange={(p) => setParams({ ...params, page: String(p) })}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {!isLoading &&
        !isError &&
        data &&
        !isPnl &&
        (data as ReportEnvelope<Record<string, unknown>>).total === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
            <PackageOpen className="mb-3 h-8 w-8" />
            <p>در این بازه داده‌ای ثبت نشده است</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ReportDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">در حال بارگذاری...</p>
        </div>
      }
    >
      <ReportDetailContent />
    </Suspense>
  );
}
