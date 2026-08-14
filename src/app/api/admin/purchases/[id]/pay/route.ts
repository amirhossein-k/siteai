import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, PURCHASE_WRITE_LIMIT } from "@/lib/rate-limiter";
import PurchaseOrder from "@/models/PurchaseOrder";
import { derivePaymentStatus } from "@/lib/purchase-math";
import { toPurchaseView } from "@/lib/purchase-view";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * POST /api/admin/purchases/[id]/pay  { amount }
 *
 * Records a supplier payment. STRICTLY a cash event — it NEVER creates
 * inventory, cost layers, or movements (only receiving does). amountPaid is
 * capped at the order total; paymentStatus is derived (unpaid|partial|paid).
 * Atomic single-document update (standalone Mongo convention).
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
    const body = await req.json();
    const amount = Number(body?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: "مبلغ پرداخت باید عدد صحیح مثبت باشد" }, { status: 400 });
    }

    await dbConnect();
    const rl = await rateLimit(`purchase-write:${token!.id}`, PURCHASE_WRITE_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const purchase: any = await PurchaseOrder.findById(id).lean();
    if (!purchase) {
      return NextResponse.json({ error: "خرید یافت نشد" }, { status: 404 });
    }
    if (purchase.status === "cancelled") {
      return NextResponse.json({ error: "خرید لغو شده قابل پرداخت نیست" }, { status: 400 });
    }

    const total = Number(purchase.total || 0);
    const currentPaid = Number(purchase.amountPaid || 0);
    const newPaid = Math.min(total, currentPaid + amount);
    const paymentStatus = derivePaymentStatus(newPaid, total);

    const updated = await PurchaseOrder.findByIdAndUpdate(
      id,
      {
        $set: {
          amountPaid: newPaid,
          paymentStatus,
          updatedBy: token!.id,
        },
      },
      { new: true }
    )
      .populate("supplier", "businessName")
      .lean();

    return NextResponse.json({
      purchase: toPurchaseView(updated as Record<string, unknown>),
      paidAmount: newPaid - currentPaid,
    });
  } catch (error) {
    console.error("[Purchases] pay failed:", error);
    return serverError();
  }
}
