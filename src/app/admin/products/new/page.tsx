"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCreateAdminProduct } from "@/hooks/use-admin-products";
import { ProductForm } from "@/components/admin/product-form";
import { showToast } from "@/components/ui/toast";
import { ChevronRight } from "lucide-react";
import type { ProductFormData } from "@/lib/validations/product";

export default function NewProductPage() {
  const router = useRouter();
  const createProduct = useCreateAdminProduct();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: ProductFormData) => {
    setIsSubmitting(true);
    try {
      await createProduct.mutateAsync(data);
      showToast.success("محصول با موفقیت ایجاد شد");
      router.push("/admin/products");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در ایجاد محصول"
          : "خطا در ایجاد محصول";
      showToast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <span className="text-foreground">محصول جدید</span>
      </div>

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">افزودن محصول جدید</h1>
        <p className="text-sm text-muted-foreground">
          اطلاعات محصول جدید را وارد کنید
        </p>
      </div>

      <ProductForm
        mode="create"
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
