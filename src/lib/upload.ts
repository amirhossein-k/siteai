/**
 * Unified File Upload Service
 *
 * Supports S3-compatible storage (Liara, AWS S3, MinIO, etc.).
 * Provides file validation, multipart browser upload, URL-based import, and deletion.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ─── Allowed MIME types ─────────────────────────────────
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/ogg",
] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
] as const;

export type AllowedMimeType = (typeof ALLOWED_TYPES)[number];

// ─── File size limits ────────────────────────────────────
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024; // 20 MB

function getMaxSizeForType(mimeType: string): number {
  if (mimeType.startsWith("image/")) return MAX_IMAGE_SIZE;
  if (mimeType.startsWith("video/")) return MAX_VIDEO_SIZE;
  return MAX_DOCUMENT_SIZE;
}

// ─── Category helpers ────────────────────────────────────
export type FileCategory = "image" | "video" | "document";

export function getFileCategory(mimeType: string): FileCategory {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

// ─── S3 Client ───────────────────────────────────────────
let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client | null {
  const endpoint = process.env.LIARA_ENDPOINT;
  const accessKey = process.env.LIARA_ACCESS_KEY;
  const secretKey = process.env.LIARA_SECRET_KEY;

  if (!endpoint || !accessKey || !secretKey) {
    console.warn("[Upload] Liara S3 credentials not configured");
    return null;
  }

  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: process.env.LIARA_REGION || "us-west-2",
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }

  return s3ClientInstance;
}

function getBucketName(): string {
  return process.env.LIARA_BUCKET_NAME || "";
}

// ─── File naming ─────────────────────────────────────────
/**
 * Generate a unique file key for S3 storage.
 * Format: uploads/{category}/{date}/{random}.{ext}
 */
function generateFileKey(
  category: FileCategory,
  originalName: string,
  mimeType: string
): string {
  const ext = mimeType.split("/")[1] || "bin";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const random = crypto.randomUUID().slice(0, 12);
  const safeName = originalName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 40);

  return `uploads/${category}/${date}/${random}-${safeName}.${ext}`;
}

// ─── Validation ──────────────────────────────────────────
export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFile(
  file: { name: string; size: number; type: string },
  allowedTypes?: readonly string[]
): FileValidationResult {
  const types = allowedTypes || ALLOWED_TYPES;

  // Check MIME type
  if (!types.includes(file.type as AllowedMimeType)) {
    return {
      valid: false,
      error: `نوع فایل "${file.type}" مجاز نیست. فرمت‌های مجاز: ${types
        .map((t) => t.split("/")[1])
        .join(", ")}`,
    };
  }

  // Check size
  const maxSize = getMaxSizeForType(file.type);
  if (file.size > maxSize) {
    const sizeMB = Math.round(maxSize / (1024 * 1024));
    return {
      valid: false,
      error: `حجم فایل نباید بیشتر از ${sizeMB} مگابایت باشد`,
    };
  }

  return { valid: true };
}

// ─── Upload result ───────────────────────────────────────
export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  category?: FileCategory;
  error?: string;
}

// ─── Upload file from browser (multipart/form-data) ─────
export async function uploadFile(
  file: File,
  allowedTypes?: readonly string[]
): Promise<UploadResult> {
  // Validate
  const validation = validateFile(file, allowedTypes);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const s3 = getS3Client();
  if (!s3) {
    return {
      success: false,
      error: "سیستم آپلود پیکربندی نشده است",
    };
  }

  const bucket = getBucketName();
  if (!bucket) {
    return {
      success: false,
      error: "مخزن آپلود پیکربندی نشده است",
    };
  }

  const category = getFileCategory(file.type);
  const key = generateFileKey(category, file.name, file.type);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );

    const endpoint = process.env.LIARA_ENDPOINT!;
    const publicUrl = `${endpoint}/${bucket}/${key}`;

    return {
      success: true,
      url: publicUrl,
      key,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      category,
    };
  } catch (error) {
    console.error("[Upload] Error uploading file:", error);
    return {
      success: false,
      error: "خطا در آپلود فایل. لطفاً دقایقی دیگر تلاش کنید.",
    };
  }
}

// ─── Upload file from URL (e.g., Telegram) ──────────────
export async function uploadFileFromUrl(
  fileUrl: string,
  allowedTypes?: readonly string[]
): Promise<UploadResult> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      return {
        success: false,
        error: "خطا در دانلود فایل از منبع مورد نظر",
      };
    }

    const contentType =
      response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    // Validate MIME type
    const types = allowedTypes || ALLOWED_TYPES;
    if (!types.includes(contentType as AllowedMimeType)) {
      return {
        success: false,
        error: `نوع فایل "${contentType}" مجاز نیست`,
      };
    }

    const s3 = getS3Client();
    if (!s3) {
      return { success: false, error: "سیستم آپلود پیکربندی نشده است" };
    }

    const bucket = getBucketName();
    if (!bucket) {
      return { success: false, error: "مخزن آپلود پیکربندی نشده است" };
    }

    const category = getFileCategory(contentType);
    const ext = contentType.split("/")[1] || "jpg";
    const key = generateFileKey(category, `url-import.${ext}`, contentType);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const endpoint = process.env.LIARA_ENDPOINT!;
    const publicUrl = `${endpoint}/${bucket}/${key}`;

    return {
      success: true,
      url: publicUrl,
      key,
      name: `url-import.${ext}`,
      size: buffer.length,
      mimeType: contentType,
      category,
    };
  } catch (error) {
    console.error("[Upload] Error uploading from URL:", error);
    return {
      success: false,
      error: "خطا در آپلود فایل از URL",
    };
  }
}

// ─── Delete file ─────────────────────────────────────────
export async function deleteFile(key: string): Promise<{ success: boolean; error?: string }> {
  if (!key) {
    return { success: false, error: "کلید فایل نامعتبر است" };
  }

  const s3 = getS3Client();
  if (!s3) {
    return { success: false, error: "سیستم آپلود پیکربندی نشده است" };
  }

  const bucket = getBucketName();
  if (!bucket) {
    return { success: false, error: "مخزن آپلود پیکربندی نشده است" };
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return { success: true };
  } catch (error) {
    console.error("[Upload] Error deleting file:", error);
    return { success: false, error: "خطا در حذف فایل" };
  }
}

/**
 * Extract the S3 key from a public URL.
 * Example: https://endpoint/bucket/uploads/image/2025/01/abc.jpg
 * → uploads/image/2025/01/abc.jpg
 */
export function getKeyFromUrl(url: string): string | null {
  try {
    const endpoint = process.env.LIARA_ENDPOINT || "";
    const bucket = getBucketName();
    const prefix = `${endpoint}/${bucket}/`;
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length);
    }
    return null;
  } catch {
    return null;
  }
}
