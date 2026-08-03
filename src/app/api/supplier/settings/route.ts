import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import { sendTelegramMessage } from "@/lib/telegram";

// Public storefront profile field limits (Session 42).
const LOGO_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 500;

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id })
      .select("telegramChatId businessName contactPhone bankAccount logo description")
      .lean();

    if (!supplier) {
      return NextResponse.json(
        { error: "فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(supplier);
  } catch (error) {
    console.error("Error fetching supplier settings:", error);
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();
    const body = await req.json();
    const { telegramChatId, logo, description } = body as {
      telegramChatId?: string;
      logo?: string;
      description?: string;
    };

    if (telegramChatId === undefined && logo === undefined && description === undefined) {
      return NextResponse.json(
        { error: "مقداری برای بروزرسانی ارسال نشده است" },
        { status: 400 }
      );
    }

    // Sanitize: trim + length caps. telegramChatId behavior unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $set: Record<string, string> = {};
    if (telegramChatId !== undefined) {
      $set.telegramChatId = telegramChatId.trim();
    }
    if (logo !== undefined) {
      $set.logo = logo.trim().slice(0, LOGO_MAX_LENGTH);
    }
    if (description !== undefined) {
      $set.description = description.trim().slice(0, DESCRIPTION_MAX_LENGTH);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated: any = await Supplier.findOneAndUpdate(
      { user: token!.id },
      { $set },
      { new: true }
    )
      .select("telegramChatId logo description")
      .lean();

    if (!updated) {
      return NextResponse.json(
        { error: "فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "تنظیمات با موفقیت بروزرسانی شد",
      telegramChatId: updated.telegramChatId,
      logo: updated.logo || "",
      description: updated.description || "",
    });
  } catch (error) {
    console.error("Error updating supplier settings:", error);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier: any = await Supplier.findOne({ user: token!.id })
      .select("telegramChatId")
      .lean();

    if (!supplier) {
      return NextResponse.json(
        { error: "فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    if (!supplier.telegramChatId) {
      return NextResponse.json(
        { error: "ابتدا آیدی چت تلگرام را در تنظیمات وارد کنید" },
        { status: 400 }
      );
    }

    const sent = await sendTelegramMessage(
      supplier.telegramChatId,
      [
        "<b>🤖 پیام تست ربات فروشگاه من</b>",
        "",
        "ربات تلگرام شما با موفقیت متصل شد!",
        "",
        "از این پس نوتیف سفارشات جدید و بروزرسانی وضعیت از طریق این ربات ارسال خواهد شد.",
        "",
        `📅 ${new Date().toLocaleDateString("fa-IR", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
      ].join("\n")
    );

    if (!sent) {
      return NextResponse.json(
        {
          error:
            "خطا در ارسال پیام تست. لطفاً از صحت آیدی چت خود مطمئن شوید و ربات را در تلگرام استارت کنید.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      message: "پیام تست با موفقیت ارسال شد",
    });
  } catch (error) {
    console.error("Error sending test Telegram message:", error);
    return serverError();
  }
}
