import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError } from "@/lib/auth-utils";
import InventoryMovement from "@/models/InventoryMovement";
import Product from "@/models/Product";
import { buildPaginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

const MOVEMENT_TYPES = [
  "opening_balance",
  "receipt",
  "sale",
  "return_restock",
  "cancellation_restock",
  "purchase_return",
  "adjustment",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * GET /api/admin/inventory/movements — Session 82 Phase D.
 *
 * Admin-only append-only ledger read. Filters: product, variant, movement
 * type, sourceRef, date range (from/to, YYYY-MM-DD), free-text search
 * (product name / description / sourceRef), pagination.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const sp = req.nextUrl.searchParams;

    const filter: Record<string, unknown> = {};

    const product = sp.get("product");
    if (product && !mongoose.isValidObjectId(product)) {
      return NextResponse.json({ error: "شناسه محصول نامعتبر است" }, { status: 400 });
    }
    if (product) filter.product = product;

    const variant = sp.get("variant");
    if (variant && !mongoose.isValidObjectId(variant)) {
      return NextResponse.json({ error: "شناسه تنوع نامعتبر است" }, { status: 400 });
    }
    if (variant) filter.variantId = variant;

    const type = sp.get("type");
    if (type) {
      if (!(MOVEMENT_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json({ error: "نوع جابه‌جایی نامعتبر است" }, { status: 400 });
      }
      filter.type = type;
    }

    const sourceRef = sp.get("sourceRef");
    if (sourceRef) filter.sourceRef = new RegExp(escapeRegExp(sourceRef), "i");

    const fromRaw = sp.get("from");
    const toRaw = sp.get("to");
    if (fromRaw || toRaw) {
      const from = fromRaw ? new Date(fromRaw + "T00:00:00.000Z") : null;
      const to = toRaw ? new Date(toRaw + "T23:59:59.999Z") : null;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
        return NextResponse.json({ error: "بازه زمانی نامعتبر است" }, { status: 400 });
      }
      filter.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const q = sp.get("search");
    if (q && q.trim()) {
      const needle = escapeRegExp(q.trim());
      const productIds = (
        await Product.find({ name: new RegExp(needle, "i") })
          .select("_id")
          .lean()
      ).map((p) => p._id);
      filter.$or = [
        { product: { $in: productIds } },
        { description: new RegExp(needle, "i") },
        { sourceRef: new RegExp(needle, "i") },
      ];
    }

    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20)
    );

    const [total, movements] = await Promise.all([
      InventoryMovement.countDocuments(filter),
      InventoryMovement.find(filter)
        .populate("product", "name slug")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(movements, total, page, limit)
    );
  } catch (err) {
    console.error("[InventoryMovements] GET failed:", err);
    return NextResponse.json({ error: "خطا در دریافت سوابق جابه‌جایی" }, { status: 500 });
  }
}
