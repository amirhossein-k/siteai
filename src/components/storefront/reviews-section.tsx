"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Star, StarHalf, MessageSquareText, Loader2, CheckCircle2, Clock, XCircle, AlertCircle, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import { useProductReviews, useMyReviews, useSubmitReview } from "@/hooks/use-reviews";
import type { ReviewStatus } from "@/types";

/**
 * Storefront reviews & ratings section (Session 34).
 *
 * - Rating summary (average + count of APPROVED reviews)
 * - Approved reviews list (paginated)
 * - «ثبت دیدگاه» form — gated to customers who have a DELIVERED order
 *   containing the product and have not yet reviewed that order-item.
 * - Shows the customer's own review status (در انتظار تأیید / تأیید شده / رد شده).
 */
export function ReviewsSection({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const { data: session, status: sessionStatus } = useSession();
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");

  const {
    data: reviewsData,
    isLoading,
    isError,
    refetch,
  } = useProductReviews(productId, page);

  const isCustomer = session?.user?.role === "customer";
  const {
    data: myData,
    isLoading: myLoading,
    refetch: refetchMine,
  } = useMyReviews(productId);

  const submitMutation = useSubmitReview();

  const ratingSummary = reviewsData?.ratingSummary || { average: 0, count: 0 };
  const hasReviews = ratingSummary.count > 0;

  // The customer can write a review when they have at least one eligible order
  const canReview = isCustomer && !myLoading && (myData?.eligibleOrders?.length || 0) > 0;
  const selectedOrderId = myData?.eligibleOrders?.[0]?._id || "";

  const myPendingReview = (myData?.reviews || []).find(
    (r) => r.status === "pending"
  );
  const myApprovedReview = (myData?.reviews || []).find(
    (r) => r.status === "approved"
  );
  const myRejectedReview = (myData?.reviews || []).find(
    (r) => r.status === "rejected"
  );

  const handleSubmit = async () => {
    if (rating < 1 || rating > 5) {
      showToast.error("لطفاً یک امتیاز انتخاب کنید");
      return;
    }
    if (!text.trim()) {
      showToast.error("لطفاً متن دیدگاه را وارد کنید");
      return;
    }
    if (!selectedOrderId) {
      showToast.error("سفارش قابل‌ارزیابی یافت نشد");
      return;
    }
    try {
      await submitMutation.mutateAsync({
        productId,
        orderId: selectedOrderId,
        rating,
        text: text.trim(),
      });
      showToast.success("دیدگاه شما ثبت شد و پس از تأیید منتشر می‌شود");
      setRating(0);
      setText("");
      await refetchMine();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ثبت دیدگاه"
          : "خطا در ثبت دیدگاه";
      showToast.error(message);
    }
  };

  const myStatusBadge = (status: ReviewStatus) => {
    const config = {
      pending: { label: "در انتظار تأیید", variant: "warning", icon: Clock },
      approved: { label: "تأیید شده", variant: "success", icon: CheckCircle2 },
      rejected: { label: "رد شده", variant: "destructive", icon: XCircle },
    } as const;
    const c = config[status];
    const Icon = c.icon;
    return (
      <Badge variant={c.variant} className="gap-1 text-xs">
        <Icon className="h-3 w-3" />
        {c.label}
      </Badge>
    );
  };

  return (
    <Card className="mt-10 glass-panel rounded-3xl">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            <CardTitle className="text-xl">دیدگاه‌ها</CardTitle>
          </div>
          {hasReviews && (
            <div className="flex items-center gap-2">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={cn(
                      "h-5 w-5",
                      s <= Math.round(ratingSummary.average)
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30"
                    )}
                  />
                ))}
              </div>
              <span className="text-sm font-bold">{ratingSummary.average}</span>
              <span className="text-xs text-muted-foreground">
                ({ratingSummary.count} دیدگاه)
              </span>
            </div>
          )}
        </div>
        <CardDescription>
          دیدگاه مشتریانی که این محصول را خریداری و دریافت کرده‌اند
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* --- Review form (gated to verified purchasers of a delivered order) --- */}
        {isCustomer && !myLoading && canReview && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-sm font-semibold">ثبت دیدگاه شما</h3>

            {/* Star picker */}
            <div className="mb-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-label={`${s} ستاره`}
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(s)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      "h-7 w-7",
                      (hoverRating || rating) >= s
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30"
                    )}
                  />
                </button>
              ))}
              <span className="mr-2 text-sm text-muted-foreground">
                {rating ? `${rating} از ۵` : "امتیاز دهید"}
              </span>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="تجربه خرید خود را بنویسید... (پس از تأیید مدیر منتشر می‌شود)"
              className="mb-3 flex w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                {text.length}/1000
              </p>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
                className="gap-1.5"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquareText className="h-4 w-4" />
                )}
                ثبت دیدگاه
              </Button>
            </div>
          </div>
        )}

        {/* Customer's own review status (already submitted) */}
        {isCustomer && !myLoading && !canReview && (myPendingReview || myApprovedReview || myRejectedReview) && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
            <span className="text-muted-foreground">دیدگاه شما:</span>
            {myPendingReview && myStatusBadge("pending")}
            {myApprovedReview && myStatusBadge("approved")}
            {myRejectedReview && (
              <>
                {myStatusBadge("rejected")}
                {myRejectedReview.rejectionReason && (
                  <span className="text-xs text-muted-foreground">
                    — {myRejectedReview.rejectionReason}
                  </span>
                )}
              </>
            )}
            <span className="mr-auto text-xs text-muted-foreground">
              {myApprovedReview?.rating
                ? `${myApprovedReview.rating} از ۵ ستاره`
                : myPendingReview?.rating
                ? `${myPendingReview.rating} از ۵ ستاره`
                : ""}
            </span>
          </div>
        )}

        {/* Not logged in prompt */}
        {!isCustomer && sessionStatus === "unauthenticated" && hasReviews && (
          <p className="text-xs text-muted-foreground">
            برای ثبت دیدگاه{" "}
            <Link href="/login" className="text-primary hover:underline">
              وارد حساب خود
            </Link>{" "}
            شوید.
          </p>
        )}

        {/* --- Approved reviews list --- */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="mb-2 h-6 w-6 text-destructive" />
            <p className="mb-2 text-sm text-muted-foreground">
              خطا در دریافت دیدگاه‌ها
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              تلاش مجدد
            </Button>
          </div>
        ) : !reviewsData || reviewsData.data.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {hasReviews
              ? "هنوز دیدگاهی منتشر نشده است"
              : "هنوز دیدگاهی برای این محصول ثبت نشده است. اولین نفر باشید!"}
          </div>
        ) : (
          <div className="space-y-4">
            {reviewsData.data.map((review) => (
              <div
                key={review._id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06]"
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {review.customer?.name || "مشتری"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {review.createdAt
                        ? new Date(review.createdAt).toLocaleDateString(
                            "fa-IR",
                            { year: "numeric", month: "long", day: "numeric" }
                          )
                        : ""}
                    </span>
                  </div>
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={cn(
                          "h-3.5 w-3.5",
                          s <= review.rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30"
                        )}
                      />
                    ))}
                  </div>
                </div>
                {review.itemSnapshot?.variantLabel && (
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    {review.itemSnapshot.variantLabel}
                  </p>
                )}
                <p className="text-sm leading-6 whitespace-pre-line">
                  {review.text}
                </p>

                {/* Supplier reply (Session 37) — shown under the approved review */}
                {review.reply?.text && (
                  <div className="mt-3 rounded-xl border-r-4 border-primary bg-white/5 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Store className="h-3.5 w-3.5" />
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
                )}
              </div>
            ))}

            {/* Pagination */}
            {reviewsData.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!reviewsData.hasPreviousPage}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  قبلی
                </Button>
                <span className="text-xs text-muted-foreground">
                  صفحه {reviewsData.page} از {reviewsData.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!reviewsData.hasNextPage}
                  onClick={() => setPage((p) => p + 1)}
                >
                  بعدی
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Empty state when no reviews at all and not logged in */}
        {!isLoading && !isError && (!reviewsData || reviewsData.data.length === 0) && (
          !hasReviews && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <StarHalf className="h-4 w-4" />
              <span>
                {sessionStatus === "authenticated"
                  ? "هنوز دیدگاهی ثبت نکرده‌اید"
                  : "برای ثبت اولین دیدگاه وارد شوید"}
              </span>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
