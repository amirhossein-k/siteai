"use client";

import { use, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAdminOrder, useUpdateOrderStatus, useRefundOrder } from "@/hooks/use-admin-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Package,
  Truck,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  ArrowLeft,
  Save,
  Undo2,
  Wallet,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { OrderStatusV2 } from "@/types";

// --- Status Configuration ---

const statusConfig: Record<
  OrderStatusV2 | "refunded",
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning";
    icon: React.ElementType;
    color: string;
  }
> = {
  pending_payment: {
    label: "در انتظار پرداخت",
    variant: "secondary",
    icon: Clock,
    color: "text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
  },
  processing: {
    label: "در حال پردازش",
    variant: "warning",
    icon: Package,
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
  },
  confirmed: {
    label: "تأیید شده",
    variant: "default",
    icon: CheckCircle2,
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300",
  },
  shipped: {
    label: "ارسال شده",
    variant: "default",
    icon: Truck,
    color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300",
  },
  delivered: {
    label: "تحویل شده",
    variant: "success",
    icon: CheckCircle2,
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
  },
  cancelled: {
    label: "لغو شده",
    variant: "destructive",
    icon: Ban,
    color: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300",
  },
  refunded: {
    label: "بازپرداخت شده",
    variant: "secondary",
    icon: Undo2,
    color: "text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-300",
  },
};

// Valid transitions for each status
const validTransitions: Record<OrderStatusV2, OrderStatusV2[]> = {
  pending_payment: ["processing", "cancelled"],
  processing: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const paymentLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }> = {
  paid: { label: "پرداخت شده", variant: "success" },
  pending: { label: "در انتظار", variant: "warning" },
  failed: { label: "ناموفق", variant: "destructive" },
  canceled: { label: "لغو شده", variant: "destructive" },
  refunded: { label: "بازپرداخت شده", variant: "secondary" },
};

/**
 * statusHistory notes are machine-readable audit keys (Session 46) — map
 * known keys to Persian labels for display; passthrough for human-entered
 * notes (admin writes Persian/empty notes today).
 */
const statusNoteLabels: Record<string, string> = {
  customer_cancelled: "لغو توسط مشتری",
};
function statusNoteLabel(note?: string): string | undefined {
  if (!note) return undefined;
  return statusNoteLabels[note] || note;
}

// --- Page Component ---

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: order, isLoading, isError, refetch } = useAdminOrder(id);
  const updateStatus = useUpdateOrderStatus();
  const refundOrder = useRefundOrder();

  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [statusNote, setStatusNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState("");

  // Current available transitions
  const availableTransitions = useMemo(() => {
    if (!order) return [];
    return validTransitions[order.status as OrderStatusV2] || [];
  }, [order]);

  // Reset form when order changes
  useEffect(() => {
    setSelectedStatus("");
    setStatusNote("");
    setRefundReason("");
    setRefundError("");
  }, [order?._id]);

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      setRefundError("لطفاً دلیل بازپرداخت را وارد کنید");
      return;
    }
    setRefundError("");
    try {
      await refundOrder.mutateAsync({
        orderId: id,
        reason: refundReason.trim(),
      });
      showToast.success("سفارش با موفقیت بازپرداخت شد");
      setShowRefundModal(false);
      setRefundReason("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در بازپرداخت سفارش"
          : "خطا در بازپرداخت سفارش";
      setRefundError(message);
    }
  };

  const handleStatusChange = async () => {
    if (!selectedStatus) return;

    setIsSubmitting(true);
    try {
      await updateStatus.mutateAsync({
        id,
        status: selectedStatus,
        note: statusNote,
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
          <Link href="/admin/orders" className="transition-colors hover:text-foreground">
            سفارشات
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">جزئیات سفارش</span>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">خطا در دریافت اطلاعات سفارش</p>
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
  if (!order) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/admin/orders" className="transition-colors hover:text-foreground">
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

  const CurrentStatusIcon = statusConfig[order.status as OrderStatusV2]?.icon || Clock;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/orders" className="transition-colors hover:text-foreground">
          سفارشات
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">جزئیات سفارش #{order._id.slice(-6)}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              سفارش #{order._id.slice(-6)}
            </h1>
            <Badge
              variant={statusConfig[order.status as OrderStatusV2]?.variant}
              className="text-sm"
            >
              {statusConfig[order.status as OrderStatusV2]?.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            ثبت شده در {new Date(order.createdAt).toLocaleDateString("fa-IR")}
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="ml-2 h-4 w-4" />
          بازگشت
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Order Info + Items */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">محصولات سفارش</CardTitle>
              <CardDescription>
                {order.items?.length || 0} قلم کالا
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-4 py-3 text-right font-medium">محصول</th>
                      <th className="px-4 py-3 text-right font-medium">قیت واحد</th>
                      <th className="px-4 py-3 text-right font-medium">تعداد</th>
                      <th className="px-4 py-3 text-left font-medium">جمع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items || []).map((item, idx) => (
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
                        <td className="px-4 py-3">{formatPrice(item.price)}</td>
                        <td className="px-4 py-3">{item.quantity}</td>
                        <td className="px-4 py-3 text-left font-medium">
                          {formatPrice(item.price * item.quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {order.subtotalAmount != null && order.discount?.amount ? (
                      <>
                        <tr className="border-t">
                          <td colSpan={3} className="px-4 py-2 text-left text-muted-foreground">
                            جمع جزء
                          </td>
                          <td className="px-4 py-2 text-left font-medium">
                            {formatPrice(order.subtotalAmount)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="px-4 py-2 text-left text-emerald-600">
                            تخفیف ({order.discount.code})
                          </td>
                          <td className="px-4 py-2 text-left font-medium text-emerald-600">
                            −{formatPrice(order.discount.amount)}
                          </td>
                        </tr>
                      </>
                    ) : null}
                    <tr className="border-t-2">
                      <td colSpan={3} className="px-4 py-3 text-left font-bold">
                        جمع کل
                      </td>
                      <td className="px-4 py-3 text-left font-bold text-lg">
                        {formatPrice(order.totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Status Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">تاریخچه وضعیت</CardTitle>
            </CardHeader>
            <CardContent>
              {order.statusHistory && order.statusHistory.length > 0 ? (
                <div className="space-y-0">
                  {order.statusHistory.map((entry, idx) => {
                    const config = statusConfig[entry.status as OrderStatusV2];
                    const Icon = config?.icon || Clock;
                    const isLast = idx === order.statusHistory!.length - 1;
                    return (
                      <div key={idx} className="relative flex gap-4 pb-6 last:pb-0">
                        {/* Timeline line */}
                        {!isLast && (
                          <div className="absolute right-[15px] top-8 bottom-0 w-px bg-border" />
                        )}
                        {/* Icon circle */}
                        <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config?.color || "bg-muted"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        {/* Content */}
                        <div className="flex-1 pt-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {config?.label || entry.status}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(entry.at).toLocaleDateString("fa-IR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          {statusNoteLabel(entry.note) && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {statusNoteLabel(entry.note)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  تاریخچه‌ای ثبت نشده است
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Info + Actions */}
        <div className="space-y-6">
          {/* Current Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">وضعیت فعلی</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`flex items-center gap-3 rounded-lg p-4 ${statusConfig[order.status as OrderStatusV2]?.color}`}>
                <CurrentStatusIcon className="h-6 w-6" />
                <div>
                  <p className="font-medium">
                    {statusConfig[order.status as OrderStatusV2]?.label}
                  </p>
                  <p className="text-xs opacity-75">
                    آخرین بروزرسانی:{" "}
                    {order.updatedAt
                      ? new Date(order.updatedAt).toLocaleDateString("fa-IR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </p>
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
                  وضعیت سفارش را به مرحله بعد منتقل کنید
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
                  <label className="text-sm font-medium">یادداشت (اختیاری)</label>
                  <textarea
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="دلیل تغییر وضعیت..."
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
              </CardContent>
            </Card>
          )}

          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">اطلاعات مشتری</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">نام</p>
                <p className="font-medium">{order.customer?.name || "نامشخص"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">شماره موبایل</p>
                <p className="font-medium" dir="ltr">
                  {order.customer?.phone || "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Payment Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">پرداخت</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">وضعیت</span>
                <Badge
                  variant={
                    paymentLabels[order.payment?.status]?.variant || "secondary"
                  }
                  className="text-xs"
                >
                  {paymentLabels[order.payment?.status]?.label ||
                    order.payment?.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">روش</span>
                <span className="text-sm font-medium">
                  {order.payment?.method === "zarinpal"
                    ? "درگاه زرین‌پال"
                    : order.payment?.method || "—"}
                </span>
              </div>
              {order.payment?.refId && (
                <div>
                  <p className="text-xs text-muted-foreground">کد تراکنش</p>
                  <p className="text-sm font-mono">{order.payment.refId}</p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">مبلغ</span>
                <span className="text-sm font-bold">
                  {formatPrice(order.totalAmount)}
                </span>
              </div>

              {/* Refund metadata (only when refunded) */}
              {order.payment?.status === "refunded" && order.refund && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      تاریخ بازپرداخت
                    </span>
                    <span className="text-sm font-medium">
                      {order.refund.refundedAt
                        ? new Date(order.refund.refundedAt).toLocaleDateString(
                            "fa-IR"
                          )
                        : "—"}
                    </span>
                  </div>
                  {order.refund.reason && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        دلیل بازپرداخت
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {order.refund.reason}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Refund button — only for paid orders */}
              {order.payment?.status === "paid" && (
                <Button
                  className="w-full gap-2"
                  variant="outline"
                  onClick={() => setShowRefundModal(true)}
                >
                  <Undo2 className="h-4 w-4" />
                  بازپرداخت سفارش
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Refund Confirmation Modal */}
          {showRefundModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={() => {
                if (!refundOrder.isPending) setShowRefundModal(false);
              }}
            >
              <div
                className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">بازپرداخت سفارش</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      موجودی اقلام سفارش به انبار بازگردانده می‌شود.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    دلیل بازپرداخت <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="دلیل بازپرداخت را وارد کنید..."
                  />
                  {refundError && (
                    <p className="text-xs text-destructive">{refundError}</p>
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setShowRefundModal(false)}
                    disabled={refundOrder.isPending}
                  >
                    انصراف
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleRefund}
                    disabled={!refundReason.trim() || refundOrder.isPending}
                    loading={refundOrder.isPending}
                  >
                    {refundOrder.isPending
                      ? "در حال بازپرداخت..."
                      : "تأیید بازپرداخت"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Shipping Address */}
          {order.shippingAddress && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">آدرس تحویل</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.shippingAddress.fullName && (
                  <div>
                    <p className="text-xs text-muted-foreground">گیرنده</p>
                    <p className="font-medium">
                      {order.shippingAddress.fullName}
                    </p>
                  </div>
                )}
                {order.shippingAddress.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground">تلفن</p>
                    <p className="font-medium" dir="ltr">
                      {order.shippingAddress.phone}
                    </p>
                  </div>
                )}
                {order.shippingAddress.address && (
                  <div>
                    <p className="text-xs text-muted-foreground">آدرس</p>
                    <p className="text-sm">{order.shippingAddress.address}</p>
                  </div>
                )}
                {order.shippingAddress.postalCode && (
                  <div>
                    <p className="text-xs text-muted-foreground">کد پستی</p>
                    <p className="font-mono text-sm">
                      {order.shippingAddress.postalCode}
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
