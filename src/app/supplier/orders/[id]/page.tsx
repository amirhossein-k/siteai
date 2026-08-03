"use client";

import { use, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useSupplierOrder,
  useUpdateSupplierOrderStatus,
} from "@/hooks/use-supplier-orders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  Ban,
  ArrowLeft,
  Save,
  Package,
  ShoppingCart,
  DollarSign,
  User,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { SupplierOrderItemStatus } from "@/types";

// --- Status Configuration ---

const statusConfig: Record<
  SupplierOrderItemStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning";
    icon: React.ElementType;
    color: string;
    description: string;
  }
> = {
  pending: {
    label: "در انتظار تأیید",
    variant: "secondary",
    icon: Clock,
    color: "text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
    description: "منتظر تأیید موجودی توسط شما",
  },
  confirmed: {
    label: "تأیید شده",
    variant: "default",
    icon: CheckCircle2,
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300",
    description: "موجودی تأیید شده، آماده ارسال",
  },
  rejected: {
    label: "رد شده",
    variant: "destructive",
    icon: XCircle,
    color: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300",
    description: "عدم تأیید موجودی",
  },
  shipped: {
    label: "ارسال شده",
    variant: "warning",
    icon: Truck,
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
    description: "محصولات ارسال شده‌اند",
  },
  delivered: {
    label: "تحویل داده شده",
    variant: "success",
    icon: CheckCircle2,
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
    description: "محصولات تحویل مشتری شده‌اند",
  },
};

// Valid transitions for supplier
const validTransitions: Record<SupplierOrderItemStatus, SupplierOrderItemStatus[]> = {
  pending: ["confirmed", "rejected"],
  confirmed: ["shipped"],
  rejected: [],
  shipped: ["delivered"],
  delivered: [],
};

const paymentLabels: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  paid: { label: "پرداخت شده", variant: "success" },
  pending: { label: "در انتظار", variant: "warning" },
  failed: { label: "ناموفق", variant: "destructive" },
};

// --- Page Component ---

export default function SupplierOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: supplierOrder, isLoading, isError, refetch } = useSupplierOrder(id);
  const updateStatus = useUpdateSupplierOrderStatus();

  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [statusNote, setStatusNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Available transitions for current status
  const availableTransitions = useMemo(() => {
    if (!supplierOrder) return [];
    return validTransitions[supplierOrder.status] || [];
  }, [supplierOrder]);

  // Reset form when order changes
  useEffect(() => {
    setSelectedStatus("");
    setStatusNote("");
  }, [supplierOrder?._id]);

  const handleStatusChange = async () => {
    if (!selectedStatus) return;
    await doStatusChange(selectedStatus, statusNote);
  };

  const doStatusChange = async (status: string, note?: string) => {
    setIsSubmitting(true);
    try {
      await updateStatus.mutateAsync({
        id,
        status,
        note: note || "",
      });
      showToast.success("وضعیت سفارش با موفقیت بروزرسانی شد");
      setSelectedStatus("");
      setStatusNote("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در بروزرسانی وضعیت"
          : "خطا در بروزرسانی وضعیت";
      showToast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Extract order details from populated data
  const orderDetails = useMemo(() => {
    if (!supplierOrder) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderData = supplierOrder.order as any;
    if (!orderData || typeof orderData === "string") return null;
    return orderData as {
      _id: string;
      customer: { _id: string; name: string; phone: string };
      totalAmount: number;
      shippingAddress?: {
        fullName?: string;
        phone?: string;
        address?: string;
        postalCode?: string;
      };
      payment: {
        status: string;
        method?: string;
        refId?: string;
        paidAt?: string | null;
      };
      status: string;
      createdAt: string;
      updatedAt: string;
    };
  }, [supplierOrder]);

  // --- Loading State ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // --- Error State ---
  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            href="/supplier/orders"
            className="transition-colors hover:text-foreground"
          >
            سفارشات
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">جزئیات سفارش</span>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات سفارش
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

  // --- Not Found State ---
  if (!supplierOrder) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            href="/supplier/orders"
            className="transition-colors hover:text-foreground"
          >
            سفارشات
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">جزئیات سفارش</span>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            سفارش مورد نظر یافت نشد
          </CardContent>
        </Card>
      </div>
    );
  }

  const config = statusConfig[supplierOrder.status];
  const StatusIcon = config?.icon || Clock;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/supplier/orders"
          className="transition-colors hover:text-foreground"
        >
          سفارشات
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">
          جزئیات سفارش #{supplierOrder._id.slice(-6)}
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              جزئیات سفارش #{supplierOrder._id.slice(-6)}
            </h1>
            <Badge variant={config?.variant || "secondary"} className="text-sm">
              {config?.label || supplierOrder.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            ثبت شده در{" "}
            {supplierOrder.createdAt
              ? new Date(supplierOrder.createdAt).toLocaleDateString("fa-IR")
              : "—"}
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="ml-2 h-4 w-4" />
          بازگشت
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Items + Main Order Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items (Supplier's Items Only) */}
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader className="bg-emerald-50 dark:bg-emerald-950/50 rounded-t-lg">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-emerald-600" />
                <CardTitle className="text-lg">محصولات شما در این سفارش</CardTitle>
              </div>
              <CardDescription>
                {supplierOrder.items?.length || 0} قلم کالا
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-4 py-3 text-right font-medium">
                        محصول
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        قیمت تأمین
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        تعداد
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        جمع (سهم شما)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(supplierOrder.items || []).map((item, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                className="h-10 w-10 shrink-0 rounded-md border object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                <Package className="h-4 w-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium">{item.name}</p>
                              {item.variantLabel && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {item.variantLabel}
                                </p>
                              )}
                              {item.sku && (
                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5" dir="ltr">
                                  SKU: {item.sku}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {formatPrice(item.supplierPrice)}
                        </td>
                        <td className="px-4 py-3">{item.quantity}</td>
                        <td className="px-4 py-3 text-left font-medium">
                          {formatPrice(item.supplierPrice * item.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-emerald-200 dark:border-emerald-800">
                      <td
                        colSpan={3}
                        className="px-4 py-3 text-left font-bold"
                      >
                        جمع کل (سهم شما)
                      </td>
                      <td className="px-4 py-3 text-left font-bold text-lg text-emerald-600">
                        {formatPrice(supplierOrder.amountOwed || 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Main Order Info */}
          {orderDetails && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">
                    سفارش اصلی #{orderDetails._id.slice(-6)}
                  </CardTitle>
                </div>
                <CardDescription>
                  اطلاعات کلی سفارش مشتری
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">مشتری</p>
                      <p className="font-medium">
                        {orderDetails.customer?.name || "نامشخص"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    <DollarSign className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        مبلغ کل سفارش
                      </p>
                      <p className="font-medium">
                        {formatPrice(orderDetails.totalAmount)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Payment Info */}
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      وضعیت پرداخت
                    </span>
                    <Badge
                      variant={
                        paymentLabels[orderDetails.payment?.status]?.variant ||
                        "secondary"
                      }
                      className="text-xs"
                    >
                      {paymentLabels[orderDetails.payment?.status]?.label ||
                        orderDetails.payment?.status}
                    </Badge>
                  </div>
                  {orderDetails.payment?.refId && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground">
                        کد تراکنش
                      </p>
                      <p className="text-sm font-mono">
                        {orderDetails.payment.refId}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Status Timeline */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">
                  تاریخچه وضعیت (سهم شما)
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {/* Build timeline from timestamps only (no duplication with current status card) */}
                {/* Show the initial pending creation */}
                <TimelineItem
                  status="pending"
                  date={supplierOrder.createdAt}
                  note={null}
                  isLast={!supplierOrder.confirmedAt && !supplierOrder.shippedAt && supplierOrder.status === "pending"}
                />
                {/* Confirmed */}
                {supplierOrder.confirmedAt && (
                  <TimelineItem
                    status="confirmed"
                    date={supplierOrder.confirmedAt}
                    note={null}
                    isLast={!supplierOrder.shippedAt && !supplierOrder.deliveredAt && (supplierOrder.status === "confirmed" || supplierOrder.status === "rejected")}
                  />
                )}
                {/* Shipped */}
                {supplierOrder.shippedAt && (
                  <TimelineItem
                    status="shipped"
                    date={supplierOrder.shippedAt}
                    note={null}
                    isLast={!supplierOrder.deliveredAt && supplierOrder.status === "shipped"}
                  />
                )}
                {/* Delivered */}
                {supplierOrder.deliveredAt && (
                  <TimelineItem
                    status="delivered"
                    date={supplierOrder.deliveredAt}
                    note={null}
                    isLast={true}
                  />
                )}
                {/* Rejected (show if rejected with no other progress) */}
                {supplierOrder.status === "rejected" && !supplierOrder.confirmedAt && (
                  <TimelineItem
                    status="rejected"
                    date={supplierOrder.updatedAt || supplierOrder.createdAt}
                    note={null}
                    isLast={true}
                  />
                )}
                {/* Pending waiting message */}
                {supplierOrder.status === "pending" && !supplierOrder.confirmedAt && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    در انتظار تأیید توسط شما
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Actions + Info */}
        <div className="space-y-6">
          {/* Current Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">وضعیت فعلی</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`flex items-center gap-3 rounded-lg p-4 ${config?.color}`}
              >
                <StatusIcon className="h-6 w-6" />
                <div>
                  <p className="font-medium">
                    {config?.label || supplierOrder.status}
                  </p>
                  <p className="text-xs opacity-75">{config?.description}</p>
                </div>
              </div>

              {/* Payout Info */}
              <div className="mt-4 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    وضعیت واریز
                  </span>
                  <Badge
                    variant={supplierOrder.isPaidOut ? "success" : "secondary"}
                    className="text-xs"
                  >
                    {supplierOrder.isPaidOut ? "واریز شده" : "در انتظار"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    مبلغ قابل دریافت
                  </span>
                  <span className="text-sm font-bold text-emerald-600">
                    {formatPrice(supplierOrder.amountOwed || 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Change Status */}
          {availableTransitions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">تغییر وضعیت</CardTitle>
                <CardDescription>
                  وضعیت محصولات خود در این سفارش را تعیین کنید
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">وضعیت جدید</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">انتخاب وضعیت...</option>
                    {availableTransitions.map((s) => (
                      <option key={s} value={s}>
                        {statusConfig[s]?.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    یادداشت (اختیاری)
                  </label>
                  <textarea
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder={
                      selectedStatus === "rejected"
                        ? "دلیل رد سفارش..."
                        : selectedStatus === "confirmed"
                        ? "تأیید موجودی..."
                        : "توضیحات..."
                    }
                  />
                </div>

                <Button
                  className="w-full gap-2"
                  onClick={handleStatusChange}
                  disabled={!selectedStatus}
                  loading={isSubmitting}
                >
                  <Save className="h-4 w-4" />
                  {isSubmitting ? "در حال ذخیره..." : "ذخیره تغییر وضعیت"}
                </Button>

                {/* Quick action buttons for common transitions */}
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    اقدام سریع:
                  </p>
                  <div className="flex gap-2">
                    {availableTransitions.includes("confirmed") && (
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1 gap-1 text-xs"
                        onClick={() => doStatusChange("confirmed")}
                        disabled={isSubmitting}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        تأیید
                      </Button>
                    )}
                    {availableTransitions.includes("rejected") && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1 gap-1 text-xs"
                        onClick={() => doStatusChange("rejected", "عدم موجودی کافی")}
                        disabled={isSubmitting}
                      >
                        <XCircle className="h-3 w-3" />
                        رد
                      </Button>
                    )}
                    {availableTransitions.includes("shipped") && (
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => doStatusChange("shipped")}
                        disabled={isSubmitting}
                      >
                        <Truck className="h-3 w-3" />
                        ارسال
                      </Button>
                    )}
                    {availableTransitions.includes("delivered") && (
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => doStatusChange("delivered")}
                        disabled={isSubmitting}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        تحویل
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Customer Info */}
          {orderDetails?.customer && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">اطلاعات مشتری</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">نام</p>
                  <p className="font-medium">
                    {orderDetails.customer.name || "نامشخص"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">شماره موبایل</p>
                  <p className="font-medium" dir="ltr">
                    {orderDetails.customer.phone || "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Shipping Address */}
          {orderDetails?.shippingAddress && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">آدرس تحویل</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {orderDetails.shippingAddress.fullName && (
                  <div>
                    <p className="text-xs text-muted-foreground">گیرنده</p>
                    <p className="font-medium">
                      {orderDetails.shippingAddress.fullName}
                    </p>
                  </div>
                )}
                {orderDetails.shippingAddress.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground">تلفن</p>
                    <p className="font-medium" dir="ltr">
                      {orderDetails.shippingAddress.phone}
                    </p>
                  </div>
                )}
                {orderDetails.shippingAddress.address && (
                  <div>
                    <p className="text-xs text-muted-foreground">آدرس</p>
                    <p className="text-sm">
                      {orderDetails.shippingAddress.address}
                    </p>
                  </div>
                )}
                {orderDetails.shippingAddress.postalCode && (
                  <div>
                    <p className="text-xs text-muted-foreground">کد پستی</p>
                    <p className="font-mono text-sm">
                      {orderDetails.shippingAddress.postalCode}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Timeline Item Sub-component ---

function TimelineItem({
  status,
  date,
  note,
  isLast,
}: {
  status: string;
  date: string | Date | null | undefined;
  note: string | null;
  isLast: boolean;
}) {
  const config = statusConfig[status as SupplierOrderItemStatus];
  const Icon = config?.icon || Clock;

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute right-[15px] top-8 bottom-0 w-px bg-border" />
      )}
      {/* Icon circle */}
      <div
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          config?.color || "bg-muted"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      {/* Content */}
      <div className="flex-1 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {config?.label || status}
          </span>
          <span className="text-xs text-muted-foreground">
            {date
              ? new Date(date).toLocaleDateString("fa-IR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}
          </span>
        </div>
        {note && (
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        )}
      </div>
    </div>
  );
}
