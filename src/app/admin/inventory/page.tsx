"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import {
  ArrowDownUp,
  Package,
  Layers,
  History,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  Check,
  Minus,
  Plus,
} from "lucide-react";
import { useAdminProducts } from "@/hooks/use-admin-products";
import {
  useInventoryMovements,
  useInventoryLayers,
  useCreateInventoryAdjustment,
} from "@/hooks/use-admin-inventory";
import { showToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/utils";
import type { AdminProduct, InventoryMovementType } from "@/types";

const MOVEMENT_CONFIG: Record<
  InventoryMovementType,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  opening_balance: { label: "موجودی اولیه", variant: "secondary" },
  receipt: { label: "دریافت خرید", variant: "success" },
  sale: { label: "فروش", variant: "default" },
  return_restock: { label: "بازگشت بازپرداخت", variant: "success" },
  cancellation_restock: { label: "بازگشت لغو", variant: "success" },
  purchase_return: { label: "مرجوعی خرید", variant: "warning" },
  adjustment: { label: "تعدیل", variant: "warning" },
  sourcing_change: { label: "تغییر منبع", variant: "destructive" },
};

const LAYER_SOURCE_LABEL: Record<string, string> = {
  opening: "موجودی اولیه",
  receipt: "دریافت",
  adjustment: "تعدیل",
};

const PAGE_SIZE = 20;
const sign = (n: number) => (n > 0 ? "+" : "");

export default function AdminInventoryPage() {
  const [tab, setTab] = useState<"adjust" | "movements" | "layers">("adjust");

  // ---- Adjustment form ----
  const {
    data: productsData,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useAdminProducts({ limit: 200 });
  const products = useMemo(() => productsData?.data ?? [], [productsData]);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [delta, setDelta] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const adjust = useCreateInventoryAdjustment();

  const selected: AdminProduct | undefined = products.find(
    (p) => p._id === productId
  );
  const selectedVariants = useMemo(
    () =>
      selected?.hasVariants && selected.variants?.length
        ? selected.variants.filter((v) => v.isActive !== false)
        : [],
    [selected]
  );
  const selectedVariant = selectedVariants.find((v) => v._id === variantId);
  const currentStock = selectedVariant
    ? selectedVariant.stock
    : selected?.hasVariants
      ? selectedVariants.reduce((a, v) => a + (v.stock ?? 0), 0)
      : (selected?.stock ?? 0);
  const deltaNum = Number(delta.replace(/[^\d-]/g, "")) || 0;
  const resultingStock = currentStock + deltaNum;
  const isPurchased = selected?.sourcing === "purchased";
  const unitCostNum = Number(unitCost.replace(/[^\d]/g, "")) || 0;
  const costImpact = deltaNum > 0 && isPurchased ? deltaNum * unitCostNum : null;

  const openConfirm = () => {
    setFormError("");
    if (!selected) return setFormError("محصول را انتخاب کنید");
    if (selected?.hasVariants && !variantId)
      return setFormError("تنوع را انتخاب کنید");
    if (deltaNum === 0) return setFormError("مقدار تعدیل را وارد کنید");
    if (resultingStock < 0)
      return setFormError(`موجودی کافی نیست (فعلی: ${currentStock})`);
    if (!reason.trim() || reason.trim().length < 2)
      return setFormError("دلیل تعدیل (حداقل ۲ نویسه) الزامی است");
    if (deltaNum > 0 && isPurchased && unitCostNum <= 0)
      return setFormError(
        "برای افزایش موجودی کالای خریداری‌شده، هزینه واحد تعدیل الزامی است"
      );
    setConfirmOpen(true);
  };

  const submitAdjustment = async () => {
    const key = `e2e-inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const res = await adjust.mutateAsync({
        product: productId,
        ...(variantId ? { variantId } : {}),
        quantityDelta: deltaNum,
        ...(deltaNum > 0 && isPurchased ? { unitCost: unitCostNum } : {}),
        reason: reason.trim(),
        notes: notes.trim() || undefined,
        key,
      });
      showToast.success(
        res.idempotent ? "این تعدیل قبلاً ثبت شده بود" : "تعدیل موجودی با موفقیت ثبت شد"
      );
      setConfirmOpen(false);
      setDelta("");
      setUnitCost("");
      setReason("");
      setNotes("");
      refetchProducts();
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error || "خطا در ثبت تعدیل";
      showToast.error(msg);
    }
  };

  // ---- Movements tab ----
  const [mvType, setMvType] = useState("");
  const [mvSearch, setMvSearch] = useState("");
  const [mvFrom, setMvFrom] = useState("");
  const [mvTo, setMvTo] = useState("");
  const [mvPage, setMvPage] = useState(1);
  const mvParams = useMemo(() => {
    const p: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (mvType) p.type = mvType;
    if (mvSearch.trim()) p.search = mvSearch.trim();
    if (mvFrom) p.from = mvFrom;
    if (mvTo) p.to = mvTo;
    if (mvPage > 1) p.page = String(mvPage);
    return p;
  }, [mvType, mvSearch, mvFrom, mvTo, mvPage]);
  const movements = useInventoryMovements(mvParams);

  // ---- Layers tab ----
  const [layerProduct, setLayerProduct] = useState("");
  const [layerPage, setLayerPage] = useState(1);
  const layerParams = useMemo(() => {
    const p: Record<string, string> = { limit: "100" };
    if (layerProduct) p.product = layerProduct;
    if (layerPage > 1) p.page = String(layerPage);
    return p;
  }, [layerProduct, layerPage]);
  const layers = useInventoryLayers(layerParams);
  const layerSummary = useMemo(() => {
    const rows = layers.data?.data ?? [];
    return {
      count: rows.length,
      remaining: rows.reduce((a, r) => a + r.remaining, 0),
      value: rows.reduce((a, r) => a + r.value, 0),
    };
  }, [layers.data]);

  const productName = (p: AdminProduct) =>
    p.hasVariants ? `${p.name} (تنوع‌دار)` : p.name;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">انبار</h1>
          <p className="text-sm text-muted-foreground">
            تعدیل موجودی، سوابق جابه‌جایی و لایه‌های هزینه FIFO — هر تغییر پس از
            فعال‌شدن حسابداری در اینجا ثبت می‌شود
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/reports/inventory">
            <Package className="ml-2 h-4 w-4" />
            گزارش موجودی
          </Link>
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              لایه‌های فعال هزینه
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {layers.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              layerSummary.count
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              واحد باقی‌مانده در لایه‌ها
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {layers.isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              layerSummary.remaining.toLocaleString("fa-IR")
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              ارزش لایه‌ها (Σ باقی‌مانده × هزینه واحد)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {layers.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              formatPrice(layerSummary.value)
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "adjust", label: "تعدیل موجودی", icon: ArrowDownUp },
            { key: "movements", label: "سوابق جابه‌جایی", icon: History },
            { key: "layers", label: "لایه‌های هزینه", icon: Layers },
          ] as const
        ).map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            <t.icon className="ml-2 h-4 w-4" />
            {t.label}
          </Button>
        ))}
      </div>

      {/* ================= ADJUSTMENT TAB ================= */}
      {tab === "adjust" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDownUp className="h-5 w-5" />
              ثبت تعدیل موجودی
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {productsError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                خطا در بارگذاری محصولات
                <Button variant="outline" size="sm" onClick={() => refetchProducts()}>
                  <RefreshCw className="ml-1 h-3 w-3" />
                  تلاش مجدد
                </Button>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">محصول</label>
                {productsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setVariantId("");
                    }}
                  >
                    <option value="">انتخاب محصول...</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>
                        {productName(p)} — {formatPrice(p.price)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedVariants.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">تنوع</label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={variantId}
                    onChange={(e) => setVariantId(e.target.value)}
                  >
                    <option value="">انتخاب تنوع...</option>
                    {selectedVariants.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.attributes?.map((a) => `${a.name}: ${a.value}`).join("، ") ||
                          v.sku}{" "}
                        — {v.stock} واحد
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selected && (
                <div className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">منبع کالا:</span>
                    <Badge variant={isPurchased ? "default" : "secondary"}>
                      {isPurchased ? "خریداری‌شده (FIFO)" : "امانی (فروشنده)"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">موجودی فعلی:</span>
                    <span className="font-bold">
                      {currentStock.toLocaleString("fa-IR")} واحد
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  مقدار تعدیل (مثبت = افزایش / منفی = کاهش)
                </label>
                <Input
                  inputMode="numeric"
                  placeholder="مثلاً 5- یا 10"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
              </div>

              {deltaNum > 0 && isPurchased && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    هزینه واحد تعدیل (تومان){" "}
                    <span className="text-destructive">*</span>
                  </label>
                  <Input
                    inputMode="numeric"
                    placeholder="هزینه تأییدشده هر واحد"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    این هزینه به‌صورت یک لایه FIFO جدید ثبت می‌شود — هرگز به‌صورت
                    خودکار از قیمت فعلی فروشنده استفاده نمی‌شود.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  دلیل تعدیل <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder="مثلاً: آسیب دیدگی، کمبود فیزیکی، ورودی انبار"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">توضیحات (اختیاری)</label>
                <Textarea
                  rows={2}
                  placeholder="توضیحات تکمیلی"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Live preview */}
            {selected && deltaNum !== 0 && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span>
                    فعلی: <b>{currentStock.toLocaleString("fa-IR")}</b>
                  </span>
                  <Minus className="h-4 w-4 text-muted-foreground" />
                  <span
                    className={
                      deltaNum > 0 ? "text-success" : "text-destructive"
                    }
                  >
                    {sign(deltaNum)}
                    {deltaNum.toLocaleString("fa-IR")}
                  </span>
                  <Minus className="h-4 w-4 text-muted-foreground" />
                  <span>
                    نتیجه:{" "}
                    <b
                      className={
                        resultingStock < 0 ? "text-destructive" : undefined
                      }
                    >
                      {resultingStock.toLocaleString("fa-IR")}
                    </b>
                  </span>
                  {costImpact !== null && (
                    <span>
                      اثر هزینه: <b>{formatPrice(costImpact)}</b>
                    </span>
                  )}
                  {deltaNum < 0 && isPurchased && (
                    <span className="text-muted-foreground">
                      (هزینه مصرفی از لایه‌های FIFO به‌صورت سرور محاسبه می‌شود)
                    </span>
                  )}
                </div>
              </div>
            )}

            {formError && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {formError}
              </p>
            )}

            <div className="flex justify-end">
              <Button onClick={openConfirm} disabled={adjust.isPending}>
                {adjust.isPending ? "در حال ثبت..." : "ثبت تعدیل"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= MOVEMENTS TAB ================= */}
      {tab === "movements" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              سوابق جابه‌جایی انبار
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={mvType}
                onChange={(e) => {
                  setMvType(e.target.value);
                  setMvPage(1);
                }}
              >
                <option value="">همه انواع</option>
                {Object.entries(MOVEMENT_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>
                    {cfg.label}
                  </option>
                ))}
              </select>
              <Input
                placeholder="جستجوی محصول / توضیح / منبع"
                value={mvSearch}
                onChange={(e) => {
                  setMvSearch(e.target.value);
                  setMvPage(1);
                }}
              />
              <Input
                type="date"
                value={mvFrom}
                onChange={(e) => {
                  setMvFrom(e.target.value);
                  setMvPage(1);
                }}
              />
              <Input
                type="date"
                value={mvTo}
                onChange={(e) => {
                  setMvTo(e.target.value);
                  setMvPage(1);
                }}
              />
            </div>

            {movements.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : movements.isError ? (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                خطا در دریافت سوابق
              </p>
            ) : (movements.data?.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                جابه‌جایی‌ای یافت نشد.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-muted-foreground">
                      <th className="py-2 pr-2">تاریخ</th>
                      <th className="py-2 pr-2">محصول</th>
                      <th className="py-2 pr-2">نوع</th>
                      <th className="py-2 pr-2">تعداد</th>
                      <th className="py-2 pr-2">هزینه واحد</th>
                      <th className="py-2 pr-2">هزینه کل</th>
                      <th className="py-2 pr-2">منبع</th>
                      <th className="py-2 pr-2">توضیح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(movements.data?.data ?? []).map((mv) => {
                      const cfg = MOVEMENT_CONFIG[mv.type] ?? {
                        label: mv.type,
                        variant: "secondary",
                      };
                      const name =
                        typeof mv.product === "object" && mv.product
                          ? mv.product.name
                          : String(mv.product).slice(-8);
                      return (
                        <tr key={mv._id} className="border-b last:border-0">
                          <td className="py-2 pr-2 whitespace-nowrap text-xs">
                            {new Date(mv.createdAt).toLocaleDateString("fa-IR")}
                          </td>
                          <td className="py-2 pr-2">{name}</td>
                          <td className="py-2 pr-2">
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                          </td>
                          <td
                            className={`py-2 pr-2 font-bold ${
                              mv.quantity < 0 ? "text-destructive" : "text-success"
                            }`}
                          >
                            {sign(mv.quantity)}
                            {mv.quantity.toLocaleString("fa-IR")}
                          </td>
                          <td className="py-2 pr-2">
                            {formatPrice(mv.unitCost)}
                          </td>
                          <td className="py-2 pr-2">
                            {formatPrice(mv.totalCost)}
                          </td>
                          <td className="py-2 pr-2 font-mono text-xs" dir="ltr">
                            {mv.sourceRef}
                          </td>
                          <td className="py-2 pr-2 text-xs text-muted-foreground">
                            {mv.description}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {(movements.data?.totalPages ?? 1) > 1 && (
              <PaginationControls
                page={mvPage}
                totalPages={movements.data?.totalPages ?? 1}
                onPageChange={setMvPage}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ================= LAYERS TAB ================= */}
      {tab === "layers" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              لایه‌های هزینه FIFO (فعال)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={layerProduct}
                onChange={(e) => {
                  setLayerProduct(e.target.value);
                  setLayerPage(1);
                }}
              >
                <option value="">همه محصولات</option>
                {products.map((p) => (
                  <option key={p._id} value={p._id}>
                    {productName(p)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                لایه‌های کاملاً مصرف‌شده در «سوابق جابه‌جایی» قابل پیگیری هستند.
              </span>
            </div>

            {layers.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : layers.isError ? (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                خطا در دریافت لایه‌ها
              </p>
            ) : (layers.data?.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لایه هزینه فعالی یافت نشد — با دریافت خرید یا تعدیل مثبت ایجاد
                می‌شود.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-muted-foreground">
                      <th className="py-2 pr-2">محصول</th>
                      <th className="py-2 pr-2">تنوع</th>
                      <th className="py-2 pr-2">باقی‌مانده</th>
                      <th className="py-2 pr-2">هزینه واحد</th>
                      <th className="py-2 pr-2">ارزش لایه</th>
                      <th className="py-2 pr-2">تاریخ ایجاد</th>
                      <th className="py-2 pr-2">منبع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(layers.data?.data ?? []).map((r, i) => (
                      <tr key={`${r.ref}-${i}`} className="border-b last:border-0">
                        <td className="py-2 pr-2">
                          {r.productName}
                          <span className="mr-1 text-xs text-muted-foreground" dir="ltr">
                            ({r.slug})
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          {r.variantId ? r.variantLabel || r.variantSku : "—"}
                        </td>
                        <td className="py-2 pr-2 font-bold">
                          {r.remaining.toLocaleString("fa-IR")}
                        </td>
                        <td className="py-2 pr-2">{formatPrice(r.unitCost)}</td>
                        <td className="py-2 pr-2 font-bold">
                          {formatPrice(r.value)}
                        </td>
                        <td className="py-2 pr-2 text-xs">
                          {new Date(r.acquiredAt).toLocaleDateString("fa-IR")}
                        </td>
                        <td className="py-2 pr-2">
                          <Badge variant="secondary">
                            {LAYER_SOURCE_LABEL[r.source] ?? r.source}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(layers.data?.totalPages ?? 1) > 1 && (
              <PaginationControls
                page={layerPage}
                totalPages={layers.data?.totalPages ?? 1}
                onPageChange={setLayerPage}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ================= CONFIRMATION MODAL ================= */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg">
            <div className="mb-4 flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  deltaNum < 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-success/10 text-success"
                }`}
              >
                {deltaNum < 0 ? (
                  <Minus className="h-5 w-5" />
                ) : (
                  <Plus className="h-5 w-5" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-bold">تأیید تعدیل موجودی</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  این تغییر به‌صورت دائمی در سوابق انبار ثبت می‌شود.
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">محصول</span>
                <span>{selected?.name}</span>
              </div>
              {selectedVariant && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">تنوع</span>
                  <span>
                    {selectedVariant.attributes
                      ?.map((a) => `${a.name}: ${a.value}`)
                      .join("، ") || selectedVariant.sku}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">موجودی فعلی</span>
                <span>{currentStock.toLocaleString("fa-IR")} واحد</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">مقدار تعدیل</span>
                <span
                  className={
                    deltaNum < 0 ? "text-destructive" : "text-success"
                  }
                >
                  {sign(deltaNum)}
                  {deltaNum.toLocaleString("fa-IR")} واحد
                </span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="font-medium">موجودی نتیجه</span>
                <span className="font-bold">
                  {resultingStock.toLocaleString("fa-IR")} واحد
                </span>
              </div>
              {costImpact !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">اثر هزینه (لایه جدید)</span>
                  <span>{formatPrice(costImpact)}</span>
                </div>
              )}
              {deltaNum < 0 && isPurchased && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">اثر هزینه</span>
                  <span className="text-muted-foreground">
                    از لایه‌های FIFO (سرور)
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">دلیل</span>
                <span>{reason.trim()}</span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={adjust.isPending}
              >
                انصراف
              </Button>
              <Button
                variant={deltaNum < 0 ? "destructive" : "default"}
                onClick={submitAdjustment}
                disabled={adjust.isPending}
              >
                {adjust.isPending ? "در حال ثبت..." : "تأیید و ثبت"}
                <Check className="mr-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Post-cutover hint */}
      {tab === "adjust" && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          پس از فعال‌شدن حسابداری، تغییر مستقیم موجودی از فرم محصول مسدود است —
          همه تغییرات باید از همین صفحه ثبت شوند تا سوابق انبار کامل بماند.
        </p>
      )}
    </div>
  );
}
