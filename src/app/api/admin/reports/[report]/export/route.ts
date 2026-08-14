import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { rateLimit, REPORT_EXPORT_LIMIT } from "@/lib/rate-limiter";
import { EXPORT_MAX_ROWS, parseReportFilters } from "@/lib/report-utils";
import {
  getCouponReport,
  getCustomerSalesReport,
  getInventoryReport,
  getOrdersReport,
  getPaymentsReport,
  getProfitLossReport,
  getRefundsReport,
  getReportData,
  getSalesReport,
  REPORT_SLUGS,
  type ReportSlug,
} from "@/lib/reports";
import {
  buildDashboardWorkbook,
  buildReportWorkbook,
} from "@/lib/reports-excel";

/**
 * GET /api/admin/reports/[report]/export
 *
 * Admin-only + rate-limited Excel (.xlsx) export of the SAME filtered dataset
 * the UI shows for [report]. The dashboard export is the full accountant
 * workbook (Summary + P&L + Sales + Orders + Payments + Refunds + Coupons +
 * Customers + Inventory sheets); every other report exports Summary + its
 * detail sheet.
 *
 * The export reuses the exact server-side aggregation functions and filters as
 * the JSON endpoint — the sheet always matches the on-screen dataset. Rows are
 * capped at EXPORT_MAX_ROWS (10,000) to bound memory.
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ report: string }> }
) {
  const { token, error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  const { report } = await params;
  if (!(REPORT_SLUGS as readonly string[]).includes(report)) {
    return NextResponse.json({ error: "گزارش نامعتبر است" }, { status: 400 });
  }

  const parsed = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
    { kind: report === "purchases" ? "purchase" : "order" }
  );
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    // Rate-limit the export (expensive + downloadable) — same actor key.
    const rl = await rateLimit(`report-export:${token!.id}`, REPORT_EXPORT_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        { error: "درخواست‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
        { status: 429, headers: rl.headers }
      );
    }

    await dbConnect();
    const filters = { ...parsed.filters, page: 1, limit: EXPORT_MAX_ROWS };

    let workbook;
    if (report === "dashboard") {
      const [sales, orders, payments, refunds, coupons, customers, inventory, pnl] =
        await Promise.all([
          getSalesReport(filters),
          getOrdersReport(filters),
          getPaymentsReport(filters),
          getRefundsReport(filters),
          getCouponReport(filters),
          getCustomerSalesReport(filters),
          getInventoryReport(filters),
          getProfitLossReport(filters),
        ]);
      workbook = buildDashboardWorkbook({
        filters,
        summary: sales.summary,
        sales,
        orders,
        payments,
        refunds,
        coupons,
        customers,
        inventory,
        pnl,
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await getReportData(report as ReportSlug, filters);
      workbook = buildReportWorkbook(report, data, filters);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `report-${report}-${filters.from}_${filters.to}.xlsx`;

    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error exporting report:", err);
    return serverError();
  }
}
