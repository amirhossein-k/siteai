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
  FolderTree,
  ChevronLeft,
  ChevronDown,
  Save,
  X,
} from "lucide-react";
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory } from "@/hooks/use-admin-categories";
import type { AdminCategory } from "@/hooks/use-admin-categories";
import { slugify } from "@/lib/utils";

interface TreeNode extends AdminCategory {
  children: TreeNode[];
}

interface CategoryFormData {
  _id?: string;
  name: string;
  slug: string;
  parent: string;
  icon: string;
  image: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  metaTitle: string;
  metaDescription: string;
}

const emptyForm: CategoryFormData = {
  name: "",
  slug: "",
  parent: "",
  icon: "",
  image: "",
  description: "",
  sortOrder: 0,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
};

export default function AdminCategories() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CategoryFormData>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: categories, isLoading, isError, refetch } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  // Tree structure
  const categoryTree: TreeNode[] = useMemo(() => {
    if (!categories) return [];
    const catMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    categories.forEach((cat) => {
      catMap.set(cat._id, { ...cat, children: [] });
    });

    categories.forEach((cat) => {
      const node = catMap.get(cat._id);
      if (!node) return;
      if (cat.parent?._id && catMap.has(cat.parent._id)) {
        const parent = catMap.get(cat.parent._id);
        if (parent) parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }, [categories]);

  // Search filter
  const filteredTree: TreeNode[] = useMemo(() => {
    if (!searchQuery.trim()) return categoryTree;

    const searchLower = searchQuery.toLowerCase();
    const filterTree = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.filter((node) => {
        const matches =
          node.name.toLowerCase().includes(searchLower) ||
          node.slug.toLowerCase().includes(searchLower) ||
          (node.description || "").toLowerCase().includes(searchLower);
        const filteredChildren = filterTree(node.children);
        return matches || filteredChildren.length > 0;
      });
    };
    return filterTree(categoryTree);
  }, [categoryTree, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreateForm = (parentId = "") => {
    setEditingId(null);
    setFormData({ ...emptyForm, parent: parentId });
    setShowForm(true);
  };

  const openEditForm = (cat: AdminCategory) => {
    setEditingId(cat._id);
    setFormData({
      _id: cat._id,
      name: cat.name,
      slug: cat.slug,
      parent: cat.parent?._id || "",
      icon: cat.icon || "",
      image: cat.image || "",
      description: cat.description || "",
      sortOrder: cat.sortOrder ?? 0,
      isActive: cat.isActive ?? true,
      metaTitle: cat.metaTitle || "",
      metaDescription: cat.metaDescription || "",
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
      showToast.error("نام دسته‌بندی الزامی است");
      return;
    }
    if (!formData.slug.trim()) {
      showToast.error("اسلاگ دسته‌بندی الزامی است");
      return;
    }

    try {
      if (editingId) {
        await updateCategory.mutateAsync({ id: editingId, data: formData });
        showToast.success("دسته‌بندی با موفقیت به‌روزرسانی شد");
      } else {
        await createCategory.mutateAsync(formData);
        showToast.success("دسته‌بندی با موفقیت ایجاد شد");
      }
      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm);
      refetch();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data?.error || "خطا"
          : "خطا در ذخیره دسته‌بندی";
      showToast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCategory.mutateAsync(id);
      showToast.success("دسته‌بندی با موفقیت حذف شد");
      setDeleteConfirmId(null);
      refetch();
    } catch {
      showToast.error("خطا در حذف دسته‌بندی");
    }
  };

  const renderCategoryNode = (node: TreeNode, depth = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedIds.has(node._id);

    return (
      <div key={node._id}>
        <div
          className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
          style={{ marginRight: depth * 24 }}
        >
          {/* Expand/collapse */}
          <button
            type="button"
            onClick={() => hasChildren && toggleExpand(node._id)}
            className={`flex h-6 w-6 items-center justify-center rounded ${
              hasChildren
                ? "text-muted-foreground hover:bg-accent"
                : "text-transparent"
            }`}
          >
            {hasChildren && (isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            ))}
          </button>

          {/* Icon/image */}
          {node.icon ? (
            <span className="text-lg">{node.icon}</span>
          ) : node.image ? (
            <img src={node.image} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <FolderTree className="h-4 w-4 text-muted-foreground" />
          )}

          {/* Name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{node.name}</span>
              {!node.isActive && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  غیرفعال
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground font-mono" dir="ltr">
                /{node.slug}
              </span>
            </div>
            {node.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {node.description}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => openEditForm(node)}
              title="ویرایش"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => openCreateForm(node._id)}
              title="افزودن زیردسته"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {deleteConfirmId === node._id ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs px-2"
                  onClick={() => handleDelete(node._id)}
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
                onClick={() => setDeleteConfirmId(node._id)}
                title="حذف"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="space-y-1 mt-1">
            {node.children.map((child) => renderCategoryNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const isSubmitting = createCategory.isPending || updateCategory.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مدیریت دسته‌بندی‌ها</h1>
          <p className="text-sm text-muted-foreground">
            ایجاد، ویرایش و مدیریت دسته‌بندی‌های محصولات
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
          <Button onClick={() => openCreateForm()} disabled={showForm}>
            <Plus className="ml-2 h-4 w-4" />
            دسته‌بندی جدید
          </Button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {editingId ? "ویرایش دسته‌بندی" : "دسته‌بندی جدید"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">نام دسته‌بندی *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="مثال: پوشاک مردانه"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">اسلاگ *</label>
                <Input
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, slug: slugify(e.target.value) }))
                  }
                  placeholder="مثال: mens-clothing"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">دسته‌بندی والد</label>
                <select
                  value={formData.parent}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, parent: e.target.value }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">بدون والد (دسته اصلی)</option>
                  {categories
                    ?.filter((c) => c._id !== editingId)
                    .map((cat) => (
                      <option key={cat._id} value={cat._id}>
                        {cat.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">آیکون (emoji)</label>
                <Input
                  value={formData.icon}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, icon: e.target.value }))
                  }
                  placeholder="مثال: 👕"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">تصویر (URL)</label>
                <Input
                  value={formData.image}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, image: e.target.value }))
                  }
                  placeholder="https://example.com/image.jpg"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">ترتیب نمایش</label>
                <Input
                  type="number"
                  min={0}
                  value={formData.sortOrder}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      sortOrder: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">توضیحات</label>
                <Input
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="توضیحات کوتاه برای این دسته‌بندی..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">عنوان SEO (متا تایتل)</label>
                <Input
                  value={formData.metaTitle}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      metaTitle: e.target.value,
                    }))
                  }
                  placeholder="بهینه برای موتورهای جستجو"
                  dir="ltr"
                  className="text-left"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">توضیحات SEO (متا دسکریپشن)</label>
                <Input
                  value={formData.metaDescription}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      metaDescription: e.target.value,
                    }))
                  }
                  placeholder="توضیحات برای SEO"
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
              <Button
                onClick={handleSubmit}
                loading={isSubmitting}
              >
                <Save className="ml-2 h-4 w-4" />
                {editingId ? "ذخیره تغییرات" : "ایجاد دسته‌بندی"}
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
          {[1, 2, 3].map((i) => (
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
                خطا در بارگذاری دسته‌بندی‌ها
              </p>
              <p className="text-xs text-red-600/70 dark:text-red-400/70">
                لطفاً صفحه را بروزرسانی کنید
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
            >
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {categories && categories.length > 0 && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجوی دسته‌بندی..."
            className="pr-9"
          />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && categories?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <FolderTree className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">هیچ دسته‌بندی وجود ندارد</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              اولین دسته‌بندی را ایجاد کنید
            </p>
            <Button onClick={() => openCreateForm()}>
              <Plus className="ml-2 h-4 w-4" />
              ایجاد دسته‌بندی
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Category Tree */}
      {!isLoading && !isError && filteredTree.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-2 pb-2">
            <span>{categories?.length} دسته‌بندی</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                if (expandedIds.size > 0) {
                  setExpandedIds(new Set());
                } else {
                  setExpandedIds(new Set(categories?.map((c) => c._id)));
                }
              }}
            >
              {expandedIds.size > 0 ? "بستن همه" : "باز کردن همه"}
            </Button>
          </div>
          {filteredTree.map((node) => renderCategoryNode(node))}
        </div>
      )}

      {/* Help Text */}
      <Card className="border-muted">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <strong>راهنما:</strong> برای ایجاد دسته‌بندی جدید از دکمه &quot;دسته‌بندی جدید&quot; استفاده کنید.
            برای افزودن زیردسته، روی آیکون + کنار هر دسته‌بندی کلیک کنید.
            دسته‌بندی‌های والد می‌توانند تعداد نامحدودی زیردسته داشته باشند.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
