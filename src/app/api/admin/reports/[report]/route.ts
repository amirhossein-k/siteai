import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import { parseReportFilters } from "@/lib/report-utils";
import {
  getReportData,
  REPORT_SLUGS,
  type ReportSlug,
} from "@/lib/reports";

/**
 * GET /api/admin/reports/[report]
 *
 * Admin-only reporting endpoint (Session 81). `report` ∈
 * dashboard | sales | orders | payments | refunds | coupons | customers |
 * inventory | pnl. All filters are whitelist-validated server-side
 * (src/lib/report-utils.ts) and every figure comes from the immutable order
 * snapshots — never from current Product prices.
 *
 * READ-ONLY: this route performs aggregations only — no writes. Same auth
 * model as /api/admin/analytics (requireRoleOrError → 401/403).
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ report: string }> }
) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  const { report } = await params;
  if (!(REPORT_SLUGS as readonly string[]).includes(report)) {
    return NextResponse.json({ error: "گزارش نامعتبر است" }, { status: 400 });
  }

  const parsed = parseReportFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
    {
      kind:
        report === "purchases"
          ? "purchase"
          : report === "expenses"
            ? "expense"
            : "order",
    }
  );
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    await dbConnect();
    const data = await getReportData(report as ReportSlug, parsed.filters);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Error fetching report:", err);
    return serverError();
  }
}
