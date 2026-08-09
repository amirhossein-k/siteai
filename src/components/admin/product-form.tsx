"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import {
  productSchema,
  type ProductFormData,
} from "@/lib/validations/product";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { FileUpload } from "@/components/ui/file-upload";
import { showToast } from "@/components/ui/toast";
import { ArrowRight, ImageIcon, Loader2, X } from "lucide-react";
import { useCategories } from "@/hooks/use-categories";
import { useBrands } from "@/hooks/use-brands";
import { useTags } from "@/hooks/use-tags";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useAttributes } from "@/hooks/use-attributes";
import {
  VariantBuilder,
  type VariantDraft,
} from "@/components/admin/variant-builder";
import { ProductDescriptionEditor } from "@/components/admin/product/product-description-editor";
import { slugify } from "@/lib/utils";
import type { RichDescriptionNode } from "@/types";

interface ProductFormProps {
  mode: "create" | "edit";
  defaultValues?: Partial<ProductFormData>;
  onSubmit: (data: ProductFormData) => Promise<void>;
  isSubmitting: boolean;
}

export function ProductForm({
  mode,
  defaultValues,
  onSubmit,
  isSubmitting,
}: ProductFormProps) {
  const router = useRouter();
  const { data: categories, isLoading: catsLoading } = useCategories();
  const { data: brands, isLoading: brandsLoading } = useBrands();
  const { data: tags, isLoading: tagsLoading } = useTags();
  const { data: suppliers, isLoading: suppsLoading } = useSuppliers();
  const { data: attributes, isLoading: attrsLoading } = useAttributes();
  const [productImages, setProductImages] = useState<string[]>(
    defaultValues?.images || []
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    (defaultValues as any)?.tags || []
  );
  const [hasVariants, setHasVariants] = useState<boolean>(
    (defaultValues as any)?.hasVariants ?? false
  );
  const [variants, setVariants] = useState<VariantDraft[]>(
    (defaultValues as any)?.variants || []
  );
  const [descriptionRich, setDescriptionRich] = useState<
    RichDescriptionNode[] | undefined
  >((defaultValues as any)?.descriptionRich);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      brand: "",
      tags: [],
      category: "",
      supplier: "",
      price: 0,
      supplierPrice: 0,
      stock: 0,
      isActive: true,
      images: [],
      ...defaultValues,
    },
  });

  const handleFormSubmit = async (data: ProductFormData) => {
    await onSubmit({
      ...data,
      images: productImages,
      tags: selectedTags,
      hasVariants,
      variants,
      descriptionRich,
    });
  };

  const isFormLoading =
    catsLoading || suppsLoading || brandsLoading || tagsLoading || attrsLoading;

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    form.setValue("name", name);
    // Only auto-generate slug if it hasn't been manually edited
    if (!form.formState.dirtyFields.slug) {
      form.setValue("slug", slugify(name));
    }
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    form.setValue("slug", e.target.value);
    form.trigger("slug");
  };

  const selectClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  if (isFormLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-8">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>اطلاعات پایه</CardTitle>
            <CardDescription>
              نام، دسته‌بندی و قیمت محصول را وارد کنید
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>نام محصول</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={handleNameChange}
                        placeholder="مثال: هدفون بی‌سیم X200"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>اسلاگ (لینک)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={handleSlugChange}
                        placeholder="مثال: headphone-x200"
                        dir="ltr"
                        className="text-left"
                      />
                    </FormControl>
                    <FormDescription>
                      به صورت خودکار از نام تولید می‌شود
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              {/* Plain <label>: the editor is controlled via local state, not
                  a RHF FormField — shadcn's FormLabel requires a FormField
                  context and would throw "useFormField should be used within
                  <FormField>". */}
              <label
                htmlFor="product-description-editor"
                className="text-sm font-medium leading-none"
              >
                توضیحات
              </label>
              <ProductDescriptionEditor
                id="product-description-editor"
                initialValue={descriptionRich}
                onChange={setDescriptionRich}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                توضیحات غنی محصول (عنوان، لیست، تصویر و...). برای محصولات قبلی،
                متن ساده بدون تغییر حفظ می‌شود.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Product Images */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              <CardTitle>تصاویر محصول</CardTitle>
            </div>
            <CardDescription>
              تصاویر محصول را آپلود کنید. فرمت‌های مجاز: JPEG, PNG, WebP, GIF
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUpload
              maxFiles={5}
              accept="image/*"
              existingImages={productImages}
              onUploadComplete={(file) =>
                setProductImages((prev) => [...prev, file.url])
              }
              onDelete={(key) =>
                setProductImages((prev) =>
                  prev.filter((url) => !url.includes(key))
                )
              }
            />
          </CardContent>
        </Card>

        {/* Brand, Tags, Category & Supplier */}
        <Card>
          <CardHeader>
            <CardTitle>برند، برچسب‌ها، دسته‌بندی و فروشنده</CardTitle>
            <CardDescription>
              برند، برچسب‌ها، دسته‌بندی و فروشنده محصول را انتخاب کنید
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Tags Multi-Select */}
            {tags && tags.length > 0 && (
              <div className="space-y-3">
                <label className="text-sm font-medium">برچسب‌ها</label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const isSelected = selectedTags.includes(tag._id);
                    return (
                      <button
                        key={tag._id}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            isSelected
                              ? prev.filter((id) => id !== tag._id)
                              : [...prev, tag._id]
                          )
                        }
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {tag.name}
                        {isSelected && (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedTags.length === 0
                    ? "هیچ برچسبی انتخاب نشده است"
                    : `${selectedTags.length} برچسب انتخاب شده`}
                </p>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>برند</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className={selectClass}
                        value={field.value || ""}
                      >
                        <option value="">بدون برند</option>
                        {(brands || []).map((brand) => (
                          <option key={brand._id} value={brand._id}>
                            {brand.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>دسته‌بندی</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className={selectClass}
                        value={field.value || ""}
                      >
                        <option value="" disabled>
                          انتخاب دسته‌بندی...
                        </option>
                        {(categories || []).map((cat) => (
                          <option key={cat._id} value={cat._id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>فروشنده (تأمین‌کننده)</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className={selectClass}
                        value={field.value || ""}
                      >
                        <option value="" disabled>
                          انتخاب فروشنده...
                        </option>
                        {(suppliers || []).map((sup) => (
                          <option key={sup._id} value={sup._id}>
                            {sup.businessName}
                            {sup.user?.name ? ` (${sup.user.name})` : ""}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Variants Toggle */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>تنوع محصول</CardTitle>
            <CardDescription>
              اگر محصول در رنگ/سایز و ... تنوع دارد، این گزینه را فعال کنید
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={hasVariants}
                onClick={() => setHasVariants(!hasVariants)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  hasVariants ? "bg-primary" : "bg-input"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    hasVariants ? "translate-x-[22px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
              <div>
                <p className="text-sm font-medium leading-none">
                  این محصول دارای تنوع است
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasVariants
                    ? "قیمت و موجودی از مجموع تنوع‌ها محاسبه می‌شود"
                    : "محصول به صورت ساده با یک قیمت و موجودی ثبت می‌شود"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Variant Builder (when enabled) */}
        {hasVariants && (
          <VariantBuilder
            attributes={attributes || []}
            variants={variants}
            onChange={setVariants}
            productSlug={form.getValues("slug")}
          />
        )}

        {/* Pricing & Stock (simple product only) */}
        {!hasVariants && (
        <Card>
          <CardHeader>
            <CardTitle>قیمت و موجودی</CardTitle>
            <CardDescription>
              قیمت فروش، قیمت تأمین و موجودی محصول را وارد کنید
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>قیمت فروش (تومان)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={0}
                        placeholder="مثال: ۸۵۰۰۰۰"
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="supplierPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>قیمت تأمین (تومان)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={0}
                        placeholder="مثال: ۶۵۰۰۰۰"
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>موجودی</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={0}
                        placeholder="مثال: ۱۰"
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Active toggle */}
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="mt-5">
                  <div className="flex items-center gap-3">
                    <FormControl>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={field.value}
                        onClick={() => field.onChange(!field.value)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          field.value ? "bg-primary" : "bg-input"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                            field.value ? "translate-x-[22px]" : "translate-x-[2px]"
                          }`}
                        />
                      </button>
                    </FormControl>
                    <div>
                      <FormLabel className="text-sm font-medium leading-none cursor-pointer">
                        محصول فعال
                      </FormLabel>
                      {field.value ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          محصول در سایت قابل مشاهده است
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          محصول در سایت نمایش داده نمی‌شود
                        </p>
                      )}
                    </div>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            <ArrowRight className="ml-2 h-4 w-4" />
            انصراف
          </Button>
          <Button type="submit" loading={isSubmitting} size="lg">
            {isSubmitting
              ? mode === "create"
                ? "در حال ایجاد..."
                : "در حال ذخیره..."
              : mode === "create"
              ? "ایجاد محصول"
              : "ذخیره تغییرات"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
