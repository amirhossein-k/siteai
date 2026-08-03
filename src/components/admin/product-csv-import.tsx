"use client";

import { useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import {
  FileUp,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  SkipForward,
  FileSpreadsheet,
} from "lucide-react";
import { PRODUCT_CSV_HEADERS, MAX_IMPORT_ROWS } from "@/lib/product-csv-constants";
import { cn } from "@/lib/utils";
import type { ProductImportReport } from "@/types";

interface ProductCsvImportProps {
  /** Posts the raw CSV to the import endpoint and resolves with the report. */
  onImport: (csv: string) => Promise<ProductImportReport>;
  /** Supplier mode: hides the supplier column requirement note. */
  supplierMode?: boolean;
}

/** Column guide shown under the uploader. */
const COLUMN_GUIDE: Array<{ key: string; required: boolean; note: string }> = [
  { key: "name", required: true, note: "نام محصول" },
  { key: "slug", required: true, note: "اسلاگ (لاتین کوچک و خط تیره)" },
  { key: "price", required: true, note: "قیمت فروش (عدد)" },
  { key: "supplierPrice", required: true, note: "قیمت تأمین (عدد)" },
  { key: "stock", required: true, note: "موجودی (عدد صحیح)" },
  { key: "category", required: true, note: "نام دسته‌بندی" },
  { key: "brand", required: false, note: "نام برند (اختیاری)" },
  { key: "tags", required: false, note: "برچسب‌ها با ویرگول (اختیاری)" },
  { key: "images", required: false, note: "آدرس تصاویر با ویرگول (اختیاری)" },
  { key: "isActive", required: false, note: "فعال بودن: 1 یا 0 (پیش‌فرض 1)" },
  { key: "supplier", required: false, note: "نام کسب‌وکار فروشنده (مدیریت)" },
];

/**
 * Bulk product CSV import UI (Session 51).
 * Upload a CSV → server validates → per-row report. The server is the
 * authoritative parser; the client only reads the file into text. Create-only:
 * duplicate slugs are skipped and reported (never overwritten).
 */
export function ProductCsvImport({
  onImport,
  supplierMode = false,
}: ProductCsvImportProps) {
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<ProductImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result || ""));
      setFileName(file.name);
      setReport(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csv.trim()) {
      showToast.error("ابتدا یک فایل CSV انتخاب کنید");
      return;
    }
    setPending(true);
    try {
      const result = await onImport(csv);
      setReport(result);
      if (result.failed > 0) {
        showToast.error(`${result.failed} ردیف رد شد — گزارش را بررسی کنید`);
      } else if (result.skipped > 0) {
        showToast.info(`${result.skipped} ردیف رد شد (اسلاگ تکراری)`);
      } else {
        showToast.success(`${result.created} محصول با موفقیت اضافه شد`);
      }
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "خطا در ورود فایل";
      showToast.error(message);
      setReport(null);
    } finally {
      setPending(false);
    }
  };

  const downloadTemplate = () => {
    const text = PRODUCT_CSV_HEADERS.join(",") + "\n";
    const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const problematic = report?.results.filter((r) => r.status !== "created") || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            آپلود فایل CSV
          </CardTitle>
          <CardDescription>
            حداکثر {MAX_IMPORT_ROWS.toLocaleString("fa-IR")} ردیف در هر فایل — فقط
            محصولات ساده (بدون تنوع). اسلاگ‌های تکراری رد می‌شوند و هرگز بازنویسی
            نمی‌شوند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-4 w-4" />
              {fileName || "انتخاب فایل CSV"}
            </Button>
            <Button variant="ghost" className="gap-2" onClick={downloadTemplate}>
              <Download className="h-4 w-4" />
              دانلود قالب
            </Button>
            <Button
              className="gap-2"
              onClick={handleImport}
              disabled={pending || !csv.trim()}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              ورود محصولات
            </Button>
          </div>

          {/* Column guide */}
          <div className="flex flex-wrap gap-1.5">
            {COLUMN_GUIDE.map((col) => {
              if (supplierMode && col.key === "supplier") return null;
              return (
                <span
                  key={col.key}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]",
                    col.required
                      ? "border-primary/20 bg-primary/5 font-medium text-primary"
                      : "border-border bg-muted/40 text-muted-foreground"
                  )}
                  title={col.note}
                >
                  {col.key}
                  {col.required && <span className="text-destructive">*</span>}
                </span>
              );
            })}
          </div>
          {supplierMode && (
            <p className="text-xs text-muted-foreground">
              ستون supplier در ورود فروشنده نادیده گرفته می‌شود — محصولات به‌صورت
              خودکار به فروشگاه شما اختصاص می‌یابند.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Report */}
      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">گزارش ورود</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary" className="gap-1.5">
                مجموع: {report.total.toLocaleString("fa-IR")}
              </Badge>
              <Badge variant="success" className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                ساخته‌شده: {report.created.toLocaleString("fa-IR")}
              </Badge>
              <Badge variant="warning" className="gap-1.5">
                <SkipForward className="h-3.5 w-3.5" />
                ردشده (تکراری): {report.skipped.toLocaleString("fa-IR")}
              </Badge>
              <Badge variant="destructive" className="gap-1.5">
                <XCircle className="h-3.5 w-3.5" />
                ناموفق: {report.failed.toLocaleString("fa-IR")}
              </Badge>
            </div>

            {problematic.length === 0 ? (
              <p className="text-sm text-emerald-600">
                همه ردیف‌ها با موفقیت ساخته شدند ✅
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground">
                      <th className="px-3 py-2 text-right font-medium">ردیف</th>
                      <th className="px-3 py-2 text-right font-medium">نام</th>
                      <th className="px-3 py-2 text-right font-medium">وضعیت</th>
                      <th className="px-3 py-2 text-right font-medium">دلیل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problematic.map((r) => (
                      <tr key={r.rowNumber} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">
                          {r.rowNumber}
                        </td>
                        <td className="px-3 py-2">{r.name || "—"}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={
                              r.status === "skipped" ? "warning" : "destructive"
                            }
                            className="text-[10px]"
                          >
                            {r.status === "skipped" ? "ردشده" : "ناموفق"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
