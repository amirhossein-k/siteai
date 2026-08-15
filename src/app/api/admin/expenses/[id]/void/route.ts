import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, EXPENSE_WRITE_LIMIT } from "@/lib/rate-limiter";
import Expense from "@/models/Expense";
import { toExpenseView } from "../../route";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * POST /api/admin/expenses/[id]/void
 *
 * AUDITED VOID — the approved Phase E flow:
 *  - voidReason is REQUIRED (2–500 chars, validated BEFORE the rate limiter).
 *  - The row is NEVER hard-deleted: voidedAt/voidedBy/voidReason are stamped
 *    and the status flips to "void" — it stays visible for the audit trail.
 *  - paid/pending → void; voiding an already-voided expense is a no-op 200
 *    (idempotent). Voids are FINAL (no un-void) — corrections are new rows.
 *  - Voided expenses are EXCLUDED from every financial total (P&L, report).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: "شناسه نامعتبر است" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const reason =
      body && typeof body.voidReason === "string" ? body.voidReason.trim() : "";
    if (reason.length < 2 || reason.length > 500) {
      return NextResponse.json(
        { error: "دلیل باطل‌سازی الزامی است (بین ۲ تا ۵۰۰ کاراکتر)" },
        { status: 400 }
      );
    }

    const rl = await rateLimit(`expense-write:${token!.id}`, EXPENSE_WRITE_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();
    const expense = await Expense.findById(id);
    if (!expense) {
      return NextResponse.json({ error: "هزینه یافت نشد" }, { status: 404 });
    }
    if (expense.status === "void") {
      // Idempotent — already voided.
      const existing = await Expense.findById(id)
        .populate("createdBy", "name")
        .populate("voidedBy", "name")
        .lean();
      return NextResponse.json({ expense: toExpenseView(existing!) });
    }

    const updated = await Expense.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "void",
          voidedAt: new Date(),
          voidedBy: token!.id,
          voidReason: reason,
          updatedBy: token!.id,
        },
      },
      { new: true }
    )
      .populate("createdBy", "name")
      .populate("voidedBy", "name")
      .lean();

    return NextResponse.json({ expense: toExpenseView(updated!) });
  } catch (error) {
    console.error("[Expenses] void failed:", error);
    return serverError();
  }
}
