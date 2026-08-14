import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, PURCHASE_WRITE_LIMIT } from "@/lib/rate-limiter";
import PurchaseOrder from "@/models/PurchaseOrder";
import { computeSubtotal, computeTotal } from "@/lib/purchase-math";
import { preparePurchaseItems } from "@/lib/purchase-prepare";
import { toPurchaseView } from "@/lib/purchase-view";
import type { PurchaseItemInput } from "@/types";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/** GET /api/admin/purchases/[id] — detail with line items + receipts. */
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
    const purchase = await PurchaseOrder.findById(id)
      .populate("supplier", "businessName")
      .lean();
    if (!purchase) {
      return NextResponse.json({ error: "خرید یافت نشد" }, { status: 404 });
    }
    return NextResponse.json({ purchase: toPurchaseView(purchase as Record<string, unknown>) });
  } catch (error) {
    console.error("[Purchases] GET detail failed:", error);
    return serverError();
  }
}

/**
 * PATCH /api/admin/purchases/[id]
 *
 * Allowed while status is draft (edit items/amounts, mark ordered) or ordered
 * (mark ordered; items are frozen — receiving has begun semantics). Once any
 * quantity is received, line items can never change (historical cost layers
 * already reference them).
 */
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

    await dbConnect();
    const rl = await rateLimit(`purchase-write:${token!.id}`, PURCHASE_WRITE_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const purchase = (await PurchaseOrder.findById(id).lean()) as
      | (Record<string, unknown> & {
          status?: string;
          items?: Array<Record<string, unknown>>;
          discount?: number;
          additionalCosts?: number;
        })
      | null;
    if (!purchase) {
      return NextResponse.json({ error: "خرید یافت نشد" }, { status: 404 });
    }
    if (purchase.status === "cancelled") {
      return NextResponse.json({ error: "خرید لغو شده قابل ویرایش نیست" }, { status: 400 });
    }
    const hasReceived =
      ((purchase.items as Array<Record<string, unknown>>) || []).some(
        (it) => Number(it.receivedQuantity || 0) > 0
      );
    if (purchase.status === "received" || hasReceived) {
      return NextResponse.json(
        { error: "پس از دریافت کالا، خرید قابل ویرایش نیست" },
        { status: 400 }
      );
    }

    const set: Record<string, unknown> = {};
    const action = body?.action;

    // Mark ordered (draft → ordered) — a standalone action.
    if (action === "order") {
      if (purchase.status !== "draft") {
        return NextResponse.json({ error: "فقط خرید پیش‌نویس قابل سفارش است" }, { status: 400 });
      }
      set.status = "ordered";
    } else {
      // Editable fields (draft only)
      if (purchase.status !== "draft") {
        return NextResponse.json(
          { error: "فقط خرید پیش‌نویس قابل ویرایش است" },
          { status: 400 }
        );
      }
      if (body.purchaseDate !== undefined) {
        if (typeof body.purchaseDate !== "string" || Number.isNaN(Date.parse(body.purchaseDate))) {
          return NextResponse.json({ error: "تاریخ خرید نامعتبر است" }, { status: 400 });
        }
        set.purchaseDate = new Date(body.purchaseDate);
      }
      if (body.reference !== undefined) set.reference = String(body.reference).trim().slice(0, 200);
      if (body.notes !== undefined) set.notes = String(body.notes).trim().slice(0, 1000);

      if (body.items !== undefined) {
        const items: PurchaseItemInput[] = Array.isArray(body.items) ? body.items : null;
        if (!items || items.length === 0) {
          return NextResponse.json({ error: "حداقل یک قلم کالا لازم است" }, { status: 400 });
        }
        for (const it of items) {
          if (!it || typeof it.product !== "string" || !isValidObjectId(it.product)) {
            return NextResponse.json({ error: "کالای نامعتبر در خرید" }, { status: 400 });
          }
          if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
            return NextResponse.json({ error: "تعداد باید عدد صحیح مثبت باشد" }, { status: 400 });
          }
          if (!Number.isInteger(it.unitCost) || it.unitCost < 0) {
            return NextResponse.json({ error: "هزینه واحد نامعتبر است" }, { status: 400 });
          }
        }
        // Re-validate + snapshot against current products (same invariant as
        // create — consignment products can never enter a purchase).
        const prepared = await preparePurchaseItems(items);
        if (!prepared.ok) {
          return NextResponse.json({ error: prepared.error }, { status: prepared.status });
        }
        set.items = prepared.items.map((it) => ({
          product: it.product,
          variantId: it.variantId,
          name: it.name,
          variantLabel: it.variantLabel,
          quantity: it.quantity,
          receivedQuantity: 0,
          unitCost: it.unitCost,
        }));
      }

      const discount =
        body.discount !== undefined ? Number(body.discount) : Number(purchase.discount || 0);
      const additionalCosts =
        body.additionalCosts !== undefined
          ? Number(body.additionalCosts)
          : Number(purchase.additionalCosts || 0);
      if (!Number.isInteger(discount) || discount < 0 || !Number.isInteger(additionalCosts) || additionalCosts < 0) {
        return NextResponse.json({ error: "تخفیف و هزینه اضافی باید عدد صحیح غیرمنفی باشند" }, { status: 400 });
      }
      set.discount = discount;
      set.additionalCosts = additionalCosts;

      const items = (set.items as Array<{ quantity: number; unitCost: number }>) ??
        (purchase.items as Array<{ quantity: number; unitCost: number }>);
      const subtotal = computeSubtotal(items);
      const total = computeTotal(subtotal, discount, additionalCosts);
      if (total <= 0) {
        return NextResponse.json({ error: "مبلغ کل خرید باید بیشتر از صفر باشد" }, { status: 400 });
      }
      set.subtotal = subtotal;
      set.total = total;
    }

    set.updatedBy = token!.id;
    const updated = await PurchaseOrder.findByIdAndUpdate(id, { $set: set }, { new: true })
      .populate("supplier", "businessName")
      .lean();
    return NextResponse.json({ purchase: toPurchaseView(updated as Record<string, unknown>) });
  } catch (error) {
    console.error("[Purchases] PATCH failed:", error);
    return serverError();
  }
}
