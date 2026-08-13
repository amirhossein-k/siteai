import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, ACCOUNTING_CONFIG_LIMIT } from "@/lib/rate-limiter";
import AccountingConfig from "@/models/AccountingConfig";
import type { AccountingConfig as AccountingConfigType } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH /api/admin/accounting/config
 *
 * Store-level accounting settings (Session 82 Phase A):
 *  - GET: current config (cutoverDate, valuationMethod, inventoryInitialized).
 *  - PATCH: set the Accounting Cutover Date (a valid ISO date) BEFORE the
 *    initialization wizard runs. Once inventoryInitialized is true the cutover
 *    date is frozen (changing it would rewrite the meaning of opening layers).
 *
 * Admin-only. PATCH is rate-limited (ACCOUNTING_CONFIG_LIMIT).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const config = (await AccountingConfig.findById("accounting").lean()) as
      | (AccountingConfigType & { _id?: string })
      | null;
    return NextResponse.json({
      cutoverDate: config?.cutoverDate
        ? new Date(config.cutoverDate).toISOString()
        : null,
      valuationMethod: config?.valuationMethod ?? "fifo",
      inventoryInitialized: config?.inventoryInitialized ?? false,
      initializedAt: config?.initializedAt
        ? new Date(config.initializedAt).toISOString()
        : null,
      initializedBy: config?.initializedBy
        ? String(config.initializedBy)
        : null,
    });
  } catch (error) {
    console.error("[AccountingConfig] GET failed:", error);
    return serverError();
  }
}

export async function PATCH(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    const body = await req.json();
    const cutoverDate = body?.cutoverDate;
    if (typeof cutoverDate !== "string" || Number.isNaN(Date.parse(cutoverDate))) {
      return NextResponse.json(
        { error: "تاریخ شروع حسابداری معتبر نیست" },
        { status: 400 }
      );
    }

    await dbConnect();

    // Rate-limit after body validation (same convention as the rest of the app).
    const rl = await rateLimit(
      `accounting-config:${token!.id}`,
      ACCOUNTING_CONFIG_LIMIT
    );
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    const existing = (await AccountingConfig.findById("accounting").lean()) as
      | { inventoryInitialized?: boolean }
      | null;
    if (existing?.inventoryInitialized) {
      return NextResponse.json(
        { error: "پس از شروع موجودی اولیه، تاریخ حسابداری قابل تغییر نیست" },
        { status: 400 }
      );
    }

    await AccountingConfig.findByIdAndUpdate(
      "accounting",
      { $set: { cutoverDate: new Date(cutoverDate) } },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      cutoverDate: new Date(cutoverDate).toISOString(),
      valuationMethod: "fifo",
      inventoryInitialized: false,
      initializedAt: null,
      initializedBy: null,
    });
  } catch (error) {
    console.error("[AccountingConfig] PATCH failed:", error);
    return serverError();
  }
}
