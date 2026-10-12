import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import OtpCode from "@/models/OtpCode";
import User from "@/models/User";
import {
  rateLimit,
  OTP_REQUEST_LIMIT,
  OTP_REQUEST_IP_LIMIT,
} from "@/lib/rate-limiter";
import {
  generateOtpCode,
  hashOtpCode,
  normalizePhone,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
} from "@/lib/otp";
import { sendOtp, isSmsMockEnabled } from "@/lib/sms";

const PHONE_RE = /^09\d{9}$/;

/**
 * Session 62 — POST /api/auth/otp/request
 *
 * Step 1 of the SMS OTP flow. Validates the phone/purpose, applies per-phone +
 * per-IP rate limits and a 60s resend cooldown, then issues a 6-digit code
 * (only its SHA-256 digest is stored) and hands it to the SMS adapter.
 *
 * Account-existence gate (login): for the `login` purpose a phone with no
 * account receives 404 `{ reason: "not_registered" }` — no OtpCode row,
 * no SMS, no success response — so the UI can offer registration instead of
 * waiting for an SMS that never arrives. Rate limits (per-phone + per-IP)
 * run before the lookup, capping the existence oracle at the same rate as
 * the pre-existing register-purpose 409. `verify()` still fails uniformly
 * for unknown phones.
 */
export async function POST(req) {
  try {
    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const phone = normalizePhone(body?.phone || "");
    const purpose = body?.purpose;

    // Validate BEFORE the rate limiter (invalid payloads don't burn quota —
    // the Session 51 convention).
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: "شماره موبایل معتبر نیست" },
        { status: 400 }
      );
    }
    if (purpose !== "login" && purpose !== "register" && purpose !== "password_reset") {
      return NextResponse.json(
        { error: "نوع درخواست نامعتبر است" },
        { status: 400 }
      );
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const phoneRl = await rateLimit(`otp_request:${phone}`, OTP_REQUEST_LIMIT);
    if (phoneRl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست کد بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: phoneRl.headers }
      );
    }
    const ipRl = await rateLimit(`otp_request_ip:${ip}`, OTP_REQUEST_IP_LIMIT);
    if (ipRl.limited) {
      return NextResponse.json(
        { error: "تعداد درخواست کد بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: ipRl.headers }
      );
    }

    await dbConnect();

    // 60s resend cooldown — an unconsumed code created in the last minute
    // blocks a new one (prevents SMS bombing + accidental double-sends).
    const recent = await OtpCode.findOne({
      phone,
      purpose,
      codeConsumedAt: null,
      createdAt: { $gte: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
    });
    if (recent) {
      const waitMs = Math.max(
        1,
        OTP_RESEND_COOLDOWN_MS -
          (Date.now() - new Date(recent.createdAt).getTime())
      );
      return NextResponse.json(
        { error: "کد قبلی هنوز معتبر است. کمی صبر کنید." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) },
        }
      );
    }

    if (purpose === "register") {
      const existing = await User.findOne({ phone });
      if (existing) {
        return NextResponse.json(
          { error: "این شماره موبایل قبلاً ثبت‌نام کرده است" },
          { status: 409 }
        );
      }
    } else if (purpose === "login") {
      // login — account-existence gate (product decision: the login UX
      // guides unregistered visitors to registration instead of silently
      // pretending an SMS was sent).
      //
      // Threat model: response-shape changes are rate-limit-equivalent to the
      // PRE-EXISTING register-purpose 409 oracle — per-phone + per-IP limits
      // run BEFORE this lookup and cap enumeration at the same rate. No row
      // is created for unknown phones and no code is issued: nothing is
      // verifiable, so `verify()` would 400 uniformly anyway.
      const user = await User.findOne({ phone });
      if (!user) {
        // Unknown phone — guide to registration. Never reveals more than
        // existence (normalized lookup, server-side; page preserves the
        // number as a query param and re-validates at the register API).
        return NextResponse.json(
          {
            error: "حسابی با این شماره موبایل پیدا نشد. لطفاً ثبت‌نام کنید.",
            reason: "not_registered",
          },
          { status: 404 }
        );
      }
    } else {
      // password_reset — anti-enumeration CLOSED (Session 84 decision): an
      // unknown phone receives the SAME 200 AND a dummy OtpCode row, so the
      // 60s resend cooldown behaves identically for known and unknown
      // numbers (no 200-vs-429 existence oracle — the login purpose keeps
      // its documented legacy trade-off, this purpose does not inherit it).
      // No SMS is ever sent; the dummy row carries a random code hash that
      // was never delivered, so verify() fails uniformly for unknown phones.
      const user = await User.findOne({ phone });
      if (!user) {
        await OtpCode.create({
          phone,
          purpose,
          codeHash: hashOtpCode(generateOtpCode()),
          devPlaintextCode: null,
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        });
        return NextResponse.json({
          sent: true,
          purpose,
          expiresInSeconds: OTP_TTL_MS / 1000,
        });
      }
    }

    const code = generateOtpCode();
    const mock = isSmsMockEnabled();
    await OtpCode.create({
      phone,
      purpose,
      codeHash: hashOtpCode(code),
      devPlaintextCode: mock ? code : null,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const result = await sendOtp(phone, code);
    if (!result.ok) {
      // Controlled delivery failure — the code row TTL-expires unused.
      // A missing SMS provider (SMS_NOT_CONFIGURED) surfaces here as a 503
      // without ever breaking the rest of the app.
      return NextResponse.json(
        { error: "ارسال پیامک در حال حاضر ممکن نیست. لطفاً بعداً تلاش کنید." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      sent: true,
      purpose,
      expiresInSeconds: OTP_TTL_MS / 1000,
    });
  } catch (err) {
    console.error("OTP request error:", err);
    return NextResponse.json(
      { error: "خطای سرور، دوباره امتحان کنید" },
      { status: 500 }
    );
  }
}
