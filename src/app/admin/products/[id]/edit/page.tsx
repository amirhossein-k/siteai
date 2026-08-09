"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAdminProduct, useUpdateAdminProduct } from "@/hooks/use-admin-products";
import { ProductForm } from "@/components/admin/product-form";
import {
  createVariantKey,
  type VariantDraft,
} from "@/components/admin/variant-builder";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { ChevronRight, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { relationId } from "@/lib/utils";
import type { ProductFormData } from "@/lib/validations/product";

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: product, isLoading, isError, refetch } = useAdminProduct(id);
  const updateProduct = useUpdateAdminProduct();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultValues = useMemo(() => {
    if (!product) return undefined;
    return {
      name: product.name,
      slug: product.slug,
      description: product.description || "",
      // Session 69 — rich description MUST be mapped back into the form, or
      // the editor mounts empty and a save wipes descriptionRich (replaced by
      // the plain-text projection). Absent on legacy products → editor empty.
      descriptionRich: product.descriptionRich,
      // Session 65 — populated relations may be null (deleted ref) or a raw
      // id string at runtime; relationId normalizes all shapes safely. images/
      // brand/tags are mapped so the full-replacement PUT does not wipe them.
      images: product.images || [],
      brand: relationId(product.brand),
      tags: (product.tags || []).map(relationId).filter(Boolean),
      category: relationId(product.category),
      supplier: relationId(product.supplier),
      price: product.price,
      supplierPrice: product.supplierPrice,
      stock: product.stock,
      isActive: product.isActive,
      hasVariants: product.hasVariants,
      // Map DB variants -> form draft shape (attributes keep name for display).
      // Every draft gets a unique local `key` (server variants only carry a DB
      // `_id`) — without it VariantBuilder renders all rows with key=undefined
      // (React duplicate-key warning) and update/remove hit every row at once.
      variants: (product.variants || []).map(
        (v): VariantDraft => ({
          key: createVariantKey(),
          sku: v.sku,
          attributes: v.attributes.map((a) => ({
            attributeId: a.attributeId,
            name: a.name,
            value: a.value,
          })),
          price: v.price,
          supplierPrice: v.supplierPrice,
          stock: v.stock,
          images: v.images || [],
          isActive: v.isActive,
        })
      ),
    };
  }, [product]);

  const handleSubmit = async (data: ProductFormData) => {
    setIsSubmitting(true);
    try {
      await updateProduct.mutateAsync({ id, ...data });
      showToast.success("محصول با موفقیت ویرایش شد");
      router.push("/admin/products");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در ویرایش محصول"
          : "خطا در ویرایش محصول";
      showToast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/admin/products" className="transition-colors hover:text-foreground">
            محصولات
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">ویرایش محصول</span>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات محصول
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/admin/products" className="transition-colors hover:text-foreground">
            محصولات
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">ویرایش محصول</span>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            محصول مورد نظر یافت نشد
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/admin/products"
          className="transition-colors hover:text-foreground"
        >
          محصولات
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">ویرایش: {product.name}</span>
      </div>

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ویرایش محصول</h1>
        <p className="text-sm text-muted-foreground">
          اطلاعات محصول {product.name} را ویرایش کنید
        </p>
      </div>

      <ProductForm
        mode="edit"
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
