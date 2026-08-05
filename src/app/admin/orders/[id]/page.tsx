"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAdminOrder, useUpdateOrderStatus, useRefundOrder } from "@/hooks/use-admin-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ArrowLeft,
  Save,
  Undo2,
  Wallet,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import {
  ORDER_STATUS_CONFIG,
  OrderStatusBadge,
  PaymentStatusBadge,
  type OrderStatusWithRefund,
} from "@/components/orders/order-status-badge";
import { OrderEventTimeline } from "@/components/orders/order-timeline";
import { OrderInvoice } from "@/components/orders/order-invoice";
import type { OrderStatusV2 } from "@/types";

const statusConfig = ORDER_STATUS_CONFIG;

// Valid transitions for each status
const validTransitions: Record<OrderStatusV2, OrderStatusV2[]> = {
  pending_payment: ["processing", "cancelled"],
  processing: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

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
  // Session 57 — optional shipping metadata captured on the shipped transition.
  const [shippingProvider, setShippingProvider] = useState("");
  const [shippingTracking, setShippingTracking] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState("");

  // Current available transitions
  const availableTransitions = useMemo(() => {
    if (!order) return [];
    return validTransitions[order.status as OrderStatusV2] || [];
  }, [order]);

  // Reset form when order changes — render-phase adjustment (the lint-compliant
  // pattern; an effect-based reset would cascade renders).
  const [prevOrderId, setPrevOrderId] = useState<string | undefined>(order?._id);
  if (prevOrderId !== order?._id) {
    setPrevOrderId(order?._id);
    setSelectedStatus("");
    setStatusNote("");
    setShippingProvider("");
    setShippingTracking("");
    setRefundReason("");
    setRefundError("");
  }

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
        shipping:
          selectedStatus === "shipped"
            ? {
                provider: shippingProvider.trim() || undefined,
                trackingCode: shippingTracking.trim() || undefined,
              }
            : undefined,
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

  const CurrentStatusIcon =
    statusConfig[order.status as OrderStatusV2]?.icon || Clock;
  const shipping = order.shipping;
  const hasShippingInfo = Boolean(
    shipping &&
      (shipping.provider || shipping.trackingCode || shipping.shippedAt)
  );

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
            <OrderStatusBadge
              status={order.status as OrderStatusWithRefund}
              className="text-sm"
            />
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
              <OrderInvoice order={order} />
            </CardContent>
          </Card>

          {/* Status Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">تاریخچه وضعیت</CardTitle>
            </CardHeader>
            <CardContent>
              {order.statusHistory && order.statusHistory.length > 0 ? (
                <OrderEventTimeline entries={order.statusHistory} />
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

                {/* Session 57 — optional shipping metadata on the shipped transition */}
                {selectedStatus === "shipped" && (
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        شرکت پست / باربری (اختیاری)
                      </label>
                      <Input
                        value={shippingProvider}
                        onChange={(e) => setShippingProvider(e.target.value)}
                        placeholder="مثلاً تیپاکس، پست پیشتاز..."
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        کد رهگیری (اختیاری)
                      </label>
                      <Input
                        value={shippingTracking}
                        onChange={(e) => setShippingTracking(e.target.value)}
                        placeholder="کد رهگیری مرسوله..."
                        dir="ltr"
                      />
                    </div>
                  </div>
                )}

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
                <PaymentStatusBadge
                  status={order.payment?.status}
                  className="text-xs"
                />
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

          {/* Shipping Info (Session 57) */}
          {hasShippingInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">اطلاعات ارسال</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {shipping?.provider && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      شرکت ارسال
                    </span>
                    <span className="text-sm font-medium">
                      {shipping.provider}
                    </span>
                  </div>
                )}
                {shipping?.trackingCode && (
                  <div>
                    <p className="text-xs text-muted-foreground">کد رهگیری</p>
                    <p className="text-sm font-mono" dir="ltr">
                      {shipping.trackingCode}
                    </p>
                  </div>
                )}
                {shipping?.shippedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      تاریخ ارسال
                    </span>
                    <span className="text-sm font-medium">
                      {new Date(shipping.shippedAt).toLocaleDateString("fa-IR")}
                    </span>
                  </div>
                )}
                {shipping?.deliveredAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      تاریخ تحویل
                    </span>
                    <span className="text-sm font-medium">
                      {new Date(shipping.deliveredAt).toLocaleDateString("fa-IR")}
                    </span>
                  </div>
                )}
                {shipping?.note && (
                  <div>
                    <p className="text-xs text-muted-foreground">یادداشت</p>
                    <p className="text-sm text-muted-foreground">
                      {shipping.note}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
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
