import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, EXPENSE_WRITE_LIMIT } from "@/lib/rate-limiter";
import Expense from "@/models/Expense";
import { toExpenseView } from "../../route";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * POST /api/admin/expenses/[id]/pay
 *
 * pending → paid (idempotent: paying an already-paid expense is a no-op 200).
 * A voided expense can never be paid (400) — financial history is immutable.
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
      return NextResponse.json(
        { error: "هزینه باطل‌شده قابل پرداخت نیست" },
        { status: 400 }
      );
    }
    if (expense.status === "paid") {
      // Idempotent — already paid.
      const existing = await Expense.findById(id)
        .populate("createdBy", "name")
        .populate("voidedBy", "name")
        .lean();
      return NextResponse.json({ expense: toExpenseView(existing!) });
    }

    const updated = await Expense.findByIdAndUpdate(
      id,
      { $set: { status: "paid", updatedBy: token!.id } },
      { new: true }
    )
      .populate("createdBy", "name")
      .populate("voidedBy", "name")
      .lean();

    return NextResponse.json({ expense: toExpenseView(updated!) });
  } catch (error) {
    console.error("[Expenses] pay failed:", error);
    return serverError();
  }
}
