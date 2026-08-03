"use client";

import { useSupplierProductImport } from "@/hooks/use-product-import-export";
import { ProductCsvImport } from "@/components/admin/product-csv-import";

export default function SupplierProductImportPage() {
  const mutation = useSupplierProductImport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ورود انبوه محصولات</h1>
        <p className="text-sm text-muted-foreground">
          ایجاد انبوه محصولات از فایل CSV — محصولات به فروشگاه شما اختصاص می‌یابند
        </p>
      </div>
      <ProductCsvImport
        supplierMode
        onImport={(csv) => mutation.mutateAsync(csv)}
      />
    </div>
  );
}
