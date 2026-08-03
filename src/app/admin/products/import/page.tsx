"use client";

import { useAdminProductImport } from "@/hooks/use-product-import-export";
import { ProductCsvImport } from "@/components/admin/product-csv-import";

export default function AdminProductImportPage() {
  const mutation = useAdminProductImport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ورود انبوه محصولات</h1>
        <p className="text-sm text-muted-foreground">
          ایجاد انبوه محصولات از فایل CSV — فقط محصولات ساده
        </p>
      </div>
      <ProductCsvImport
        onImport={(csv) => mutation.mutateAsync(csv)}
      />
    </div>
  );
}
