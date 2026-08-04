"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import axios from "axios";

interface ImageFieldProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
}

/**
 * Single-image upload field for the homepage CMS (Session 53).
 * Uploads via the existing /api/upload (S3) and stores the returned URL in
 * the form value. Used for desktop/mobile artwork on hero slides, banners
 * and gift collections.
 */
export function ImageField({ label, value, onChange, hint }: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFile = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      // Do NOT set Content-Type manually — the browser must generate the
      // multipart boundary itself (same rule as FileUpload).
      const { data } = await axios.post("/api/upload", formData);
      onChange(data.url);
      showToast.success("تصویر با موفقیت آپلود شد");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showToast.error(
        axiosErr?.response?.data?.error || "خطا در آپلود تصویر"
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    if (value) {
      try {
        await axios.delete("/api/upload", { data: { key: value } });
      } catch {
        // silent — the file may no longer exist
      }
    }
    onChange("");
  };

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {value ? (
        <div className="group relative aspect-video w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={handleRemove}
            aria-label="حذف تصویر"
            className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="flex aspect-video w-full max-w-xs flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/50"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">در حال آپلود...</span>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6" />
              <span className="text-xs">{hint || "انتخاب تصویر"}</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {value && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5" />
          تصویر بارگذاری شده — برای تغییر دوباره بارگذاری کنید
        </p>
      )}
    </div>
  );
}
