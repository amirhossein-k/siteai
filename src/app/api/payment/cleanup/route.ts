import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError } from "@/lib/auth-utils";
import { cleanupAbandonedPayments } from "@/lib/payment-cleanup";

/**
 * GET /api/payment/cleanup
 *
 * Manual/cron trigger for the abandoned-payment cleanup.
 *
 * Authorization:
 *  - Admin (via requireRoleOrError) — manual trigger from the admin panel.
 *  - Optional CRON_SECRET support: if the request carries
 *    `x-cron-secret: <CRON_SECRET>` (or `Authorization: Bearer <CRON_SECRET>`),
 *    it is accepted without a session (Vercel Cron style). This is optional —
 *    if CRON_SECRET is not configured, admin auth is still enforced.
 *
 * Returns: { cleaned } — the number of abandoned orders cancelled.
 */
export async function GET(req: NextRequest) {
  // Optional cron secret (Vercel Cron / external scheduler)
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (!(cronSecret && headerSecret === cronSecret)) {
    const { error } = await requireRoleOrError(req, ["admin"]);
    if (error) return error;
  }

  try {
    await dbConnect();
    const cleaned = await cleanupAbandonedPayments();
    return NextResponse.json({ cleaned });
  } catch (error) {
    console.error("[Payment cleanup] Error:", error);
    return NextResponse.json(
      { error: "خطا در پردازش پاکسازی پرداخت‌ها" },
      { status: 500 }
    );
  }
}
