"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  REPORT_NAV,
  cleanParamsForReport,
} from "@/components/reports/report-config";

export function ReportNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current =
    pathname === "/admin/reports"
      ? "dashboard"
      : pathname.split("/").filter(Boolean).pop() || "dashboard";

  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="گزارش‌ها">
      {REPORT_NAV.map((item) => {
        const isActive = current === item.report;
        const href =
          item.report === "dashboard"
            ? "/admin/reports"
            : `/admin/reports/${item.report}`;
        // Preserve only filters that apply to the target report.
        const keep = cleanParamsForReport(item.report, params);
        const query = new URLSearchParams(keep).toString();
        return (
          <Link
            key={item.report}
            href={query ? `${href}?${query}` : href}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
