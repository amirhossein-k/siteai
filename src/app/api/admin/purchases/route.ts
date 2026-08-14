import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, PURCHASE_WRITE_LIMIT } from "@/lib/rate-limiter";
import PurchaseOrder from "@/models/PurchaseOrder";
import Supplier from "@/models/Supplier";
import { computeSubtotal, computeTotal, buildPurchaseNumber } from "@/lib/purchase-math";
import { preparePurchaseItems } from "@/lib/purchase-prepare";
import { toPurchaseView } from "@/lib/purchase-view";
import type { PurchaseItemInput } from "@/types";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

/** GET /api/admin/purchases — list with status/supplier filters + pagination. */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || "";
    const supplier = sp.get("supplier") || "";
    const page = Math.max(1, Number(sp.get("page") || 1) || 1);
    const limit = Math.min(50, Math.max(1, Number(sp.get("limit") || 20) || 20));

    const match: Record<string, unknown> = {};
    if (status && ["draft", "ordered", "partially_received", "received", "cancelled"].includes(status)) {
      match.status = status;
    }
    if (supplier && isValidObjectId(supplier)) match.supplier = supplier;

    const [rows, total] = await Promise.all([
      PurchaseOrder.find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("supplier", "businessName")
        .lean(),
      PurchaseOrder.countDocuments(match),
    ]);

    return NextResponse.json({
      purchases: rows.map(toPurchaseView as (p: unknown) => ReturnType<typeof toPurchaseView>),
      page,
      totalPages: Math.ceil(total / limit),
      total,
    });
  } catch (error) {
    console.error("[Purchases] GET failed:", error);
    return serverError();
  }
}

/** POST /api/admin/purchases — create a draft purchase (NEVER creates inventory). */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const body = await req.json();

    const supplierId = body?.supplier;
    const purchaseDate = body?.purchaseDate;
    const items: PurchaseItemInput[] = Array.isArray(body?.items)
      ? body.items
      : null;
    const discount = Number(body?.discount ?? 0);
    const additionalCosts = Number(body?.additionalCosts ?? 0);
    const reference = typeof body?.reference === "string" ? body.reference : "";
    const notes = typeof body?.notes === "string" ? body.notes : "";

    // --- Shape validation before the rate limiter ---
    if (typeof supplierId !== "string" || !isValidObjectId(supplierId)) {
      return NextResponse.json({ error: "تأمین‌کننده نامعتبر است" }, { status: 400 });
    }
    if (typeof purchaseDate !== "string" || Number.isNaN(Date.parse(purchaseDate))) {
      return NextResponse.json({ error: "تاریخ خرید نامعتبر است" }, { status: 400 });
    }
    if (!items || items.length === 0) {
      return NextResponse.json({ error: "حداقل یک قلم کالا لازم است" }, { status: 400 });
    }
    for (const it of items) {
      if (!it || typeof it.product !== "string" || !isValidObjectId(it.product)) {
        return NextResponse.json({ error: "کالای نامعتبر در خرید" }, { status: 400 });
      }
      if (it.variantId !== undefined && it.variantId !== null && typeof it.variantId !== "string") {
        return NextResponse.json({ error: "تنوع نامعتبر است" }, { status: 400 });
      }
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        return NextResponse.json({ error: "تعداد باید عدد صحیح مثبت باشد" }, { status: 400 });
      }
      if (!Number.isInteger(it.unitCost) || it.unitCost < 0) {
        return NextResponse.json({ error: "هزینه واحد باید عدد صحیح غیرمنفی باشد" }, { status: 400 });
      }
    }
    if (!Number.isInteger(discount) || discount < 0 || !Number.isInteger(additionalCosts) || additionalCosts < 0) {
      return NextResponse.json({ error: "تخفیف و هزینه اضافی باید عدد صحیح غیرمنفی باشند" }, { status: 400 });
    }
    if (reference.length > 200 || notes.length > 1000) {
      return NextResponse.json({ error: "متن بیش از حد مجاز است" }, { status: 400 });
    }

    await dbConnect();
    const rl = await rateLimit(`purchase-write:${token!.id}`, PURCHASE_WRITE_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // Supplier must exist.
    const supplier = await Supplier.findById(supplierId).lean();
    if (!supplier) {
      return NextResponse.json({ error: "تأمین‌کننده یافت نشد" }, { status: 400 });
    }

    // Every line must reference an EXISTING "purchased"-sourcing product
    // (Phase A invariant — shared with the update route).
    const prepared = await preparePurchaseItems(items);
    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: prepared.status });
    }
    const preparedItems = prepared.items;

    const subtotal = computeSubtotal(preparedItems);
    const total = computeTotal(subtotal, discount, additionalCosts);
    if (total <= 0) {
      return NextResponse.json({ error: "مبلغ کل خرید باید بیشتر از صفر باشد" }, { status: 400 });
    }

    // Unique purchase number with a deterministic retry.
    let created = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        created = await PurchaseOrder.create({
          number: buildPurchaseNumber(new Date(purchaseDate)),
          supplier: supplierId,
          purchaseDate: new Date(purchaseDate),
          reference: reference.trim(),
          notes: notes.trim(),
          status: "draft",
          subtotal,
          discount,
          additionalCosts,
          total,
          paymentStatus: "unpaid",
          amountPaid: 0,
          items: preparedItems,
          receipts: [],
          createdBy: token!.id,
          updatedBy: token!.id,
        });
        break;
      } catch (err) {
        const code = (err as { code?: number })?.code;
        if (code !== 11000 || attempt === 4) throw err;
      }
    }

    const populated = await PurchaseOrder.findById(created!._id)
      .populate("supplier", "businessName")
      .lean();
    return NextResponse.json(
      { purchase: toPurchaseView(populated as Record<string, unknown>) },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Purchases] POST failed:", error);
    return serverError();
  }
}
