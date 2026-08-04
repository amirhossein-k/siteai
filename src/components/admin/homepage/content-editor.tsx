"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import { ImageField } from "@/components/admin/homepage/image-field";
import {
  useAdminHomepageContent,
  useCreateHomepageContent,
  useUpdateHomepageContent,
  useDeleteHomepageContent,
  type AdminHomepageContentRow,
  type HomepageContentFormData,
} from "@/hooks/use-admin-homepage";

export type HomepageContentType =
  | "hero-slide"
  | "campaign-banner"
  | "gift-collection"
  | "trust-badge";

type FieldId =
  | "title"
  | "subtitle"
  | "tagline"
  | "description"
  | "ctaLabel"
  | "ctaHref"
  | "themeColor"
  | "icon"
  | "imageDesktop"
  | "imageMobile"
  | "sortOrder"
  | "isActive"
  | "status";

interface ContentTypeConfig {
  type: HomepageContentType;
  label: string;
  fields: FieldId[];
  iconOptions?: string[];
}

export const CONTENT_TYPE_CONFIGS: ContentTypeConfig[] = [
  {
    type: "hero-slide",
    label: "اسلایدهای هیرو",
    fields: [
      "title", "subtitle", "tagline", "ctaLabel", "ctaHref",
      "imageDesktop", "imageMobile", "themeColor", "sortOrder", "isActive", "status",
    ],
  },
  {
    type: "campaign-banner",
    label: "بنر کمپین",
    fields: [
      "title", "subtitle", "tagline", "ctaLabel", "ctaHref",
      "imageDesktop", "imageMobile", "themeColor", "sortOrder", "isActive", "status",
    ],
  },
  {
    type: "gift-collection",
    label: "کالکشن‌های هدیه",
    fields: [
      "title", "description", "ctaLabel", "ctaHref",
      "imageDesktop", "imageMobile", "themeColor", "sortOrder", "isActive", "status",
    ],
  },
  {
    type: "trust-badge",
    label: "نشان‌های اعتماد",
    fields: ["title", "description", "icon", "sortOrder", "isActive", "status"],
    iconOptions: [
      "truck", "shield-check", "star", "headphones", "tag", "package",
      "badge-check", "refresh-cw", "heart", "gift", "credit-card", "store",
    ],
  },
];

const DEFAULT_FORM: Record<string, unknown> = {
  title: "",
  subtitle: "",
  tagline: "",
  description: "",
  ctaLabel: "",
  ctaHref: "",
  themeColor: "",
  icon: "",
  imageDesktop: "",
  imageMobile: "",
  sortOrder: 0,
  isActive: true,
  status: "published",
};

interface ContentEditorProps {
  type: HomepageContentType;
  sectionSlug: string;
}

/**
 * Generic homepage content editor (Session 53) — one instance per content
 * type. Lists the section's rows (draft + inactive included) and provides a
 * create/edit form with the fields configured for that type. Desktop/mobile
 * images use the existing S3 upload. Soft-delete removes a row from the
 * public composition instantly.
 */
export function ContentEditor({ type, sectionSlug }: ContentEditorProps) {
  const config =
    CONTENT_TYPE_CONFIGS.find((c) => c.type === type) ?? CONTENT_TYPE_CONFIGS[0];

  const { data: rows, isLoading } = useAdminHomepageContent(type, sectionSlug);
  const createMutation = useCreateHomepageContent(type);
  const updateMutation = useUpdateHomepageContent(type);
  const deleteMutation = useDeleteHomepageContent(type);

  const [form, setForm] = useState<Record<string, unknown>>({ ...DEFAULT_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = () => {
    setForm({ ...DEFAULT_FORM });
    setEditingId(null);
  };

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const startEdit = (row: AdminHomepageContentRow) => {
    setForm({
      title: row.title ?? "",
      subtitle: row.subtitle ?? "",
      tagline: row.tagline ?? "",
      description: row.description ?? "",
      ctaLabel: row.ctaLabel ?? "",
      ctaHref: row.ctaHref ?? "",
      themeColor: row.themeColor ?? "",
      icon: row.icon ?? "",
      imageDesktop: row.imageDesktop ?? "",
      imageMobile: row.imageMobile ?? "",
      sortOrder: row.sortOrder ?? 0,
      isActive: row.isActive ?? true,
      status: row.status ?? "published",
    });
    setEditingId(row._id);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: HomepageContentFormData = {
      sectionSlug,
      title: String(form.title ?? ""),
      subtitle: String(form.subtitle ?? ""),
      tagline: String(form.tagline ?? ""),
      description: String(form.description ?? ""),
      ctaLabel: String(form.ctaLabel ?? ""),
      ctaHref: String(form.ctaHref ?? ""),
      themeColor: String(form.themeColor ?? ""),
      icon: String(form.icon ?? ""),
      imageDesktop: String(form.imageDesktop ?? ""),
      imageMobile: String(form.imageMobile ?? ""),
      sortOrder: Number(form.sortOrder ?? 0),
      isActive: Boolean(form.isActive),
      status: form.status === "draft" ? "draft" : "published",
    };

    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: payload });
        showToast.success("محتوا به‌روزرسانی شد");
      } else {
        await createMutation.mutateAsync(payload);
        showToast.success("محتوا ایجاد شد");
      }
      resetForm();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showToast.error(axiosErr?.response?.data?.error || "خطا در ذخیره محتوا");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("این محتوا حذف شود؟")) return;
    try {
      await deleteMutation.mutateAsync(id);
      showToast.success("محتوا حذف شد");
    } catch {
      showToast.error("خطا در حذف محتوا");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{config.label}</CardTitle>
        <Badge variant={rows?.length ? "default" : "secondary"}>
          {rows?.length ?? 0} مورد
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Rows */}
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : !rows?.length ? (
          <p className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            هنوز محتوایی برای این بخش وجود ندارد
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row._id}
                className="flex items-center gap-3 rounded-lg border bg-card p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-[10px]">
                  {row.imageDesktop ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.imageDesktop}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="px-1 text-center leading-3">
                      {row.title?.slice(0, 12) || "—"}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={row.status === "published" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {row.status === "published" ? "منتشر شده" : "پیش‌نویس"}
                    </Badge>
                    <Badge
                      variant={row.isActive ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {row.isActive ? "فعال" : "غیرفعال"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      ترتیب {row.sortOrder}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(row)}
                  aria-label="ویرایش"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(row._id)}
                  aria-label="حذف"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border bg-muted/20 p-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {editingId ? "ویرایش محتوا" : "افزودن محتوا"}
            </h3>
            {editingId && (
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                <X className="h-4 w-4" />
                انصراف
              </Button>
            )}
          </div>

          {config.fields.includes("title") && (
            <Field label="عنوان" required>
              <Input
                value={String(form.title ?? "")}
                onChange={(e) => set("title", e.target.value)}
                required
              />
            </Field>
          )}
          {config.fields.includes("subtitle") && (
            <Field label="زیرعنوان">
              <Input
                value={String(form.subtitle ?? "")}
                onChange={(e) => set("subtitle", e.target.value)}
              />
            </Field>
          )}
          {config.fields.includes("tagline") && (
            <Field label="برچسب کوتاه (بالای عنوان)">
              <Input
                value={String(form.tagline ?? "")}
                onChange={(e) => set("tagline", e.target.value)}
              />
            </Field>
          )}
          {config.fields.includes("description") && (
            <Field label="توضیحات">
              <Input
                value={String(form.description ?? "")}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          )}
          {config.fields.includes("ctaLabel") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="متن دکمه">
                <Input
                  value={String(form.ctaLabel ?? "")}
                  onChange={(e) => set("ctaLabel", e.target.value)}
                />
              </Field>
              <Field label="لینک دکمه">
                <Input
                  dir="ltr"
                  value={String(form.ctaHref ?? "")}
                  onChange={(e) => set("ctaHref", e.target.value)}
                  placeholder="/products"
                />
              </Field>
            </div>
          )}
          {config.fields.includes("ctaHref") && !config.fields.includes("ctaLabel") && (
            <Field label="لینک دکمه">
              <Input
                dir="ltr"
                value={String(form.ctaHref ?? "")}
                onChange={(e) => set("ctaHref", e.target.value)}
              />
            </Field>
          )}
          {config.fields.includes("themeColor") && (
            <Field label="رنگ پس‌زمینه">
              <Input
                dir="ltr"
                value={String(form.themeColor ?? "")}
                onChange={(e) => set("themeColor", e.target.value)}
                placeholder="from-indigo-900 via-indigo-800 to-violet-700"
              />
            </Field>
          )}
          {config.fields.includes("icon") && (
            <Field label="آیکون">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={String(form.icon ?? "")}
                onChange={(e) => set("icon", e.target.value)}
              >
                <option value="">بدون آیکون</option>
                {config.iconOptions?.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {config.fields.includes("imageDesktop") && (
            <ImageField
              label="تصویر دسکتاپ"
              value={String(form.imageDesktop ?? "")}
              onChange={(url) => set("imageDesktop", url)}
            />
          )}
          {config.fields.includes("imageMobile") && (
            <ImageField
              label="تصویر موبایل"
              value={String(form.imageMobile ?? "")}
              onChange={(url) => set("imageMobile", url)}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {config.fields.includes("sortOrder") && (
              <Field label="ترتیب نمایش">
                <Input
                  type="number"
                  min={0}
                  value={String(form.sortOrder ?? 0)}
                  onChange={(e) => set("sortOrder", Number(e.target.value))}
                />
              </Field>
            )}
            {config.fields.includes("status") && (
              <Field label="وضعیت انتشار">
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={String(form.status ?? "published")}
                  onChange={(e) => set("status", e.target.value)}
                >
                  <option value="published">منتشر شده</option>
                  <option value="draft">پیش‌نویس</option>
                </select>
              </Field>
            )}
            {config.fields.includes("isActive") && (
              <Field label="فعال">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(form.isActive)}
                    onChange={(e) => set("isActive", e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  نمایش در صفحه اصلی
                </label>
              </Field>
            )}
          </div>

          <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
            <Plus className="h-4 w-4" />
            {editingId ? "ذخیره تغییرات" : "افزودن"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
