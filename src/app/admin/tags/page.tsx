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
  Tags,
  Save,
  X,
} from "lucide-react";
import {
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  type AdminTag,
  type TagFormData,
} from "@/hooks/use-admin-tags";
import { slugify } from "@/lib/utils";

const emptyForm: TagFormData = {
  name: "",
  slug: "",
  isActive: true,
};

export default function AdminTagsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TagFormData>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: tags, isLoading, isError, refetch } = useTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  // Search filter
  const filteredTags = useMemo(() => {
    if (!tags) return [];
    if (!searchQuery.trim()) return tags;

    const lower = searchQuery.toLowerCase();
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.slug.toLowerCase().includes(lower)
    );
  }, [tags, searchQuery]);

  const openCreateForm = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (tag: AdminTag) => {
    setEditingId(tag._id);
    setFormData({
      name: tag.name,
      slug: tag.slug,
      isActive: tag.isActive ?? true,
    });
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
      showToast.error("نام برچسب الزامی است");
      return;
    }
    if (!formData.slug.trim()) {
      showToast.error("اسلاگ برچسب الزامی است");
      return;
    }

    try {
      if (editingId) {
        await updateTag.mutateAsync({ id: editingId, data: formData });
        showToast.success("برچسب با موفقیت به‌روزرسانی شد");
      } else {
        await createTag.mutateAsync(formData);
        showToast.success("برچسب با موفقیت ایجاد شد");
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
          : "خطا در ذخیره برچسب";
      showToast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTag.mutateAsync(id);
      showToast.success("برچسب با موفقیت حذف شد");
      setDeleteConfirmId(null);
      refetch();
    } catch {
      showToast.error("خطا در حذف برچسب");
    }
  };

  const isSubmitting = createTag.isPending || updateTag.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مدیریت برچسب‌ها</h1>
          <p className="text-sm text-muted-foreground">
            ایجاد، ویرایش و مدیریت برچسب‌های محصولات
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
            برچسب جدید
          </Button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId ? "ویرایش برچسب" : "برچسب جدید"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">نام برچسب *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="مثال: پرطرفدار"
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
                  placeholder="مثال: popular"
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
                {editingId ? "ذخیره تغییرات" : "ایجاد برچسب"}
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
                خطا در بارگذاری برچسب‌ها
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
      {tags && tags.length > 0 && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی برچسب..."
            className="pr-9"
          />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && tags?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Tags className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">هیچ برچسبی وجود ندارد</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              اولین برچسب را ایجاد کنید
            </p>
            <Button onClick={openCreateForm}>
              <Plus className="ml-2 h-4 w-4" />
              ایجاد برچسب
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tags List */}
      {!isLoading && !isError && filteredTags.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground px-1">
            {filteredTags.length} برچسب
            {searchQuery && filteredTags.length !== tags?.length && (
              <span> (از {tags?.length} برچسب)</span>
            )}
          </div>

          {filteredTags.map((tag) => (
            <div
              key={tag._id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
            >
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-100 to-zinc-200 text-sm font-bold text-muted-foreground dark:from-zinc-800 dark:to-zinc-700">
                <Tags className="h-4 w-4" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {tag.name}
                  </span>
                  {!tag.isActive && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      غیرفعال
                    </Badge>
                  )}
                  <span
                    className="text-[10px] text-muted-foreground font-mono"
                    dir="ltr"
                  >
                    /{tag.slug}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => openEditForm(tag)}
                  title="ویرایش"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                {deleteConfirmId === tag._id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs px-2"
                      onClick={() => handleDelete(tag._id)}
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
                    onClick={() => setDeleteConfirmId(tag._id)}
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
            <strong>راهنما:</strong> برچسب‌ها برای دسته‌بندی محصولات بر اساس
            ویژگی‌های خاص استفاده می‌شوند. هر محصول می‌تواند چندین برچسب داشته
            باشد. پس از ایجاد برچسب، می‌توانید آن را در فرم ایجاد/ویرایش محصول
            انتخاب کنید.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
