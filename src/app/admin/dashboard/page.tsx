"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DollarSign,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useAdminStats } from "@/hooks/use-admin-stats";
import { useAdminOrders } from "@/hooks/use-admin-orders";
import { useAdminProducts } from "@/hooks/use-admin-products";
import { formatPrice } from "@/lib/utils";

export default function AdminDashboard() {
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useAdminStats();

  const {
    data: ordersPage,
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
  } = useAdminOrders({ page: 1, limit: 5 });

  const {
    data: productsPage,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useAdminProducts({ page: 1, limit: 100 });

  const orders = ordersPage?.data || [];
  const products = productsPage?.data || [];

  const isLoading = statsLoading || ordersLoading || productsLoading;
  const hasError = statsError || ordersError || productsError;

  const recentOrders = useMemo(
    () =>
      (orders || [])
        .slice(0, 5)
        .map((order) => ({
          id: order._id.slice(-5),
          customer: order.customer?.name || "نامشخص",
          amount: order.totalAmount,
          status: order.status,
          date: new Date(order.createdAt).toLocaleDateString("fa-IR"),
        })),
    [orders]
  );

  const lowStockProducts = useMemo(
    () =>
      (products || [])
        .filter((p) => p.stock < 5)
        .slice(0, 4)
        .map((p) => ({
          id: p._id,
          name: p.name,
          category:
            typeof p.category === "object"
              ? (p.category as { name: string }).name
              : "بدون دسته",
          stock: p.stock,
          price: p.price,
        })),
    [products]
  );

  if (hasError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">داشبورد</h1>
          <p className="text-sm text-muted-foreground">
            خوش آمدید! خلاصه‌ای از وضعیت فروشگاه
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات داشبورد
            </p>
            <Button
              variant="outline"
              onClick={() => {
                refetchStats();
                refetchOrders();
                refetchProducts();
              }}
            >
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
        <h1 className="text-2xl font-bold tracking-tight">داشبورد</h1>
        <p className="text-sm text-muted-foreground">
          خوش آمدید! خلاصه‌ای از وضعیت فروشگاه
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="فروش کل"
          value={stats ? formatPrice(stats.totalRevenue) : "—"}
          icon={DollarSign}
          trend={
            stats
              ? { value: stats.growth, isPositive: stats.growth >= 0 }
              : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          title="سفارشات"
          value={stats ? stats.totalOrders.toLocaleString("fa-IR") : "—"}
          icon={ShoppingCart}
          description={
            stats ? `${stats.pendingOrders} سفارش در انتظار` : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          title="محصولات"
          value={stats ? stats.totalProducts.toLocaleString("fa-IR") : "—"}
          icon={Package}
          description={
            stats ? `${stats.lowStock} مورد کم‌موجودی` : undefined
          }
          isLoading={isLoading}
        />
        <StatCard
          title="کاربران"
          value={stats ? stats.totalUsers.toLocaleString("fa-IR") : "—"}
          icon={Users}
          isLoading={isLoading}
        />
      </div>

      {/* Recent Orders & Alerts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">آخرین سفارشات</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {stats?.totalOrders || 0} سفارش
            </Badge>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentOrders.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                هیچ سفارشی یافت نشد
              </div>
            ) : (
              <div className="space-y-3">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {order.id}
                      </div>
                      <div>
                        <p className="font-medium">{order.customer}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.date}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {formatPrice(order.amount)}
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">هشدارها</CardTitle>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats && stats.lowStock > 0 && (
                <AlertItem
                  type="warning"
                  message={`${stats.lowStock} محصول با موجودی کمتر از ۵ عدد`}
                />
              )}
              {stats && stats.pendingOrders > 0 && (
                <AlertItem
                  type="warning"
                  message={`${stats.pendingOrders} سفارش پرداخت نشده`}
                />
              )}
              {stats && stats.growth > 0 && (
                <AlertItem
                  type="info"
                  message={`رشد ${stats.growth}% نسبت به ماه گذشته`}
                />
              )}
              <AlertItem
                type="success"
                message="سیستم فعال و در حال کار"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Products */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">محصولات کم‌موجودی</CardTitle>
        </CardHeader>
        <CardContent>
          {productsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : lowStockProducts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              هیچ محصول کم‌موجودی وجود ندارد
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-right font-medium">محصول</th>
                    <th className="px-4 py-3 text-right font-medium">دسته‌بندی</th>
                    <th className="px-4 py-3 text-right font-medium">موجودی</th>
                    <th className="px-4 py-3 text-right font-medium">قیمت</th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockProducts.map((product) => (
                    <tr key={product.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{product.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {product.category}
                      </td>
                      <td className="px-4 py-3">{product.stock}</td>
                      <td className="px-4 py-3">{formatPrice(product.price)}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={product.stock === 0 ? "destructive" : "warning"}
                          className="text-xs"
                        >
                          {product.stock === 0 ? "تمام شده" : "کم‌موجود"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
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
              {trend.value}%
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

function OrderStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "success" | "warning"> = {
    delivered: "success",
    processing: "warning",
    pending_payment: "secondary",
    cancelled: "destructive",
    shipped: "default",
    confirmed: "default",
  };

  const labels: Record<string, string> = {
    delivered: "تحویل شده",
    processing: "در حال پردازش",
    pending_payment: "در انتظار پرداخت",
    cancelled: "لغو شده",
    shipped: "ارسال شده",
    confirmed: "تأیید شده",
  };

  return (
    <Badge variant={variants[status] || "secondary"} className="text-xs">
      {labels[status] || status}
    </Badge>
  );
}

function AlertItem({
  type,
  message,
}: {
  type: "warning" | "info" | "success" | "error";
  message: string;
}) {
  const colors = {
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
    info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    error: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  };

  return (
    <div className={`rounded-lg border p-3 text-sm ${colors[type]}`}>
      {message}
    </div>
  );
}
