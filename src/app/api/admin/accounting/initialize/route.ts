import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, ACCOUNTING_INIT_LIMIT } from "@/lib/rate-limiter";
import Product from "@/models/Product";
import AccountingConfig from "@/models/AccountingConfig";
import InventoryMovement from "@/models/InventoryMovement";
import {
  addLayer,
  buildOpeningLayer,
  type InventoryCostLayer,
} from "@/lib/inventory-layers";
import type { OpeningBalanceItemInput } from "@/types";

export const dynamic = "force-dynamic";

const isValidObjectId = (id: string) =>
  /^[0-9a-fA-F]{24}$/.test(id);

/**
 * GET /api/admin/accounting/initialize
 *
 * The candidates for the opening-balance wizard: every consignment product
 * (and, for variant products, every variant row) that can be converted to
 * `sourcing: "purchased"`. Includes the CURRENT supplierPrice as
 * `suggestedCost` — a suggested default ONLY, never a silently-accepted cost.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const products = (await Product.find({ sourcing: "consignment" })
      .select("name hasVariants stock price supplierPrice variants.sku variants.stock variants.supplierPrice variants.price")
      .lean()) as unknown as Array<
      Record<string, unknown> & {
        _id: unknown;
        name: string;
        hasVariants: boolean;
        stock: number;
        supplierPrice: number;
        variants?: Array<{
          _id: unknown;
          sku: string;
          stock: number;
          supplierPrice: number;
          price: number;
        }>;
      }
    >;

    const candidates = products.flatMap((p) => {
      const variants = p.hasVariants && Array.isArray(p.variants) ? p.variants : [];
      if (variants.length > 0) {
        return variants.map((v) => ({
          productId: String(p._id),
          variantId: String(v._id),
          name: p.name,
          variantLabel: v.sku || undefined,
          stock: v.stock ?? 0,
          suggestedCost: v.supplierPrice ?? 0,
          sourcing: "consignment",
        }));
      }
      return [
        {
          productId: String(p._id),
          name: p.name,
          stock: p.stock ?? 0,
          suggestedCost: p.supplierPrice ?? 0,
          sourcing: "consignment",
        },
      ];
    });

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error("[AccountingInit] candidates failed:", error);
    return serverError();
  }
}

/**
 * POST /api/admin/accounting/initialize
 *
 * The Accounting Cutover / Opening-Balance wizard (Session 82 Phase A).
 *
 * Converts the SELECTED consignment products to `sourcing: "purchased"` and
 * creates a CONFIRMED opening FIFO cost layer covering 100% of their current
 * on-hand stock, plus an append-only `opening_balance` InventoryMovement row
 * per product/variant. The opening cost is NEVER silently taken from
 * supplierPrice: the client must send `confirmValuation: true` AND an explicit
 * `openingCost` per item (the UI shows supplierPrice only as a suggested
 * default). Zero-stock products convert with no layer (openingCost optional).
 *
 * Body: { cutoverDate?, confirmValuation: true, items: [{ productId,
 * variantId?, openingCost?, openingDate? }] }
 *  - cutoverDate is required unless already set on the config (and frozen once
 *    initialization has happened).
 *  - items must be non-empty; variant products require one row per variant.
 *  - Already-purchased products are skipped (idempotent — never double-valued).
 *
 * Atomicity: each product conversion is a single-document findOneAndUpdate
 * (layers are embedded on the Product), and the opening layer is deduped by
 * `ref`, so concurrent/duplicate runs cannot double-count. Movements are
 * deduped by sourceRef.
 */
export async function POST(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const body = await req.json();

    // --- Shape validation BEFORE the rate limiter (project convention) ---
    if (body?.confirmValuation !== true) {
      return NextResponse.json(
        { error: "تأیید ارزش‌گذاری موجودی الزامی است" },
        { status: 400 }
      );
    }
    const items: OpeningBalanceItemInput[] = Array.isArray(body?.items)
      ? body.items
      : null;
    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "حداقل یک محصول برای شروع موجودی انتخاب کنید" },
        { status: 400 }
      );
    }
    for (const it of items) {
      if (!it || typeof it.productId !== "string" || !isValidObjectId(it.productId)) {
        return NextResponse.json(
          { error: "شناسه محصول نامعتبر است" },
          { status: 400 }
        );
      }
      if (it.variantId !== undefined && it.variantId !== null && typeof it.variantId !== "string") {
        return NextResponse.json({ error: "شناسه تنوع نامعتبر است" }, { status: 400 });
      }
      if (
        it.openingCost !== undefined &&
        it.openingCost !== null &&
        (!Number.isInteger(it.openingCost) || it.openingCost <= 0)
      ) {
        return NextResponse.json(
          { error: "قیمت تمام‌شده شروع باید عدد صحیح مثبت باشد" },
          { status: 400 }
        );
      }
      if (
        it.openingDate !== undefined &&
        it.openingDate !== null &&
        Number.isNaN(Date.parse(String(it.openingDate)))
      ) {
        return NextResponse.json(
          { error: "تاریخ شروع نامعتبر است" },
          { status: 400 }
        );
      }
    }

    await dbConnect();

    const rl = await rateLimit(
      `accounting-init:${token!.id}`,
      ACCOUNTING_INIT_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    // --- Resolve the cutover date (body or existing config) ---
    let cutoverDate: Date;
    const existing = (await AccountingConfig.findById("accounting").lean()) as
      | { cutoverDate?: Date | null }
      | null;
    if (body.cutoverDate && !Number.isNaN(Date.parse(String(body.cutoverDate)))) {
      cutoverDate = new Date(String(body.cutoverDate));
    } else if (existing?.cutoverDate) {
      cutoverDate = new Date(existing.cutoverDate);
    } else {
      return NextResponse.json(
        { error: "ابتدا تاریخ شروع حسابداری را تنظیم کنید" },
        { status: 400 }
      );
    }
    // Session 82 Phase C hardening (MEDIUM-1): never accept a future cutover
    // date here either (the config route already rejects it; this guards the
    // body-supplied variant).
    if (cutoverDate > new Date()) {
      return NextResponse.json(
        { error: "تاریخ شروع حسابداری نمی‌تواند در آینده باشد" },
        { status: 400 }
      );
    }

    // --- Process items (idempotent per product) ---
    const productsInitialized = new Set<string>();
    let layersCreated = 0;
    let totalValue = 0;
    const skipped: Array<{ productId: string; reason: string }> = [];

    for (const it of items) {
      const product = (await Product.findById(it.productId).lean()) as
        | (Record<string, unknown> & {
            _id: unknown;
            sourcing?: string;
            stock?: number;
            hasVariants?: boolean;
            costLayers?: InventoryCostLayer[];
            variants?: Array<
              Record<string, unknown> & {
                _id: unknown;
                stock?: number;
                costLayers?: InventoryCostLayer[];
              }
            >;
          })
        | null;
      if (!product) {
        skipped.push({ productId: it.productId, reason: "product-not-found" });
        continue;
      }

      const hasVariants = product.hasVariants === true;
      const productId = String(product._id);

      // Resolve the target unit (simple product or one variant)
      let stock: number;
      let variantId: string | null = null;
      let layerRef: string;
      let existingLayers: InventoryCostLayer[];

      if (hasVariants) {
        if (!it.variantId) {
          return NextResponse.json(
            { error: "برای محصول دارای تنوع، موجودی هر تنوع جداگانه ثبت می‌شود" },
            { status: 400 }
          );
        }
        const variant = (product.variants || []).find(
          (v) => String(v._id) === String(it.variantId)
        );
        if (!variant) {
          skipped.push({ productId, reason: "variant-not-found" });
          continue;
        }
        variantId = String(variant._id);
        stock = variant.stock ?? 0;
        existingLayers = variant.costLayers || [];
        layerRef = `opening-${productId}-${variantId}`;
      } else {
        if (it.variantId) {
          return NextResponse.json(
            { error: "این محصول تنوع ندارد" },
            { status: 400 }
          );
        }
        stock = product.stock ?? 0;
        existingLayers = product.costLayers || [];
        layerRef = `opening-${productId}`;
      }

      // Per-target idempotency: a product is "already initialized" only when a
      // layer with THIS target's opening ref already exists. Per-product checks
      // would wrongly skip the SECOND variant of a multi-variant product (the
      // first variant flips sourcing to "purchased"). Layer-ref dedupe + the
      // $set below keep concurrent/duplicate runs safe.
      const alreadyInitialized = existingLayers.some((l) => l.ref === layerRef);
      if (alreadyInitialized) {
        skipped.push({ productId, reason: "already-purchased" });
        continue;
      }

      // Opening cost is REQUIRED when there is stock to value — never invented.
      if (stock > 0) {
        if (
          it.openingCost === undefined ||
          it.openingCost === null ||
          !Number.isInteger(it.openingCost) ||
          it.openingCost <= 0
        ) {
          return NextResponse.json(
            { error: `قیمت تمام‌شده شروع برای «${String(product.name ?? "")}» الزامی است` },
            { status: 400 }
          );
        }
      } else {
        // Zero stock → convert with no opening layer; openingCost (if sent) ignored
        it.openingCost = undefined;
      }

      const openingDate = it.openingDate
        ? new Date(String(it.openingDate))
        : cutoverDate;

      let mergedLayers: InventoryCostLayer[];
      let movementTotal = 0;
      if (stock > 0) {
        const layer = buildOpeningLayer(stock, it.openingCost as number, openingDate, layerRef);
        mergedLayers = addLayer(existingLayers, layer);
        layersCreated += 1;
        movementTotal = stock * layer.unitCost;
        totalValue += movementTotal;
      } else {
        mergedLayers = existingLayers;
      }

      // Atomic single-document conversion + layer write
      const updated = hasVariants
        ? await Product.findOneAndUpdate(
            { _id: product._id, "variants._id": variantId },
            {
              $set: {
                sourcing: "purchased",
                "variants.$.costLayers": mergedLayers,
              },
            },
            { new: true }
          )
        : await Product.findOneAndUpdate(
            { _id: product._id },
            {
              $set: {
                sourcing: "purchased",
                costLayers: mergedLayers,
              },
            },
            { new: true }
          );
      if (!updated) {
        skipped.push({ productId, reason: "concurrent-modification" });
        continue;
      }

      productsInitialized.add(productId);

      // Append-only audit movement (deduped by sourceRef)
      if (stock > 0) {
        const exists = await InventoryMovement.exists({ sourceRef: layerRef });
        if (!exists) {
          await InventoryMovement.create({
            product: product._id,
            variantId,
            type: "opening_balance",
            quantity: stock,
            unitCost: it.openingCost as number,
            totalCost: movementTotal,
            sourceRef: layerRef,
            description: `موجودی اولیه ${String(product.name ?? "")}${
              hasVariants ? " (تنوع)" : ""
            } — تأییدشده توسط ادمین`,
            createdBy: token!.id,
          });
        }
      }
    }

    if (productsInitialized.size === 0 && layersCreated === 0) {
      return NextResponse.json(
        {
          initialized: false,
          cutoverDate: cutoverDate.toISOString(),
          productsInitialized: 0,
          layersCreated: 0,
          totalValue: 0,
          skipped,
        },
        { status: 200 }
      );
    }

    // Stamp the global cutover event (idempotent — one initialization event)
    const config = await AccountingConfig.findByIdAndUpdate(
      "accounting",
      {
        $set: {
          cutoverDate,
          inventoryInitialized: true,
          initializedAt: new Date(),
          initializedBy: token!.id,
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      initialized: true,
      cutoverDate: new Date(config!.cutoverDate).toISOString(),
      productsInitialized: productsInitialized.size,
      layersCreated,
      totalValue,
      skipped,
    });
  } catch (error) {
    console.error("[AccountingInit] POST failed:", error);
    return serverError();
  }
}
