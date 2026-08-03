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
  Building2,
  Globe,
  Save,
  X,
  ExternalLink,
} from "lucide-react";
import {
  useBrands,
  useCreateBrand,
  useUpdateBrand,
  useDeleteBrand,
  type AdminBrand,
  type BrandFormData,
} from "@/hooks/use-admin-brands";
import { slugify } from "@/lib/utils";

const emptyForm: BrandFormData = {
  name: "",
  slug: "",
  description: "",
  logo: "",
  website: "",
  isActive: true,
};

export default function AdminBrandsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BrandFormData>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: brands, isLoading, isError, refetch } = useBrands();
  const createBrand = useCreateBrand();
  const updateBrand = useUpdateBrand();
  const deleteBrand = useDeleteBrand();

  // Search filter
  const filteredBrands = useMemo(() => {
    if (!brands) return [];
    if (!searchQuery.trim()) return brands;

    const lower = searchQuery.toLowerCase();
    return brands.filter(
      (b) =>
        b.name.toLowerCase().includes(lower) ||
        b.slug.toLowerCase().includes(lower) ||
        (b.description || "").toLowerCase().includes(lower)
    );
  }, [brands, searchQuery]);

  const openCreateForm = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (brand: AdminBrand) => {
    setEditingId(brand._id);
    setFormData({
      name: brand.name,
      slug: brand.slug,
      description: brand.description || "",
      logo: brand.logo || "",
      website: brand.website || "",
      isActive: brand.isActive ?? true,
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
      showToast.error("نام برند الزامی است");
      return;
    }
    if (!formData.slug.trim()) {
      showToast.error("اسلاگ برند الزامی است");
      return;
    }

    try {
      if (editingId) {
        await updateBrand.mutateAsync({ id: editingId, data: formData });
        showToast.success("برند با موفقیت به‌روزرسانی شد");
      } else {
        await createBrand.mutateAsync(formData);
        showToast.success("برند با موفقیت ایجاد شد");
      }
      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm);
      refetch();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data?.error || "خطا"
          : "خطا در ذخیره برند";
      showToast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBrand.mutateAsync(id);
      showToast.success("برند با موفقیت حذف شد");
      setDeleteConfirmId(null);
      refetch();
    } catch {
      showToast.error("خطا در حذف برند");
    }
  };

  const isSubmitting = createBrand.isPending || updateBrand.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مدیریت برندها</h1>
          <p className="text-sm text-muted-foreground">
            ایجاد، ویرایش و مدیریت برندهای محصولات
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
            برند جدید
          </Button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId ? "ویرایش برند" : "برند جدید"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">نام برند *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="مثال: سامسونگ"
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
                  placeholder="مثال: samsung"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">توضیحات</label>
                <Input
                  value={formData.description || ""}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="توضیحات کوتاه درباره برند..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">لوگو (URL)</label>
                <Input
                  value={formData.logo || ""}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      logo: e.target.value,
                    }))
                  }
                  placeholder="https://example.com/logo.png"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">وبسایت</label>
                <Input
                  value={formData.website || ""}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      website: e.target.value,
                    }))
                  }
                  placeholder="https://samsung.com"
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
                {editingId ? "ذخیره تغییرات" : "ایجاد برند"}
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
                خطا در بارگذاری برندها
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
      {brands && brands.length > 0 && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی برند..."
            className="pr-9"
          />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && brands?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">هیچ برندی وجود ندارد</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              اولین برند را ایجاد کنید
            </p>
            <Button onClick={openCreateForm}>
              <Plus className="ml-2 h-4 w-4" />
              ایجاد برند
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Brands List */}
      {!isLoading && !isError && filteredBrands.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground px-1">
            {filteredBrands.length} برند
            {searchQuery && filteredBrands.length !== brands?.length && (
              <span> (از {brands?.length} برند)</span>
            )}
          </div>

          {filteredBrands.map((brand) => (
            <div
              key={brand._id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
            >
              {/* Logo */}
              {brand.logo ? (
                <img
                  src={brand.logo}
                  alt={brand.name}
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    const parent = (e.target as HTMLImageElement).parentElement;
                    if (parent) {
                      const fallback = document.createElement("div");
                      fallback.className =
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground";
                      fallback.textContent = brand.name[0];
                      parent.prepend(fallback);
                    }
                  }}
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-100 to-zinc-200 text-sm font-bold text-muted-foreground dark:from-zinc-800 dark:to-zinc-700">
                  {brand.name[0]}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {brand.name}
                  </span>
                  {!brand.isActive && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      غیرفعال
                    </Badge>
                  )}
                  <span
                    className="text-[10px] text-muted-foreground font-mono"
                    dir="ltr"
                  >
                    /{brand.slug}
                  </span>
                </div>
                {brand.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {brand.description}
                  </p>
                )}
              </div>

              {/* Website link */}
              {brand.website && (
                <a
                  href={brand.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title={brand.website}
                >
                  <Globe className="h-3 w-3" />
                  <span className="max-w-[120px] truncate" dir="ltr">
                    {brand.website.replace(/^https?:\/\//, "")}
                  </span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => openEditForm(brand)}
                  title="ویرایش"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                {deleteConfirmId === brand._id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs px-2"
                      onClick={() => handleDelete(brand._id)}
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
                    onClick={() => setDeleteConfirmId(brand._id)}
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
            <strong>راهنما:</strong> برندها برای دسته‌بندی محصولات بر اساس
            شرکت سازنده استفاده می‌شوند. هر محصول می‌تواند یک برند داشته باشد.
            پس از ایجاد برند، می‌توانید آن را در فرم ایجاد/ویرایش محصول انتخاب کنید.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
