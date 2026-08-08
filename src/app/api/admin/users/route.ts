import { NextResponse, NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
  invalidateTokenVersionCache,
} from "@/lib/auth-utils";
import User from "@/models/User";
import Supplier from "@/models/Supplier";
import type { UserRole } from "@/types";
import { sanitizePlainText } from "@/lib/sanitize";
import { escapeRegex } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get("role");
    // Session 55 — free-text search for the coupon user picker (name/phone)
    const search = searchParams.get("search");

    const filter: Record<string, unknown> = {};
    if (roleFilter && ["customer", "supplier", "admin"].includes(roleFilter)) {
      filter.role = roleFilter;
    }
    if (search && search.trim()) {
      const q = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ name: q }, { phone: q }];
    }

    const users = await User.find(filter)
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "خطا در دریافت کاربران" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/users
 * Create a new admin or supplier account.
 * Only existing admins can create new accounts.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const body = await req.json();
    const {
      name,
      phone,
      password,
      role,
    }: {
      name: string;
      phone: string;
      password: string;
      role: UserRole;
    } = body;

    // --- Validation ---
    if (!name || !phone || !password || !role) {
      return NextResponse.json(
        { error: "نام، شماره موبایل، رمز عبور و نقش الزامی هستند" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "رمز عبور باید حداقل ۶ کاراکتر باشد" },
        { status: 400 }
      );
    }

    if (!["admin", "supplier"].includes(role)) {
      return NextResponse.json(
        { error: "نقش باید admin یا supplier باشد" },
        { status: 400 }
      );
    }

    const phoneRegex = /^0\d{10}$/;
    if (!phoneRegex.test(phone)) {
      return NextResponse.json(
        { error: "شماره موبایل باید با ۰ شروع شود و ۱۱ رقم باشد" },
        { status: 400 }
      );
    }

    // Check for duplicate phone
    const existing = await User.findOne({ phone });
    if (existing) {
      return NextResponse.json(
        { error: "این شماره موبایل قبلاً ثبت شده است" },
        { status: 409 }
      );
    }

    // --- Create user ---
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: sanitizePlainText(name),
      phone,
      passwordHash,
      role,
      isActive: true,
    });

    // --- Auto-create Supplier document if role is supplier ---
    let supplierId: string | null = null;
    if (role === "supplier") {
      const supplier = await Supplier.create({
        user: user._id,
        businessName: name, // Default: use the user's name
        contactPhone: phone, // Default: use the user's phone
        bankAccount: {
          cardNumber: "",
          iban: "",
          ownerName: "",
        },
        telegramChatId: "",
        balance: 0,
        isActive: true,
      });

      supplierId = supplier._id.toString();

      // Link the Supplier back to the User
      await User.findByIdAndUpdate(user._id, {
        $set: { supplier: supplier._id },
      });
    }

    return NextResponse.json(
      {
        _id: user._id.toString(),
        name: user.name,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        ...(supplierId ? { supplierId } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating user:", error);
    return serverError();
  }
}

/**
 * PATCH /api/admin/users?id=xxx
 *
 * Update a user: toggle active status, change role, or reset password.
 * Only administrators can perform these actions.
 */
export async function PATCH(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه کاربر الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { action, value } = body as {
      action: "toggle-active" | "change-role" | "reset-password";
      value: string;
    };

    if (!action) {
      return NextResponse.json(
        { error: "نوع عملیات (action) مشخص نشده است" },
        { status: 400 }
      );
    }

    switch (action) {
      case "toggle-active": {
        // Toggle user's active status
        const user = await User.findById(id);
        if (!user) {
          return NextResponse.json(
            { error: "کاربر یافت نشد" },
            { status: 404 }
          );
        }

        const wasActive = user.isActive;
        user.isActive = !user.isActive;

        // Session 66 — deactivating a SUPPLIER must also flip the linked
        // Supplier document so the storefront's public active-supplier
        // surfaces (/api/suppliers, /api/suppliers/[id], sitemap) hide them.
        // (Reactivating restores both.) The User.isActive flag alone did NOT
        // hide the storefront — only Supplier.isActive drives those queries.
        if (user.supplier) {
          await Supplier.findByIdAndUpdate(user.supplier, {
            $set: { isActive: user.isActive },
          });
        }

        // Session 66 — DEACTIVATION revokes every existing session
        // immediately (tokenVersion bump + in-process cache eviction), so a
        // deactivated user cannot keep using a live JWT. Reactivation needs
        // no bump — the sessions were already revoked at deactivation time
        // and the user must sign in again (fresh token).
        if (wasActive && !user.isActive) {
          user.tokenVersion = (user.tokenVersion ?? 0) + 1;
        }
        await user.save();

        if (wasActive && !user.isActive) {
          invalidateTokenVersionCache(user._id.toString());
        }

        return NextResponse.json({
          message: user.isActive
            ? "کاربر با موفقیت فعال شد"
            : "کاربر با موفقیت غیرفعال شد",
          isActive: user.isActive,
        });
      }

      case "change-role": {
        // Change user's role
        if (!["customer", "supplier", "admin"].includes(value)) {
          return NextResponse.json(
            { error: "نقش وارد شده معتبر نیست" },
            { status: 400 }
          );
        }

        const user = await User.findById(id);
        if (!user) {
          return NextResponse.json(
            { error: "کاربر یافت نشد" },
            { status: 404 }
          );
        }

        // Session 66 — ANY role change revokes the user's existing sessions
        // immediately (tokenVersion bump + cache eviction). The old JWT
        // carries the stale role claim; forcing re-login guarantees the
        // middleware + every API route see the NEW role. This also closes the
        // gap where a promoted customer's old customer-role session lingered.
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;

        // If role is changing TO supplier, ensure a Supplier document exists
        if (value === "supplier") {
          if (!user.supplier) {
            // No existing Supplier — create one with defaults
            const supplier = await Supplier.create({
              user: user._id,
              businessName: user.name, // Default: use the user's name
              contactPhone: user.phone, // Default: use the user's phone
              bankAccount: {
                cardNumber: "",
                iban: "",
                ownerName: "",
              },
              telegramChatId: "",
              balance: 0,
              isActive: true,
            });

            user.supplier = supplier._id;
          }
          // If a Supplier already exists (e.g., was a supplier before),
          // just keep the existing link — reactivate if inactive
          else {
            await Supplier.findByIdAndUpdate(user.supplier, {
              $set: { isActive: true },
            });
          }
        }

        user.role = value as UserRole;
        await user.save();
        invalidateTokenVersionCache(user._id.toString());

        // Re-fetch without passwordHash for the response
        const updatedUser = await User.findById(id)
          .select("-passwordHash")
          .lean();

        return NextResponse.json({
          message: `نقش کاربر به ${value} تغییر یافت`,
          user: updatedUser,
        });
      }

      case "reset-password": {
        // Reset user's password
        if (!value || value.length < 6) {
          return NextResponse.json(
            { error: "رمز عبور جدید باید حداقل ۶ کاراکتر باشد" },
            { status: 400 }
          );
        }

        const passwordHash = await bcrypt.hash(value, 10);
        const updatedUser = await User.findByIdAndUpdate(id, {
          passwordHash,
        });

        if (!updatedUser) {
          return NextResponse.json(
            { error: "کاربر یافت نشد" },
            { status: 404 }
          );
        }

        return NextResponse.json({
          message: "رمز عبور با موفقیت بازنشانی شد",
        });
      }

      default:
        return NextResponse.json(
          { error: "عملیات نامعتبر است" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error updating user:", error);
    return serverError();
  }
}
