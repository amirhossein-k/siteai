import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireAuth,
  unauthorized,
  serverError,
  invalidateTokenVersionCache,
} from "@/lib/auth-utils";
import User from "@/models/User";
import { rateLimit, CHANGE_PASSWORD_LIMIT } from "@/lib/rate-limiter";

/**
 * Session 64 — POST /api/auth/change-password
 *
 * Authenticated password change with session revocation:
 *   - body: { currentPassword?, newPassword }
 *   - a user WITH a password must supply the correct currentPassword
 *     (bcrypt compare → 400 on mismatch);
 *   - a PASSWORDLESS user (OTP-registered, passwordHash null) sets their
 *     first password by omitting currentPassword — the missing hash means
 *     there is nothing to verify;
 *   - newPassword must be ≥ 6 chars (same floor as register/login);
 *   - on success the user's tokenVersion is BUMPED → every previously-issued
 *     JWT is revoked within the 60s enforcement window (see auth-utils /
 *     token-version) — the current session included. The client should
 *     signOut() and have the user sign in again with the new password.
 *
 * Rate limit: 5 per user per 15 minutes (keyed by user id, not phone).
 */
export async function POST(req) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (newPassword.length < 6 || newPassword.length > 100) {
      return NextResponse.json(
        { error: "رمز عبور جدید باید حداقل ۶ و حداکثر ۱۰۰ کاراکتر باشد" },
        { status: 400 }
      );
    }

    const rl = await rateLimit(`change_password:${token.id}`, CHANGE_PASSWORD_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد تلاش‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const user = await User.findById(token.id);
    if (!user) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 404 }
      );
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: "رمز عبور فعلی الزامی است" },
          { status: 400 }
        );
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: "رمز عبور فعلی صحیح نیست" },
          { status: 400 }
        );
      }
    }
    // Passwordless user: currentPassword is intentionally NOT required —
    // there is no existing hash to verify; they are setting their first one.

    const newHash = await bcrypt.hash(newPassword, 10);
    await User.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash: newHash },
        // Revoke ALL existing sessions (including the current one).
        $inc: { tokenVersion: 1 },
      }
    );

    // Evict the enforcement cache so this revocation applies IMMEDIATELY
    // (the pre-change session's next protected request is 401).
    invalidateTokenVersionCache(String(user._id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error changing password:", error);
    return serverError();
  }
}
