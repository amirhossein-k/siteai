"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
  Ticket,
  Wallet,
  BarChart3,
  AlertCircle,
  RefreshCw,
  Package,
} from "lucide-react";
import { useAdminAnalytics } from "@/hooks/use-admin-analytics";
import { formatPrice } from "@/lib/utils";
import type { AnalyticsTimePoint, AdminAnalytics } from "@/types";

const RANGES = [
  { days: 7, label: "۷ روز" },
  { days: 30, label: "۳۰ روز" },
  { days: 90, label: "۹۰ روز" },
];

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState(30);

  const { data, isLoading, isError, refetch } = useAdminAnalytics(range);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">گزارش‌ها و آمار</h1>
          <p className="text-sm text-muted-foreground">
            تحلیل فروش، محصولات، تخفیف‌ها و تسویه فروشندگان
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Range Selector */}
          <div className="flex items-center rounded-lg border bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setRange(r.days)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  range === r.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`ml-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            بروزرسانی
          </Button>
        </div>
      </div>

      {/* Error State */}
      {isError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                خطا در بارگذاری گزارش‌ها
              </p>
              <p className="text-xs text-red-600/70 dark:text-red-400/70">
                لطفاً صفحه را بروزرسانی کنید
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 w-full rounded-lg" />
            <Skeleton className="h-72 w-full rounded-lg" />
          </div>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {/* Summary Stats */}
          <SummaryCards data={data} />

          {/* Revenue / Orders Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">درآمد روزانه</CardTitle>
                <CardDescription>
                  {data.from} تا {data.to}
                </CardDescription>
              </div>
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <RevenueChart data={data.timeSeries} />
            </CardContent>
          </Card>

          {/* Top Products + Categories */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  پرفروش‌ترین محصولات
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topProducts.length === 0 ? (
                  <EmptyHint text="در این بازه سفارشی ثبت نشده است" />
                ) : (
                  <div className="space-y-3">
                    {data.topProducts.map((p, i) => (
                      <RankedRow
                        key={p.name + i}
                        rank={i + 1}
                        name={p.name}
                        sub={`${p.quantity.toLocaleString("fa-IR")} عدد`}
                        value={formatPrice(p.revenue)}
                        valueNum={p.revenue}
                        max={data.topProducts[0].revenue}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  پرفروش‌ترین دسته‌بندی‌ها
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topCategories.length === 0 ? (
                  <EmptyHint text="در این بازه سفارشی ثبت نشده است" />
                ) : (
                  <div className="space-y-3">
                    {data.topCategories.map((c, i) => (
                      <RankedRow
                        key={c.name + i}
                        rank={i + 1}
                        name={c.name}
                        sub={`${c.quantity.toLocaleString("fa-IR")} عدد`}
                        value={formatPrice(c.revenue)}
                        valueNum={c.revenue}
                        max={data.topCategories[0].revenue}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Coupons + Suppliers */}
          <div className="grid gap-6 lg:grid-cols-2">
            <CouponStatsCard data={data} />
            <SupplierStatsCard data={data} />

            {/* Order Status Funnel */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  وضعیت سفارش‌ها
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.ordersByStatus.length === 0 ? (
                  <EmptyHint text="در این بازه سفارشی ثبت نشده است" />
                ) : (
                  <StatusFunnel rows={data.ordersByStatus} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// --- Summary Cards ---

function SummaryCards({ data }: { data: AdminAnalytics }) {
  const items = [
    {
      title: "درآمد کل",
      value: formatPrice(data.summary.revenue),
      icon: DollarSign,
      hint: `${data.summary.orders.toLocaleString("fa-IR")} سفارش`,
    },
    {
      title: "میانگین ارزش سفارش",
      value: formatPrice(data.summary.avgOrderValue),
      icon: ShoppingCart,
      hint: "به ازای هر سفارش",
    },
    {
      title: "صرفه‌جویی کد تخفیف",
      value: formatPrice(data.summary.couponSavings),
      icon: Ticket,
      hint: "مبلغ کل تخفیف‌های اعمال‌شده",
    },
    {
      title: "مشتریان جدید",
      value: data.summary.newCustomers.toLocaleString("fa-IR"),
      icon: Users,
      hint: "ثبت‌نام‌شده در این بازه",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.title}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{item.title}</p>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold">{item.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// --- Revenue Bar Chart (hand-rolled SVG — no chart dependency) ---

function RevenueChart({ data }: { data: AnalyticsTimePoint[] }) {
  const W = 800;
  const H = 260;
  const PAD_X = 40;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 30;

  const maxRevenue = useMemo(
    () => Math.max(...data.map((d) => d.revenue), 1),
    [data]
  );
  const maxOrders = useMemo(
    () => Math.max(...data.map((d) => d.orders), 1),
    [data]
  );

  const chartW = W - PAD_X * 2;
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const step = chartW / data.length;
  const barW = Math.min(step * 0.6, 28);

  const points = data.map((d, i) => {
    const x = PAD_X + i * step + step / 2;
    const y = PAD_TOP + chartH - (d.revenue / maxRevenue) * chartH;
    return { x, y, ...d };
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div dir="ltr" className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[560px]"
        role="img"
        aria-label="نمودار درآمد روزانه"
      >
        {/* Grid lines */}
        {gridLines.map((g) => {
          const y = PAD_TOP + chartH - g * chartH;
          return (
            <g key={g}>
              <line
                x1={PAD_X}
                y1={y}
                x2={W - PAD_X}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.1"
                strokeDasharray="4 4"
              />
              <text
                x={PAD_X - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {formatPrice(maxRevenue * g)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {points.map((p) => {
          const h = (p.revenue / maxRevenue) * chartH;
          const orderRatio = (p.orders / maxOrders) * chartH;
          return (
            <g key={p.date}>
              {/* Orders (secondary, thin) */}
              <rect
                x={p.x - step / 2 + 2}
                y={PAD_TOP + chartH - orderRatio}
                width={step - 4}
                height={orderRatio}
                rx={2}
                className="fill-primary/20"
              >
                <title>{`${p.date} — ${p.orders.toLocaleString("fa-IR")} سفارش`}</title>
              </rect>
              {/* Revenue (primary) */}
              <rect
                x={p.x - barW / 2}
                y={PAD_TOP + chartH - h}
                width={barW}
                height={h}
                rx={3}
                className="fill-primary"
              >
                <title>{`${p.date} — ${formatPrice(p.revenue)}`}</title>
              </rect>
              {/* Date label (every ~5th) */}
              {data.length <= 30 && p.date.endsWith("01") && (
                <text
                  x={p.x}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {p.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" />
          درآمد
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary/20" />
          تعداد سفارش
        </span>
      </div>
    </div>
  );
}

// --- Ranked Row (top products / categories) ---

function RankedRow({
  rank,
  name,
  sub,
  value,
  valueNum,
  max,
}: {
  rank: number;
  name: string;
  sub: string;
  value: string;
  valueNum: number;
  max: number;
}) {
  // Relative weight bar (min 4% so rank-1-only lists still show a sliver)
  const pct = max > 0 ? Math.max(4, Math.round((valueNum / max) * 100)) : 4;
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          rank === 1
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
            : rank === 2
            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            : rank === 3
            ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {rank.toLocaleString("fa-IR")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <span className="shrink-0 text-sm font-semibold">{value}</span>
      {/* max bar behind — visual weight indicator */}
      <div className="hidden w-16 shrink-0 sm:block">
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div
            className="h-1.5 rounded-full bg-primary/40 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// --- Coupon Stats Card ---

function CouponStatsCard({ data }: { data: AdminAnalytics }) {
  const { couponStats } = data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ticket className="h-4 w-4 text-muted-foreground" />
          عملکرد کدهای تخفیف
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat
            label="کل کدها"
            value={couponStats.total.toLocaleString("fa-IR")}
            hint={`${couponStats.active.toLocaleString("fa-IR")} فعال`}
          />
          <MiniStat
            label="استفاده کل"
            value={couponStats.totalUses.toLocaleString("fa-IR")}
            hint="تاکنون"
          />
          <MiniStat
            label="سفارش‌های تخفیف‌خورده"
            value={couponStats.discountedOrders.toLocaleString("fa-IR")}
            hint="در این بازه"
          />
          <MiniStat
            label="مبلغ تخفیف"
            value={formatPrice(couponStats.totalDiscount)}
            hint="در این بازه"
          />
        </div>

        {couponStats.topCoupons.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              برترین کدها در این بازه
            </p>
            <div className="space-y-2">
              {couponStats.topCoupons.map((c) => (
                <div
                  key={c.code}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                >
                  <span className="font-mono font-semibold" dir="ltr">
                    {c.code}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{c.uses.toLocaleString("fa-IR")} استفاده</span>
                    <span className="font-medium text-foreground">
                      {formatPrice(c.discount)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Supplier Stats Card ---

function SupplierStatsCard({ data }: { data: AdminAnalytics }) {
  const { supplierStats } = data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          تسویه فروشندگان
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniStat
            label="درآمد کل فروشندگان"
            value={formatPrice(supplierStats.totalEarnings)}
            hint="تمام‌زمان"
          />
          <MiniStat
            label="تسویه‌شده"
            value={formatPrice(supplierStats.totalPaidOut)}
            hint={`${supplierStats.paidOutCount.toLocaleString("fa-IR")} پرداخت`}
          />
          <MiniStat
            label="تسویه در انتظار"
            value={formatPrice(supplierStats.pendingPayoutAmount)}
            hint={`${supplierStats.pendingPayoutCount.toLocaleString("fa-IR")} درخواست`}
          />
          <MiniStat
            label="بدهی به فروشندگان"
            value={formatPrice(supplierStats.outstandingBalance)}
            hint="مانده حساب"
          />
          <MiniStat
            label="رزرو تسویه"
            value={formatPrice(supplierStats.pendingReserve)}
            hint="در انتظار تأیید"
          />
        </div>
        <p className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          این بخش بر اساس دفتر کل تراکنش‌ها (درآمد سفارش، پرداخت‌ها و مانده
          حساب فروشندگان) محاسبه می‌شود.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Mini Stat ---

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// --- Status Funnel ---

function StatusFunnel({ rows }: { rows: AdminAnalytics["ordersByStatus"] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.status} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm">{row.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/60 transition-all"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-left text-sm font-semibold">
            {row.count.toLocaleString("fa-IR")}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <BarChart3 className="mb-3 h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
