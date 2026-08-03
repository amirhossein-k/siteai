"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  RefreshCw,
  Wallet,
  CheckCircle2,
  XCircle,
  Landmark,
  CreditCard,
  User,
  Loader2,
} from "lucide-react";
import {
  useAdminPayouts,
  useReviewPayout,
} from "@/hooks/use-admin-payouts";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { PayoutStatus } from "@/types";

const statusConfig: Record<
  PayoutStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning";
  }
> = {
  pending: { label: "در انتظار تأیید", variant: "warning" },
  approved: { label: "تأیید شده", variant: "success" },
  rejected: { label: "رد شده", variant: "destructive" },
};

const filterTabs: { key: string; label: string }[] = [
  { key: "", label: "همه" },
  { key: "pending", label: "در انتظار" },
  { key: "approved", label: "تأیید شده" },
  { key: "rejected", label: "رد شده" },
];

export default function AdminPayoutsPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [rejecting, setRejecting] = useState<{
    transactionId: string;
    amount: number;
    businessName: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");

  const { data: payouts, isLoading, isError, refetch } = useAdminPayouts(
    statusFilter ? { status: statusFilter } : {}
  );
  const reviewPayout = useReviewPayout();

  const handleApprove = async (transactionId: string) => {
    try {
      await reviewPayout.mutateAsync({ transactionId, action: "approve" });
      showToast.success("درخواست تسویه تأیید شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در تأیید درخواست"
          : "خطا در تأیید درخواست";
      showToast.error(message);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setRejectError("لطفاً دلیل رد را وارد کنید");
      return;
    }
    if (!rejecting) return;
    setRejectError("");
    try {
      await reviewPayout.mutateAsync({
        transactionId: rejecting.transactionId,
        action: "reject",
        reason: rejectReason.trim(),
      });
      showToast.success("درخواست تسویه رد شد");
      setRejecting(null);
      setRejectReason("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در رد درخواست"
          : "خطا در رد درخواست";
      setRejectError(message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">تسویه فروشندگان</h1>
        <p className="text-sm text-muted-foreground">
          بررسی و تأیید درخواست‌های تسویه حساب فروشندگان
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map((tab) => (
          <Button
            key={tab.key}
            variant={statusFilter === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">درخواست‌های تسویه</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${(payouts || []).length} درخواست`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="mb-4 text-muted-foreground">
                خطا در دریافت درخواست‌ها
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="ml-2 h-4 w-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !payouts || payouts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Wallet className="mx-auto mb-3 h-8 w-8" />
              <p>درخواست تسویه‌ای یافت نشد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {payouts.map((p) => {
                const config = statusConfig[p.status];
                const isPending = p.status === "pending";
                return (
                  <div
                    key={p._id}
                    className="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {p.supplier?.businessName || "نامشخص"}
                        </p>
                        <Badge
                          variant={config?.variant || "secondary"}
                          className="text-xs"
                        >
                          {config?.label || p.status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {p.createdAt
                            ? new Date(p.createdAt).toLocaleDateString("fa-IR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {p.supplier?.user?.name || "—"}
                        </span>
                        <span className="flex items-center gap-1" dir="ltr">
                          <CreditCard className="h-3 w-3" />
                          {p.supplier?.bankAccount?.cardNumber || "—"}
                        </span>
                        <span className="flex items-center gap-1" dir="ltr">
                          <Landmark className="h-3 w-3" />
                          {p.supplier?.bankAccount?.iban || "—"}
                        </span>
                      </div>
                      {p.note && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {p.note}
                        </p>
                      )}
                      {p.status === "rejected" && p.rejectionReason && (
                        <p className="mt-1 text-xs text-destructive">
                          دلیل رد: {p.rejectionReason}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-left">
                        <p className="text-lg font-bold text-emerald-600">
                          {formatPrice(Math.abs(p.amount))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          مانده: {formatPrice(p.supplier?.balance || 0)}
                        </p>
                      </div>
                      {isPending && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="gap-1 text-xs"
                            onClick={() => handleApprove(p._id)}
                            disabled={reviewPayout.isPending}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            تأیید
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="gap-1 text-xs"
                            onClick={() => {
                              setRejecting({
                                transactionId: p._id,
                                amount: Math.abs(p.amount),
                                businessName:
                                  p.supplier?.businessName || "فروشنده",
                              });
                              setRejectReason("");
                              setRejectError("");
                            }}
                            disabled={reviewPayout.isPending}
                          >
                            <XCircle className="h-3 w-3" />
                            رد
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject modal */}
      {rejecting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!reviewPayout.isPending) setRejecting(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold">رد درخواست تسویه</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  درخواست {rejecting.businessName} به مبلغ{" "}
                  {formatPrice(rejecting.amount)} رد می‌شود و مبلغ به موجودی
                  قابل برداشت برمی‌گردد.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                دلیل رد <span className="text-destructive">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="دلیل رد درخواست..."
              />
              {rejectError && (
                <p className="text-xs text-destructive">{rejectError}</p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setRejecting(null)}
                disabled={reviewPayout.isPending}
              >
                انصراف
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={!rejectReason.trim() || reviewPayout.isPending}
              >
                {reviewPayout.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                تأیید رد
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Processing overlay hint */}
      {reviewPayout.isPending && (
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
