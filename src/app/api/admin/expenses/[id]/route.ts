import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, EXPENSE_WRITE_LIMIT } from "@/lib/rate-limiter";
import Expense from "@/models/Expense";
import { validateExpenseBody, toExpenseView } from "../route";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/** GET /api/admin/expenses/[id] — expense detail (voided rows remain visible for audit). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: "شناسه نامعتبر است" }, { status: 400 });
    }

    await dbConnect();
    const expense = await Expense.findById(id)
      .populate("createdBy", "name")
      .populate("voidedBy", "name")
      .lean();
    if (!expense) {
      return NextResponse.json({ error: "هزینه یافت نشد" }, { status: 404 });
    }

    return NextResponse.json({ expense: toExpenseView(expense) });
  } catch (error) {
    console.error("[Expenses] GET [id] failed:", error);
    return serverError();
  }
}

/** PATCH /api/admin/expenses/[id] — edit an expense (NEVER once voided). */
export async function PATCH(
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

    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
    }

    const { error: validationError, data } = validateExpenseBody(body, { partial: true });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const safeData = data ?? {};

    const rl = await rateLimit(`expense-write:${token!.id}`, EXPENSE_WRITE_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();
    const existing = await Expense.findById(id);
    if (!existing) {
      return NextResponse.json({ error: "هزینه یافت نشد" }, { status: 404 });
    }
    if (existing.status === "void") {
      return NextResponse.json(
        { error: "هزینه باطل‌شده قابل ویرایش نیست — برای اصلاح، هزینه جدید ثبت کنید" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { ...safeData, updatedBy: token!.id };
    const updated = await Expense.findByIdAndUpdate(id, { $set: update }, { new: true })
      .populate("createdBy", "name")
      .populate("voidedBy", "name")
      .lean();

    return NextResponse.json({ expense: toExpenseView(updated!) });
  } catch (error) {
    console.error("[Expenses] PATCH failed:", error);
    return serverError();
  }
}
