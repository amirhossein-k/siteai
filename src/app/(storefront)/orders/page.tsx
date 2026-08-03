"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  PackageOpen,
  Search,
  AlertCircle,
  RefreshCw,
  Clock,
  Package,
  CheckCircle2,
  Truck,
  Ban,
  ChevronRight,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import { useCustomerOrders } from "@/hooks/use-customer-orders";
import { formatPrice } from "@/lib/utils";
import type { OrderStatusV2 } from "@/types";

// --- Status Config (same as admin for consistency) ---
const statusConfig: Record<
  OrderStatusV2,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning"; icon: React.ElementType; color: string }
> = {
  pending_payment: { label: "در انتظار پرداخت", variant: "secondary", icon: Clock, color: "text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400" },
  processing: { label: "در حال پردازش", variant: "warning", icon: Package, color: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300" },
  confirmed: { label: "تأیید شده", variant: "default", icon: CheckCircle2, color: "text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300" },
  shipped: { label: "ارسال شده", variant: "default", icon: Truck, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300" },
  delivered: { label: "تحویل شده", variant: "success", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300" },
  cancelled: { label: "لغو شده", variant: "destructive", icon: Ban, color: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300" },
};

const statusFilters = [
  { value: null, label: "همه" },
  { value: "pending_payment", label: "در انتظار پرداخت" },
  { value: "processing", label: "در حال پردازش" },
  { value: "shipped", label: "ارسال شده" },
  { value: "delivered", label: "تحویل شده" },
  { value: "cancelled", label: "لغو شده" },
] as const;

const paymentLabels: Record<string, string> = {
  paid: "پرداخت شده",
  pending: "در انتظار",
  failed: "ناموفق",
};

export default function CustomerOrdersPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = useCustomerOrders({
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

  // Filtered list = server response (search + status handled server-side)
  const filteredOrders = orders;

  // --- Not logged in ---
  if (!session) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <PackageOpen className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">سفارشات من</h1>
          <p className="mb-8 text-muted-foreground">
            برای مشاهده سفارشات خود وارد حساب کاربری شوید
          </p>
          <Button size="lg" onClick={() => router.push("/login?callbackUrl=/orders")}>
            ورود به حساب
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          صفحه اصلی
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">سفارشات من</span>
      </nav>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">سفارشات من</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isLoading ? "..." : `${totalOrders} سفارش`}
        </p>
      </div>

      {/* Search & Filters */}
      <div className="mb-6 space-y-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجوی سفارش..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((filter) => (
            <Button
              key={filter.label}
              variant={statusFilter === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
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
      ) : filteredOrders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <PackageOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">
              {searchQuery || statusFilter
                ? "سفارشی یافت نشد"
                : "هنوز سفارشی ثبت نکرده‌اید"}
            </h3>
            <p className="mb-6 text-sm text-muted-foreground">
              {searchQuery || statusFilter
                ? "هیچ سفارشی با فیلترهای انتخاب شده یافت نشد"
                : "برای ثبت اولین سفارش، به صفحه محصولات مراجعه کنید"}
            </p>
            {!searchQuery && !statusFilter ? (
              <Button asChild>
                <Link href="/products">
                  <ShoppingBag className="ml-2 h-4 w-4" />
                  مشاهده محصولات
                </Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => { setSearchQuery(""); setStatusFilter(null); }}>
                پاک کردن فیلترها
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const config = statusConfig[order.status as OrderStatusV2];
            const StatusIcon = config?.icon || Clock;
            const itemCount = order.items?.length || 0;

            return (
              <Link key={order._id} href={`/orders/${order._id}`}>
                <Card className="transition-all hover:shadow-md hover:border-primary/30 cursor-pointer">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Order info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${config?.color || "bg-muted"}`}>
                            <StatusIcon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              سفارش #{order._id.slice(-8)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(order.createdAt).toLocaleDateString("fa-IR", {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{itemCount} کالا</span>
                          {order.shippingAddress?.address && (
                            <span className="hidden sm:inline truncate max-w-[200px]">
                              {order.shippingAddress.address}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Price + Status */}
                      <div className="text-left shrink-0">
                        <p className="font-bold text-emerald-600 text-sm whitespace-nowrap">
                          {formatPrice(order.totalAmount)}
                        </p>
                        <Badge
                          variant={config?.variant}
                          className="mt-2 text-xs"
                        >
                          {config?.label}
                        </Badge>
                      </div>

                      {/* Arrow */}
                      <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && orders.length > 0 && (
        <div className="mt-6">
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
