import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { serializeProductsCsv, type CsvExportProduct } from "@/lib/product-csv";
import Product from "@/models/Product";
import Supplier from "@/models/Supplier";

/**
 * GET /api/supplier/products/export — download this supplier's products as
 * CSV (Session 51). Supplier-only, ownership-scoped (never another
 * supplier's products). Simple products only.
 */
export async function GET(_req: NextRequest) {
  const { token, error } = await requireRoleOrError(_req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id }).select("_id");
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const products = await Product.find({
      supplier: supplier._id,
      hasVariants: false,
    })
      .populate("category", "name")
      .populate("brand", "name")
      .populate("tags", "name")
      .populate("supplier", "businessName")
      .sort({ createdAt: -1 })
      .lean();

    const rows: CsvExportProduct[] = products.map((p) => {
      const cat = p.category as { name?: string } | null | undefined;
      const brand = p.brand as { name?: string } | null | undefined;
      const tags = (p.tags as Array<{ name?: string }> | undefined) ?? [];
      const supplier = p.supplier as { businessName?: string } | null | undefined;
      return {
        name: p.name,
        slug: p.slug,
        description: p.description || "",
        price: p.price,
        supplierPrice: p.supplierPrice,
        stock: p.stock,
        category: cat?.name || "",
        brand: brand?.name || "",
        tags: tags.map((t) => t.name || "").filter(Boolean),
        images: p.images || [],
        isActive: p.isActive !== false,
        supplier: supplier?.businessName || "",
      };
    });

    const csv = serializeProductsCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="products.csv"',
      },
    });
  } catch (err) {
    console.error("Error exporting supplier products:", err);
    return serverError();
  }
}
