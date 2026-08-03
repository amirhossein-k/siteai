"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Eye,
  AlertCircle,
  RefreshCw,
  PackageOpen,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  Ban,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSupplierOrders } from "@/hooks/use-supplier-orders";
import { formatPrice, formatDate } from "@/lib/utils";
import type { SupplierOrderItemStatus } from "@/types";

const statusConfig: Record<
  SupplierOrderItemStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning";
    icon: React.ElementType;
    color: string;
  }
> = {
  pending: {
    label: "در انتظار تأیید",
    variant: "secondary",
    icon: Clock,
    color: "text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
  },
  confirmed: {
    label: "تأیید شده",
    variant: "default",
    icon: CheckCircle2,
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300",
  },
  rejected: {
    label: "رد شده",
    variant: "destructive",
    icon: XCircle,
    color: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300",
  },
  shipped: {
    label: "ارسال شده",
    variant: "warning",
    icon: Truck,
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
  },
  delivered: {
    label: "تحویل داده شده",
    variant: "success",
    icon: CheckCircle2,
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

const statusFilters = [
  { value: null as string | null, label: "همه" },
  { value: "pending", label: "در انتظار تأیید" },
  { value: "confirmed", label: "تأیید شده" },
  { value: "shipped", label: "ارسال شده" },
  { value: "delivered", label: "تحویل شده" },
  { value: "rejected", label: "رد شده" },
] as const;

export default function SupplierOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const {
    data: orders,
    isLoading,
    isError,
    refetch,
  } = useSupplierOrders();

  const filteredOrders = useMemo(
    () =>
      (orders || []).filter((order) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orderData = order?.order as any;
        const customer =
          orderData && typeof orderData !== "string"
            ? orderData.customer
            : undefined;
        const orderId = orderData?._id || order?._id || "";

        const matchesSearch =
          orderId.includes(searchQuery) ||
          (customer?.name || "").includes(searchQuery) ||
          (customer?.phone || "").includes(searchQuery);
        const matchesStatus = statusFilter
          ? order.status === statusFilter
          : true;
        return matchesSearch && matchesStatus;
      }),
    [orders, searchQuery, statusFilter]
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">سفارشات</h1>
          <p className="text-sm text-muted-foreground">
            مشاهده سفارشات مربوط به محصولات شما
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">خطا در دریافت سفارشات</p>
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
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">سفارشات</h1>
        <p className="text-sm text-muted-foreground">
          مشاهده سفارشات مربوط به محصولات شما
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="جستجوی سفارش..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {statusFilters.map((filter) => (
                <Button
                  key={filter.label}
                  variant={
                    statusFilter === filter.value ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setStatusFilter(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">لیست سفارشات</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${filteredOrders.length} سفارش`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <PackageOpen className="mx-auto mb-3 h-8 w-8" />
              <p>سفارشی یافت نشد</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-right font-medium">شماره سفارش</th>
                    <th className="px-4 py-3 text-right font-medium">مشتری</th>
                    <th className="px-4 py-3 text-right font-medium">تعداد کالا</th>
                    <th className="px-4 py-3 text-right font-medium">مبلغ (سهم شما)</th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت شما</th>
                    <th className="px-4 py-3 text-right font-medium">واریز</th>
                    <th className="px-4 py-3 text-right font-medium">تاریخ</th>
                    <th className="px-4 py-3 text-center font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((supplierOrder) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const orderData = supplierOrder?.order as any;
                    const orderId =
                      orderData && typeof orderData !== "string"
                        ? orderData._id
                        : supplierOrder?._id || "";
                    const customer =
                      orderData && typeof orderData !== "string"
                        ? orderData.customer
                        : undefined;
                    const createdAt =
                      orderData && typeof orderData !== "string"
                        ? orderData.createdAt
                        : supplierOrder?.createdAt || "";
                    const config = statusConfig[supplierOrder.status];

                    return (
                      <tr
                        key={supplierOrder._id}
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-medium">
                          #{orderId.slice(-6)}
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">
                              {customer?.name || "نامشخص"}
                            </p>
                            <p
                              className="text-xs text-muted-foreground"
                              dir="ltr"
                            >
                              {customer?.phone || ""}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {supplierOrder.items?.length || 0} عدد
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {formatPrice(supplierOrder.amountOwed || 0)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={config?.variant || "secondary"}
                            className="text-xs"
                          >
                            {config?.label || supplierOrder.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              supplierOrder.isPaidOut ? "success" : "secondary"
                            }
                            className="text-xs"
                          >
                            {supplierOrder.isPaidOut ? "واریز شده" : "در انتظار"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {createdAt
                            ? new Date(createdAt).toLocaleDateString("fa-IR")
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              asChild
                            >
                              <Link
                                href={`/supplier/orders/${supplierOrder._id}`}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && filteredOrders.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            نمایش ۱ تا {filteredOrders.length} از {orders?.length || 0} سفارش
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled>
              قبلی
            </Button>
            <Button variant="outline" size="sm">
              بعدی
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
