"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import {
  Search,
  Eye,
  AlertCircle,
  RefreshCw,
  PackageOpen,
} from "lucide-react";
import { useAdminOrders } from "@/hooks/use-admin-orders";
import { formatPrice } from "@/lib/utils";
import type { OrderStatusV2 } from "@/types";

const statusConfig: Record<
  OrderStatusV2,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  pending_payment: { label: "در انتظار پرداخت", variant: "secondary" },
  processing: { label: "در حال پردازش", variant: "warning" },
  confirmed: { label: "تأیید شده", variant: "default" },
  shipped: { label: "ارسال شده", variant: "default" },
  delivered: { label: "تحویل شده", variant: "success" },
  cancelled: { label: "لغو شده", variant: "destructive" },
};

const paymentStatusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  paid: { label: "پرداخت شده", variant: "success" },
  pending: { label: "در انتظار", variant: "warning" },
  failed: { label: "ناموفق", variant: "destructive" },
};

const statusFilters = [
  { value: null, label: "همه" },
  { value: "pending_payment", label: "در انتظار پرداخت" },
  { value: "processing", label: "در حال پردازش" },
  { value: "delivered", label: "تحویل شده" },
  { value: "cancelled", label: "لغو شده" },
] as const;

export default function AdminOrders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = useAdminOrders({
    search: searchQuery || undefined,
    status: statusFilter || undefined,
    page,
  });

  const orders = paged?.data || [];
  const totalOrders = paged?.total || 0;
  const totalPages = paged?.totalPages || 1;

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter]);

  // Server-side search (id, customer name/phone) + status filter
  const filteredOrders = orders;

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">سفارشات</h1>
          <p className="text-sm text-muted-foreground">مدیریت و پیگیری سفارشات</p>
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
          مدیریت و پیگیری سفارشات
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
            {isLoading ? "..." : `${totalOrders} سفارش`}
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
                    <th className="px-4 py-3 text-right font-medium">شماره</th>
                    <th className="px-4 py-3 text-right font-medium">مشتری</th>
                    <th className="px-4 py-3 text-right font-medium">محصولات</th>
                    <th className="px-4 py-3 text-right font-medium">مبلغ</th>
                    <th className="px-4 py-3 text-right font-medium">پرداخت</th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                    <th className="px-4 py-3 text-right font-medium">تاریخ</th>
                    <th className="px-4 py-3 text-center font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr
                      key={order._id}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium font-mono text-xs">
                        #{order._id.slice(-6)}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">
                            {order.customer?.name || "نامشخص"}
                          </p>
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            {order.customer?.phone || ""}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {order.items?.length || 0} عدد
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatPrice(order.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            paymentStatusConfig[order.payment?.status]?.variant
                          }
                          className="text-xs"
                        >
                          {paymentStatusConfig[order.payment?.status]?.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={statusConfig[order.status]?.variant}
                          className="text-xs"
                        >
                          {statusConfig[order.status]?.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(order.createdAt).toLocaleDateString("fa-IR")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center">
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <Link href={`/admin/orders/${order._id}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && filteredOrders.length > 0 && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground flex-wrap">
          <p>
            نمایش {filteredOrders.length} سفارش از {totalOrders} سفارش
          </p>
          <PaginationControls
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
