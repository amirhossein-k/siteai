"use client";

import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";
import { useReportExport } from "@/hooks/use-admin-reports";

interface ExportButtonProps {
  report: string;
  qs: string;
}

export function ExportButton({ report, qs }: ExportButtonProps) {
  const { download, downloading, error } = useReportExport(report, qs);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => download()}
        disabled={downloading}
      >
        {downloading ? (
          <Loader2 className="ml-2 h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="ml-2 h-4 w-4" />
        )}
        خروجی اکسل
      </Button>
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
