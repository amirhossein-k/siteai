import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import Review from "@/models/Review";
import { sanitizePlainText } from "@/lib/sanitize";

/**
 * POST /api/admin/reviews/[id]/moderate
 * Admin only (requireRoleOrError → 401/403).
 * Body: { action: "approve" | "reject", reason? }
 *
 * Atomic claim (mirrors refund/payout patterns): findOneAndUpdate with
 * { _id, status: "pending" } — only ONE moderation can ever succeed; the
 * loser gets null → 400 "قبلاً بررسی شده". Reason is REQUIRED for reject.
 * reviewedBy/reviewedAt recorded for an immutable audit trail.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const { id } = await params;

    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "شناسه دیدگاه نامعتبر است" },
        { status: 400 }
      );
    }

    await dbConnect();

    const body = await req.json();
    const action: unknown = body?.action;

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "عملیات باید approve یا reject باشد" },
        { status: 400 }
      );
    }

    const reasonRaw: unknown = body?.reason;
    const reason =
      typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";

    if (action === "reject" && !reason) {
      return NextResponse.json(
        { error: "دلیل رد دیدگاه الزامی است" },
        { status: 400 }
      );
    }

    // Distinguish "not found" (404) from "already processed" (400)
    const exists = await Review.exists({ _id: id });
    if (!exists) {
      return NextResponse.json(
        { error: "دیدگاه یافت نشد" },
        { status: 404 }
      );
    }

    // Atomic claim: pending → approved/rejected exactly once
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await Review.findOneAndUpdate(
      {
        _id: id,
        status: "pending",
      },
      {
        $set: {
          status: action === "approve" ? "approved" : "rejected",
          reviewedBy: token!.id,
          reviewedAt: new Date(),
          rejectionReason: action === "reject" ? sanitizePlainText(reason) : "",
        },
      },
      { new: true }
    ).lean();

    if (!claimed) {
      return NextResponse.json(
        { error: "این دیدگاه قبلاً بررسی شده است" },
        { status: 400 }
      );
    }

    return NextResponse.json(claimed);
  } catch (error) {
    console.error("Error moderating review:", error);
    return serverError();
  }
}
