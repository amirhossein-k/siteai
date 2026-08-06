"use client";

import { useState, use } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Store,
  Package,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { PaginationControls } from "@/components/ui/pagination";
import { ProductCard } from "@/components/storefront/product-card";
import { usePublicSupplier } from "@/hooks/use-public-suppliers";
import { usePublicProducts } from "@/hooks/use-public-products";
import { isAllowedImageSrc } from "@/lib/utils";

export default function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [page, setPage] = useState(1);

  const {
    data: supplier,
    isLoading: supplierLoading,
    isError: supplierError,
    refetch: refetchSupplier,
  } = usePublicSupplier(id);

  const {
    data: paged,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = usePublicProducts({
    supplier: id,
    page,
    limit: 12,
  });

  const products = paged?.data || [];
  const totalProducts = paged?.total || 0;
  const totalPages = paged?.totalPages || 1;

  // Session 61 — skip <Image> for unconfigured hosts (next/image throws at
  // render); the ImageOff/Store fallback matches the old native <img>.
  const showLogo = !!supplier?.logo && isAllowedImageSrc(supplier.logo);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          صفحه اصلی
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link
          href="/suppliers"
          className="transition-colors hover:text-foreground"
        >
          فروشندگان
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">
          {supplier?.businessName || "فروشنده"}
        </span>
      </nav>

      {/* Supplier header */}
      {supplierLoading ? (
        <Card className="mb-8">
          <CardContent className="flex items-center gap-5 p-6">
            <Skeleton className="h-20 w-20 rounded-2xl" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </CardContent>
        </Card>
      ) : supplierError ? (
        <Card className="mb-8">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات فروشنده
            </p>
            <Button variant="outline" onClick={() => refetchSupplier()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      ) : !supplier ? (
        <Card className="mb-8">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Store className="mb-3 h-8 w-8" />
            <p>فروشنده مورد نظر یافت نشد</p>
            <Button className="mt-4" asChild>
              <Link href="/suppliers">مشاهده همه فروشندگان</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-8 overflow-hidden">
          <div className="h-24 bg-gradient-to-l from-emerald-600/15 via-teal-600/10 to-transparent" />
          <CardContent className="-mt-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-5">
              {/* Logo */}
              <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-background shadow-sm">
                {showLogo ? (
                  <Image
                    src={supplier.logo}
                    alt={supplier.businessName}
                    fill
                    sizes="96px"
                    loading="eager"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                    {supplier.logo ? (
                      <ImageOff className="h-8 w-8 text-muted-foreground/40" />
                    ) : (
                      <Store className="h-8 w-8 text-muted-foreground/40" />
                    )}
                  </div>
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  {supplier.businessName}
                </h1>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Package className="h-4 w-4" />
                  {supplier.productCount.toLocaleString("fa-IR")} محصول قابل
                  سفارش
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              فروشنده رسمی فروشگاه من
            </div>
          </CardContent>
          {supplier.description && (
            <CardContent className="pb-6 pt-0">
              <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">
                {supplier.description}
              </p>
            </CardContent>
          )}
        </Card>
      )}

      {/* Products grid */}
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">محصولات این فروشنده</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {productsLoading ? "..." : `${totalProducts.toLocaleString("fa-IR")} محصول`}
        </p>
      </div>

      {productsLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-square w-full rounded-xl" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : productsError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="mb-3 h-12 w-12 text-destructive" />
          <h3 className="mb-2 text-lg font-semibold">خطا در دریافت محصولات</h3>
          <Button variant="outline" onClick={() => refetchProducts()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            تلاش مجدد
          </Button>
        </div>
      ) : !products || products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="mb-3 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">محصولی یافت نشد</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            این فروشنده در حال حاضر محصول قابل سفارشی ندارد
          </p>
          <Button variant="outline" asChild>
            <Link href="/products">مشاهده همه محصولات</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>

          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              نمایش {products.length} محصول از{" "}
              {totalProducts.toLocaleString("fa-IR")} محصول
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
