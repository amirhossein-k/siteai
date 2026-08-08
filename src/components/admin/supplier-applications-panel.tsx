"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Inbox,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/components/ui/toast";
import {
  useAdminSupplierApplications,
  useAdminSupplierApplicationDecision,
} from "@/hooks/use-admin-supplier-applications";
import type { AdminSupplierApplication } from "@/types";

/**
 * Session 67 — admin approval queue (tab on /admin/suppliers).
 *
 * Pending applications first: applicant info, business profile from the
 * application, an optional admin note, and atomic approve/reject buttons.
 * Approved applications provision the Supplier doc (seeded from the
 * application) + flip the applicant's role + revoke their old sessions on
 * the server; rejected ones leave the role untouched. Decided applications
 * render as a compact history below.
 */
export function SupplierApplicationsPanel() {
  const { data: apps, isLoading, isError, refetch } =
    useAdminSupplierApplications();
  const decide = useAdminSupplierApplicationDecision();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = (apps || []).filter((a) => a.status === "pending");
  const decided = (apps || []).filter((a) => a.status !== "pending");

  async function handleDecide(id: string, action: "approve" | "reject") {
    try {
      await decide.mutateAsync({ id, action, note: notes[id] || "" });
      showToast.success(
        action === "approve"
          ? "درخواست تأیید شد — فروشنده فعال شد"
          : "درخواست رد شد"
      );
    } catch (err) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در بررسی درخواست"
          : "خطا در بررسی درخواست";
      showToast.error(message);
    }
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
        <p className="mb-4 text-muted-foreground">خطا در دریافت درخواستها</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="ml-2 h-4 w-4" />
          تلاش مجدد
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  // Empty state ONLY when there is nothing at all — decided history must
  // still render once a queue has been drained (the previous early-return
  // hid it forever after the last pending item was decided).
  if (pending.length === 0 && decided.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Inbox className="mx-auto mb-3 h-8 w-8" />
        <p>درخواست در انتظار بررسی وجود ندارد</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-3">
        {pending.map((app) => (
          <div
            key={app._id}
            className="rounded-xl border p-4"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{app.businessName}</p>
                  <Badge variant="warning">در انتظار بررسی</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {app.user ? `${app.user.name} — ${app.user.phone}` : "کاربر حذفشده"}
                  {" · "}
                  {new Date(app.createdAt).toLocaleDateString("fa-IR")}
                </p>
              </div>
            </div>
            {app.description && (
              <p className="mb-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {app.description}
              </p>
            )}
            <div className="mb-3 flex items-center gap-2">
              <Input
                value={notes[app._id] || ""}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [app._id]: e.target.value }))
                }
                placeholder="یادداشت (اختیاری) — به متقاضی نمایش داده میشود"
                className="max-w-md"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => handleDecide(app._id, "approve")}
                disabled={!app.user || decide.isPending}
              >
                {decide.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                تأیید و فعالسازی فروشنده
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive"
                onClick={() => handleDecide(app._id, "reject")}
                disabled={!app.user || decide.isPending}
              >
                <XCircle className="h-3.5 w-3.5" />
                رد درخواست
              </Button>
            </div>
            </div>
          ))}
        </div>
      )}

      {/* Decided history */}
      {decided.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            درخواستهای بررسیشده
          </h3>
          <div className="divide-y rounded-xl border">
            {decided.map((app: AdminSupplierApplication) => (
              <div
                key={app._id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{app.businessName}</p>
                  <p className="text-xs text-muted-foreground">
                    {app.user ? app.user.name : "کاربر حذفشده"} —{" "}
                    {new Date(
                      app.decidedAt || app.createdAt
                    ).toLocaleDateString("fa-IR")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {app.adminNote && (
                    <span className="max-w-xs truncate text-xs text-muted-foreground">
                      {app.adminNote}
                    </span>
                  )}
                  <Badge
                    variant={app.status === "approved" ? "success" : "destructive"}
                  >
                    {app.status === "approved" ? "تأیید شده" : "رد شده"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
