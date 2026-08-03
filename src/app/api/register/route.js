import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/dbConnect";
import User from "@/models/User";
import { rateLimit, REGISTER_LIMIT } from "@/lib/rate-limiter";

export async function POST(req) {
  try {
    // Rate limit by client IP (with x-forwarded-for fallback)
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const rl = await rateLimit(`register:${ip}`, REGISTER_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های ثبت‌نام بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const { name, phone, password } = await req.json();

    if (!name || !phone || !password) {
      return NextResponse.json(
        { error: "نام، شماره موبایل و رمز عبور الزامی هستن" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "رمز عبور باید حداقل ۶ کاراکتر باشه" },
        { status: 400 }
      );
    }

    await dbConnect();

    const existing = await User.findOne({ phone });
    if (existing) {
      return NextResponse.json(
        { error: "این شماره موبایل قبلا ثبت‌نام کرده" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      phone,
      passwordHash,
      role: "customer", // فروشنده و ادمین از این مسیر ساخته نمی‌شن
    });

    return NextResponse.json(
      { id: user._id.toString(), name: user.name, phone: user.phone },
      { status: 201 }
    );
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json(
      { error: "خطای سرور، دوباره امتحان کن" },
      { status: 500 }
    );
  }
}
