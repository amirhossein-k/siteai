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
import {
  useAdminHomepageSections,
  useCreateHomepageSection,
  useUpdateHomepageSection,
  useDeleteHomepageSection,
  type AdminHomepageSection,
} from "@/hooks/use-admin-homepage";

/** Registered renderer components (source of truth: the block registry). */
const COMPONENT_OPTIONS = [
  "hero-carousel",
  "quick-categories",
  "campaign-banner",
  "special-picks",
  "discounted-products",
  "newest-products",
  "premium-collection",
  "popular-brands",
  "gift-collections",
  "trust-badges",
];

const LAYOUT_VARIANTS = ["grid", "carousel", "stacked", "split"];
const COUNTDOWN_TARGETS = ["end_of_day", "fixed", "off"];

interface SectionFormState {
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  appearance: {
    themeColor: string;
    background: string;
    spacing: string;
    borderRadius: string;
  };
  behavior: {
    autoplay: boolean;
    autoplayInterval: number;
    showArrows: boolean;
    showDots: boolean;
    countdownEnabled: boolean;
    countdownTarget: string;
    countdownEndsAt: string;
    maxItems: number;
    layoutVariant: string;
  };
}

function toFormState(section?: AdminHomepageSection): SectionFormState {
  const p = section?.presentation;
  return {
    title: section?.title ?? "",
    subtitle: section?.subtitle ?? "",
    enabled: section?.enabled ?? true,
    sortOrder: section?.sortOrder ?? 0,
    appearance: {
      themeColor: p?.appearance?.themeColor ?? "",
      background: p?.appearance?.background ?? "",
      spacing: p?.appearance?.spacing ?? "",
      borderRadius: p?.appearance?.borderRadius ?? "",
    },
    behavior: {
      autoplay: p?.behavior?.autoplay ?? true,
      autoplayInterval: p?.behavior?.autoplayInterval ?? 6000,
      showArrows: p?.behavior?.showArrows ?? true,
      showDots: p?.behavior?.showDots ?? true,
      countdownEnabled: p?.behavior?.countdownEnabled ?? false,
      countdownTarget: p?.behavior?.countdownTarget ?? "off",
      countdownEndsAt: p?.behavior?.countdownEndsAt ?? "",
      maxItems: p?.behavior?.maxItems ?? 12,
      layoutVariant: p?.behavior?.layoutVariant ?? "grid",
    },
  };
}

/**
 * Homepage section composition editor (Session 53).
 * Manages the 9 section instances: visibility (enabled), ordering
 * (sortOrder), header overrides (title/subtitle) and the grouped
 * presentation settings (appearance = visual, behavior = runtime).
 * slug and component are immutable — the API rejects changes.
 */
export function SectionsEditor() {
  const { data: sections, isLoading } = useAdminHomepageSections();
  const createMutation = useCreateHomepageSection();
  const updateMutation = useUpdateHomepageSection();
  const deleteMutation = useDeleteHomepageSection();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SectionFormState>(() => toFormState());
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newComponent, setNewComponent] = useState(COMPONENT_OPTIONS[0]);

  const startEdit = (section: AdminHomepageSection) => {
    setForm(toFormState(section));
    setEditingId(section._id);
  };

  const set = <K extends keyof SectionFormState>(key: K, value: SectionFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setAppearance = (key: keyof SectionFormState["appearance"], value: string) =>
    setForm((f) => ({ ...f, appearance: { ...f.appearance, [key]: value } }));

  const setBehavior = (
    key: keyof SectionFormState["behavior"],
    value: SectionFormState["behavior"][typeof key]
  ) => setForm((f) => ({ ...f, behavior: { ...f.behavior, [key]: value } }));

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        data: {
          title: form.title,
          subtitle: form.subtitle,
          enabled: form.enabled,
          sortOrder: form.sortOrder,
          presentation: {
            appearance: { ...form.appearance },
            behavior: {
              ...form.behavior,
              countdownTarget: form.behavior.countdownTarget as
                | "end_of_day"
                | "fixed"
                | "off",
              layoutVariant: form.behavior.layoutVariant as
                | "grid"
                | "carousel"
                | "stacked"
                | "split",
              countdownEndsAt: form.behavior.countdownEndsAt || null,
            },
          },
        },
      });
      showToast.success("بخش به‌روزرسانی شد");
      setEditingId(null);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showToast.error(axiosErr?.response?.data?.error || "خطا در ذخیره بخش");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSlug.trim()) {
      showToast.error("شناسه بخش الزامی است");
      return;
    }
    try {
      await createMutation.mutateAsync({
        slug: newSlug.trim().toLowerCase(),
        component: newComponent,
      });
      showToast.success("بخش جدید ایجاد شد");
      setNewSectionOpen(false);
      setNewSlug("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showToast.error(axiosErr?.response?.data?.error || "خطا در ایجاد بخش");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("این بخش حذف شود؟ (محتوای آن باقی می‌ماند)")) return;
    try {
      await deleteMutation.mutateAsync(id);
      showToast.success("بخش حذف شد");
      if (editingId === id) setEditingId(null);
    } catch {
      showToast.error("خطا در حذف بخش");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">ترتیب و نمایش بخش‌ها</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setNewSectionOpen((v) => !v)}>
          <Plus className="h-4 w-4" />
          بخش جدید
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add section */}
        {newSectionOpen && (
          <form
            onSubmit={handleCreate}
            className="space-y-3 rounded-lg border bg-muted/20 p-4"
          >
            <h3 className="text-sm font-semibold">افزودن بخش جدید</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">شناسه (slug)</Label>
                <Input
                  dir="ltr"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="promo-spring"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">کامپوننت</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={newComponent}
                  onChange={(e) => setNewComponent(e.target.value)}
                >
                  {COMPONENT_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={createMutation.isPending}>
                ایجاد
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setNewSectionOpen(false)}
              >
                انصراف
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : !sections?.length ? (
          <p className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            هنوز بخشی تعریف نشده است
          </p>
        ) : (
          <ul className="space-y-2">
            {sections.map((section) => (
              <li key={section._id} className="rounded-lg border bg-card">
                <div className="flex items-center gap-3 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted text-xs font-bold text-muted-foreground">
                    {section.sortOrder}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" dir="ltr">
                      {section.slug}
                    </p>
                    <p className="text-[11px] text-muted-foreground" dir="ltr">
                      {section.component}
                    </p>
                  </div>
                  <Badge variant={section.enabled ? "success" : "outline"} className="text-[10px]">
                    {section.enabled ? "نمایش" : "مخفی"}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(section)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(section._id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {editingId === section._id && (
                  <form onSubmit={handleSave} className="space-y-4 border-t p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">عنوان (اختیاری)</Label>
                        <Input
                          value={form.title}
                          onChange={(e) => set("title", e.target.value)}
                          placeholder="پیش‌فرض بخش"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">زیرعنوان (اختیاری)</Label>
                        <Input
                          value={form.subtitle}
                          onChange={(e) => set("subtitle", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">ترتیب نمایش</Label>
                        <Input
                          type="number"
                          min={0}
                          value={form.sortOrder}
                          onChange={(e) => set("sortOrder", Number(e.target.value))}
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="flex h-10 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.enabled}
                            onChange={(e) => set("enabled", e.target.checked)}
                            className="h-4 w-4 rounded border-input"
                          />
                          نمایش در صفحه اصلی
                        </label>
                      </div>
                    </div>

                    {/* appearance — visual styling */}
                    <div>
                      <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                        ظاهر (appearance)
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="رنگ تم">
                          <Input
                            dir="ltr"
                            value={form.appearance.themeColor}
                            onChange={(e) => setAppearance("themeColor", e.target.value)}
                          />
                        </Field>
                        <Field label="پس‌زمینه">
                          <Input
                            dir="ltr"
                            value={form.appearance.background}
                            onChange={(e) => setAppearance("background", e.target.value)}
                          />
                        </Field>
                        <Field label="فاصله‌گذاری">
                          <Input
                            dir="ltr"
                            value={form.appearance.spacing}
                            onChange={(e) => setAppearance("spacing", e.target.value)}
                            placeholder="compact / relaxed"
                          />
                        </Field>
                        <Field label="گوشه‌گردی">
                          <Input
                            dir="ltr"
                            value={form.appearance.borderRadius}
                            onChange={(e) => setAppearance("borderRadius", e.target.value)}
                            placeholder="md / lg / xl"
                          />
                        </Field>
                      </div>
                    </div>

                    {/* behavior — runtime behavior */}
                    <div>
                      <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                        رفتار (behavior)
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="پخش خودکار">
                          <label className="flex h-10 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={form.behavior.autoplay}
                              onChange={(e) => setBehavior("autoplay", e.target.checked)}
                              className="h-4 w-4 rounded border-input"
                            />
                            فعال
                          </label>
                        </Field>
                        <Field label="فاصله خودکار (ms)">
                          <Input
                            type="number"
                            min={1000}
                            value={form.behavior.autoplayInterval}
                            onChange={(e) =>
                              setBehavior("autoplayInterval", Number(e.target.value))
                            }
                          />
                        </Field>
                        <Field label="تعداد آیتم (maxItems)">
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={form.behavior.maxItems}
                            onChange={(e) => setBehavior("maxItems", Number(e.target.value))}
                          />
                        </Field>
                        <Field label="نمایش فلش‌ها">
                          <label className="flex h-10 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={form.behavior.showArrows}
                              onChange={(e) => setBehavior("showArrows", e.target.checked)}
                              className="h-4 w-4 rounded border-input"
                            />
                            فعال
                          </label>
                        </Field>
                        <Field label="نمایش نقطه‌ها">
                          <label className="flex h-10 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={form.behavior.showDots}
                              onChange={(e) => setBehavior("showDots", e.target.checked)}
                              className="h-4 w-4 rounded border-input"
                            />
                            فعال
                          </label>
                        </Field>
                        <Field label="نوع چیدمان">
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={form.behavior.layoutVariant}
                            onChange={(e) => setBehavior("layoutVariant", e.target.value)}
                          >
                            {LAYOUT_VARIANTS.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="شمارش معکوس">
                          <label className="flex h-10 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={form.behavior.countdownEnabled}
                              onChange={(e) =>
                                setBehavior("countdownEnabled", e.target.checked)
                              }
                              className="h-4 w-4 rounded border-input"
                            />
                            فعال
                          </label>
                        </Field>
                        <Field label="هدف شمارش معکوس">
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={form.behavior.countdownTarget}
                            onChange={(e) => setBehavior("countdownTarget", e.target.value)}
                          >
                            {COUNTDOWN_TARGETS.map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {form.behavior.countdownTarget === "fixed" && (
                          <Field label="زمان پایان (fixed)">
                            <Input
                              type="datetime-local"
                              value={form.behavior.countdownEndsAt || ""}
                              onChange={(e) => setBehavior("countdownEndsAt", e.target.value)}
                            />
                          </Field>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                        ذخیره
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-4 w-4" />
                        انصراف
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}
