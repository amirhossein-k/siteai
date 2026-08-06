import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
  invalidateTokenVersionCache,
} from "@/lib/auth-utils";
import User from "@/models/User";
import { rateLimit, REVOKE_SESSION_LIMIT } from "@/lib/rate-limiter";

/**
 * Session 64 — POST /api/admin/users/[id]/revoke-session
 *
 * Admin-only session revocation: bumps the TARGET user's tokenVersion, which
 * invalidates every JWT that user holds (within the 60s enforcement window —
 * see auth-utils / token-version). The target's next protected request gets
 * 401 and they must sign in again. The admin's own session is unaffected.
 *
 * Guards: malformed ObjectId → 400 (never a CastError 500 — Session 53
 * convention); unknown user → 404. Rate limit: 30 per admin per 15 minutes.
 */
export async function POST(req, { params }) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه کاربر نامعتبر است" },
        { status: 400 }
      );
    }

    // Keyed by the ACTOR (admin) so one admin hammering revoke endpoints is
    // throttled regardless of how many distinct target users they touch.
    // (token is non-null here — requireRoleOrError only returns a token when
    // the role check passed.)
    const rl = await rateLimit(`revoke_session:${token.id}`, REVOKE_SESSION_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد تلاش‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();

    const res = await User.updateOne(
      { _id: id },
      { $inc: { tokenVersion: 1 } }
    );
    if (res.matchedCount === 0) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 404 }
      );
    }

    // Evict the target's enforcement cache so the revocation applies
    // IMMEDIATELY in this server (the target's next request is 401).
    invalidateTokenVersionCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error revoking session:", err);
    return serverError();
  }
}
