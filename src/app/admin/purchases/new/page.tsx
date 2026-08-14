"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Plus, Trash2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useAdminProducts } from "@/hooks/use-admin-products";
import { useCreatePurchase } from "@/hooks/use-admin-purchases";
import { showToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/utils";
import type { AdminProduct } from "@/types";

interface LineDraft {
  key: string;
  productId: string;
  variantId: string;
  quantity: string;
  unitCost: string;
}

let lineCounter = 0;
const nextLineKey = () => `line-${++lineCounter}-${Date.now()}`;

const toNum = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

export default function NewPurchasePage() {
  const router = useRouter();
  const { data: suppliers, isLoading: suppliersLoading } = useSuppliers();
  const {
    data: productsData,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useAdminProducts({ limit: 200, sourcing: "purchased" });

  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("");
  const [additionalCosts, setAdditionalCosts] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { key: nextLineKey(), productId: "", variantId: "", quantity: "", unitCost: "" },
  ]);
  const [formError, setFormError] = useState("");

  const createPurchase = useCreatePurchase();

  // Only products with sourcing === "purchased" may enter a purchase — the API
  // enforces this too (Phase A invariant). The picker is pre-filtered.
  // useAdminProducts returns a PaginatedResponse — the array lives under `.data`.
  const products = useMemo(() => {
    const list = (productsData as unknown as { data?: AdminProduct[] } | undefined)?.data ?? [];
    return list;
  }, [productsData]);

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const addLine = () =>
    setLines((ls) => [
      ...ls,
      { key: nextLineKey(), productId: "", variantId: "", quantity: "", unitCost: "" },
    ]);

  const removeLine = (key: string) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const liveTotals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => {
      const q = toNum(l.quantity);
      const c = toNum(l.unitCost);
      return s + q * c;
    }, 0);
    const disc = toNum(discount);
    const extra = toNum(additionalCosts);
    const total = Math.max(0, subtotal - disc + extra);
    return { subtotal, total };
  }, [lines, discount, additionalCosts]);

  const selectedProduct = (id: string) =>
    products.find((p) => p._id === id);

  const handleSubmit = async () => {
    setFormError("");
    if (!supplierId) {
      setFormError("تأمین‌کننده را انتخاب کنید");
      return;
    }
    if (!purchaseDate) {
      setFormError("تاریخ خرید را وارد کنید");
      return;
    }
    const items = lines.map((l) => ({
      product: l.productId,
      variantId: l.variantId || undefined,
      quantity: toNum(l.quantity),
      unitCost: toNum(l.unitCost),
    }));
    if (items.length === 0 || items.some((it) => !it.product)) {
      setFormError("حداقل یک قلم کالا با محصول انتخاب‌شده لازم است");
      return;
    }
    if (items.some((it) => it.quantity <= 0 || it.unitCost < 0)) {
      setFormError("تعداد و هزینه واحد هر قلم را به‌درستی وارد کنید");
      return;
    }
    if (liveTotals.total <= 0) {
      setFormError("مبلغ کل خرید باید بیشتر از صفر باشد");
      return;
    }

    try {
      const { purchase } = await createPurchase.mutateAsync({
        supplier: supplierId,
        purchaseDate: new Date(purchaseDate + "T00:00:00Z").toISOString(),
        reference: reference.trim(),
        notes: notes.trim(),
        discount: toNum(discount),
        additionalCosts: toNum(additionalCosts),
        items,
      });
      showToast.success("خرید پیش‌نویس ایجاد شد");
      router.push(`/admin/purchases/${purchase.id}`);
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ایجاد خرید"
          : "خطا در ایجاد خرید";
      setFormError(message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/purchases">
            <ArrowRight className="ml-1 h-4 w-4" />
            بازگشت
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">خرید جدید</h1>
      </div>

      {formError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              {formError}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Supplier + header fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">مشخصات خرید</CardTitle>
          <CardDescription>
            فقط محصولاتی با منبع «خریداری‌شده» قابل ثبت هستند — ثبت خرید هرگز
            موجودی ایجاد نمی‌کند
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              تأمین‌کننده <span className="text-destructive">*</span>
            </label>
            {suppliersLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">انتخاب تأمین‌کننده...</option>
                {(suppliers ?? []).map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.businessName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              تاریخ خرید <span className="text-destructive">*</span>
            </label>
            <Input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">شماره مرجع/فاکتور تأمین‌کننده</label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="اختیاری"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">یادداشت</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="اختیاری"
            />
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">اقلام خرید</CardTitle>
          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="ml-1 h-4 w-4" />
            افزودن قلم
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {productsError && (
            <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
              <p className="text-sm text-red-700 dark:text-red-300">
                خطا در دریافت فهرست محصولات
              </p>
              <Button variant="outline" size="sm" onClick={() => refetchProducts()}>
                <RefreshCw className="ml-1 h-4 w-4" />
                تلاش مجدد
              </Button>
            </div>
          )}
          {productsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              محصولی با منبع «خریداری‌شده» یافت نشد. ابتدا در صفحه حسابداری،
              محصول را به منبع خریداری‌شده تبدیل کنید.
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[1fr_100px_120px_120px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                <span>محصول</span>
                <span>تعداد</span>
                <span>هزینه واحد</span>
                <span>جمع قلم</span>
                <span />
              </div>
              {lines.map((l) => {
                const product = selectedProduct(l.productId);
                const lineTotal = toNum(l.quantity) * toNum(l.unitCost);
                return (
                  <div
                    key={l.key}
                    className="grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-[1fr_100px_120px_120px_36px] md:items-center"
                  >
                    <select
                      value={l.productId}
                      onChange={(e) =>
                        updateLine(l.key, {
                          productId: e.target.value,
                          variantId: "",
                        })
                      }
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="">انتخاب محصول...</option>
                      {products.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.name}
                          {p.hasVariants ? " (دارای تنوع)" : ""}
                        </option>
                      ))}
                    </select>
                    {product?.hasVariants && (product.variants?.length ?? 0) > 0 && (
                      <select
                        value={l.variantId}
                        onChange={(e) => updateLine(l.key, { variantId: e.target.value })}
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      >
                        <option value="">انتخاب تنوع...</option>
                        {(product.variants ?? []).map((v) => (
                          <option key={String(v._id)} value={String(v._id)}>
                            {v.sku || "بدون برچسب"}
                          </option>
                        ))}
                      </select>
                    )}
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      placeholder="تعداد"
                      className="h-10"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={l.unitCost}
                      onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                      placeholder="هزینه واحد"
                      className="h-10"
                    />
                    <div className="flex items-center justify-between md:block">
                      <span className="text-sm font-semibold md:hidden">جمع:</span>
                      <span className="text-sm font-semibold">
                        {formatPrice(lineTotal)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive"
                      onClick={() => removeLine(l.key)}
                      disabled={lines.length === 1}
                      aria-label="حذف قلم"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>

      {/* Totals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">جمع‌بندی</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">تخفیف (تومان)</label>
            <Input
              type="text"
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="۰"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">هزینه‌های اضافی (تومان)</label>
            <Input
              type="text"
              inputMode="numeric"
              value={additionalCosts}
              onChange={(e) => setAdditionalCosts(e.target.value)}
              placeholder="۰"
            />
          </div>
          <div className="flex flex-col justify-end rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">جمع جزء</span>
              <span>{formatPrice(liveTotals.subtotal)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">تخفیف</span>
              <span>- {formatPrice(toNum(discount))}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">هزینه اضافی</span>
              <span>+ {formatPrice(toNum(additionalCosts))}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <span className="font-semibold">جمع کل</span>
              <span className="text-lg font-bold">{formatPrice(liveTotals.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={createPurchase.isPending}
          className="gap-2"
        >
          {createPurchase.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          ایجاد خرید (پیش‌نویس)
        </Button>
      </div>
    </div>
  );
}
