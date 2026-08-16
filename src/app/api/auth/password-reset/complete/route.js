import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/dbConnect";
import { invalidateTokenVersionCache } from "@/lib/auth-utils";
import User from "@/models/User";
import OtpCode from "@/models/OtpCode";
import { rateLimit, PASSWORD_RESET_COMPLETE_LIMIT } from "@/lib/rate-limiter";
import { hashResetToken, normalizePhone } from "@/lib/otp";

const PHONE_RE = /^09\d{9}$/;

/**
 * Session 84 — POST /api/auth/password-reset/complete
 *
 * The final step of the password-recovery flow. Verifies the one-time
 * password-reset token minted by POST /api/auth/otp/verify (purpose
 * "password_reset"), then sets the new password and revokes every
 * previously-issued session — the exact change-password semantics:
 *
 *   - body: { phone, resetToken, newPassword }
 *   - the resetToken is 256-bit random, stored SHA-256-hashed on the OtpCode
 *     row (resetTokenHash), short-lived (2 min, TTL-aligned with the row) and
 *     consumed ATOMICALLY here (updateOne { consumedAt: null } →
 *     modifiedCount 1) — a replayed or stolen token can never be spent twice
 *     and two concurrent completes allow exactly one winner;
 *   - on success: passwordHash = bcrypt(newPassword, 10), tokenVersion++
 *     + token-version cache invalidation → ALL previously-issued JWTs die
 *     (≤60s cross-process, instant same-process);
 *   - hardening: every outstanding OtpCode row for the phone (login /
 *     register / reset codes AND issued-but-unspent login/reset tokens) is
 *     marked consumed, so a pending login token minted BEFORE the reset can
 *     never authenticate afterwards;
 *   - the flow NEVER calls signIn and NEVER issues/uses a loginToken — a
 *     password reset cannot create a session by construction.
 *
 * Public endpoint (like /api/register) — possession of the resetToken is the
 * authorization. Rate limit: 5 per phone per 15 minutes.
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
    const resetToken = typeof body?.resetToken === "string" ? body.resetToken : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    // Validate BEFORE the rate limiter (invalid payloads don't burn quota —
    // the Session 51 convention).
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: "شماره موبایل معتبر نیست" },
        { status: 400 }
      );
    }
    if (!resetToken) {
      return NextResponse.json(
        { error: "درخواست نامعتبر است" },
        { status: 400 }
      );
    }
    if (newPassword.length < 6 || newPassword.length > 100) {
      return NextResponse.json(
        { error: "رمز عبور باید حداقل ۶ و حداکثر ۱۰۰ کاراکتر باشد" },
        { status: 400 }
      );
    }

    const rl = await rateLimit(
      `password_reset_complete:${phone}`,
      PASSWORD_RESET_COMPLETE_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد تلاش‌های زیادی انجام شده است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    // Uniform failure message — never reveals whether a reset token (or the
    // account) exists.
    const UNIFORM_INVALID = "درخواست نامعتبر یا منقضی شده است";

    const doc = await OtpCode.findOne({
      phone,
      purpose: "password_reset",
      resetTokenHash: hashResetToken(resetToken),
      consumedAt: null,
    });
    if (!doc) {
      return NextResponse.json({ error: UNIFORM_INVALID }, { status: 400 });
    }
    if (
      !doc.resetTokenExpiresAt ||
      new Date(doc.resetTokenExpiresAt).getTime() <= Date.now() ||
      new Date(doc.expiresAt).getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: UNIFORM_INVALID }, { status: 400 });
    }

    // Atomic single-use claim — a concurrent/replayed complete loses the
    // update (exactly-once, mirroring authorize()'s loginToken exchange).
    const claimed = await OtpCode.updateOne(
      { _id: doc._id, consumedAt: null },
      { $set: { consumedAt: new Date() } }
    );
    if (claimed.modifiedCount !== 1) {
      return NextResponse.json({ error: UNIFORM_INVALID }, { status: 400 });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return NextResponse.json({ error: UNIFORM_INVALID }, { status: 400 });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await User.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash: newHash },
        // Revoke ALL previously-issued sessions (every device) — a
        // pre-reset JWT carries the old tokenVersion and dies at the gate.
        $inc: { tokenVersion: 1 },
      }
    );

    // Evict the enforcement cache so the revocation applies IMMEDIATELY
    // in this process (same pattern as change-password).
    invalidateTokenVersionCache(String(user._id));

    // Hardening (Session 84 decision): consume EVERY outstanding OTP row for
    // this phone — pending login/register/reset codes AND already-issued but
    // unspent login/reset tokens (their atomic exchange then fails).
    await OtpCode.updateMany(
      { phone },
      { $set: { codeConsumedAt: new Date(), consumedAt: new Date() } }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Password reset complete error:", err);
    return NextResponse.json(
      { error: "خطای سرور، دوباره امتحان کنید" },
      { status: 500 }
    );
  }
}
