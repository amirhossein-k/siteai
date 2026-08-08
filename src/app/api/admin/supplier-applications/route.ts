import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
  invalidateTokenVersionCache,
} from "@/lib/auth-utils";
import { rateLimit, SUPPLIER_APPLICATION_DECISION_LIMIT } from "@/lib/rate-limiter";
import User from "@/models/User";
import SupplierApplication from "@/models/SupplierApplication";
import { ensureSupplierForUser } from "@/lib/supplier-provision";
import {
  canDecide,
  isSupplierApplicationAction,
  validateAdminNote,
} from "@/lib/supplier-application";
import { sanitizePlainText } from "@/lib/sanitize";
import { notifyOrderEvent } from "@/lib/notifications";

/**
 * Session 67 — Admin supplier-application queue.
 *
 * GET /api/admin/supplier-applications
 *   Admin-only. Pending applications first (newest submitted first), then
 *   decided ones (newest decided first). Populated applicant (name/phone).
 *
 * PATCH /api/admin/supplier-applications?id=X  body: { action, note? }
 *   Admin-only, rate-limited (30/15min per admin). ONE atomic request does
 *   everything for a decision:
 *     approve → provisions the Supplier doc SEEDED FROM THE APPLICATION
 *               (businessName/description/contactPhone — Session 66 shared
 *               helper), flips the applicant's role to supplier, bumps
 *               tokenVersion + evicts the cache (their old customer sessions
 *               die instantly), marks the application approved, notifies the
 *               applicant («پنل فروشندگان» deep link).
 *     reject  → marks the application rejected (role untouched), notifies the
 *               applicant.
 *   Malformed id → 400 · unknown id → 404 · already-decided → 409.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const apps = await SupplierApplication.find({})
      .populate("user", "name phone isActive role")
      .limit(200)
      .lean();

    // Pending first (newest first), then decided (newest decided first).
    const sorted = [...apps].sort((a, b) => {
      const aPending = a.status === "pending" ? 0 : 1;
      const bPending = b.status === "pending" ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      const aTime = a.status === "pending" ? a.createdAt : a.decidedAt;
      const bTime = b.status === "pending" ? b.createdAt : b.decidedAt;
      return new Date(bTime || 0).getTime() - new Date(aTime || 0).getTime();
    });

    return NextResponse.json(
      sorted.map((app) => ({
        _id: String(app._id),
        status: app.status,
        businessName: app.businessName,
        description: app.description || "",
        contactPhone: app.contactPhone || "",
        adminNote: app.adminNote || "",
        decidedAt: app.decidedAt ? app.decidedAt.toISOString() : null,
        createdAt: app.createdAt.toISOString(),
        user: app.user
          ? {
              _id: String((app.user as { _id: unknown })._id),
              name: (app.user as { name: string }).name,
              phone: (app.user as { phone: string }).phone,
              isActive: (app.user as { isActive: boolean }).isActive,
              role: (app.user as { role: string }).role,
            }
          : null,
      }))
    );
  } catch (error) {
    console.error("Error fetching supplier applications:", error);
    return serverError();
  }
}

export async function PATCH(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const rl = await rateLimit(
      `supplier-application-decide:${token!.id}`,
      SUPPLIER_APPLICATION_DECISION_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "تعداد عملیات بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "شناسه درخواست الزامی است" },
        { status: 400 }
      );
    }
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return NextResponse.json(
        { error: "شناسه درخواست نامعتبر است" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { action, note } = body as { action?: string; note?: string };
    if (!isSupplierApplicationAction(action || "")) {
      return NextResponse.json(
        { error: "عملیات باید approve یا reject باشد" },
        { status: 400 }
      );
    }
    const noteValidation = validateAdminNote(note || "");
    if (!noteValidation.ok) {
      return NextResponse.json(
        { error: noteValidation.error },
        { status: 400 }
      );
    }
    const trimmedNote = sanitizePlainText((note || "").trim());

    await dbConnect();

    // Friendly pre-check for a fast 404/409 (the atomic claim below is the
    // hard guarantee — two concurrent decisions can never both win).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app: any = await SupplierApplication.findById(id).lean();
    if (!app) {
      return NextResponse.json(
        { error: "درخواست یافت نشد" },
        { status: 404 }
      );
    }
    if (!canDecide(app.status)) {
      return NextResponse.json(
        { error: "این درخواست قبلاً بررسی شده است" },
        { status: 409 }
      );
    }

    if (action === "approve") {
      const applicant = await User.findById(app.user);
      if (!applicant) {
        return NextResponse.json(
          { error: "حساب کاربری متقاضی حذف شده است" },
          { status: 400 }
        );
      }

      // ATOMIC CLAIM FIRST — only ONE admin decision may transition a
      // pending application (Session 57 claim pattern): a concurrent
      // approve/reject loses the race with `null` → 409 below. Provisioning
      // and the role flip happen only AFTER the claim is won, so a loser can
      // never flip the applicant's role while another decision already won.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimed: any = await SupplierApplication.findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: {
            status: "approved",
            adminNote: trimmedNote,
            decidedBy: token!.id,
            decidedAt: new Date(),
          },
        },
        { new: true }
      ).lean();
      if (!claimed) {
        return NextResponse.json(
          { error: "این درخواست قبلاً بررسی شده است" },
          { status: 409 }
        );
      }

      try {
        // Provision the Supplier doc seeded FROM THE APPLICATION (shared
        // Session 66 helper: create-with-seed or reactivate-existing), then
        // apply the exact change-role semantics — role flip + tokenVersion
        // bump so every old customer-role session dies immediately.
        await ensureSupplierForUser(applicant, {
          businessName: app.businessName,
          description: app.description || "",
          contactPhone: app.contactPhone,
        });
        applicant.tokenVersion = (applicant.tokenVersion ?? 0) + 1;
        applicant.role = "supplier";
        await applicant.save();
        invalidateTokenVersionCache(String(applicant._id));
      } catch (err) {
        // Roll the claim back so the admin can retry, then surface the error.
        await SupplierApplication.updateOne(
          { _id: id },
          {
            $set: {
              status: "pending",
              adminNote: "",
              decidedBy: null,
              decidedAt: null,
            },
          }
        ).catch(() => {});
        throw err;
      }

      await notifyOrderEvent({
        recipient: String(applicant._id),
        type: "supplier_approved",
        category: "system",
        message:
          "درخواست فروشندگی شما تأیید شد — برای دسترسی به پنل فروشندگان دوباره وارد شوید",
        link: "/supplier/dashboard",
        notificationKey: `supplier_approved_${claimed._id}`,
      });

      return NextResponse.json({
        message: "درخواست تأیید و فروشنده فعال شد",
        application: { _id: String(claimed._id), status: "approved" },
      });
    }

    // reject — role untouched, applicant stays a customer. Atomic claim so a
    // concurrent approve can never win after the role-relevant writes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await SupplierApplication.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: {
          status: "rejected",
          adminNote: trimmedNote,
          decidedBy: token!.id,
          decidedAt: new Date(),
        },
      },
      { new: true }
    ).lean();
    if (!claimed) {
      return NextResponse.json(
        { error: "این درخواست قبلاً بررسی شده است" },
        { status: 409 }
      );
    }

    await notifyOrderEvent({
      recipient: String(app.user),
      type: "supplier_rejected",
      category: "system",
      message: trimmedNote
        ? `درخواست فروشندگی شما رد شد: ${trimmedNote}`
        : "درخواست فروشندگی شما رد شد",
      link: "/become-supplier",
      notificationKey: `supplier_rejected_${claimed._id}`,
    });

    return NextResponse.json({
      message: "درخواست رد شد",
      application: { _id: String(claimed._id), status: "rejected" },
    });
  } catch (error) {
    console.error("Error deciding supplier application:", error);
    return serverError();
  }
}
