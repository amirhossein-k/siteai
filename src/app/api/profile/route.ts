import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import User from "@/models/User";
import { sanitizePlainText } from "@/lib/sanitize";

export async function GET(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();

    const user = await User.findById(token.id)
      .select("name phone role address isActive createdAt")
      .lean();

    if (!user) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();

    const body = await req.json();
    const { name, address } = body as {
      name?: string;
      address?: string;
    };

    // Build update object (only allow updating specific fields)
    const updateData: Record<string, string> = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { error: "نام نمی‌تواند خالی باشد" },
          { status: 400 }
        );
      }
      updateData.name = sanitizePlainText(name.trim());
    }
    if (address !== undefined) {
      updateData.address = address.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "هیچ فیلدی برای بروزرسانی ارسال نشده است" },
        { status: 400 }
      );
    }

    const updatedUser = await User.findByIdAndUpdate(
      token.id,
      { $set: updateData },
      { new: true }
    )
      .select("name phone role address isActive")
      .lean();

    if (!updatedUser) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error updating profile:", error);
    return serverError();
  }
}
