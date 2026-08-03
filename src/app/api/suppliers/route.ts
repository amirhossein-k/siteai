import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import Supplier from "@/models/Supplier";
import Product from "@/models/Product";
import {
  parsePaginationParams,
  buildPaginatedResponse,
} from "@/lib/pagination";

/**
 * STRICT public projection whitelist (Session 42).
 * These are the ONLY Supplier fields ever exposed publicly.
 * Never add: user, contactPhone, bankAccount, telegramChatId, balance,
 * pendingReserve.
 */
const PUBLIC_SUPPLIER_SELECT = "_id businessName logo description";

/**
 * productCount semantics = same visibility rules as the public products
 * catalog (isActive + in-stock). A supplier is always listed (active), even
 * with 0 visible products.
 */
async function countVisibleProductsBySupplier(): Promise<Map<string, number>> {
  const rows = await Product.aggregate([
    { $match: { isActive: true, stock: { $gt: 0 } } },
    { $group: { _id: "$supplier", count: { $sum: 1 } } },
  ]);
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row._id) map.set(String(row._id), row.count);
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = parsePaginationParams(searchParams);

    const filter = { isActive: true };

    const [total, suppliers, counts] = await Promise.all([
      Supplier.countDocuments(filter),
      Supplier.find(filter)
        .select(PUBLIC_SUPPLIER_SELECT)
        .sort({ businessName: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      countVisibleProductsBySupplier(),
    ]);

    const data = suppliers.map((s) => ({
      _id: s._id,
      businessName: s.businessName,
      logo: s.logo || "",
      description: s.description || "",
      productCount: counts.get(String(s._id)) || 0,
    }));

    return NextResponse.json(
      buildPaginatedResponse(data, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return NextResponse.json(
      { error: "خطا در دریافت فروشندگان" },
      { status: 500 }
    );
  }
}
