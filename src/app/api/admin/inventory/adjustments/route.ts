import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError } from "@/lib/auth-utils";
import { rateLimit, INVENTORY_WRITE_LIMIT } from "@/lib/rate-limiter";
import {
  applyInventoryAdjustment,
  validateAdjustment,
  type AdjustmentInput,
} from "@/lib/inventory-adjustments";

/**
 * POST /api/admin/inventory/adjustments — Session 82 Phase D.
 *
 * Admin-only audited stock adjustment. Every successful adjustment creates an
 * append-only `adjustment` InventoryMovement (exactly-once via the unique
 * sourceRef `adj-<key>` claim), keeps Product.stock ↔ costLayers consistent
 * atomically (stockVersion optimistic lock), and never lets stock go negative.
 *
 * Purchased products: positive → new FIFO layer at the CONFIRMED unitCost;
 * negative → FIFO layer consumption (insufficient layers → 400, no mutation).
 * Consignment products: stock-only (no cost layers — documented semantics).
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const input: AdjustmentInput = {
      productId: String(body?.product ?? ""),
      variantId:
        body?.variantId !== undefined && body?.variantId !== null
          ? String(body.variantId)
          : undefined,
      quantityDelta: body?.quantityDelta,
      unitCost: body?.unitCost,
      reason: String(body?.reason ?? ""),
      notes: body?.notes ? String(body.notes) : undefined,
      key: String(body?.key ?? ""),
      actorId: token!.id,
    };

    // Shape validation BEFORE the rate limiter (project convention).
    const v = validateAdjustment(input);
    if (v.error) {
      return NextResponse.json({ error: v.error }, { status: v.status ?? 400 });
    }

    const rl = await rateLimit(
      `inventory-write:${token!.id}`,
      INVENTORY_WRITE_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json({ error: "تعدیل‌های زیادی انجام شد. کمی بعد دوباره تلاش کنید" }, { status: 429 });
    }

    const result = await applyInventoryAdjustment(input);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(
      {
        idempotent: result.idempotent,
        movement: result.movement,
        product: result.product,
      },
      { status: result.idempotent ? 200 : 201 }
    );
  } catch (err) {
    console.error("[InventoryAdjustments] POST failed:", err);
    return NextResponse.json({ error: "خطا در ثبت تعدیل موجودی" }, { status: 500 });
  }
}
