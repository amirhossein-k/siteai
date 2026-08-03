"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import axios from "axios";
import { useCustomerOrder, useCancelOrder } from "@/hooks/use-customer-orders";
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
  Package,
  Truck,
  CheckCircle2,
  Clock,
  Ban,
  ArrowLeft,
  MapPin,
  CreditCard,
  User,
  Phone,
  Building,
  Loader2,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { OrderStatusV2 } from "@/types";

// --- Status Configuration (same as admin for consistency) ---
const statusConfig: Record<
  OrderStatusV2,
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
};

const paymentLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }> = {
  paid: { label: "پرداخت شده", variant: "success" },
  pending: { label: "در انتظار", variant: "warning" },
  failed: { label: "ناموفق", variant: "destructive" },
  canceled: { label: "لغو شده", variant: "destructive" },
  refunded: { label: "مسترد شده", variant: "secondary" },
};

/**
 * Payment can be retried when the order is still awaiting payment and the
 * payment is not in a terminal success/refund state.
 */
function canRetryPayment(order: {
  status: string;
  payment?: { status?: string; method?: string };
}): boolean {
  return (
    order.status === "pending_payment" &&
    order.payment?.method === "zarinpal" &&
    ["pending", "failed", "canceled"].includes(
      order.payment?.status || ""
    )
  );
}

/**
 * Customer self-service cancellation (Session 46) is available ONLY while the
 * order is awaiting payment — matches the server's atomic claim exactly
 * (status pending_payment + payment.status pending).
 */
function canCancelOrder(order: {
  status: string;
  payment?: { status?: string };
}): boolean {
  return (
    order.status === "pending_payment" && order.payment?.status === "pending"
  );
}

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

const statusOrder: OrderStatusV2[] = [
  "pending_payment",
  "processing",
  "confirmed",
  "shipped",
  "delivered",
];

export default function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { data: order, isLoading, isError, refetch } = useCustomerOrder(id);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelOrder = useCancelOrder();

  const handleRetryPayment = async () => {
    if (!order) return;
    setIsRetrying(true);
    try {
      const { data } = await axios.post("/api/payment/retry", {
        orderId: order._id,
      });
      showToast.success("در حال انتقال به درگاه پرداخت...");
      window.location.href = data.paymentUrl;
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در پرداخت مجدد"
          : "خطا در پرداخت مجدد";
      showToast.error(message);
      setIsRetrying(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    setIsCancelling(true);
    try {
      await cancelOrder.mutateAsync(order._id);
      showToast.success("سفارش با موفقیت لغو شد");
      setShowCancelConfirm(false);
      refetch();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در لغو سفارش"
          : "خطا در لغو سفارش";
      showToast.error(message);
      setIsCancelling(false);
      setShowCancelConfirm(false);
    }
  };

  // Compute timeline: show all steps up to and including current + cancelled if applicable
  const timelineEntries = useMemo(() => {
    if (!order) return [];
    const currentStatus = order.status as OrderStatusV2;

    if (currentStatus === "cancelled") {
      // Show the path before cancellation and then cancelled
      const cancelledIndex = order.statusHistory?.findIndex(
        (h) => h.status === "cancelled"
      );
      const lastGoodStatus =
        cancelledIndex && cancelledIndex > 0
          ? (order.statusHistory![cancelledIndex - 1].status as OrderStatusV2)
          : statusOrder[0];

      const steps: OrderStatusV2[] = [];
      for (const s of statusOrder) {
        steps.push(s);
        if (s === lastGoodStatus) break;
      }
      steps.push("cancelled");
      return steps;
    }

    const idx = statusOrder.indexOf(currentStatus);
    if (idx === -1) return [currentStatus];
    return statusOrder.slice(0, idx + 1);
  }, [order]);

  // --- Not logged in ---
  if (!session) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 text-center">
        <p className="text-muted-foreground">لطفاً وارد حساب خود شوید</p>
        <Button className="mt-4" onClick={() => router.push("/login")}>
          ورود
        </Button>
      </div>
    );
  }

  // --- Loading State ---
  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <Skeleton className="mb-4 h-8 w-48" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // --- Error State ---
  if (isError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/orders" className="transition-colors hover:text-foreground">
            سفارشات من
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
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/orders" className="transition-colors hover:text-foreground">
            سفارشات من
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/orders" className="transition-colors hover:text-foreground">
          سفارشات من
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">
          سفارش #{order._id.slice(-8)}
        </span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              سفارش #{order._id.slice(-8)}
            </h1>
            <Badge
              variant={statusConfig[order.status as OrderStatusV2]?.variant}
              className="text-sm"
            >
              {statusConfig[order.status as OrderStatusV2]?.label}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            ثبت شده در{" "}
            {new Date(order.createdAt).toLocaleDateString("fa-IR", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="ml-2 h-4 w-4" />
          بازگشت
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Items + Timeline */}
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
                      <th className="px-4 py-3 text-right font-medium">قیمت واحد</th>
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
                        <td className="px-4 py-3">
                          {formatPrice(item.price)}
                        </td>
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
                          <td
                            colSpan={3}
                            className="px-4 py-2 text-left text-muted-foreground"
                          >
                            جمع جزء
                          </td>
                          <td className="px-4 py-2 text-left font-medium">
                            {formatPrice(order.subtotalAmount)}
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan={3}
                            className="px-4 py-2 text-left text-emerald-600"
                          >
                            تخفیف ({order.discount.code})
                          </td>
                          <td className="px-4 py-2 text-left font-medium text-emerald-600">
                            −{formatPrice(order.discount.amount)}
                          </td>
                        </tr>
                      </>
                    ) : null}
                    <tr className="border-t-2">
                      <td
                        colSpan={3}
                        className="px-4 py-3 text-left font-bold"
                      >
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
              <CardTitle className="text-lg">وضعیت سفارش</CardTitle>
              <CardDescription>
                مراحل پردازش و ارسال سفارش
              </CardDescription>
            </CardHeader>
            <CardContent>
              {timelineEntries.length > 0 ? (
                <div className="space-y-0">
                  {timelineEntries.map((status, idx) => {
                    const config = statusConfig[status];
                    const Icon = config?.icon || Clock;
                    const isLast = idx === timelineEntries.length - 1;
                    const isCancelled = status === "cancelled";

                    // Find the actual timestamp from statusHistory if available
                    const historyEntry = order.statusHistory?.find(
                      (h) => h.status === status
                    );
                    const timestamp = historyEntry?.at;

                    return (
                      <div
                        key={status}
                        className="relative flex gap-4 pb-6 last:pb-0"
                      >
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
                          <div
                            className={`flex items-center gap-2 ${
                              isCancelled ? "text-destructive" : ""
                            }`}
                          >
                            <span className="font-medium text-sm">
                              {config?.label || status}
                            </span>
                            {timestamp && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(timestamp).toLocaleDateString(
                                  "fa-IR",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </span>
                            )}
                          </div>
                          {statusNoteLabel(historyEntry?.note) && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {statusNoteLabel(historyEntry?.note)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  اطلاعات وضعیت در دسترس نیست
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Info Cards */}
        <div className="space-y-6">
          {/* Current Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">وضعیت فعلی</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`flex items-center gap-3 rounded-lg p-4 ${
                  statusConfig[order.status as OrderStatusV2]?.color
                }`}
              >
                <CurrentStatusIcon className="h-6 w-6 shrink-0" />
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

          {/* Payment Info */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">پرداخت</CardTitle>
              </div>
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
                    : order.payment?.method === "manual"
                    ? "پرداخت نقدی"
                    : "—"}
                </span>
              </div>
              {order.payment?.refId && (
                <div>
                  <p className="text-xs text-muted-foreground">کد تراکنش</p>
                  <p className="text-sm font-mono">{order.payment.refId}</p>
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">مبلغ کل</span>
                <span className="text-sm font-bold">
                  {formatPrice(order.totalAmount)}
                </span>
              </div>

              {/* Retry payment (only when payment can be retried) */}
              {canRetryPayment(order) && (
                <Button
                  className="w-full gap-2"
                  onClick={handleRetryPayment}
                  disabled={isRetrying}
                >
                  {isRetrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  پرداخت مجدد
                </Button>
              )}

              {/* Self-service cancel (only while awaiting payment) */}
              {canCancelOrder(order) && (
                <div className="border-t pt-3">
                  {!showCancelConfirm ? (
                    <Button
                      variant="destructive"
                      className="w-full gap-2"
                      onClick={() => setShowCancelConfirm(true)}
                    >
                      <Ban className="h-4 w-4" />
                      لغو سفارش
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                      <p className="mb-3 text-sm text-destructive">
                        آیا از لغو این سفارش مطمئن هستید؟ موجودی به انبار
                        برگردانده می‌شود و سفارش قابل پرداخت نیست.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          className="flex-1"
                          onClick={handleCancelOrder}
                          disabled={isCancelling}
                        >
                          {isCancelling ? (
                            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                          ) : null}
                          تأیید لغو
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => setShowCancelConfirm(false)}
                          disabled={isCancelling}
                        >
                          انصراف
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shipping Address */}
          {order.shippingAddress && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">آدرس تحویل</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.shippingAddress.fullName && (
                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">گیرنده</p>
                      <p className="font-medium">
                        {order.shippingAddress.fullName}
                      </p>
                    </div>
                  </div>
                )}
                {order.shippingAddress.phone && (
                  <div className="flex items-start gap-2">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">تلفن</p>
                      <p className="font-medium" dir="ltr">
                        {order.shippingAddress.phone}
                      </p>
                    </div>
                  </div>
                )}
                {order.shippingAddress.address && (
                  <div>
                    <p className="text-xs text-muted-foreground">آدرس</p>
                    <p className="text-sm">{order.shippingAddress.address}</p>
                  </div>
                )}
                {order.shippingAddress.postalCode && (
                  <div className="flex items-start gap-2">
                    <Building className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">کد پستی</p>
                      <p className="font-mono text-sm">
                        {order.shippingAddress.postalCode}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Navigation Back */}
          <Button variant="outline" className="w-full" asChild>
            <Link href="/orders">
              <ArrowLeft className="ml-2 h-4 w-4" />
              بازگشت به لیست سفارشات
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
