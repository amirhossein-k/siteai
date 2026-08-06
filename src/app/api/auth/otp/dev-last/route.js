import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import OtpCode from "@/models/OtpCode";
import { normalizePhone } from "@/lib/otp";
import { isSmsMockEnabled } from "@/lib/sms";

const PHONE_RE = /^09\d{9}$/;

/**
 * Session 62 — GET /api/auth/otp/dev-last?phone=…
 *
 * DEV/MOCK-ONLY seam (NODE_ENV=development AND SMS_MOCK=1): returns the most
 * recent UNCONSUMED code's plaintext for a phone, exactly like a user reading
 * their SMS inbox. E2E + verify-otp suites consume this to drive the OTP flow
 * hermetically.
 *
 * In every other environment this endpoint 404s — and because `devPlaintextCode`
 * is null there, there is literally no plaintext to return.
 */
export async function GET(req) {
  if (!isSmsMockEnabled()) {
    return NextResponse.json({ error: "در دسترس نیست" }, { status: 404 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const phone = normalizePhone(searchParams.get("phone") || "");
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: "شماره موبایل معتبر نیست" },
        { status: 400 }
      );
    }

    await dbConnect();

    const doc = await OtpCode.findOne({ phone, codeConsumedAt: null }).sort({
      createdAt: -1,
    });
    if (!doc || !doc.devPlaintextCode) {
      return NextResponse.json({ error: "کدی یافت نشد" }, { status: 404 });
    }

    return NextResponse.json({ code: doc.devPlaintextCode, purpose: doc.purpose });
  } catch (err) {
    console.error("OTP dev-last error:", err);
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  }
}
