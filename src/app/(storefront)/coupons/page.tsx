"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ticket,
  Copy,
  Check,
  Percent,
  Banknote,
  AlertCircle,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import { usePublicCoupons } from "@/hooks/use-public-coupons";
import type { PublicCoupon } from "@/types";

/**
 * Session 44 — public coupon marketing page.
 * Renders ONLY the admin-opted-in public coupons (GET /api/coupons/public —
 * strict projection: code/type/value/minSubtotal/maxDiscount/endsAt; private
 * coupons and internal limits are never returned). Copy-to-clipboard on each
 * code; the customer pastes it at checkout where the untouched
 * validate → claim flow applies it.
 */
export default function PublicCouponsPage() {
  const { data, isLoading, isError, refetch } = usePublicCoupons(1);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = async (coupon: PublicCoupon) => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopiedCode(coupon._id);
      showToast.success(`کد ${coupon.code} کپی شد`);
      setTimeout(() => setCopiedCode((prev) => (prev === coupon._id ? null : prev)), 2000);
    } catch {
      showToast.error("خطا در کپی کد");
    }
  };

  const couponLabel = (c: PublicCoupon) =>
    c.type === "percent"
      ? `٪${c.value.toLocaleString("fa-IR")} تخفیف${
          c.maxDiscount > 0 ? ` (حداکثر ${formatPrice(c.maxDiscount)})` : ""
        }`
      : `${formatPrice(c.value)} تخفیف`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-lg">
          <Ticket className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">کدهای تخفیف</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          با کدهای تخفیف فروشگاه، سفارش خود را با قیمت بهتری ثبت کنید. کد را
          کپی کرده و هنگام تسویه حساب وارد کنید.
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت کدهای تخفیف
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && data && data.total === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Ticket className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h2 className="mb-2 text-lg font-semibold">
              در حال حاضر کد تخفیفی فعال نیست
            </h2>
            <p className="mb-6 max-w-sm text-sm text-muted-foreground">
              به‌زودی کدهای تخفیف ویژه‌ای برای شما منتشر می‌شود. از فروشگاه
              دیدن کنید.
            </p>
            <Button asChild>
              <Link href="/products">مشاهده محصولات</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Coupons grid */}
      {!isLoading && !isError && data && data.total > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((coupon) => (
              <Card
                key={coupon._id}
                className="group relative overflow-hidden border-emerald-400/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                {/* Decorative ribbon */}
                <div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-emerald-400 to-emerald-600" />

                <CardContent className="flex flex-col gap-4 p-5 pr-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">کد تخفیف</p>
                      <p
                        className="mt-1 text-2xl font-bold tracking-wide font-mono"
                        dir="ltr"
                      >
                        {coupon.code}
                      </p>
                    </div>
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                      {coupon.type === "percent" ? (
                        <Percent className="h-5 w-5" />
                      ) : (
                        <Banknote className="h-5 w-5" />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success" className="text-xs">
                      {couponLabel(coupon)}
                    </Badge>
                    {coupon.minSubtotal > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        حداقل سبد: {formatPrice(coupon.minSubtotal)}
                      </Badge>
                    )}
                    {coupon.endsAt && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Clock className="h-3 w-3" />
                        تا {new Date(coupon.endsAt).toLocaleDateString("fa-IR")}
                      </Badge>
                    )}
                  </div>

                  <Button
                    variant="default"
                    className={
                      copiedCode === coupon._id
                        ? "w-full gap-2 bg-emerald-700 hover:bg-emerald-800"
                        : "w-full gap-2"
                    }
                    onClick={() => handleCopy(coupon)}
                  >
                    {copiedCode === coupon._id ? (
                      <>
                        <Check className="h-4 w-4" />
                        کپی شد!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        کپی کد
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            کد را در صفحه تسویه حساب وارد کنید؛ تخفیف به‌صورت خودکار اعمال
            می‌شود.
          </p>
        </>
      )}
    </div>
  );
}
