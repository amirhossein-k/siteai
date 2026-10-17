import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import EnamadSettings from "@/models/EnamadSettings";
import { sanitizeEnamadCode, type EnamadSettingsDoc } from "@/lib/enamad-settings";
import { sanitizePlainText } from "@/lib/sanitize";

async function requireAdmin(req: NextRequest) {
  return requireRoleOrError(req, ["admin"]);
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  try {
    await dbConnect();
    const settings = (await EnamadSettings.findOne({ key: "footer" }).lean()) as EnamadSettingsDoc | null;
    return NextResponse.json({
      settings: {
        enabled: Boolean(settings?.enabled),
        code: String(settings?.code || ""),
        altText: String(settings?.altText || "نماد اعتماد الکترونیکی"),
      },
    });
  } catch (error) {
    console.error("Error reading Enamad settings:", error);
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  try {
    const body = await req.json();
    const code = sanitizeEnamadCode(body.code);
    if (body.enabled && !code) {
      return NextResponse.json(
        { error: "کد اینماد معتبر نیست؛ فقط کد رسمی HTTPS شامل لینک و تصویر اینماد پذیرفته می‌شود." },
        { status: 400 }
      );
    }
    await dbConnect();
    const settings = (
      await EnamadSettings.findOneAndUpdate(
      { key: "footer" },
      {
        $set: {
          enabled: Boolean(body.enabled),
          code,
          altText: sanitizePlainText(String(body.altText || "نماد اعتماد الکترونیکی")).slice(0, 120),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean()
    ) as EnamadSettingsDoc | null;
    if (!settings) return serverError();
    return NextResponse.json({
      settings: {
        enabled: Boolean(settings.enabled),
        code: String(settings.code || ""),
        altText: String(settings.altText || ""),
      },
    });
  } catch (error) {
    console.error("Error saving Enamad settings:", error);
    return serverError();
  }
}
