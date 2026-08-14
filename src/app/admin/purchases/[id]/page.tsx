"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Loader2,
  PackageCheck,
  CheckCircle2,
  XCircle,
  Wallet,
  Truck,
  FileText,
} from "lucide-react";
import {
  usePurchaseDetail,
  useOrderPurchase,
  useReceivePurchase,
  usePayPurchase,
  useCancelPurchase,
} from "@/hooks/use-admin-purchases";
import { showToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/utils";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  draft: { label: "پیش‌نویس", variant: "secondary" },
  ordered: { label: "ثبت سفارش", variant: "warning" },
  partially_received: { label: "دریافت جزئی", variant: "warning" },
  received: { label: "دریافت کامل", variant: "success" },
  cancelled: { label: "لغو شده", variant: "destructive" },
};

const PAYMENT_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  unpaid: { label: "پرداخت نشده", variant: "secondary" },
  partial: { label: "پرداخت جزئی", variant: "warning" },
  paid: { label: "پرداخت شده", variant: "success" },
};

const toNum = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError, refetch } = usePurchaseDetail(id);
  const orderPurchase = useOrderPurchase();
  const receivePurchase = useReceivePurchase();
  const payPurchase = usePayPurchase();
  const cancelPurchase = useCancelPurchase();

  const purchase = data?.purchase;

  // Receive drafts — keyed by item id, prefilled with the outstanding quantity.
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  // Client-generated idempotency key per receive operation.
  const [receiveKey, setReceiveKey] = useState("");
  const [receiveError, setReceiveError] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payError, setPayError] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const receiveDraft = useMemo(() => receiveQty, [receiveQty]);

  // Idempotency key: a client-side override when the user edits it, otherwise
  // a fresh key per receive operation (generated in the handler — never during
  // render, which would be impure and break SSR hydration).
  const freshReceiveKey = () =>
    receiveKey || `recv-${id}-${Date.now()}`;

  const handleOrder = async () => {
    if (!purchase) return;
    setBusy(true);
    try {
      await orderPurchase.mutateAsync(purchase.id);
      showToast.success("خرید به وضعیت «ثبت سفارش» تغییر کرد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ثبت سفارش"
          : "خطا در ثبت سفارش";
      showToast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleReceive = async (itemId: string) => {
    if (!purchase) return;
    const requested = toNum(receiveDraft[itemId] ?? "");
    const item = purchase.items.find((it) => it.id === itemId);
    if (!item || requested <= 0) {
      setReceiveError("تعداد دریافت باید عدد صحیح مثبت باشد");
      return;
    }
    if (requested > item.outstanding) {
      setReceiveError(`تعداد بیش از باقیمانده (${item.outstanding.toLocaleString("fa-IR")})`);
      return;
    }
    setReceiveError("");
    setBusy(true);
    try {
      await receivePurchase.mutateAsync({
        id: purchase.id,
        items: [{ itemId, quantity: requested }],
        key: freshReceiveKey(),
      });
      setReceiveKey("");
      showToast.success("دریافت ثبت شد — موجودی و لایه هزینه ایجاد شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ثبت دریافت"
          : "خطا در ثبت دریافت";
      setReceiveError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleReceiveAll = async () => {
    if (!purchase) return;
    const items = purchase.items
      .filter((it) => it.outstanding > 0)
      .map((it) => ({ itemId: it.id, quantity: it.outstanding }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      await receivePurchase.mutateAsync({
        id: purchase.id,
        items,
        key: freshReceiveKey(),
      });
      setReceiveKey("");
      showToast.success("همه اقلام دریافت شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ثبت دریافت"
          : "خطا در ثبت دریافت";
      setReceiveError(message);
    } finally {
      setBusy(false);
    }
  };

  const handlePay = async () => {
    if (!purchase) return;
    const amount = toNum(payAmount);
    if (amount <= 0) {
      setPayError("مبلغ پرداخت باید عدد صحیح مثبت باشد");
      return;
    }
    if (amount > purchase.amountOutstanding) {
      setPayError("مبلغ پرداخت بیش از مانده است");
      return;
    }
    setPayError("");
    setBusy(true);
    try {
      await payPurchase.mutateAsync({ id: purchase.id, amount });
      setPayAmount("");
      showToast.success("پرداخت ثبت شد — این عملیات هرگز موجودی ایجاد نمی‌کند");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ثبت پرداخت"
          : "خطا در ثبت پرداخت";
      setPayError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!purchase) return;
    setBusy(true);
    try {
      await cancelPurchase.mutateAsync({
        id: purchase.id,
        reason: cancelReason.trim(),
      });
      showToast.success("خرید لغو شد");
      setConfirmCancel(false);
      setCancelReason("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در لغو خرید"
          : "خطا در لغو خرید";
      showToast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !purchase) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/purchases">
            <ArrowRight className="ml-1 h-4 w-4" />
            بازگشت
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4">خرید یافت نشد</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const st = STATUS_CONFIG[purchase.status] ?? {
    label: purchase.status,
    variant: "secondary",
  };
  const pay = PAYMENT_CONFIG[purchase.paymentStatus] ?? {
    label: purchase.paymentStatus,
    variant: "secondary",
  };
  const canReceive = ["ordered", "partially_received"].includes(purchase.status);
  const canPay = !["cancelled"].includes(purchase.status) && purchase.amountOutstanding > 0;
  const canOrder = purchase.status === "draft";
  const canCancel =
    purchase.status === "draft" || purchase.status === "ordered";
  const editingAllowed = purchase.status === "draft";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/purchases">
            <ArrowRight className="ml-1 h-4 w-4" />
            بازگشت
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight" dir="ltr">
          {purchase.number}
        </h1>
        <Badge variant={st.variant}>{st.label}</Badge>
        <Badge variant={pay.variant}>{pay.label}</Badge>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">خلاصه</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">تأمین‌کننده</p>
            <p className="mt-1 font-medium">{purchase.supplierName || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تاریخ خرید</p>
            <p className="mt-1 font-medium">
              {purchase.purchaseDate
                ? new Date(purchase.purchaseDate).toLocaleDateString("fa-IR")
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">مرجع</p>
            <p className="mt-1 font-medium" dir="ltr">
              {purchase.reference || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">جمع کل</p>
            <p className="mt-1 text-lg font-bold">{formatPrice(purchase.total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">جمع جزء</p>
            <p className="mt-1 font-medium">{formatPrice(purchase.subtotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تخفیف / هزینه اضافی</p>
            <p className="mt-1 font-medium">
              {formatPrice(purchase.discount)} / {formatPrice(purchase.additionalCosts)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">پرداخت‌شده</p>
            <p className="mt-1 font-medium text-emerald-600">
              {formatPrice(purchase.amountPaid)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">مانده</p>
            <p className="mt-1 font-medium text-amber-600">
              {formatPrice(purchase.amountOutstanding)}
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-xs text-muted-foreground">یادداشت</p>
            <p className="mt-1 text-sm">{purchase.notes || "—"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">عملیات</CardTitle>
          <CardDescription>
            فقط دریافت کالا، موجودی و لایه هزینه ایجاد می‌کند؛ پرداخت مالی جدا از
            موجودی است
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {canOrder && (
            <Button onClick={handleOrder} disabled={busy}>
              <Truck className="ml-2 h-4 w-4" />
              ثبت سفارش
            </Button>
          )}
          {canReceive && (
            <>
              <Button
                variant="default"
                onClick={handleReceiveAll}
                disabled={busy || purchase.totalOutstanding === 0}
              >
                <PackageCheck className="ml-2 h-4 w-4" />
                دریافت همه باقیمانده
              </Button>
            </>
          )}
          {canPay && (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="numeric"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder={`پرداخت (مانده: ${purchase.amountOutstanding.toLocaleString("fa-IR")})`}
                className="w-48"
                aria-label="مبلغ پرداخت"
              />
              <Button variant="outline" onClick={handlePay} disabled={busy}>
                <Wallet className="ml-2 h-4 w-4" />
                ثبت پرداخت
              </Button>
            </div>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              onClick={() => setConfirmCancel(true)}
              disabled={busy}
            >
              <XCircle className="ml-2 h-4 w-4" />
              لغو خرید
            </Button>
          )}
          {!editingAllowed && !canOrder && !canReceive && !canPay && !canCancel && (
            <p className="text-sm text-muted-foreground">
              این خرید به‌طور کامل دریافت شده است — دیگر عملیاتی ممکن نیست.
            </p>
          )}
        </CardContent>
        {receiveError && (
          <CardContent className="pt-0">
            <p className="text-sm text-destructive">{receiveError}</p>
          </CardContent>
        )}
        {payError && (
          <CardContent className="pt-0">
            <p className="text-sm text-destructive">{payError}</p>
          </CardContent>
        )}
      </Card>

      {/* Line items with receiving UI */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">اقلام</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-4 py-2.5 text-right text-xs font-medium">محصول</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium">تنوع</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium">سفارش</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium">دریافت</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium">باقیمانده</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium">هزینه واحد</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium">جمع قلم</th>
                {canReceive && (
                  <th className="px-4 py-2.5 text-right text-xs font-medium">دریافت</th>
                )}
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((it) => (
                <tr key={it.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{it.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {it.variantLabel || "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {it.quantity.toLocaleString("fa-IR")}
                  </td>
                  <td className="px-4 py-2.5">
                    {it.receivedQuantity.toLocaleString("fa-IR")}
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {it.outstanding.toLocaleString("fa-IR")}
                  </td>
                  <td className="px-4 py-2.5">{formatPrice(it.unitCost)}</td>
                  <td className="px-4 py-2.5 font-medium">{formatPrice(it.lineTotal)}</td>
                  {canReceive && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={receiveDraft[it.id] ?? String(it.outstanding)}
                          onChange={(e) =>
                            setReceiveQty((q) => ({ ...q, [it.id]: e.target.value }))
                          }
                          className="h-9 w-24"
                          aria-label={`تعداد دریافت ${it.name}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReceive(it.id)}
                          disabled={busy || it.outstanding === 0}
                        >
                          <CheckCircle2 className="ml-1 h-3.5 w-3.5" />
                          دریافت
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-bold">
                <td className="px-4 py-2.5 text-xs" colSpan={2}>
                  جمع
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {purchase.totalOrdered.toLocaleString("fa-IR")}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {purchase.totalReceived.toLocaleString("fa-IR")}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {purchase.totalOutstanding.toLocaleString("fa-IR")}
                </td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 text-xs">{formatPrice(purchase.total)}</td>
                {canReceive && <td className="px-4 py-2.5" />}
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* Receipts history */}
      {purchase.receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">سوابق دریافت</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {purchase.receipts.map((r, i) => (
              <div key={r.key || i} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    <span dir="ltr">{r.key}</span>
                    <span>
                      {r.receivedAt
                        ? new Date(r.receivedAt).toLocaleString("fa-IR")
                        : "—"}
                    </span>
                  </div>
                  <span>
                    {r.items.length.toLocaleString("fa-IR")} قلم
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  {r.items.map((ri) => {
                    const item = purchase.items.find((it) => it.id === String(ri.itemId));
                    return (
                      <span key={String(ri.itemId)}>
                        {item?.name || "—"} × {ri.quantity.toLocaleString("fa-IR")}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Cancel confirmation */}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!busy) setConfirmCancel(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">لغو خرید</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              فقط خریدهایی که هیچ کالایی دریافت نکرده‌اند قابل لغو هستند. تاریخچه
              دریافت هرگز حذف نمی‌شود.
            </p>
            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium">دلیل لغو</label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="دلیل لغو..."
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmCancel(false)} disabled={busy}>
                انصراف
              </Button>
              <Button variant="destructive" onClick={handleCancel} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                تأیید لغو
              </Button>
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="flex items-center gap-2 rounded-lg bg-background px-4 py-3 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">در حال پردازش...</span>
          </div>
        </div>
      )}
    </div>
  );
}
