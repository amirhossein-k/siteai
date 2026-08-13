"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export const reportKeys = {
  all: ["admin", "reports"] as const,
  detail: (report: string, qs: string) =>
    [...reportKeys.all, report, qs] as const,
};

/** Fetch a report's JSON envelope for the given query string. */
export async function fetchReport<T>(report: string, qs: string): Promise<T> {
  const { data } = await axios.get(`/api/admin/reports/${report}?${qs}`);
  return data;
}

export function useReportData<T>(report: string, qs: string) {
  return useQuery({
    queryKey: reportKeys.detail(report, qs),
    queryFn: () => fetchReport<T>(report, qs),
    staleTime: 15_000,
  });
}

/**
 * Excel export downloader. The exported workbook is generated server-side
 * from the SAME filters that produced the on-screen dataset.
 */
export function useReportExport(report: string, qs: string) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async () => {
    setError(null);
    setDownloading(true);
    try {
      const res = await axios.get(`/api/admin/reports/${report}/export?${qs}`, {
        responseType: "blob",
        timeout: 60_000,
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("خطا در ایجاد فایل اکسل");
    } finally {
      setDownloading(false);
    }
  }, [report, qs]);

  return { download, downloading, error };
}
