"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatCell,
  type ReportColumn,
} from "@/components/reports/report-config";

interface ReportTableProps {
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, number>;
  totalKeys?: string[];
  loading?: boolean;
  emptyText?: string;
}

export function ReportTable({
  columns,
  rows,
  totals,
  totalKeys = [],
  loading = false,
  emptyText = "داده‌ای برای نمایش وجود ندارد",
}: ReportTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-xs font-medium",
                  col.align === "right" ? "text-right" : "text-right"
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2",
                      col.align === "right" ? "text-right" : "text-right",
                      col.className
                    )}
                  >
                    {formatCell(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {totals && rows.length > 0 && (
          <tfoot>
            <tr className="border-t bg-muted/50 font-bold">
              <td className="px-3 py-2 text-xs">جمع</td>
              {columns.slice(1).map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-xs",
                    col.align === "right" ? "text-right" : "text-right"
                  )}
                >
                  {totalKeys.includes(col.key) && totals[col.key] !== undefined
                    ? formatCell(totals[col.key], col.format)
                    : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
