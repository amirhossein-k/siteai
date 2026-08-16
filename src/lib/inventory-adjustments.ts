/**
 * Inventory Adjustments — shared service (Session 82 Phase D).
 *
 * SINGLE implementation for every audited post-cutover stock change that is
 * NOT a sale/restock/receipt: admin stock adjustments. Purchased-sourcing
 * products keep stock ↔ costLayers consistent (positive → new layer at the
 * explicitly confirmed adjustment cost; negative → FIFO layer consumption,
 * never invented cost). Consignment products have NO cost layers (supplier-
 * owned stock) — adjustments record the movement with cost 0 and no layer
 * mutation (documented different semantics; never a fake FIFO invariant).
 *
 * Concurrency / atomicity (standalone MongoDB — no multi-doc transactions):
 *  - The movement row is the EXACTLY-ONCE claim: the append-only
 *    `InventoryMovement` with sourceRef `adj-<key>` is inserted FIRST (unique
 *    partial index). A duplicate key (client retry or concurrent identical
 *    request) short-circuits to an idempotent response — stock is never
 *    touched twice.
 *  - Stock + layers move together in ONE single-document findOneAndUpdate
 *    guarded by stockVersion (optimistic lock, 5-attempt re-read retry) —
 *    stock can never change without its layers (and vice versa).
 *  - Documented limitation (same exposure as Phase B receiving): a server
 *    crash between the claim insert and the stock apply leaves a pending
 *    movement row (final totals 0) and no stock change; the retry then
 *    reports idempotent. The row is visible in the ledger for reconciliation.
 *
 * Reconciliation: `reconcileInventory()` checks the audit invariant
 *   Σ signed movements (opening_balance + receipt − sale + restocks ±
 *   adjustments) == Product.stock
 * for initialized post-cutover products, and layersRemaining == stock for
 * purchased products.
 */

import mongoose from "mongoose";
import Product from "@/models/Product";
import InventoryMovement from "@/models/InventoryMovement";
import AccountingConfig from "@/models/AccountingConfig";
import {
  addLayer,
  consumeFifoLayers,
  type InventoryCostLayer,
} from "@/lib/inventory-layers";

const MAX_ADJUST_ATTEMPTS = 5;

export interface AdjustmentInput {
  productId: string;
  variantId?: string;
  /** Signed integer quantity change (≠ 0). */
  quantityDelta: number;
  /** Whole-toman unit cost — REQUIRED for positive purchased adjustments. */
  unitCost?: number;
  reason: string;
  notes?: string;
  /** Client-supplied idempotency key (must be 8..64 safe chars). */
  key: string;
  actorId: string;
}

export type AdjustmentResult =
  | {
      ok: true;
      idempotent: boolean;
      movement: Record<string, unknown>;
      product: Record<string, unknown>;
    }
  | { ok: false; status: number; error: string };

/** Validate the request shape (before any DB write / rate limit). */
export function validateAdjustment(
  input: AdjustmentInput
): { error?: string; status?: number } {
  if (!input.productId || !mongoose.isValidObjectId(input.productId)) {
    return { error: "شناسه محصول نامعتبر است", status: 400 };
  }
  if (
    input.variantId !== undefined &&
    input.variantId !== null &&
    !mongoose.isValidObjectId(input.variantId)
  ) {
    return { error: "شناسه تنوع نامعتبر است", status: 400 };
  }
  if (
    typeof input.quantityDelta !== "number" ||
    !Number.isInteger(input.quantityDelta) ||
    input.quantityDelta === 0
  ) {
    return { error: "مقدار تعدیل باید عدد صحیح غیرصفر باشد", status: 400 };
  }
  if (
    typeof input.key !== "string" ||
    input.key.length < 8 ||
    input.key.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(input.key)
  ) {
    return { error: "شناسه یکتای تعدیل نامعتبر است", status: 400 };
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < 2 || reason.length > 200) {
    return { error: "دلیل تعدیل (۲ تا ۲۰۰ نویسه) الزامی است", status: 400 };
  }
  if (
    input.unitCost !== undefined &&
    input.unitCost !== null &&
    (!Number.isInteger(input.unitCost) || input.unitCost < 0)
  ) {
    return { error: "هزینه واحد تعدیل باید عدد صحیح نامنفی باشد", status: 400 };
  }
  return {};
}

/** Is the accounting cutover initialized (enforcement is active)? */
export async function isInventoryInitialized(): Promise<boolean> {
  const config = (await AccountingConfig.findById("accounting")
    .select("inventoryInitialized")
    .lean()) as { inventoryInitialized?: boolean } | null;
  return config?.inventoryInitialized === true;
}

/**
 * Post-cutover enforcement guard (Session 82 Phase D): once accounting is
 * initialized, direct stock writes in product-edit payloads are REJECTED —
 * stock may only change through the audited adjustment mechanism (or the
 * existing audited flows: purchases/receiving, checkout, refunds, cancels).
 * Non-stock product editing is untouched. Returns `ok: true` when the payload
 * does not change stock (or accounting is not yet initialized).
 */
export async function assertNoDirectStockChange(
  productId: string,
  submitted: {
    stock?: unknown;
    variants?: Array<{ _id?: unknown; stock?: unknown }>;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isInventoryInitialized())) return { ok: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product: any = await Product.findById(productId)
    .select("stock hasVariants variants")
    .lean();
  if (!product) return { ok: true }; // let the caller's own 404 flow handle it
  const msg =
    "پس از فعال‌شدن حسابداری، تغییر مستقیم موجودی ممکن نیست — از صفحه «انبار» (تعدیل موجودی) استفاده کنید";
  if (
    product.hasVariants &&
    Array.isArray(product.variants) &&
    product.variants.length > 0
  ) {
    for (const sv of submitted.variants ?? []) {
      const current =
        sv._id === undefined || sv._id === null
          ? undefined
          : (product.variants as Array<{
              _id: unknown;
              stock?: number;
            }>).find((v) => String(v._id) === String(sv._id));
      if (!current) {
        // Session 82 Phase C hardening (MEDIUM-5): a NEW variant added
        // post-cutover must not introduce stock — there is no audited
        // adjustment (and no cost layer) behind it. stock = 0 is fine (no
        // inventory change).
        if (typeof sv.stock === "number" && sv.stock > 0) {
          return { ok: false, error: msg };
        }
        continue;
      }
      if (
        typeof sv.stock === "number" &&
        sv.stock !== (current.stock ?? 0)
      ) {
        return { ok: false, error: msg };
      }
    }
  } else if (
    typeof submitted.stock === "number" &&
    submitted.stock !== (product.stock ?? 0)
  ) {
    return { ok: false, error: msg };
  }
  return { ok: true };
}

/** Sum the signed movement quantities for a product (+ variant). */
export async function reconcileInventory(
  productId: string,
  variantId?: string
): Promise<{
  movementNet: number;
  stock: number;
  matches: boolean;
  layersRemaining: number;
  layersValue: number;
  movementCount: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [movements, product]: [any[], any] = await Promise.all([
    InventoryMovement.find({
      product: productId,
      ...(variantId ? { variantId } : {}),
    })
      .select("quantity")
      .lean(),
    Product.findById(productId)
      .select("stock stockVersion sourcing costLayers variants")
      .lean(),
  ]);
  const movementNet = movements.reduce((s, m) => s + (m.quantity || 0), 0);
  let stock = product?.stock ?? 0;
  let layersRemaining = 0;
  let layersValue = 0;
  if (variantId && product?.variants) {
    const v = (product.variants as Array<{
      _id?: unknown;
      stock?: number;
      costLayers?: InventoryCostLayer[];
    }>).find((x) => String(x._id) === String(variantId));
    stock = v?.stock ?? 0;
    layersRemaining = ((v?.costLayers ?? []) as InventoryCostLayer[]).reduce(
      (s, l) => s + l.remaining,
      0
    );
    layersValue = ((v?.costLayers ?? []) as InventoryCostLayer[]).reduce(
      (s, l) => s + l.remaining * l.unitCost,
      0
    );
  } else if (product) {
    layersRemaining = ((product.costLayers ?? []) as InventoryCostLayer[]).reduce(
      (s, l) => s + l.remaining,
      0
    );
    layersValue = ((product.costLayers ?? []) as InventoryCostLayer[]).reduce(
      (s, l) => s + l.remaining * l.unitCost,
      0
    );
  }
  return {
    movementNet,
    stock,
    matches: movementNet === stock,
    layersRemaining,
    layersValue,
    movementCount: movements.length,
  };
}

/**
 * Apply an audited inventory adjustment.
 *
 * Purchased products:
 *   positive → new FIFO layer at the CONFIRMED unitCost (never silently the
 *              current supplierPrice) + stock $inc, same atomic update.
 *   negative → consume FIFO layers (consumeFifoLayers); insufficient layers
 *              → fail safely (400, no partial mutation, cost never invented).
 * Consignment products: stock-only (documented — no cost layers exist).
 * Never allows stock below zero.
 */
export async function applyInventoryAdjustment(
  input: AdjustmentInput
): Promise<AdjustmentResult> {
  const validated = validateAdjustment(input);
  if (validated.error) {
    return { ok: false, status: validated.status ?? 400, error: validated.error };
  }

  const productId = String(input.productId);
  const delta = input.quantityDelta;
  const absDelta = Math.abs(delta);
  const sourceRef = `adj-${input.key}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let product: any = await Product.findById(productId)
    .select("name slug stock stockVersion sourcing costLayers variants hasVariants")
    .lean();
  if (!product) {
    return { ok: false, status: 404, error: "محصول یافت نشد" };
  }

  let variant: (Record<string, unknown> & { _id: unknown; stock?: number; stockVersion?: number; costLayers?: InventoryCostLayer[]; isActive?: boolean }) | null = null;
  if (input.variantId) {
    variant =
      ((product.variants ?? []) as Array<
        Record<string, unknown> & {
          _id: unknown;
          stock?: number;
          stockVersion?: number;
          costLayers?: InventoryCostLayer[];
          isActive?: boolean;
        }
      >).find((v) => String(v._id) === String(input.variantId)) ?? null;
    if (!variant) {
      return { ok: false, status: 400, error: "تنوع مورد نظر یافت نشد" };
    }
    if (variant.isActive === false) {
      return { ok: false, status: 400, error: "تنوع غیرفعال است" };
    }
  }

  const sourcing: "consignment" | "purchased" =
    product.sourcing === "purchased" ? "purchased" : "consignment";

  // --- Never below zero ---
  const currentStock = variant ? (variant.stock ?? 0) : (product.stock ?? 0);
  if (currentStock + delta < 0) {
    return {
      ok: false,
      status: 400,
      error: `موجودی کافی نیست. موجودی فعلی: ${currentStock}`,
    };
  }

  // --- Cost semantics per sourcing ---
  let layerCost: number | undefined;
  if (sourcing === "purchased") {
    if (delta > 0) {
      // Positive purchased → cost is REQUIRED and confirmed by the admin.
      if (
        input.unitCost === undefined ||
        input.unitCost === null ||
        input.unitCost <= 0
      ) {
        return {
          ok: false,
          status: 400,
          error: "برای افزایش موجودی کالای خریداری‌شده، هزینه واحد تعدیل الزامی است",
        };
      }
      layerCost = input.unitCost;
    }
  } else {
    // Consignment: no cost layers — movement cost stays 0 (no invented COGS).
    layerCost = undefined;
  }

  // --- Fast-fail pre-check of the layer effect (purchased) ---
  // Revalidated inside the apply loop on every retry; this first pass catches
  // the common case (e.g. insufficient layers) BEFORE any claim is written.
  let newLayers: InventoryCostLayer[] | null = null;
  let consumedCost = 0;
  if (sourcing === "purchased") {
    const layers = (
      variant ? (variant.costLayers ?? []) : (product.costLayers ?? [])
    ) as InventoryCostLayer[];
    if (delta > 0) {
      newLayers = addLayer(layers, {
        qty: delta,
        remaining: delta,
        unitCost: layerCost as number,
        acquiredAt: new Date(),
        source: "adjustment",
        ref: sourceRef,
      });
    } else {
      const consumption = consumeFifoLayers(layers, absDelta);
      if (!consumption) {
        return {
          ok: false,
          status: 400,
          error: "لایه‌های هزینه FIFO برای این کاهش کافی نیست — بدون تغییر اعمال شد",
        };
      }
      newLayers = consumption.layers;
      consumedCost = consumption.consumedCost;
    }
  }

  const description = `تعدیل موجودی — ${(input.reason ?? "").trim()}${
    input.notes ? ` (${input.notes.trim().slice(0, 200)})` : ""
  }`;

  // --- EXACTLY-ONCE claim + crash-recovery completion (Phase C hardening) ---
  // The movement row is the exactly-once claim (unique partial index on
  // sourceRef). `completedAt` is the completion marker: it is stamped together
  // with the final cost figures ONLY after the atomic apply succeeded. A row
  // with completedAt === null is a PENDING claim — a server crash between the
  // claim insert and the apply — and a retry with the same key COMPLETES the
  // apply instead of reporting idempotent (the pre-hardening bug: the retry
  // short-circuited and the adjustment was silently lost). `claimOwned` tracks
  // whether THIS request inserted the row, so only its own claim is removed on
  // a hard failure (pre-existing pending claims are left for a later retry).
  let claimOwned = false;
  let existingClaim = (await InventoryMovement.findOne({ sourceRef })
    .lean()) as unknown as { completedAt?: Date | null } | null;
  if (existingClaim) {
    if (existingClaim.completedAt) {
      return {
        ok: true,
        idempotent: true,
        movement: existingClaim as Record<string, unknown>,
        product,
      };
    }
    // pending claim → complete the apply below (never insert a second row)
  } else {
    try {
      await InventoryMovement.create({
        product: productId,
        variantId: input.variantId ? String(input.variantId) : null,
        type: "adjustment",
        quantity: delta,
        unitCost: 0, // finalized with completedAt once the apply succeeds
        totalCost: 0,
        sourceRef,
        description: description.slice(0, 500),
        createdBy: input.actorId,
      });
      claimOwned = true;
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        // Concurrent insert or a crashed sibling's pending row → complete it.
        existingClaim = (await InventoryMovement.findOne({ sourceRef })
          .lean()) as unknown as { completedAt?: Date | null } | null;
        if (!existingClaim) {
          return { ok: false, status: 500, error: "خطا در ثبت تعدیل" };
        }
        if (existingClaim.completedAt) {
          return {
            ok: true,
            idempotent: true,
            movement: existingClaim as Record<string, unknown>,
            product,
          };
        }
      } else {
        throw err;
      }
    }
  }

  // Remove OUR claim on a hard failure so the client can retry fresh; a
  // pre-existing pending claim is left in place (a later retry completes it,
  // or it remains as the visible ledger trace of the interrupted attempt).
  const cleanupClaim = async () => {
    if (claimOwned) await InventoryMovement.deleteOne({ sourceRef });
  };

  // --- Atomic stock + layers (single-doc, stockVersion-guarded, retry) ---
  let applied = false;
  let movement: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < MAX_ADJUST_ATTEMPTS && !applied; attempt++) {
    // Recompute the layer effect from the CURRENT product state on every pass
    // (a concurrent op may have changed stock/layers since the last read).
    if (sourcing === "purchased") {
      const layers = (
        variant ? (variant.costLayers ?? []) : (product.costLayers ?? [])
      ) as InventoryCostLayer[];
      if (delta > 0) {
        newLayers = addLayer(layers, {
          qty: delta,
          remaining: delta,
          unitCost: layerCost as number,
          acquiredAt: new Date(),
          source: "adjustment",
          ref: sourceRef,
        });
      } else {
        const consumption = consumeFifoLayers(layers, absDelta);
        if (!consumption) {
          // A concurrent sale exhausted the layers → fail safely, no mutation.
          await cleanupClaim();
          return {
            ok: false,
            status: 400,
            error: "لایه‌های هزینه FIFO برای این کاهش کافی نیست — بدون تغییر اعمال شد",
          };
        }
        newLayers = consumption.layers;
        consumedCost = consumption.consumedCost;
      }
    }

    const version = variant
      ? (variant.stockVersion ?? 0)
      : (product.stockVersion ?? 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated: any = variant
      ? await Product.findOneAndUpdate(
          {
            _id: productId,
            variants: {
              $elemMatch: {
                _id: input.variantId,
                isActive: true,
                stock: { $gte: delta > 0 ? 0 : absDelta },
                stockVersion: version,
              },
            },
          },
          {
            $inc: {
              "variants.$.stock": delta,
              "variants.$.stockVersion": 1,
              stock: delta, // top-level summary stays in sync atomically
            },
            ...(newLayers
              ? { $set: { "variants.$.costLayers": newLayers } }
              : {}),
          },
          { new: true }
        ).lean()
      : await Product.findOneAndUpdate(
          {
            _id: productId,
            stock: { $gte: delta > 0 ? 0 : absDelta },
            stockVersion: version,
          },
          {
            $inc: { stock: delta, stockVersion: 1 },
            ...(newLayers ? { $set: { costLayers: newLayers } } : {}),
          },
          { new: true }
        ).lean();

    if (updated) {
      applied = true;
      product = updated;
      // Final cost figures for the movement.
      let unitCost = 0;
      let totalCost = 0;
      if (sourcing === "purchased") {
        if (delta > 0) {
          unitCost = layerCost as number;
          totalCost = delta * unitCost;
        } else {
          unitCost = Math.round(consumedCost / absDelta);
          totalCost = consumedCost;
        }
      }
      // Finalize the claim: stamp completedAt TOGETHER with the cost figures in
      // one atomic update. If a concurrent retry already completed it, we did
      // not win the apply race — return their (authoritative) row idempotently.
      movement = (await InventoryMovement.findOneAndUpdate(
        { sourceRef, completedAt: null },
        { $set: { unitCost, totalCost, completedAt: new Date() } },
        { new: true }
      ).lean()) as unknown as Record<string, unknown> | null;
      if (!movement) {
        const sibling = (await InventoryMovement.findOne({ sourceRef })
          .lean()) as unknown as Record<string, unknown> | null;
        movement = sibling;
      }
      break;
    }

    // Version conflict → a concurrent write landed. If a sibling retry of THIS
    // same adjustment completed it, return idempotent (never re-apply).
    const freshMv = (await InventoryMovement.findOne({ sourceRef })
      .lean()) as unknown as { completedAt?: Date | null } | null;
    if (freshMv?.completedAt) {
      const siblingProduct = (await Product.findById(productId)
        .select("name slug stock stockVersion sourcing costLayers variants hasVariants")
        .lean()) as unknown as Record<string, unknown> | null;
      return {
        ok: true,
        idempotent: true,
        movement: freshMv as unknown as Record<string, unknown>,
        product: siblingProduct ?? product,
      };
    }

    // Otherwise re-read fresh product state and retry the apply.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh: any = input.variantId
      ? await Product.findOne(
          { _id: productId, "variants._id": input.variantId },
          { sourcing: 1, "variants.$": 1 }
        ).lean()
      : await Product.findById(productId)
          .select("stock stockVersion sourcing costLayers")
          .lean();
    if (!fresh) break;
    product = fresh;
    if (input.variantId) {
      variant = fresh.variants?.[0] ?? null;
      if (!variant) break;
      if ((variant.stock ?? 0) + delta < 0) {
        await cleanupClaim();
        return {
          ok: false,
          status: 400,
          error: `موجودی کافی نیست. موجودی فعلی: ${variant.stock ?? 0}`,
        };
      }
    } else if ((product.stock ?? 0) + delta < 0) {
      await cleanupClaim();
      return {
        ok: false,
        status: 400,
        error: `موجودی کافی نیست. موجودی فعلی: ${product.stock ?? 0}`,
      };
    }
  }

  if (!applied || !movement) {
    // Could not apply after retries — remove OUR claim so the client can retry.
    await cleanupClaim();
    return {
      ok: false,
      status: 409,
      error: "تغییر همزمان موجودی رخ داد. لطفاً دوباره تلاش کنید",
    };
  }

  return { ok: true, idempotent: claimOwned ? false : true, movement, product };
}
