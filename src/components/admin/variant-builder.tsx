"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { Plus, Trash2, Layers, Sparkles, AlertCircle, X } from "lucide-react";
import type { AttributeOption } from "@/hooks/use-attributes";
import { slugify } from "@/lib/utils";

export interface VariantDraftAttribute {
  attributeId: string;
  name: string;
  value: string;
}

export interface VariantDraft {
  key: string; // local unique key for React lists (not sent to server)
  sku: string;
  attributes: VariantDraftAttribute[];
  price: number;
  supplierPrice: number;
  stock: number;
  images: string[];
  isActive: boolean;
}

interface VariantBuilderProps {
  attributes: AttributeOption[];
  variants: VariantDraft[];
  onChange: (variants: VariantDraft[]) => void;
  productSlug?: string;
  maxVariants?: number;
}

let keyCounter = 0;
const nextKey = () => `v${Date.now()}_${keyCounter++}`;

/** Generate a human-readable label for a variant from its attributes */
export function variantLabel(attrs: VariantDraftAttribute[]): string {
  return attrs.map((a) => `${a.name}: ${a.value}`).join("، ");
}

/** Generate a default SKU from product slug + attribute values */
export function generateSku(
  slug: string,
  attrs: VariantDraftAttribute[]
): string {
  const base = slugify(slug) || "product";
  const suffix = attrs
    .map((a) => slugify(a.value))
    .filter(Boolean)
    .join("-");
  return (suffix ? `${base}-${suffix}` : base).toUpperCase();
}

export function VariantBuilder({
  attributes,
  variants,
  onChange,
  productSlug,
  maxVariants = 200,
}: VariantBuilderProps) {
  // Combination generator state
  const [genOpen, setGenOpen] = useState(false);
  const [genSelections, setGenSelections] = useState<
    Record<string, string[]>
  >({});

  // Client-side duplicate detection
  const duplicates = useMemo(() => {
    const skuMap = new Map<string, number>();
    const comboMap = new Map<string, number>();
    variants.forEach((v) => {
      const sku = v.sku.trim().toUpperCase();
      if (sku) skuMap.set(sku, (skuMap.get(sku) || 0) + 1);
      const combo = [...v.attributes]
        .map((a) => `${a.attributeId}:${a.value.toLowerCase()}`)
        .sort()
        .join("|");
      if (combo) comboMap.set(combo, (comboMap.get(combo) || 0) + 1);
    });
    const dupSkus = new Set<string>();
    skuMap.forEach((count, sku) => {
      if (count > 1) dupSkus.add(sku);
    });
    const dupCombos = new Set<string>();
    comboMap.forEach((count, combo) => {
      if (count > 1) dupCombos.add(combo);
    });
    return { dupSkus, dupCombos };
  }, [variants]);

  const addEmptyVariant = () => {
    if (variants.length >= maxVariants) return;
    onChange([
      ...variants,
      {
        key: nextKey(),
        sku: "",
        attributes: [],
        price: 0,
        supplierPrice: 0,
        stock: 0,
        images: [],
        isActive: true,
      },
    ]);
  };

  const updateVariant = (key: string, patch: Partial<VariantDraft>) => {
    onChange(
      variants.map((v) => (v.key === key ? { ...v, ...patch } : v))
    );
  };

  const removeVariant = (key: string) => {
    onChange(variants.filter((v) => v.key !== key));
  };

  // --- Combination generator ---
  const toggleGenAttribute = (attrId: string) => {
    setGenSelections((prev) => {
      const next = { ...prev };
      if (next[attrId]) {
        delete next[attrId];
      } else {
        const attr = attributes.find((a) => a._id === attrId);
        next[attrId] = attr?.values?.[0] ? [attr.values[0]] : [];
      }
      return next;
    });
  };

  const toggleGenValue = (attrId: string, value: string) => {
    setGenSelections((prev) => {
      const current = prev[attrId] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [attrId]: next };
    });
  };

  const generateCombinations = () => {
    const activeGenAttrs = attributes.filter(
      (a) => (genSelections[a._id] || []).length > 0
    );
    if (activeGenAttrs.length === 0) return;

    const cartesian = (
      arrays: string[][]
    ): string[][] =>
      arrays.reduce<string[][]>(
        (acc, curr) =>
          acc.flatMap((combo) => curr.map((v) => [...combo, v])),
        [[]]
      );

    const combos = cartesian(
      activeGenAttrs.map((a) => genSelections[a._id])
    );

    const existingCombos = new Set(
      variants.map((v) =>
        [...v.attributes]
          .map((a) => `${a.attributeId}:${a.value.toLowerCase()}`)
          .sort()
          .join("|")
      )
    );

    const newVariants: VariantDraft[] = [];
    for (const combo of combos) {
      const attrs = activeGenAttrs.map((a, i) => ({
        attributeId: a._id,
        name: a.name,
        value: combo[i],
      }));
      const comboKey = [...attrs]
        .map((a) => `${a.attributeId}:${a.value.toLowerCase()}`)
        .sort()
        .join("|");
      if (existingCombos.has(comboKey)) continue;
      const firstVariant = variants[0];
      newVariants.push({
        key: nextKey(),
        sku: generateSku(productSlug || "", attrs),
        attributes: attrs,
        price: firstVariant?.price || 0,
        supplierPrice: firstVariant?.supplierPrice || 0,
        stock: firstVariant?.stock || 0,
        images: [],
        isActive: true,
      });
    }

    if (newVariants.length > 0) {
      onChange([...variants, ...newVariants]);
    }
  };

  const hasDupSkus = duplicates.dupSkus.size > 0;
  const hasDupCombos = duplicates.dupCombos.size > 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">تنوع‌های محصول</CardTitle>
            </div>
            <Badge variant="secondary">
              {variants.length} / {maxVariants}
            </Badge>
          </div>
          <CardDescription>
            ترکیب‌های مختلف محصول (رنگ، سایز و ...) را تعریف کنید. برای هر
            تنوع قیمت، موجودی و تصویر مجزا قابل تنظیم است.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {attributes.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  ابتدا ویژگی‌ها را تعریف کنید
                </p>
                <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
                  برای ساخت تنوع، ابتدا از بخش «ویژگی‌ها» در پنل مدیریت،
                  ویژگی‌هایی مثل رنگ و سایز بسازید.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setGenOpen((o) => !o)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                تولید خودکار ترکیب‌ها
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={addEmptyVariant}
                disabled={variants.length >= maxVariants}
              >
                <Plus className="h-3.5 w-3.5" />
                افزودن تنوع
              </Button>
            </div>
          )}

          {/* Combination generator */}
          {genOpen && attributes.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-3 text-sm font-medium">
                ویژگی‌ها و مقادیر ترکیب را انتخاب کنید:
              </p>
              <div className="space-y-3">
                {attributes.map((attr) => (
                  <div key={attr._id} className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGenAttribute(attr._id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        genSelections[attr._id]?.length
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {attr.name}
                      {genSelections[attr._id]?.length ? (
                        <X className="h-3 w-3" />
                      ) : null}
                    </button>
                    {genSelections[attr._id]?.length > 0 &&
                      (attr.values || []).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleGenValue(attr._id, value)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            genSelections[attr._id]?.includes(value)
                              ? "border-primary bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  onClick={generateCombinations}
                  disabled={
                    !attributes.some(
                      (a) => (genSelections[a._id] || []).length > 0
                    )
                  }
                >
                  تولید ترکیب‌ها
                </Button>
              </div>
            </div>
          )}

          {/* Duplicate warnings */}
          {(hasDupSkus || hasDupCombos) && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div className="text-xs text-red-700 dark:text-red-300">
                {hasDupSkus && (
                  <p>
                    کد SKU تکراری:{" "}
                    {[...duplicates.dupSkus].join("، ")} — هر SKU باید یکتا باشد
                  </p>
                )}
                {hasDupCombos && (
                  <p>ترکیب ویژگی تکراری وجود دارد — ترکیب‌ها باید یکتا باشند</p>
                )}
              </div>
            </div>
          )}

          {/* Variant rows */}
          {variants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              هنوز تنوعی تعریف نشده است. از «تولید خودکار ترکیب‌ها» یا
              «افزودن تنوع» استفاده کنید.
            </p>
          ) : (
            <div className="space-y-4">
              {variants.map((variant, idx) => {
                const skuDup = duplicates.dupSkus.has(
                  variant.sku.trim().toUpperCase()
                );
                const combo = [...variant.attributes]
                  .map((a) => `${a.attributeId}:${a.value.toLowerCase()}`)
                  .sort()
                  .join("|");
                const comboDup = combo && duplicates.dupCombos.has(combo);

                return (
                  <div
                    key={variant.key}
                    className="rounded-lg border bg-card p-4"
                  >
                    {/* Header row */}
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          تنوع {idx + 1}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono" dir="ltr">
                          {variant.sku || "بدون SKU"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Active toggle */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={variant.isActive}
                          onClick={() =>
                            updateVariant(variant.key, {
                              isActive: !variant.isActive,
                            })
                          }
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            variant.isActive ? "bg-primary" : "bg-input"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                              variant.isActive
                                ? "translate-x-[18px]"
                                : "translate-x-[2px]"
                            }`}
                          />
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={() => removeVariant(variant.key)}
                          title="حذف تنوع"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Attribute selects */}
                    <div className="mb-3 flex flex-wrap gap-2">
                      {variant.attributes.map((attr, aIdx) => {
                        const attrDef = attributes.find(
                          (a) => a._id === attr.attributeId
                        );
                        return (
                          <div
                            key={`${attr.attributeId}-${aIdx}`}
                            className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2 py-1.5"
                          >
                            <select
                              value={attr.attributeId}
                              onChange={(e) => {
                                const newAttr = attributes.find(
                                  (a) => a._id === e.target.value
                                );
                                const next = [...variant.attributes];
                                next[aIdx] = newAttr
                                  ? {
                                      attributeId: newAttr._id,
                                      name: newAttr.name,
                                      value: newAttr.values?.[0] || "",
                                    }
                                  : { ...attr, attributeId: "" };
                                updateVariant(variant.key, {
                                  attributes: next,
                                  sku: generateSku(productSlug || "", next),
                                });
                              }}
                              className="h-7 rounded border-0 bg-transparent text-xs focus:outline-none"
                            >
                              <option value="">ویژگی...</option>
                              {attributes.map((a) => (
                                <option key={a._id} value={a._id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            <span className="text-muted-foreground">:</span>
                            <select
                              value={attr.value}
                              onChange={(e) => {
                                const next = [...variant.attributes];
                                next[aIdx] = {
                                  ...attr,
                                  value: e.target.value,
                                };
                                updateVariant(variant.key, {
                                  attributes: next,
                                  sku: generateSku(productSlug || "", next),
                                });
                              }}
                              className="h-7 rounded border-0 bg-transparent text-xs focus:outline-none"
                            >
                              <option value="">مقدار...</option>
                              {(attrDef?.values || []).map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                const next = variant.attributes.filter(
                                  (_, i) => i !== aIdx
                                );
                                updateVariant(variant.key, {
                                  attributes: next,
                                  sku: generateSku(productSlug || "", next),
                                });
                              }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                      {/* Add attribute to this variant */}
                      <select
                        value=""
                        onChange={(e) => {
                          const attr = attributes.find(
                            (a) => a._id === e.target.value
                          );
                          if (!attr) return;
                          const already = variant.attributes.some(
                            (a) => a.attributeId === attr._id
                          );
                          if (already) return;
                          const next = [
                            ...variant.attributes,
                            {
                              attributeId: attr._id,
                              name: attr.name,
                              value: attr.values?.[0] || "",
                            },
                          ];
                          updateVariant(variant.key, {
                            attributes: next,
                            sku: generateSku(productSlug || "", next),
                          });
                        }}
                        className="h-7 rounded-lg border border-dashed bg-transparent px-2 text-xs text-muted-foreground focus:outline-none"
                      >
                        <option value="">+ ویژگی</option>
                        {attributes
                          .filter(
                            (a) =>
                              !variant.attributes.some(
                                (va) => va.attributeId === a._id
                              )
                          )
                          .map((a) => (
                            <option key={a._id} value={a._id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Fields */}
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">SKU *</label>
                        <Input
                          value={variant.sku}
                          onChange={(e) =>
                            updateVariant(variant.key, {
                              sku: e.target.value.toUpperCase(),
                            })
                          }
                          placeholder="مثال: T-SHIRT-RED-M"
                          dir="ltr"
                          className={`h-8 text-xs text-left ${skuDup ? "border-red-500" : ""}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">قیمت فروش</label>
                        <Input
                          type="number"
                          min={0}
                          value={variant.price || ""}
                          onChange={(e) =>
                            updateVariant(variant.key, {
                              price: e.target.valueAsNumber || 0,
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">قیمت تأمین</label>
                        <Input
                          type="number"
                          min={0}
                          value={variant.supplierPrice || ""}
                          onChange={(e) =>
                            updateVariant(variant.key, {
                              supplierPrice: e.target.valueAsNumber || 0,
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">موجودی</label>
                        <Input
                          type="number"
                          min={0}
                          value={variant.stock || ""}
                          onChange={(e) =>
                            updateVariant(variant.key, {
                              stock: e.target.valueAsNumber || 0,
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    {comboDup && (
                      <p className="mt-2 text-xs text-red-600">
                        ترکیب ویژگی این تنوع تکراری است
                      </p>
                    )}

                    {/* Variant images */}
                    <div className="mt-3">
                      <FileUpload
                        maxFiles={3}
                        accept="image/*"
                        existingImages={variant.images}
                        onUploadComplete={(file) =>
                          updateVariant(variant.key, {
                            images: [...variant.images, file.url],
                          })
                        }
                        onDelete={(key) =>
                          updateVariant(variant.key, {
                            images: variant.images.filter(
                              (url) => !url.includes(key)
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
