"use client";

import { useState } from "react";
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
  AlertCircle,
  RefreshCw,
  Star,
  CheckCircle2,
  XCircle,
  MessageSquareText,
  Loader2,
  User,
  Package,
} from "lucide-react";
import { useAdminReviews, useModerateReview } from "@/hooks/use-admin-reviews";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ReviewStatus } from "@/types";

const statusConfig: Record<
  ReviewStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning";
    color: string;
  }
> = {
  pending: {
    label: "در انتظار تأیید",
    variant: "warning",
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300",
  },
  approved: {
    label: "تأیید شده",
    variant: "success",
    color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
  },
  rejected: {
    label: "رد شده",
    variant: "destructive",
    color: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-300",
  },
};

const filterTabs: { key: string; label: string }[] = [
  { key: "", label: "همه" },
  { key: "pending", label: "در انتظار" },
  { key: "approved", label: "تأیید شده" },
  { key: "rejected", label: "رد شده" },
];

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={cn(
            "h-3.5 w-3.5",
            s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          )}
        />
      ))}
    </div>
  );
}

export default function AdminReviewsPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [rejecting, setRejecting] = useState<{
    reviewId: string;
    reviewText: string;
    customerName: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");

  const { data, isLoading, isError, refetch } = useAdminReviews(
    statusFilter ? { status: statusFilter } : {}
  );
  const moderate = useModerateReview();

  const handleApprove = async (reviewId: string) => {
    try {
      await moderate.mutateAsync({ reviewId, action: "approve" });
      showToast.success("دیدگاه تأیید شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در تأیید دیدگاه"
          : "خطا در تأیید دیدگاه";
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
      await moderate.mutateAsync({
        reviewId: rejecting.reviewId,
        action: "reject",
        reason: rejectReason.trim(),
      });
      showToast.success("دیدگاه رد شد");
      setRejecting(null);
      setRejectReason("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در رد دیدگاه"
          : "خطا در رد دیدگاه";
      setRejectError(message);
    }
  };

  const reviews = data?.data || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">مدیریت دیدگاه‌ها</h1>
        <p className="text-sm text-muted-foreground">
          بررسی و تأیید دیدگاه‌های مشتریان پیش از انتشار
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
          <CardTitle className="text-lg">دیدگاه‌ها</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${reviews.length} دیدگاه`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="mb-4 text-muted-foreground">
                خطا در دریافت دیدگاه‌ها
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="ml-2 h-4 w-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <MessageSquareText className="mx-auto mb-3 h-8 w-8" />
              <p>دیدگاهی یافت نشد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => {
                const config = statusConfig[review.status];
                const isPending = review.status === "pending";
                return (
                  <div
                    key={review._id}
                    className="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      {/* Left: review content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {review.customer?.name || "مشتری"}
                          </p>
                          <Badge
                            variant={config?.variant || "secondary"}
                            className="text-xs"
                          >
                            {config?.label || review.status}
                          </Badge>
                          <Stars rating={review.rating} />
                        </div>

                        {/* Product context */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            <Link
                              href={`/admin/products/${review.product?._id}/edit`}
                              className="hover:text-primary hover:underline"
                            >
                              {review.product?.name || "محصول"}
                            </Link>
                          </span>
                          {review.customer?.phone && (
                            <span className="flex items-center gap-1" dir="ltr">
                              <User className="h-3 w-3" />
                              {review.customer.phone}
                            </span>
                          )}
                          <span>
                            {review.createdAt
                              ? new Date(review.createdAt).toLocaleDateString(
                                  "fa-IR",
                                  { hour: "2-digit", minute: "2-digit" }
                                )
                              : "—"}
                          </span>
                          {review.itemSnapshot?.variantLabel && (
                            <span className="text-muted-foreground">
                              {review.itemSnapshot.variantLabel}
                            </span>
                          )}
                        </div>

                        <p className="mt-2 text-sm leading-6 whitespace-pre-line">
                          {review.text}
                        </p>

                        {review.status === "rejected" &&
                          review.rejectionReason && (
                            <p className="mt-1 text-xs text-destructive">
                              دلیل رد: {review.rejectionReason}
                            </p>
                          )}

                        {/* Supplier reply (Session 37) — read-only for admin */}
                        {review.reply?.text && (
                          <div className="mt-3 rounded-lg border-r-4 border-primary bg-muted/40 p-3">
                            <p className="mb-1 text-xs font-semibold text-primary">
                              پاسخ فروشنده
                            </p>
                            <p className="text-sm leading-6 whitespace-pre-line">
                              {review.reply.text}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right: actions */}
                      {isPending && (
                        <div className="flex shrink-0 gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="gap-1 text-xs"
                            onClick={() => handleApprove(review._id)}
                            disabled={moderate.isPending}
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
                                reviewId: review._id,
                                reviewText: review.text,
                                customerName:
                                  review.customer?.name || "مشتری",
                              });
                              setRejectReason("");
                              setRejectError("");
                            }}
                            disabled={moderate.isPending}
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
            if (!moderate.isPending) setRejecting(null);
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
                <h2 className="text-lg font-bold">رد دیدگاه</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  دیدگاه {rejecting.customerName} رد می‌شود و برای مشتری نمایش
                  داده نمی‌شود.
                </p>
              </div>
            </div>

            <div className="mb-3 rounded-lg bg-muted/50 p-3 text-sm italic text-muted-foreground">
              «{rejecting.reviewText.slice(0, 120)}»
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
                placeholder="دلیل رد دیدگاه..."
              />
              {rejectError && (
                <p className="text-xs text-destructive">{rejectError}</p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setRejecting(null)}
                disabled={moderate.isPending}
              >
                انصراف
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={!rejectReason.trim() || moderate.isPending}
              >
                {moderate.isPending ? (
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
      {moderate.isPending && (
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
