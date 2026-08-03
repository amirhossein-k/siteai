import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import Supplier from "@/models/Supplier";
import Product from "@/models/Product";

/**
 * STRICT public projection whitelist (Session 42) — same as the list route.
 * Never expose: user, contactPhone, bankAccount, telegramChatId, balance,
 * pendingReserve.
 */
const PUBLIC_SUPPLIER_SELECT = "_id businessName logo description";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Malformed id would throw a CastError -> 500; guard it to 404 instead.
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json(
        { error: "فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    await dbConnect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplier: any = await Supplier.findOne({ _id: id, isActive: true })
      .select(PUBLIC_SUPPLIER_SELECT)
      .lean();

    if (!supplier) {
      return NextResponse.json(
        { error: "فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const productCount = await Product.countDocuments({
      supplier: id,
      isActive: true,
      stock: { $gt: 0 },
    });

    return NextResponse.json({
      _id: supplier._id,
      businessName: supplier.businessName,
      logo: supplier.logo || "",
      description: supplier.description || "",
      productCount,
    });
  } catch (error) {
    console.error("Error fetching supplier:", error);
    return NextResponse.json(
      { error: "خطا در دریافت اطلاعات فروشنده" },
      { status: 500 }
    );
  }
}
