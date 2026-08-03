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
  Star,
  Loader2,
  MessageSquareText,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  RefreshCw,
  Send,
  Package,
  User,
} from "lucide-react";
import {
  useSupplierReviews,
  useReplyToReview,
} from "@/hooks/use-supplier-reviews";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { PaginationControls } from "@/components/ui/pagination";
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

/**
 * Supplier review reply queue (Session 37).
 *
 * Reviews on the supplier's OWN products. Approved reviews WITHOUT a reply get
 * an inline reply box; already-replied reviews show the reply with a badge.
 * Pending/rejected reviews are read-only here (moderation is admin-side).
 */
export default function SupplierReviewsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const replyMutation = useReplyToReview();

  const { data, isLoading, isError, refetch } = useSupplierReviews(
    page,
    statusFilter || undefined
  );

  const reviews = data?.data || [];

  const handleReply = async (reviewId: string) => {
    const text = (drafts[reviewId] || "").trim();
    if (!text) {
      showToast.error("متن پاسخ نمی‌تواند خالی باشد");
      return;
    }
    try {
      await replyMutation.mutateAsync({ reviewId, text });
      showToast.success("پاسخ شما ثبت شد و برای مشتری نمایش داده می‌شود");
      setDrafts((prev) => ({ ...prev, [reviewId]: "" }));
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ثبت پاسخ"
          : "خطا در ثبت پاسخ";
      showToast.error(message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">پاسخ به دیدگاه‌ها</h1>
        <p className="text-sm text-muted-foreground">
          به دیدگاه‌های مشتریان درباره محصولات خود پاسخ دهید
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map((tab) => (
          <Button
            key={tab.key}
            variant={statusFilter === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(tab.key);
              setPage(1);
            }}
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
                <Skeleton key={i} className="h-28 w-full" />
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
                const canReply =
                  review.status === "approved" && !review.reply;
                return (
                  <div
                    key={review._id}
                    className="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    {/* Review content */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
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
                          {review.reply && (
                            <Badge variant="default" className="gap-1 text-xs">
                              <CheckCircle2 className="h-3 w-3" />
                              پاسخ داده شد
                            </Badge>
                          )}
                        </div>

                        {/* Product context */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            <Link
                              href={`/products/${review.product?.slug || review.product?._id}`}
                              className="hover:text-primary hover:underline"
                            >
                              {review.product?.name || "محصول"}
                            </Link>
                          </span>
                          {review.customer?.name && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {review.customer.name}
                            </span>
                          )}
                          <span>
                            {review.createdAt
                              ? new Date(review.createdAt).toLocaleDateString(
                                  "fa-IR",
                                  { year: "numeric", month: "long", day: "numeric" }
                                )
                              : "—"}
                          </span>
                          {review.itemSnapshot?.variantLabel && (
                            <span>{review.itemSnapshot.variantLabel}</span>
                          )}
                        </div>

                        <p className="mt-2 text-sm leading-6 whitespace-pre-line">
                          {review.text}
                        </p>
                      </div>
                    </div>

                    {/* Supplier reply */}
                    {review.reply ? (
                      <div className="mr-4 rounded-lg border-r-4 border-primary bg-muted/40 p-3">
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                          <MessageSquareText className="h-3.5 w-3.5" />
                          پاسخ فروشنده
                        </p>
                        <p className="text-sm leading-6 whitespace-pre-line">
                          {review.reply.text}
                        </p>
                        {review.reply.at && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {new Date(review.reply.at).toLocaleDateString("fa-IR", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                    ) : canReply ? (
                      <div className="mr-4 space-y-2 rounded-lg border bg-muted/30 p-3">
                        <textarea
                          value={drafts[review._id] || ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [review._id]: e.target.value,
                            }))
                          }
                          rows={3}
                          maxLength={1000}
                          placeholder="پاسخ فروشنده را اینجا بنویسید..."
                          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] text-muted-foreground">
                            {(drafts[review._id] || "").length}/1000
                          </p>
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={() => handleReply(review._id)}
                            disabled={
                              replyMutation.isPending ||
                              !(drafts[review._id] || "").trim()
                            }
                          >
                            {replyMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            ارسال پاسخ
                          </Button>
                        </div>
                      </div>
                    ) : (
                      review.status === "pending" && (
                        <p className="mr-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          پس از تأیید مدیر می‌توانید پاسخ دهید
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoading && (data?.totalPages ?? 1) > 1 && (
        <PaginationControls
          page={data?.page ?? 1}
          totalPages={data?.totalPages ?? 1}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
