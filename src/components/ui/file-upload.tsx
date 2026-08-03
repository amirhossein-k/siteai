"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload,
  X,
  ImageIcon,
  FileText,
  Film,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import axios from "axios";
import type { FileCategory } from "@/lib/upload";

export interface UploadedFileInfo {
  url: string;
  key: string;
  name: string;
  size: number;
  mimeType: string;
  category: FileCategory;
}

interface FileUploadProps {
  onUploadComplete?: (file: UploadedFileInfo) => void;
  onDelete?: (key: string) => void;
  maxFiles?: number;
  accept?: string;
  className?: string;
  existingImages?: string[];
  disabled?: boolean;
}

export function FileUpload({
  onUploadComplete,
  onDelete,
  maxFiles = 5,
  accept = "image/*",
  className,
  existingImages = [],
  disabled = false,
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>(existingImages);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (uploadedUrls.length >= maxFiles) {
        showToast.error(`حداکثر ${maxFiles} فایل مجاز است`);
        return;
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        // IMPORTANT: do NOT manually set `Content-Type: multipart/form-data`.
        // The browser must generate the header itself (with the `boundary=...`
        // parameter) from the FormData body — a hand-written header without a
        // boundary breaks the server's `req.formData()` parsing and the file
        // never arrives ("فایلی ارسال نشده است").
        const { data } = await axios.post("/api/upload", formData);

        setUploadedUrls((prev) => [...prev, data.url]);
        onUploadComplete?.(data);
        showToast.success(`${file.name} با موفقیت آپلود شد`);
      } catch (err: unknown) {
        // Surface the REAL server error instead of a generic message.
        const axiosErr = err as {
          response?: { data?: { error?: string } };
        };
        const serverMessage = axiosErr?.response?.data?.error;
        // Show the server's message if present; otherwise keep a Persian
        // fallback (avoid leaking raw English axios/network messages).
        const message =
          serverMessage || "خطا در آپلود فایل. لطفاً دقایقی دیگر تلاش کنید";
        showToast.error(message);
      } finally {
        setIsUploading(false);
      }
    },
    [uploadedUrls.length, maxFiles, onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [handleFile]
  );

  const handleRemove = useCallback(
    async (url: string) => {
      setUploadedUrls((prev) => prev.filter((u) => u !== url));
      // Extract key from URL and call delete API
      try {
        await axios.delete("/api/upload", { data: { key: url } });
        onDelete?.(url);
      } catch {
        // Silent fail — file may no longer exist
      }
    },
    [onDelete]
  );

  const getFileIcon = (url: string) => {
    const ext = url.split(".").pop()?.toLowerCase() || "";
    if (["mp4", "webm", "ogg"].includes(ext)) return <Film className="h-8 w-8" />;
    if (["pdf", "doc", "docx"].includes(ext)) return <FileText className="h-8 w-8" />;
    return <ImageIcon className="h-8 w-8" />;
  };

  const isImage = (url: string) => {
    const ext = url.split(".").pop()?.toLowerCase() || "";
    return ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Uploaded files preview */}
      {uploadedUrls.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {uploadedUrls.map((url) => (
            <div
              key={url}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              {isImage(url) ? (
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                  }}
                />
              ) : null}
              <div className={cn(
                "flex h-full w-full items-center justify-center",
                isImage(url) && "hidden"
              )}>
                {getFileIcon(url)}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload drop zone */}
      {uploadedUrls.length < maxFiles && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">در حال آپلود...</p>
            </div>
          ) : (
            <>
              <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                فایل را اینجا رها کنید یا کلیک کنید
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                تصاویر (تا ۱۰ مگابایت) — ویدیو (تا ۵۰ مگابایت) — اسناد (تا ۲۰ مگابایت)
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleInputChange}
        disabled={isUploading || disabled}
      />

      {/* Image URLs (hidden inputs for form submission) */}
      {uploadedUrls.map((url) => (
        <input key={url} type="hidden" name="images" value={url} />
      ))}
    </div>
  );
}
