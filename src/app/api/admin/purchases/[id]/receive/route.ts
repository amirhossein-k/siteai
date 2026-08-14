import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, PURCHASE_WRITE_LIMIT } from "@/lib/rate-limiter";
import PurchaseOrder from "@/models/PurchaseOrder";
import Product from "@/models/Product";
import InventoryMovement from "@/models/InventoryMovement";
import { deriveStatus } from "@/lib/purchase-math";
import { toPurchaseView } from "@/lib/purchase-view";
import type { InventoryCostLayer } from "@/lib/inventory-layers";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) => /^[0-9a-fA-F]{24}$/.test(id);

interface ReceiveRequestItem {
  itemId: string;
  quantity: number;
}

/**
 * POST /api/admin/purchases/[id]/receive
 *
 * The ONLY operation that creates inventory (stock + FIFO cost layer +
 * InventoryMovement). Creating or paying a purchase never does.
 *
 * CRITICAL RULES:
 *  - receivedQuantity can never exceed quantity (per-item atomic $elemMatch
 *    claim — two concurrent receives cannot over-receive).
 *  - Unit cost comes from the PurchaseItem, NEVER Product.supplierPrice.
 *  - Every received quantity creates exactly one FIFO cost layer whose ref is
 *    `receipt-<purchaseId>-<key>-<itemId>`. The Product update is guarded by
 *    that ref's absence, so it is AT-MOST-ONCE per (purchase, key, item) —
 *    repeated/duplicate requests can never double inventory.
 *  - Every receipt creates an append-only InventoryMovement (type "receipt"),
 *    deduped by sourceRef (unique partial index).
 *  - The operation is idempotent via the client-supplied `key`: a retry with
 *    the same key self-heals (re-applies any missing inventory writes — they
 *    are ref-guarded) and never double-receives.
 *
 * FAILURE-WINDOW ANALYSIS (standalone Mongo — no multi-document transactions):
 *  - The purchase-doc commit (receipt journal + per-item receivedQuantity +
 *    status) is a sequence of single-document atomic updates on ONE document;
 *    on an over-receive the whole request rolls back (reverse increments +
 *    $pull the receipt record) → 409, no partial state.
 *  - The Product stock/layer + movement writes happen AFTER the purchase-doc
 *    commit. A crash in that window leaves the purchase "received" but some
 *    inventory writes missing — a retry with the SAME key re-applies only the
 *    missing writes (layer-ref guard + movement sourceRef dedupe) and converges.
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

    const key =
      typeof body?.key === "string" ? body.key.replace(/[^a-zA-Z0-9_-]/g, "") : "";
    const requestItems: ReceiveRequestItem[] = Array.isArray(body?.items)
      ? body.items
      : null;

    // --- Shape validation before the rate limiter ---
    if (!key || key.length < 4 || key.length > 64) {
      return NextResponse.json({ error: "کلید دریافت نامعتبر است" }, { status: 400 });
    }
    if (!requestItems || requestItems.length === 0) {
      return NextResponse.json({ error: "حداقل یک قلم برای دریافت انتخاب کنید" }, { status: 400 });
    }
    for (const it of requestItems) {
      if (!it || typeof it.itemId !== "string" || !isValidObjectId(it.itemId)) {
        return NextResponse.json({ error: "قلم نامعتبر است" }, { status: 400 });
      }
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        return NextResponse.json({ error: "تعداد دریافت باید عدد صحیح مثبت باشد" }, { status: 400 });
      }
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
      return NextResponse.json({ error: "خرید لغو شده قابل دریافت نیست" }, { status: 400 });
    }
    if (purchase.status === "received") {
      return NextResponse.json({ error: "این خرید به‌طور کامل دریافت شده است" }, { status: 400 });
    }

    const purchaseId = String(purchase._id);
    const items = (purchase.items as Array<Record<string, unknown>>) || [];
    const itemById = new Map(items.map((it) => [String(it._id), it]));

    // Resolve each requested item against the purchase lines.
    interface ResolvedReceive {
      item: Record<string, unknown>;
      inc: number;
    }
    const resolved: ResolvedReceive[] = [];
    for (const r of requestItems) {
      const item = itemById.get(r.itemId);
      if (!item) {
        return NextResponse.json({ error: "قلم خرید یافت نشد" }, { status: 400 });
      }
      const ordered = Number(item.quantity || 0);
      const received = Number(item.receivedQuantity || 0);
      const outstanding = Math.max(0, ordered - received);
      if (r.quantity > outstanding) {
        return NextResponse.json(
          { error: `تعداد درخواستی بیش از موجودی قابل دریافت است (باقیمانده: ${outstanding})` },
          { status: 409 }
        );
      }
      resolved.push({ item, inc: r.quantity });
    }

    // ---------- Step 1: idempotency + claim the receipt key ----------
    const receiptRef = (itemId: string) =>
      `receipt-${purchaseId}-${key}-${itemId}`;

    // Inventory-side application (ref-guarded — at-most-once per (key, item)).
    const applyInventory = async (res: ResolvedReceive[]) => {
      for (const r of res) {
        const productId = String(r.item.product || "");
        const variantId = r.item.variantId ? String(r.item.variantId) : null;
        const unitCost = Number(r.item.unitCost || 0);
        const inc = r.inc;
        const ref = receiptRef(String(r.item._id));
        const now = new Date();

        const layer: InventoryCostLayer = {
          qty: inc,
          remaining: inc,
          unitCost,
          acquiredAt: now,
          source: "receipt",
          ref,
        };

        // Atomic at-most-once product update: stock increment + layer push in
        // ONE single-document operation, guarded by the layer ref absence.
        const query = variantId
          ? {
              _id: productId,
              variants: {
                $elemMatch: {
                  _id: variantId,
                  costLayers: { $not: { $elemMatch: { ref } } },
                },
              },
            }
          : {
              _id: productId,
              costLayers: { $not: { $elemMatch: { ref } } },
            };
        const update = variantId
          ? {
              $inc: {
                stock: inc,
                stockVersion: 1,
                "variants.$.stock": inc,
                "variants.$.stockVersion": 1,
              },
              $push: { "variants.$.costLayers": layer },
            }
          : {
              $inc: { stock: inc, stockVersion: 1 },
              $push: { costLayers: layer },
            };

        await Product.findOneAndUpdate(query, update, { new: true });

        // Append-only movement (deduped by the unique partial index on sourceRef).
        const sourceRef = ref;
        const exists = await InventoryMovement.exists({ sourceRef });
        if (!exists) {
          try {
            await InventoryMovement.create({
              product: productId,
              variantId,
              type: "receipt",
              quantity: inc,
              unitCost,
              totalCost: inc * unitCost,
              sourceRef,
              description: `دریافت کالا (خرید ${String(purchase.number || "")})`,
              createdBy: token!.id,
            });
          } catch (mvErr) {
            if ((mvErr as { code?: number })?.code !== 11000) throw mvErr;
          }
        }
      }
    };

    const existingReceipt = (purchase.receipts as Array<{ key?: string }>) || [];
    const already = existingReceipt.some((r) => r.key === key);

    if (already) {
      // Idempotent retry: self-heal any missing inventory writes (guarded) and
      // return the current state — never double-receives.
      await applyInventory(resolved);
      const current = await PurchaseOrder.findById(id)
        .populate("supplier", "businessName")
        .lean();
      return NextResponse.json({
        purchase: toPurchaseView(current as Record<string, unknown>),
        idempotent: true,
      });
    }

    const claimed = await PurchaseOrder.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ["ordered", "partially_received"] },
        "receipts.key": { $ne: key },
      },
      {
        $push: {
          receipts: {
            key,
            items: requestItems.map((r) => ({
              itemId: r.itemId,
              quantity: r.quantity,
            })),
            receivedAt: new Date(),
            receivedBy: token!.id,
          },
        },
      },
      { new: true }
    ).lean();
    if (!claimed) {
      // Concurrent duplicate key claim — treat as an idempotent retry.
      await applyInventory(resolved);
      const current = await PurchaseOrder.findById(id)
        .populate("supplier", "businessName")
        .lean();
      return NextResponse.json({
        purchase: toPurchaseView(current as Record<string, unknown>),
        idempotent: true,
      });
    }

    // ---------- Step 2: per-item atomic increments (over-receive → rollback) ----------
    const applied: Array<{ itemId: string; inc: number }> = [];
    for (const r of resolved) {
      const updatedItem = await PurchaseOrder.findOneAndUpdate(
        {
          _id: id,
          items: {
            $elemMatch: {
              _id: r.item._id,
              receivedQuantity: { $lte: Number(r.item.quantity || 0) - r.inc },
            },
          },
        },
        { $inc: { "items.$.receivedQuantity": r.inc } },
        { new: true }
      ).lean();
      if (!updatedItem) {
        // Over-receive (concurrent different-key receipt consumed outstanding).
        // ROLL BACK everything applied in THIS request (all single-doc on the
        // same purchase document) and return 409 — no partial state.
        for (const a of applied) {
          await PurchaseOrder.updateOne(
            { _id: id, "items._id": a.itemId },
            { $inc: { "items.$.receivedQuantity": -a.inc } }
          );
        }
        await PurchaseOrder.updateOne({ _id: id }, { $pull: { receipts: { key } } });
        return NextResponse.json(
          { error: "دریافت هم‌زمان رخ داد؛ دوباره تلاش کنید" },
          { status: 409 }
        );
      }
      applied.push({ itemId: String(r.item._id), inc: r.inc });
    }

    // ---------- Step 3: recompute + persist status ----------
    const fresh: any = await PurchaseOrder.findById(id).lean();
    const freshItems = (fresh!.items as Array<Record<string, unknown>>) || [];
    const newStatus = deriveStatus(freshItems as never, String(fresh!.status));
    if (newStatus !== fresh!.status) {
      await PurchaseOrder.updateOne(
        { _id: id },
        { $set: { status: newStatus, updatedBy: token!.id } }
      );
    }

    // ---------- Step 4: inventory side (stock + layers + movements) ----------
    await applyInventory(resolved);

    const finalPurchase = await PurchaseOrder.findById(id)
      .populate("supplier", "businessName")
      .lean();
    return NextResponse.json({
      purchase: toPurchaseView(finalPurchase as Record<string, unknown>),
      idempotent: false,
    });
  } catch (error) {
    console.error("[Purchases] receive failed:", error);
    return serverError();
  }
}
