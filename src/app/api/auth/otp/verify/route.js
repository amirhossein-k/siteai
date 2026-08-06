import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import OtpCode from "@/models/OtpCode";
import User from "@/models/User";
import { rateLimit, OTP_VERIFY_LIMIT } from "@/lib/rate-limiter";
import {
  generateLoginToken,
  hashLoginToken,
  hashOtpCode,
  normalizePhone,
  OTP_MAX_ATTEMPTS,
  OTP_LOGIN_TOKEN_TTL_MS,
} from "@/lib/otp";

const PHONE_RE = /^09\d{9}$/;
const CODE_RE = /^\d{6}$/;

/**
 * Session 62 — POST /api/auth/otp/verify
 *
 * Step 2 of the SMS OTP flow. Validates the code against the latest
 * unconsumed row for the phone+purpose:
 *   - wrong code → attempts incremented; after OTP_MAX_ATTEMPTS the row is
 *     locked (consumed) so a fresh code is required;
 *   - expired code → 400;
 *   - correct code → for `register` creates the customer account (NO
 *     passwordHash — OTP-only, tokenVersion 0), for `login` requires the
 *     account; then consumes the row and attaches a one-time loginTokenHash
 *     (TTL-aligned with the row so the token can never outlive it) and
 *     returns the plaintext token for the NextAuth credentials exchange.
 *
 * The returned login token is replay-proof: authorize() consumes the row
 * atomically, so a second exchange loses the update.
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
    const code = String(body?.code || "").trim();
    const purpose = body?.purpose;
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (
      !PHONE_RE.test(phone) ||
      !CODE_RE.test(code) ||
      (purpose !== "login" && purpose !== "register")
    ) {
      return NextResponse.json(
        { error: "اطلاعات وارد شده معتبر نیست" },
        { status: 400 }
      );
    }
    if (purpose === "register" && name.length < 2) {
      return NextResponse.json(
        { error: "نام باید حداقل ۲ کاراکتر باشد" },
        { status: 400 }
      );
    }

    const rl = await rateLimit(`otp_verify:${phone}`, OTP_VERIFY_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const doc = await OtpCode.findOne({ phone, purpose, codeConsumedAt: null }).sort(
      { createdAt: -1 }
    );
    if (!doc) {
      // Uniform error — covers unknown phones (login) and never-trusted codes.
      return NextResponse.json(
        { error: "کد وارد شده صحیح نیست" },
        { status: 400 }
      );
    }
    if (new Date(doc.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "کد منقضی شده است. دوباره درخواست دهید." },
        { status: 400 }
      );
    }

    if (hashOtpCode(code) !== doc.codeHash) {
      const attempts = (doc.attempts || 0) + 1;
      const locked = attempts >= OTP_MAX_ATTEMPTS;
      await OtpCode.updateOne(
        { _id: doc._id },
        {
          $set: {
            attempts,
            ...(locked ? { codeConsumedAt: new Date() } : {}),
          },
        }
      );
      return NextResponse.json(
        {
          error: locked
            ? "تعداد تلاش‌های ناموفق بیش از حد مجاز بود. دوباره درخواست دهید."
            : "کد وارد شده صحیح نیست",
        },
        { status: 400 }
      );
    }

    // Correct code — resolve/create the account.
    let user;
    if (purpose === "register") {
      const existing = await User.findOne({ phone });
      if (existing) {
        // Registered between request and verify (race).
        return NextResponse.json(
          { error: "این شماره موبایل قبلاً ثبت‌نام کرده است" },
          { status: 409 }
        );
      }
      user = await User.create({
        name,
        phone,
        role: "customer",
        isActive: true,
        tokenVersion: 0,
      });
    } else {
      user = await User.findOne({ phone });
      if (!user) {
        return NextResponse.json(
          { error: "کد وارد شده صحیح نیست" },
          { status: 400 }
        );
      }
    }

    // Issue a one-time login token. TTL = min(remaining row life, token TTL)
    // so the token can NEVER outlive its row (TTL index alignment).
    // NOTE: the CODE is consumed here (codeConsumedAt) but `consumedAt` stays
    // null — it is reserved for the single token exchange in authorize().
    const loginToken = generateLoginToken();
    const tokenExpiry = Math.min(
      new Date(doc.expiresAt).getTime(),
      Date.now() + OTP_LOGIN_TOKEN_TTL_MS
    );
    await OtpCode.updateOne(
      { _id: doc._id },
      {
        $set: {
          codeConsumedAt: new Date(),
          loginTokenHash: hashLoginToken(loginToken),
          loginTokenExpiresAt: new Date(tokenExpiry),
        },
      }
    );

    return NextResponse.json({
      loginToken,
      expiresInSeconds: Math.max(1, Math.floor((tokenExpiry - Date.now()) / 1000)),
    });
  } catch (err) {
    console.error("OTP verify error:", err);
    return NextResponse.json(
      { error: "خطای سرور، دوباره امتحان کنید" },
      { status: 500 }
    );
  }
}
