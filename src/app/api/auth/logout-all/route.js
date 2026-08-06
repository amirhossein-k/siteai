import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireAuth,
  unauthorized,
  serverError,
  invalidateTokenVersionCache,
} from "@/lib/auth-utils";
import User from "@/models/User";
import { rateLimit, LOGOUT_ALL_LIMIT } from "@/lib/rate-limiter";

/**
 * Session 64 — POST /api/auth/logout-all
 *
 * "Sign out from all devices": bumps the authenticated user's tokenVersion,
 * which revokes EVERY previously-issued JWT (including the current one) within
 * the 60s enforcement window (see auth-utils / token-version). The client
 * should then call signOut() to clear the local session cookie and redirect.
 *
 * Rate limit: 10 per user per 15 minutes (a deliberate action — generous).
 */
export async function POST(req) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    const rl = await rateLimit(`logout_all:${token.id}`, LOGOUT_ALL_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد تلاش‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const res = await User.updateOne(
      { _id: token.id },
      { $inc: { tokenVersion: 1 } }
    );
    if (res.matchedCount === 0) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 404 }
      );
    }

    // Evict the enforcement cache so the revocation applies IMMEDIATELY.
    invalidateTokenVersionCache(token.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging out all devices:", error);
    return serverError();
  }
}
