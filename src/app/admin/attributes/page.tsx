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
  Palette,
  Save,
  X,
  ListChecks,
} from "lucide-react";
import {
  useAttributes,
  useCreateAttribute,
  useUpdateAttribute,
  useDeleteAttribute,
  type AdminAttribute,
  type AttributeFormData,
} from "@/hooks/use-admin-attributes";
import { slugify } from "@/lib/utils";

const TYPE_LABELS: Record<AdminAttribute["type"], string> = {
  text: "متنی",
  color: "رنگ",
  size: "سایز",
  number: "عددی",
};

const emptyForm: AttributeFormData = {
  name: "",
  slug: "",
  type: "text",
  values: [],
  isActive: true,
};

export default function AdminAttributesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<AttributeFormData>(emptyForm);
  const [valuesText, setValuesText] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: attributes, isLoading, isError, refetch } = useAttributes();
  const createAttribute = useCreateAttribute();
  const updateAttribute = useUpdateAttribute();
  const deleteAttribute = useDeleteAttribute();

  // Search filter
  const filteredAttributes = useMemo(() => {
    if (!attributes) return [];
    if (!searchQuery.trim()) return attributes;

    const lower = searchQuery.toLowerCase();
    return attributes.filter(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        a.slug.toLowerCase().includes(lower) ||
        a.values.some((v) => v.toLowerCase().includes(lower))
    );
  }, [attributes, searchQuery]);

  const openCreateForm = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setValuesText("");
    setShowForm(true);
  };

  const openEditForm = (attr: AdminAttribute) => {
    setEditingId(attr._id);
    setFormData({
      name: attr.name,
      slug: attr.slug,
      type: attr.type,
      values: attr.values || [],
      isActive: attr.isActive ?? true,
    });
    setValuesText((attr.values || []).join("، "));
    setShowForm(true);
  };

  const handleNameChange = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: editingId ? prev.slug : slugify(name),
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      showToast.error("نام ویژگی الزامی است");
      return;
    }
    if (!formData.slug.trim()) {
      showToast.error("اسلاگ ویژگی الزامی است");
      return;
    }

    // Parse comma-separated values
    const values = valuesText
      .split(/[،,]/)
      .map((v) => v.trim())
      .filter(Boolean);

    try {
      if (editingId) {
        await updateAttribute.mutateAsync({ id: editingId, data: { ...formData, values } });
        showToast.success("ویژگی با موفقیت به‌روزرسانی شد");
      } else {
        await createAttribute.mutateAsync({ ...formData, values });
        showToast.success("ویژگی با موفقیت ایجاد شد");
      }
      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm);
      setValuesText("");
      refetch();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data?.error || "خطا"
          : "خطا در ذخیره ویژگی";
      showToast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAttribute.mutateAsync(id);
      showToast.success("ویژگی با موفقیت حذف شد");
      setDeleteConfirmId(null);
      refetch();
    } catch {
      showToast.error("خطا در حذف ویژگی");
    }
  };

  const isSubmitting = createAttribute.isPending || updateAttribute.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مدیریت ویژگی‌ها</h1>
          <p className="text-sm text-muted-foreground">
            ویژگی‌های تنوع محصول (رنگ، سایز و ...) را تعریف کنید
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`ml-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            بروزرسانی
          </Button>
          <Button onClick={openCreateForm} disabled={showForm}>
            <Plus className="ml-2 h-4 w-4" />
            ویژگی جدید
          </Button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId ? "ویرایش ویژگی" : "ویژگی جدید"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">نام ویژگی *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="مثال: رنگ"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">اسلاگ *</label>
                <Input
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      slug: slugify(e.target.value),
                    }))
                  }
                  placeholder="مثال: color"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">نوع</label>
                <select
                  value={formData.type}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      type: e.target.value as AdminAttribute["type"],
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="text">متنی</option>
                  <option value="color">رنگ</option>
                  <option value="size">سایز</option>
                  <option value="number">عددی</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">مقادیر مجاز (با ویرگول جدا کنید)</label>
                <Input
                  value={valuesText}
                  onChange={(e) => setValuesText(e.target.value)}
                  placeholder="مثال: قرمز، آبی، سبز"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={formData.isActive}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      isActive: !prev.isActive,
                    }))
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.isActive ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      formData.isActive
                        ? "translate-x-[22px]"
                        : "translate-x-[2px]"
                    }`}
                  />
                </button>
                <span className="text-sm text-muted-foreground">
                  {formData.isActive ? "فعال" : "غیرفعال"}
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <Button onClick={handleSubmit} loading={isSubmitting}>
                <Save className="ml-2 h-4 w-4" />
                {editingId ? "ذخیره تغییرات" : "ایجاد ویژگی"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setFormData(emptyForm);
                  setValuesText("");
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
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
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
                خطا در بارگذاری ویژگی‌ها
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
      {attributes && attributes.length > 0 && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی ویژگی..."
            className="pr-9"
          />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && attributes?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Palette className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">هیچ ویژگی‌ای وجود ندارد</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              برای ساخت تنوع محصول، ابتدا ویژگی‌هایی مثل رنگ و سایز تعریف کنید
            </p>
            <Button onClick={openCreateForm}>
              <Plus className="ml-2 h-4 w-4" />
              ایجاد ویژگی
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Attributes List */}
      {!isLoading && !isError && filteredAttributes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground px-1">
            {filteredAttributes.length} ویژگی
            {searchQuery && filteredAttributes.length !== attributes?.length && (
              <span> (از {attributes?.length} ویژگی)</span>
            )}
          </div>

          {filteredAttributes.map((attr) => (
            <div
              key={attr._id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
            >
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-100 to-zinc-200 text-muted-foreground dark:from-zinc-800 dark:to-zinc-700">
                <Palette className="h-5 w-5" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {attr.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {TYPE_LABELS[attr.type] || attr.type}
                  </Badge>
                  {!attr.isActive && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      غیرفعال
                    </Badge>
                  )}
                  <span
                    className="text-[10px] text-muted-foreground font-mono"
                    dir="ltr"
                  >
                    /{attr.slug}
                  </span>
                </div>
                {attr.values && attr.values.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <ListChecks className="h-3 w-3 text-muted-foreground" />
                    {attr.values.map((v, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => openEditForm(attr)}
                  title="ویرایش"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                {deleteConfirmId === attr._id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs px-2"
                      onClick={() => handleDelete(attr._id)}
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
                    onClick={() => setDeleteConfirmId(attr._id)}
                    title="حذف"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      <Card className="border-muted">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <strong>راهنما:</strong> ویژگی‌ها ابعاد تنوع محصول را تعریف می‌کنند
            (مثل «رنگ» و «سایز»). پس از تعریف ویژگی و مقادیر آن، در فرم
            ایجاد/ویرایش محصول می‌توانید ترکیب‌های مختلف را بسازید.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
