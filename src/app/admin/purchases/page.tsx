"use client";

import { useMemo, useState } from "react";
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
import { PaginationControls } from "@/components/ui/pagination";
import { Plus, RefreshCw, AlertCircle, ShoppingCart } from "lucide-react";
import { useAdminPurchases } from "@/hooks/use-admin-purchases";
import { formatPrice } from "@/lib/utils";
import type { PurchaseOrderView } from "@/types";

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

const PAGE_SIZE = 20;

export default function AdminPurchasesPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const params = useMemo(() => {
    const p: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (status) p.status = status;
    if (page > 1) p.page = String(page);
    return p;
  }, [status, page]);

  const { data, isLoading, isError, refetch } = useAdminPurchases(params);

  const filterTabs: { key: string; label: string }[] = [
    { key: "", label: "همه" },
    { key: "draft", label: "پیش‌نویس" },
    { key: "ordered", label: "ثبت سفارش" },
    { key: "partially_received", label: "دریافت جزئی" },
    { key: "received", label: "دریافت کامل" },
    { key: "cancelled", label: "لغو شده" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">خریدها</h1>
          <p className="text-sm text-muted-foreground">
            خرید از تأمین‌کنندگان، دریافت کالا و ثبت هزینه — فقط دریافت، موجودی و
            لایه‌های هزینه ایجاد می‌کند
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/purchases/new">
            <Plus className="ml-2 h-4 w-4" />
            خرید جدید
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {filterTabs.map((tab) => (
          <Button
            key={tab.key}
            variant={status === tab.key ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">فهرست خریدها</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${(data?.total ?? 0).toLocaleString("fa-IR")} خرید`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="mb-4 text-muted-foreground">خطا در دریافت خریدها</p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="ml-2 h-4 w-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !data?.purchases?.length ? (
            <div className="py-12 text-center text-muted-foreground">
              <ShoppingCart className="mx-auto mb-3 h-8 w-8" />
              <p>خریدی یافت نشد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.purchases.map((p: PurchaseOrderView) => {
                const st = STATUS_CONFIG[p.status] ?? {
                  label: p.status,
                  variant: "secondary",
                };
                const pay = PAYMENT_CONFIG[p.paymentStatus] ?? {
                  label: p.paymentStatus,
                  variant: "secondary",
                };
                return (
                  <Link
                    key={p.id}
                    href={`/admin/purchases/${p.id}`}
                    className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-medium" dir="ltr">
                            {p.number}
                          </p>
                          <Badge variant={st.variant} className="text-xs">
                            {st.label}
                          </Badge>
                          <Badge variant={pay.variant} className="text-xs">
                            {pay.label}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{p.supplierName || "—"}</span>
                          <span>
                            {p.purchaseDate
                              ? new Date(p.purchaseDate).toLocaleDateString("fa-IR")
                              : "—"}
                          </span>
                          <span>
                            سفارش: {p.totalOrdered.toLocaleString("fa-IR")} · دریافت:{" "}
                            {p.totalReceived.toLocaleString("fa-IR")} · باقیمانده:{" "}
                            {p.totalOutstanding.toLocaleString("fa-IR")}
                          </span>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="text-base font-bold">
                          {formatPrice(p.total)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          پرداخت: {formatPrice(p.amountPaid)}
                          {p.amountOutstanding > 0 &&
                            ` · مانده: ${formatPrice(p.amountOutstanding)}`}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex justify-center">
          <PaginationControls
            page={data.page}
            totalPages={data.totalPages}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
}
