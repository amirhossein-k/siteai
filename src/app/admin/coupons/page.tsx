"use client";

import { useState, useMemo } from "react";
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
import { showToast } from "@/components/ui/toast";
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  AlertCircle,
  RefreshCw,
  Save,
  X,
  Ticket,
  Percent,
  Banknote,
} from "lucide-react";
import {
  useCoupons,
  useCreateCoupon,
  useUpdateCoupon,
  useDeleteCoupon,
  type CouponFormData,
} from "@/hooks/use-admin-coupons";
import type { AdminCoupon } from "@/types";

const emptyForm: CouponFormData = {
  code: "",
  type: "percent",
  value: 10,
  minSubtotal: 0,
  maxDiscount: 0,
  startsAt: null,
  endsAt: null,
  isActive: true,
  isPublic: false,
  usageLimit: 0,
  perUserLimit: 0,
};

function formatToman(n: number): string {
  return n.toLocaleString("fa-IR") + " تومان";
}

export default function AdminCouponsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CouponFormData>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: coupons, isLoading, isError, refetch } = useCoupons();
  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const deleteCoupon = useDeleteCoupon();

  const filteredCoupons = useMemo(() => {
    if (!coupons) return [];
    if (!searchQuery.trim()) return coupons;
    const lower = searchQuery.toLowerCase();
    return coupons.filter((c) => c.code.toLowerCase().includes(lower));
  }, [coupons, searchQuery]);

  const openCreateForm = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (coupon: AdminCoupon) => {
    setEditingId(coupon._id);
    setFormData({
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      minSubtotal: coupon.minSubtotal,
      maxDiscount: coupon.maxDiscount,
      startsAt: coupon.startsAt ? coupon.startsAt.slice(0, 16) : null,
      endsAt: coupon.endsAt ? coupon.endsAt.slice(0, 16) : null,
      isActive: coupon.isActive,
      isPublic: coupon.isPublic,
      usageLimit: coupon.usageLimit,
      perUserLimit: coupon.perUserLimit,
    });
    setShowForm(true);
  };

  const setNumber = (key: keyof CouponFormData, raw: string) => {
    const n = raw === "" ? 0 : Number(raw);
    setFormData((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const handleSubmit = async () => {
    if (!formData.code.trim()) {
      showToast.error("کد تخفیف الزامی است");
      return;
    }
    if (formData.type === "percent" && formData.value > 100) {
      showToast.error("درصد تخفیف نمی‌تواند بیشتر از ۱۰۰ باشد");
      return;
    }

    try {
      if (editingId) {
        await updateCoupon.mutateAsync({ id: editingId, data: formData });
        showToast.success("کد تخفیف با موفقیت به‌روزرسانی شد");
      } else {
        await createCoupon.mutateAsync(formData);
        showToast.success("کد تخفیف با موفقیت ایجاد شد");
      }
      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm);
      refetch();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا"
          : "خطا در ذخیره کد تخفیف";
      showToast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCoupon.mutateAsync(id);
      showToast.success("کد تخفیف با موفقیت حذف شد");
      setDeleteConfirmId(null);
      refetch();
    } catch {
      showToast.error("خطا در حذف کد تخفیف");
    }
  };

  const isSubmitting = createCoupon.isPending || updateCoupon.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">کدهای تخفیف</h1>
          <p className="text-sm text-muted-foreground">
            ایجاد و مدیریت کدهای تخفیف سفارش (درصدی یا مبلغی)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`ml-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            بروزرسانی
          </Button>
          <Button onClick={openCreateForm} disabled={showForm}>
            <Plus className="ml-2 h-4 w-4" />
            کد تخفیف جدید
          </Button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId ? "ویرایش کد تخفیف" : "کد تخفیف جدید"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">کد تخفیف *</label>
                <Input
                  value={formData.code}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="مثال: SAVE10"
                  dir="ltr"
                  className="text-left font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">نوع تخفیف *</label>
                <select
                  value={formData.type}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      type: e.target.value as "percent" | "fixed",
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="percent">درصدی</option>
                  <option value="fixed">مبلغی (تومان)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {formData.type === "percent" ? "درصد تخفیف *" : "مبلغ تخفیف (تومان) *"}
                </label>
                <Input
                  type="number"
                  value={formData.value || ""}
                  onChange={(e) => setNumber("value", e.target.value)}
                  placeholder={formData.type === "percent" ? "مثال: 10" : "مثال: 100000"}
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">حداقل مبلغ سبد (تومان)</label>
                <Input
                  type="number"
                  value={formData.minSubtotal || ""}
                  onChange={(e) => setNumber("minSubtotal", e.target.value)}
                  placeholder="۰ = بدون شرط"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">سقف تخفیف (تومان، فقط درصدی)</label>
                <Input
                  type="number"
                  value={formData.maxDiscount || ""}
                  onChange={(e) => setNumber("maxDiscount", e.target.value)}
                  placeholder="۰ = بدون سقف"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">سقف استفاده کل</label>
                <Input
                  type="number"
                  value={formData.usageLimit || ""}
                  onChange={(e) => setNumber("usageLimit", e.target.value)}
                  placeholder="۰ = نامحدود"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">سقف استفاده هر کاربر</label>
                <Input
                  type="number"
                  value={formData.perUserLimit || ""}
                  onChange={(e) => setNumber("perUserLimit", e.target.value)}
                  placeholder="۰ = نامحدود"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">شروع اعتبار</label>
                <Input
                  type="datetime-local"
                  value={formData.startsAt || ""}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, startsAt: e.target.value || null }))
                  }
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">پایان اعتبار</label>
                <Input
                  type="datetime-local"
                  value={formData.endsAt || ""}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, endsAt: e.target.value || null }))
                  }
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={formData.isActive}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.isActive ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      formData.isActive ? "translate-x-[22px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="text-sm text-muted-foreground">
                  {formData.isActive ? "فعال" : "غیرفعال"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={formData.isPublic}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, isPublic: !prev.isPublic }))
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.isPublic ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      formData.isPublic ? "translate-x-[22px]" : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="text-sm text-muted-foreground">
                  {formData.isPublic ? "عمومی (نمایش در فروشگاه)" : "خصوصی"}
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <Button onClick={handleSubmit} loading={isSubmitting}>
                <Save className="ml-2 h-4 w-4" />
                {editingId ? "ذخیره تغییرات" : "ایجاد کد تخفیف"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setFormData(emptyForm);
                }}
              >
                انصراف
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                خطا در بارگذاری کدهای تخفیف
              </p>
              <p className="text-xs text-red-600/70 dark:text-red-400/70">
                لطفاً صفحه را بروزرسانی کنید
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {coupons && coupons.length > 0 && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی کد تخفیف..."
            className="pr-9 font-mono"
            dir="ltr"
          />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && coupons?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Ticket className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">هیچ کد تخفیفی وجود ندارد</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              اولین کد تخفیف را ایجاد کنید
            </p>
            <Button onClick={openCreateForm}>
              <Plus className="ml-2 h-4 w-4" />
              ایجاد کد تخفیف
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Coupons List */}
      {!isLoading && !isError && filteredCoupons.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground px-1">
            {filteredCoupons.length} کد تخفیف
            {searchQuery && filteredCoupons.length !== coupons?.length && (
              <span> (از {coupons?.length} کد)</span>
            )}
          </div>

          {filteredCoupons.map((coupon) => {
            const isExpired =
              coupon.endsAt && new Date(coupon.endsAt).getTime() < Date.now();
            const isLimitReached =
              coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit;
            return (
              <div
                key={coupon._id}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-600 dark:from-emerald-900 dark:to-emerald-800">
                  {coupon.type === "percent" ? (
                    <Percent className="h-4 w-4" />
                  ) : (
                    <Banknote className="h-4 w-4" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono" dir="ltr">
                      {coupon.code}
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {coupon.type === "percent"
                        ? `٪${coupon.value}`
                        : formatToman(coupon.value)}
                    </Badge>
                    {!coupon.isActive && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        غیرفعال
                      </Badge>
                    )}
                    {coupon.isPublic && (
                      <Badge variant="success" className="text-[10px] px-1.5 py-0">
                        عمومی
                      </Badge>
                    )}
                    {isExpired && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        منقضی شده
                      </Badge>
                    )}
                    {isLimitReached && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        تمام شده
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>
                      استفاده: {coupon.usedCount.toLocaleString("fa-IR")}
                      {coupon.usageLimit > 0
                        ? ` / ${coupon.usageLimit.toLocaleString("fa-IR")}`
                        : ""}
                    </span>
                    {coupon.minSubtotal > 0 && (
                      <span>حداقل سبد: {formatToman(coupon.minSubtotal)}</span>
                    )}
                    {coupon.maxDiscount > 0 && (
                      <span>سقف: {formatToman(coupon.maxDiscount)}</span>
                    )}
                    {coupon.perUserLimit > 0 && (
                      <span>هر کاربر: {coupon.perUserLimit.toLocaleString("fa-IR")}</span>
                    )}
                    {coupon.startsAt && (
                      <span>
                        از {new Date(coupon.startsAt).toLocaleDateString("fa-IR")}
                      </span>
                    )}
                    {coupon.endsAt && (
                      <span>
                        تا {new Date(coupon.endsAt).toLocaleDateString("fa-IR")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => openEditForm(coupon)}
                    title="ویرایش"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  {deleteConfirmId === coupon._id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs px-2"
                        onClick={() => handleDelete(coupon._id)}
                      >
                        حذف شود
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirmId(coupon._id)}
                      title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Help Text */}
      <Card className="border-muted">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <strong>راهنما:</strong> کدهای تخفیف روی کل مبلغ سبد خرید اعمال
            می‌شوند. تخفیف توسط سرور و پس از بررسی قیمت‌ها محاسبه می‌شود و
            سهمیه استفاده از کد هنگام ثبت سفارش رزرو می‌شود.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
