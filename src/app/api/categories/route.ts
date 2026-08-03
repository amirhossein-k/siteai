import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import Category from "@/models/Category";

export async function GET() {
  try {
    await dbConnect();

    const categories = await Category.find({ isActive: true })
      .select("name slug image")
      .sort({ name: 1 })
      .lean();

    return NextResponse.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { error: "خطا در دریافت دسته‌بندی‌ها" },
      { status: 500 }
    );
  }
}
