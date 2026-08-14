import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, PURCHASE_WRITE_LIMIT } from "@/lib/rate-limiter";
import PurchaseOrder from "@/models/PurchaseOrder";
import { toPurchaseView } from "@/lib/purchase-view";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * POST /api/admin/purchases/[id]/cancel  { reason }
 *
 * Cancels a purchase. Only allowed while NOTHING has been received — received
 * inventory history is never destroyed (purchase returns are a later phase),
 * so a partially-received purchase cannot be cancelled in v1.
 * Atomic claim: matches only draft/ordered with zero received quantities.
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
      typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    await dbConnect();
    const rl = await rateLimit(`purchase-write:${token!.id}`, PURCHASE_WRITE_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const updated = await PurchaseOrder.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ["draft", "ordered"] },
        // No item may have received inventory yet
        "items.receivedQuantity": { $not: { $gt: 0 } },
      },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: token!.id,
          cancellationReason: reason,
          updatedBy: token!.id,
        },
      },
      { new: true }
    )
      .populate("supplier", "businessName")
      .lean();

    if (!updated) {
      const existing: any = await PurchaseOrder.findById(id).lean();
      if (!existing) {
        return NextResponse.json({ error: "خرید یافت نشد" }, { status: 404 });
      }
      const hasReceived = ((existing.items as Array<Record<string, unknown>>) || []).some(
        (it) => Number(it.receivedQuantity || 0) > 0
      );
      return NextResponse.json(
        hasReceived
          ? { error: "خرید دارای موجودی دریافتی قابل لغو نیست (بازگشت خرید در نسخه بعدی)" }
          : { error: "این خرید در وضعیت قابل لغو نیست" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      purchase: toPurchaseView(updated as Record<string, unknown>),
    });
  } catch (error) {
    console.error("[Purchases] cancel failed:", error);
    return serverError();
  }
}
