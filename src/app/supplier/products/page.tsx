"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
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
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
  FileUp,
  Download,
} from "lucide-react";
import {
  useSupplierProducts,
  useDeleteSupplierProduct,
  useUpdateSupplierVariantStock,
} from "@/hooks/use-supplier-products";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { SupplierProduct } from "@/types";

export default function SupplierProducts() {
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [stockEditProductId, setStockEditProductId] = useState<string | null>(
    null
  );
  const {
    data: products,
    isLoading,
    isError,
    refetch,
  } = useSupplierProducts();

  const deleteProduct = useDeleteSupplierProduct();

  const filteredProducts = useMemo(
    () =>
      (products || []).filter((p) => {
        const name = p.name || "";
        const category =
          typeof p.category === "object" && p.category?.name
            ? p.category.name
            : "";
        return (
          name.includes(searchQuery) || category.includes(searchQuery)
        );
      }),
    [products, searchQuery]
  );

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
            <h1 className="text-2xl font-bold tracking-tight">محصولات من</h1>
            <p className="text-sm text-muted-foreground">
              مدیریت محصولات خود
            </p>
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
          <h1 className="text-2xl font-bold tracking-tight">محصولات من</h1>
          <p className="text-sm text-muted-foreground">
            مدیریت محصولات خود
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" asChild>
            <Link href="/supplier/products/import">
              <FileUp className="h-4 w-4" />
              ورود انبوه
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <a href="/api/supplier/products/export">
              <Download className="h-4 w-4" />
              خروجی CSV
            </a>
          </Button>
          <Button className="gap-2" asChild>
            <Link href="/supplier/products/new">
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
            {isLoading ? "..." : `${filteredProducts.length} محصول`}
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
              {!searchQuery && (
                <Button className="mt-4 gap-2" asChild>
                  <Link href="/supplier/products/new">
                    <Plus className="h-4 w-4" />
                    اولین محصول را اضافه کنید
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-right font-medium">محصول</th>
                    <th className="px-4 py-3 text-right font-medium">
                      دسته‌بندی
                    </th>
                    <th className="px-4 py-3 text-right font-medium">قیمت</th>
                    <th className="px-4 py-3 text-right font-medium">
                      موجودی
                    </th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                    <th className="px-4 py-3 text-center font-medium">
                      عملیات
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const categoryName =
                      typeof product.category === "object"
                        ? product.category?.name
                        : product.category || "بدون دسته";
                    return (
                      <Fragment key={product._id}>
                      <tr
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-xs font-medium text-emerald-700">
                              {product.name?.[0] || "?"}
                            </div>
                            <div>
                              <Link
                                href={`/supplier/products/${product._id}/edit`}
                                className="font-medium transition-colors hover:text-emerald-600"
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
                          {typeof categoryName === "string"
                            ? categoryName
                            : "بدون دسته"}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {formatPrice(product.price)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                product.stock <= 5
                                  ? "text-amber-600 font-medium"
                                  : ""
                              }
                            >
                              {product.stock}
                            </span>
                            {product.hasVariants &&
                              (product.variants || []).length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 px-2 text-xs text-emerald-600"
                                  onClick={() =>
                                    setStockEditProductId(
                                      stockEditProductId === product._id
                                        ? null
                                        : product._id
                                    )
                                  }
                                >
                                  {stockEditProductId === product._id ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                  ویرایش سریع
                                </Button>
                              )}
                          </div>
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
                                href={`/supplier/products/${product._id}/edit`}
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
                                onClick={() =>
                                  setDeleteConfirmId(product._id)
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {stockEditProductId === product._id &&
                        product.hasVariants && (
                          <tr key={`${product._id}-variants`}>
                            <td colSpan={6} className="px-4 py-3 bg-muted/30">
                              <VariantStockEditor product={product} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            نمایش ۱ تا {filteredProducts.length} از {filteredProducts.length}{" "}
            محصول
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled>
              قبلی
            </Button>
            <Button variant="outline" size="sm">
              بعدی
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline variant stock quick-edit — lets the supplier adjust a variant's
 * stock without opening the full product form. Uses the shared
 * POST /api/supplier/products/stock endpoint (atomic optimistic-lock update
 * via setVariantStock() from @/lib/inventory — no second inventory system).
 */
function VariantStockEditor({ product }: { product: SupplierProduct }) {
  const updateStock = useUpdateSupplierVariantStock();
  const [stockInputs, setStockInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (product.variants || []).map((v) => [String(v._id), String(v.stock ?? 0)])
    )
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleSave = async (variantId: string) => {
    const raw = stockInputs[variantId];
    const stock = Number(raw);
    if (!Number.isInteger(stock) || stock < 0) {
      showToast.error("موجودی باید عدد صحیح و غیرمنفی باشد");
      return;
    }
    setSavingId(variantId);
    try {
      await updateStock.mutateAsync({
        productId: product._id,
        variantId,
        stock,
      });
      showToast.success("موجودی تنوع با موفقیت بروزرسانی شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در بروزرسانی موجودی"
          : "خطا در بروزرسانی موجودی";
      showToast.error(message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        ویرایش سریع موجودی تنوع‌ها — {product.name}
      </p>
      <div className="space-y-2">
        {(product.variants || []).map((variant) => (
          <div
            key={String(variant._id)}
            className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {(variant.attributes || [])
                  .map((a) => `${a.name}: ${a.value}`)
                  .join("، ") || variant.sku}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono" dir="ltr">
                SKU: {variant.sku}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                className="h-8 w-24 text-left font-mono"
                value={stockInputs[String(variant._id)] ?? ""}
                onChange={(e) =>
                  setStockInputs((prev) => ({
                    ...prev,
                    [String(variant._id)]: e.target.value,
                  }))
                }
              />
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => handleSave(String(variant._id))}
                disabled={updateStock.isPending && savingId === String(variant._id)}
              >
                {savingId === String(variant._id) && updateStock.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                ذخیره
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
