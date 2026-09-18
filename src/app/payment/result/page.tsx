"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  ShoppingBag,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function PaymentResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const status = searchParams.get("status");
  const orderId = searchParams.get("orderId");
  const refId = searchParams.get("refId");
  const message = searchParams.get("message");

  if (status === "success") {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">
          پرداخت با موفقیت انجام شد!
        </h1>
        <p className="mb-4 text-muted-foreground">
          سفارش شما ثبت و پرداخت شد. کد پیگیری تراکنش خود را یادداشت کنید.
        </p>

        <Card className="mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">شماره سفارش</span>
              <span className="font-bold font-mono" dir="ltr">
                #{orderId?.slice(-8)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">کد پیگیری</span>
              <span className="font-bold font-mono text-emerald-600" dir="ltr">
                {refId}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href={`/orders/${orderId}`}>
              <ClipboardList className="ml-2 h-4 w-4" />
              مشاهده سفارش
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/products">
              <ShoppingBag className="ml-2 h-4 w-4" />
              ادامه خرید
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-10 w-10 text-amber-600" />
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">
          پرداخت لغو شد
        </h1>
        <p className="mb-4 text-muted-foreground">
          پرداخت شما لغو شد. سفارش شما همچنان در وضعیت "در انتظار پرداخت" باقی
          می‌ماند.
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href={orderId ? `/orders/${orderId}` : "/checkout"}>
              <ArrowLeft className="ml-2 h-4 w-4" />
              {orderId ? "مشاهده سفارش" : "تلاش مجدد"}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/products">
              <ShoppingBag className="ml-2 h-4 w-4" />
              ادامه خرید
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Failed or unknown status
  return (
    <div className="mx-auto max-w-md text-center">
      <div className="mb-6 flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
          <XCircle className="h-10 w-10 text-red-600" />
        </div>
      </div>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">
        پرداخت ناموفق
      </h1>
      <p className="mb-4 text-muted-foreground">
        {message || "متأسفانه پرداخت شما با خطا مواجه شد. لطفاً مجدداً تلاش کنید."}
      </p>
      <div className="flex flex-col gap-3">
        {orderId ? (
          <Button asChild>
            <Link href={`/orders/${orderId}`}>
              <ClipboardList className="ml-2 h-4 w-4" />
              مشاهده سفارش و پرداخت مجدد
            </Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/checkout">
              <ArrowLeft className="ml-2 h-4 w-4" />
              بازگشت به تسویه حساب
            </Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/products">
            <ShoppingBag className="ml-2 h-4 w-4" />
            ادامه خرید
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function PaymentResultPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <p className="text-muted-foreground">در حال بارگذاری...</p>
          </div>
        }
      >
        <PaymentResultContent />
      </Suspense>
    </div>
  );
}
