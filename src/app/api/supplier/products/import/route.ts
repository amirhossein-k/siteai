import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/rate-limiter";
import { executeProductImport } from "@/lib/product-import";
import { MAX_CSV_BYTES } from "@/lib/product-csv-constants";
import Supplier from "@/models/Supplier";

/** Supplier product import: 20 imports per 15 minutes per user (bulk sessions can legitimately import several files). */
const IMPORT_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/**
 * POST /api/supplier/products/import — bulk product CSV import (Session 51).
 * Supplier-only. Body: { csv: string }. Rows are auto-assigned to the calling
 * supplier's profile (the CSV `supplier` column is ignored) — ownership can
 * never be forged. Returns a per-row ImportReport. Create-only.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    // Validate the payload BEFORE the rate limiter (invalid payloads don't
    // burn quota — same convention as the supplier-review-reply route).
    const body = await req.json().catch(() => null);
    const csv = typeof body?.csv === "string" ? body.csv : "";
    if (!csv.trim()) {
      return NextResponse.json({ error: "متن CSV الزامی است" }, { status: 400 });
    }
    // Byte-length (not char-length) — Persian UTF-8 can otherwise exceed the
    // nominal cap. Mirrors the executor guard.
    if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: "حجم فایل CSV بیشتر از حد مجاز است (حداکثر ۵۰۰ کیلوبایت)" },
        { status: 413 }
      );
    }

    const rate = await rateLimit(`product-import:${token!.id}`, IMPORT_LIMIT);
    if (rate.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های ورود انبوه بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rate.headers }
      );
    }

    const supplier = await Supplier.findOne({ user: token!.id }).select("_id");
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const result = await executeProductImport(csv, String(supplier._id));

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status || 400 }
      );
    }
    return NextResponse.json(result.report);
  } catch (err) {
    console.error("Error importing supplier products:", err);
    return serverError();
  }
}
