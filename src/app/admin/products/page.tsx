"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  Filter,
  AlertCircle,
  RefreshCw,
  Package,
  X,
  FileUp,
  Download,
} from "lucide-react";
import { useAdminProducts, useDeleteAdminProduct } from "@/hooks/use-admin-products";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";

export default function AdminProducts() {
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = useAdminProducts({
    search: searchQuery || undefined,
    page,
  });

  const products = paged?.data || [];
  const totalProducts = paged?.total || 0;
  const totalPages = paged?.totalPages || 1;

  const deleteProduct = useDeleteAdminProduct();

  // Reset to page 1 whenever search changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  // Server-side search (name, slug, category/brand/tag name)
  const filteredProducts = products;

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteProduct.mutateAsync(id);
        showToast.success("محصول با موفقیت حذف شد");
        setDeleteConfirmId(null);
      } catch {
        showToast.error("خطا در حذف محصول");
      }
    },
    [deleteProduct]
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">محصولات</h1>
            <p className="text-sm text-muted-foreground">مدیریت محصولات فروشگاه</p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت محصولات
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">محصولات</h1>
          <p className="text-sm text-muted-foreground">
            مدیریت محصولات فروشگاه
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" asChild>
            <Link href="/admin/products/import">
              <FileUp className="h-4 w-4" />
              ورود انبوه
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <a href="/api/admin/products/export">
              <Download className="h-4 w-4" />
              خروجی CSV
            </a>
          </Button>
          <Button className="gap-2" asChild>
            <Link href="/admin/products/new">
              <Plus className="h-4 w-4" />
              افزودن محصول جدید
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="جستجوی محصولات..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              فیلترها
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">لیست محصولات</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${totalProducts} محصول`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Package className="mx-auto mb-3 h-8 w-8" />
              <p>محصولی یافت نشد</p>
              {searchQuery && (
                <Button
                  variant="link"
                  onClick={() => setSearchQuery("")}
                  className="mt-2"
                >
                  پاک کردن فیلتر جستجو
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-right font-medium">محصول</th>
                    <th className="px-4 py-3 text-right font-medium">دسته‌بندی</th>
                    <th className="px-4 py-3 text-right font-medium">قیمت</th>
                    <th className="px-4 py-3 text-right font-medium">موجودی</th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                    <th className="px-4 py-3 text-center font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const categoryName =
                      typeof product.category === "object"
                        ? product.category?.name
                        : product.category || "بدون دسته";
                    return (
                      <tr
                        key={product._id}
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                              {product.name?.[0] || "?"}
                            </div>
                            <div>
                              <Link
                                href={`/admin/products/${product._id}/edit`}
                                className="font-medium transition-colors hover:text-primary"
                              >
                                {product.name}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {product.slug}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {typeof categoryName === "string" ? categoryName : "بدون دسته"}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {formatPrice(product.price)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              product.stock <= 5
                                ? "text-amber-600 font-medium"
                                : ""
                            }
                          >
                            {product.stock}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={product.isActive ? "success" : "secondary"}
                            className="text-xs"
                          >
                            {product.isActive ? "فعال" : "غیرفعال"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              asChild
                            >
                              <Link
                                href={`/admin/products/${product._id}/edit`}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </Link>
                            </Button>

                            {deleteConfirmId === product._id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={() => handleDelete(product._id)}
                                  loading={deleteProduct.isPending}
                                >
                                  تأیید حذف
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => setDeleteConfirmId(product._id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && filteredProducts.length > 0 && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground flex-wrap">
          <p>
            نمایش {filteredProducts.length} محصول از {totalProducts} محصول
          </p>
          <PaginationControls
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
