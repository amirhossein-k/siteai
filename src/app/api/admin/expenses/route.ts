import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, EXPENSE_WRITE_LIMIT } from "@/lib/rate-limiter";
import Expense, {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
} from "@/models/Expense";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/** Shape validation shared by create + update (validation BEFORE the rate limiter). */
export function validateExpenseBody(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): { error?: string; data?: {
  category?: string;
  description?: string;
  amount?: number;
  expenseDate?: Date;
  paymentMethod?: string | null;
  reference?: string;
  payee?: string;
  notes?: string;
  status?: string;
} } {
  const partial = opts.partial ?? false;
  const out: NonNullable<ReturnType<typeof validateExpenseBody>["data"]> = {};

  const require = (v: unknown) => (partial ? v !== undefined : v !== undefined && v !== null && v !== "");

  if (require(body.category)) {
    if (typeof body.category !== "string" || !(EXPENSE_CATEGORIES as readonly string[]).includes(body.category)) {
      return { error: "دسته‌بندی هزینه نامعتبر است" };
    }
    out.category = body.category;
  }

  if (require(body.description)) {
    if (typeof body.description !== "string") {
      return { error: "شرح هزینه باید متن باشد" };
    }
    const desc = body.description.trim();
    if (desc.length < 2 || desc.length > 500) {
      return { error: "شرح هزینه باید بین ۲ تا ۵۰۰ کاراکتر باشد" };
    }
    out.description = desc;
  }

  if (require(body.amount)) {
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 0) {
      return { error: "مبلغ باید عدد صحیح غیرمنفی (تومان) باشد" };
    }
    out.amount = amount;
  }

  if (body.expenseDate !== undefined && body.expenseDate !== null && body.expenseDate !== "") {
    if (typeof body.expenseDate !== "string" || Number.isNaN(Date.parse(body.expenseDate))) {
      return { error: "تاریخ هزینه نامعتبر است" };
    }
    out.expenseDate = new Date(body.expenseDate);
  }

  if (require(body.paymentMethod)) {
    if (typeof body.paymentMethod !== "string" || !(EXPENSE_PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
      return { error: "روش پرداخت هزینه نامعتبر است" };
    }
    out.paymentMethod = body.paymentMethod;
  }

  if (body.reference !== undefined && body.reference !== null) {
    if (typeof body.reference !== "string") return { error: "مرجع باید متن باشد" };
    const reference = body.reference.trim();
    if (reference.length > 200) return { error: "مرجع حداکثر ۲۰۰ کاراکتر" };
    out.reference = reference;
  }

  if (body.payee !== undefined && body.payee !== null) {
    if (typeof body.payee !== "string") return { error: "دریافت‌کننده باید متن باشد" };
    const payee = body.payee.trim();
    if (payee.length > 200) return { error: "دریافت‌کننده حداکثر ۲۰۰ کاراکتر" };
    out.payee = payee;
  }

  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") return { error: "یادداشت باید متن باشد" };
    const notes = body.notes.trim();
    if (notes.length > 1000) return { error: "یادداشت حداکثر ۱۰۰۰ کاراکتر" };
    out.notes = notes;
  }

  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (typeof body.status !== "string" || !(EXPENSE_STATUSES as readonly string[]).includes(body.status)) {
      return { error: "وضعیت هزینه نامعتبر است" };
    }
    if (body.status === "void") {
      return { error: "وضعیت باطل‌شده فقط از طریق عملیات باطل‌سازی ثبت می‌شود" };
    }
    out.status = body.status;
  }

  return { data: out };
}

/** GET /api/admin/expenses — list with status/category/date/q filters + pagination. */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || "";
    const category = sp.get("category") || "";
    const q = sp.get("q") || "";
    const from = sp.get("from");
    const to = sp.get("to");
    const page = Math.max(1, Number(sp.get("page") || 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || 30) || 30));

    const match: Record<string, unknown> = {};
    if (status && (EXPENSE_STATUSES as readonly string[]).includes(status)) match.status = status;
    if (category && (EXPENSE_CATEGORIES as readonly string[]).includes(category)) match.category = category;

    // Date range on expenseDate — [from 00:00, to+1d 00:00).
    if (from && !Number.isNaN(Date.parse(from))) {
      match.expenseDate = { ...((match.expenseDate as object) || {}), $gte: new Date(`${from}T00:00:00.000Z`) };
    }
    if (to && !Number.isNaN(Date.parse(to))) {
      match.expenseDate = {
        ...((match.expenseDate as object) || {}),
        $lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000),
      };
    }

    if (q) {
      const needle = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.$or = [
        { description: new RegExp(needle, "i") },
        { payee: new RegExp(needle, "i") },
        { reference: new RegExp(needle, "i") },
        { notes: new RegExp(needle, "i") },
      ];
    }

    const [rows, total] = await Promise.all([
      Expense.find(match)
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("createdBy", "name")
        .populate("voidedBy", "name")
        .lean(),
      Expense.countDocuments(match),
    ]);

    return NextResponse.json({
      expenses: rows.map((e) => toExpenseView(e)),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    console.error("[Expenses] GET failed:", error);
    return serverError();
  }
}

/** POST /api/admin/expenses — create a new expense (default status: pending). */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
    }

    const { error: validationError, data } = validateExpenseBody(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    if (!data!.category || !data!.description || data!.amount === undefined) {
      return NextResponse.json(
        { error: "دسته‌بندی، شرح و مبلغ هزینه الزامی است" },
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
    const expense = await Expense.create({
      category: data!.category,
      description: data!.description,
      amount: data!.amount,
      expenseDate: data!.expenseDate ?? new Date(),
      paymentMethod: data!.paymentMethod ?? null,
      reference: data!.reference ?? "",
      payee: data!.payee ?? "",
      notes: data!.notes ?? "",
      status: data!.status ?? "pending",
      createdBy: token!.id,
    });

    return NextResponse.json({ expense: toExpenseView(expense.toObject()) }, { status: 201 });
  } catch (error) {
    console.error("[Expenses] POST failed:", error);
    return serverError();
  }
}

/** View mapper — populate labels + ISO dates (mirrors purchase-view conventions). */
export function toExpenseView(e: Record<string, any>): Record<string, any> {
  const createdBy = e.createdBy as unknown as { name?: string } | string | null | undefined;
  const voidedBy = e.voidedBy as unknown as { name?: string } | string | null | undefined;
  return {
    _id: String(e._id),
    category: e.category,
    categoryLabel:
      (EXPENSE_CATEGORY_LABELS as Record<string, string>)[String(e.category)] ??
      String(e.category ?? ""),
    description: e.description,
    amount: Number(e.amount || 0),
    expenseDate: e.expenseDate ? new Date(e.expenseDate).toISOString() : null,
    paymentMethod: e.paymentMethod,
    paymentMethodLabel: e.paymentMethod
      ? ((EXPENSE_PAYMENT_METHOD_LABELS as Record<string, string>)[String(e.paymentMethod)] ??
        String(e.paymentMethod))
      : null,
    reference: e.reference || "",
    payee: e.payee || "",
    notes: e.notes || "",
    status: e.status,
    statusLabel:
      (EXPENSE_STATUS_LABELS as Record<string, string>)[String(e.status)] ??
      String(e.status ?? ""),
    createdByName: typeof createdBy === "object" && createdBy ? createdBy.name || "" : "",
    voidedAt: e.voidedAt ? new Date(e.voidedAt).toISOString() : null,
    voidedByName: typeof voidedBy === "object" && voidedBy ? voidedBy.name || "" : "",
    voidReason: e.voidReason || "",
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : null,
  };
}
