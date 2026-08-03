"use client";

import { useState } from "react";
import { Store, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import { SupplierCard } from "@/components/storefront/supplier-card";
import { usePublicSuppliers } from "@/hooks/use-public-suppliers";

export default function SuppliersListingPage() {
  const [page, setPage] = useState(1);

  const { data: paged, isLoading, isError, refetch } = usePublicSuppliers({
    page,
  });

  const suppliers = paged?.data || [];
  const totalSuppliers = paged?.total || 0;
  const totalPages = paged?.totalPages || 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">فروشندگان</h1>
            <p className="mt-1 text-muted-foreground">
              {isLoading
                ? "..."
                : `${totalSuppliers.toLocaleString("fa-IR")} فروشنده فعال در فروشگاه`}
            </p>
          </div>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-14 w-14 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="mb-3 h-12 w-12 text-destructive" />
          <h3 className="mb-2 text-lg font-semibold">
            خطا در دریافت فروشندگان
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            ممکن است اتصال اینترنت خود را بررسی کنید
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            تلاش مجدد
          </Button>
        </div>
      ) : !suppliers || suppliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Store className="mb-3 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">فروشنده‌ای یافت نشد</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            هنوز فروشنده‌ای در فروشگاه ثبت نشده است
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((supplier) => (
              <SupplierCard key={supplier._id} supplier={supplier} />
            ))}
          </div>

          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              نمایش {suppliers.length} فروشنده از {totalSuppliers.toLocaleString("fa-IR")}{" "}
              فروشنده
            </div>
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
