"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Package,
  ShoppingCart,
  TrendingUp,
  DollarSign,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useSupplierStats } from "@/hooks/use-supplier-stats";
import { formatPrice } from "@/lib/utils";

export default function SupplierDashboard() {
  const {
    data: stats,
    isLoading,
    isError,
    refetch,
  } = useSupplierStats();

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">داشبورد</h1>
          <p className="text-sm text-muted-foreground">
            خلاصه‌ای از فعالیت‌های شما
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات داشبورد
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">داشبورد فروشنده</h1>
        <p className="text-sm text-muted-foreground">
          خوش آمدید! خلاصه‌ای از فعالیت‌های شما
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="محصولات من"
          value={
            stats ? stats.totalProducts.toLocaleString("fa-IR") : "—"
          }
          icon={Package}
          description={
            stats ? `${stats.lowStock} مورد کم‌موجودی` : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          title="کل سفارشات"
          value={
            stats ? stats.totalOrders.toLocaleString("fa-IR") : "—"
          }
          icon={ShoppingCart}
          description={
            stats ? `${stats.pendingOrders} سفارش در انتظار` : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          title="درآمد کل"
          value={stats ? formatPrice(stats.totalEarnings) : "—"}
          icon={TrendingUp}
          trend={
            stats
              ? { value: stats.totalEarnings > 0 ? 100 : 0, isPositive: true }
              : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          title="کیف پول"
          value={stats ? formatPrice(stats.balance) : "—"}
          icon={DollarSign}
          isLoading={isLoading}
        />
      </div>

      {/* Info Cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick Stats */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">وضعیت محصولات</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {stats?.totalProducts || 0} محصول
            </Badge>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <StatusItem
                  label="محصولات فعال"
                  value={stats?.totalProducts || 0}
                  color="text-emerald-600"
                />
                <StatusItem
                  label="محصولات کم‌موجودی"
                  value={stats?.lowStock || 0}
                  color={
                    (stats?.lowStock || 0) > 0
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }
                />
                <StatusItem
                  label="سفارشات در انتظار"
                  value={stats?.pendingOrders || 0}
                  color={
                    (stats?.pendingOrders || 0) > 0
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Balance Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">موجودی کیف پول</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-3xl font-bold text-emerald-600">
                    {stats ? formatPrice(stats.balance) : "—"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {stats && stats.balance > 0
                      ? "مانده قابل تسویه"
                      : stats && stats.balance < 0
                      ? "بدهی به فروشگاه"
                      : "بدون تراکنش"}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">درآمد کل</p>
                  <p className="mt-1 text-xl font-semibold">
                    {stats ? formatPrice(stats.totalEarnings) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    مجموع درآمد از همه سفارشات
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Sub-components ---

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  isLoading,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  trend?: { value: number; isPositive: boolean };
  description?: string;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="mb-1 h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
            <Icon className="h-4 w-4 text-emerald-600" />
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold">{value}</p>
        <div className="mt-1 flex items-center gap-2">
          {trend && (
            <span
              className={`inline-flex items-center gap-0.5 text-xs ${
                trend.isPositive ? "text-emerald-600" : "text-red-600"
              }`}
            >
              <TrendingUp
                className={`h-3 w-3 ${
                  trend.isPositive ? "" : "rotate-180"
                }`}
              />
              فعال
            </span>
          )}
          {description && (
            <span className="text-xs text-muted-foreground">
              {description}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusItem({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${color}`}>
        {value.toLocaleString("fa-IR")}
      </span>
    </div>
  );
}
