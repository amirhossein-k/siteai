"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useSupplierProduct,
  useUpdateSupplierProduct,
} from "@/hooks/use-supplier-products";
import { SupplierProductForm } from "@/components/supplier/supplier-product-form";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import type { SupplierProductFormData } from "@/lib/validations/product";

export default function EditSupplierProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const {
    data: product,
    isLoading,
    isError,
    refetch,
  } = useSupplierProduct(id);
  const updateProduct = useUpdateSupplierProduct();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultValues = useMemo(() => {
    if (!product) return undefined;
    return {
      name: product.name,
      slug: product.slug,
      description: product.description || "",
      category:
        typeof product.category === "object"
          ? product.category._id
          : product.category,
      supplier:
        typeof product.supplier === "object"
          ? product.supplier._id
          : product.supplier || "",
      price: product.price,
      supplierPrice: product.supplierPrice,
      stock: product.stock,
      isActive: product.isActive,
      images: product.images || [],
      hasVariants: product.hasVariants,
      // Map DB variants -> form draft shape (attributes keep name for display)
      variants: (product.variants || []).map((v) => ({
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
      })),
    };
  }, [product]);

  const handleSubmit = async (data: SupplierProductFormData) => {
    setIsSubmitting(true);
    try {
      // Add supplier field for type compatibility (API auto-sets it server-side)
      await updateProduct.mutateAsync({ id, ...data, supplier: "" });
      showToast.success("محصول با موفقیت ویرایش شد");
      router.push("/supplier/products");
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
          <Link
            href="/supplier/products"
            className="transition-colors hover:text-foreground"
          >
            محصولات من
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
          <Link
            href="/supplier/products"
            className="transition-colors hover:text-foreground"
          >
            محصولات من
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
          href="/supplier/products"
          className="transition-colors hover:text-foreground"
        >
          محصولات من
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

      <SupplierProductForm
        mode="edit"
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
