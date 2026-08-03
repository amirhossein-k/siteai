import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import File from "@/models/File";
import {
  uploadFile,
  uploadFileFromUrl,
  deleteFile,
  getKeyFromUrl,
} from "@/lib/upload";

/**
 * POST /api/upload
 *
 * Uploads a file. Supports two modes:
 * 1. multipart/form-data (browser file input) — field name: "file"
 * 2. application/json with { url: string } — downloads from URL and uploads
 *
 * Requires authentication (admin or supplier role).
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, [
    "admin",
    "supplier",
  ]);
  if (error) return error;

  try {
    const contentType = req.headers.get("content-type") || "";

    // ─── Mode 1: multipart/form-data (browser upload) ───
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileField = formData.get("file");

      // Duck-type the file: `fileField instanceof File` is unreliable in
      // Next.js route handlers (the class produced by the body parser is not
      // necessarily the same as the route module's global `File`), which made
      // every upload fail with "فایلی ارسال نشده است" even when the multipart
      // body was well-formed. Check the File/Blob shape instead.
      const value = fileField as unknown;
      const isFileLike =
        fileField !== null &&
        typeof value === "object" &&
        typeof (value as { arrayBuffer?: unknown }).arrayBuffer ===
          "function" &&
        typeof (value as { size?: unknown }).size === "number";

      if (!isFileLike) {
        return NextResponse.json(
          { error: "فایلی ارسال نشده است" },
          { status: 400 }
        );
      }

      const file = fileField as File;

      if (file.size === 0) {
        return NextResponse.json(
          { error: "فایل ارسال شده خالی است" },
          { status: 400 }
        );
      }

      const result = await uploadFile(file);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      await dbConnect();
      await File.create({
        url: result.url,
        key: result.key,
        name: result.name,
        size: result.size,
        mimeType: result.mimeType,
        category: result.category,
        uploadedBy: token!.id,
      }).catch((err) =>
        console.error("[Upload] Failed to persist file record:", err)
      );

      return NextResponse.json(
        {
          success: true,
          url: result.url,
          key: result.key,
          name: result.name,
          size: result.size,
          mimeType: result.mimeType,
          category: result.category,
        },
        { status: 201 }
      );
    }

    // ─── Mode 2: JSON with URL ───
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { url } = body;

      if (!url || typeof url !== "string") {
        return NextResponse.json(
          { error: "آدرس فایل (url) الزامی است" },
          { status: 400 }
        );
      }

      const result = await uploadFileFromUrl(url);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      await dbConnect();
      await File.create({
        url: result.url,
        key: result.key,
        name: result.name,
        size: result.size,
        mimeType: result.mimeType,
        category: result.category,
        uploadedBy: token!.id,
      }).catch((err) =>
        console.error("[Upload] Failed to persist file record:", err)
      );

      return NextResponse.json(
        {
          success: true,
          url: result.url,
          key: result.key,
          name: result.name,
          size: result.size,
          mimeType: result.mimeType,
          category: result.category,
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        error:
          "فرمت درخواست نامعتبر است. از multipart/form-data یا application/json استفاده کنید.",
      },
      { status: 415 }
    );
  } catch (error) {
    console.error("[Upload API] Error:", error);
    return NextResponse.json(
      { error: "خطا در آپلود فایل" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/upload
 */
export async function DELETE(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, [
    "admin",
    "supplier",
  ]);
  if (error) return error;

  try {
    const body = await req.json();
    let { key } = body;

    if (!key || typeof key !== "string") {
      return NextResponse.json(
        { error: "کلید فایل (key) الزامی است" },
        { status: 400 }
      );
    }

    if (key.startsWith("http")) {
      const extractedKey = getKeyFromUrl(key);
      if (!extractedKey) {
        return NextResponse.json(
          { error: "آدرس فایل نامعتبر است" },
          { status: 400 }
        );
      }
      key = extractedKey;
    }

    const result = await deleteFile(key);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    await dbConnect();
    await File.findOneAndDelete({ key }).catch((err) =>
      console.warn("[Upload] Failed to delete file record from DB:", err)
    );

    return NextResponse.json({
      success: true,
      message: "فایل با موفقیت حذف شد",
    });
  } catch (error) {
    console.error("[Upload API] Delete error:", error);
    return NextResponse.json(
      { error: "خطا در حذف فایل" },
      { status: 500 }
    );
  }
}