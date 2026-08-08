"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Search,
  AlertCircle,
  RefreshCw,
  Store,
  Ban,
  CheckCircle,
  UserPlus,
  UserCog,
  Wallet,
  X,
  Loader2,
  Phone,
  Inbox,
} from "lucide-react";
import { CreateUserModal } from "@/components/admin/create-user-modal";
import { SupplierApplicationsPanel } from "@/components/admin/supplier-applications-panel";
import {
  useAdminSuppliers,
  useToggleSupplierActive,
  usePromoteToSupplier,
  useInvalidateAdminSuppliers,
} from "@/hooks/use-admin-suppliers";
import { useAdminUsers, useCreateAdminUser } from "@/hooks/use-admin-users";
import { useAdminSupplierApplications } from "@/hooks/use-admin-supplier-applications";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { AdminSupplier, UserRole } from "@/types";

/**
 * Session 66 — Admin Supplier Management (فروشندگان).
 *
 * The dedicated home for Supplier onboarding:
 *  - CREATE a supplier (shared CreateUserModal → POST /api/admin/users with
 *    role=supplier — the server auto-provisions the Supplier document).
 *  - PROMOTE an existing customer to supplier (PATCH change-role — the server
 *    auto-provisions the Supplier document and revokes the old-role session).
 *  - VIEW status: business profile, wallet figures, linked user, active flag.
 *  - DEACTIVATE / REACTIVATE (PATCH toggle-active — server flips Supplier +
 *    User isActive together and revokes sessions on deactivation).
 *  - NAVIGATE to the payout/settlement queue (/admin/payouts).
 *
 * NO duplicate supplier-creation API was added — everything reuses the
 * existing /api/admin/users flows. Public supplier registration stays
 * out of scope (admin-only onboarding by design, see RBAC.md).
 */
export default function AdminSuppliersPage() {
  const [tab, setTab] = useState<"suppliers" | "applications">("suppliers");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: suppliers,
    isLoading,
    isError,
    refetch,
  } = useAdminSuppliers();
  // Pending-application count for the queue tab badge (same query key as the
  // panel — React Query dedupes).
  const { data: applications } = useAdminSupplierApplications();
  const pendingCount = (applications || []).filter(
    (a) => a.status === "pending"
  ).length;
  const toggleActive = useToggleSupplierActive();
  const promote = usePromoteToSupplier();
  const createUser = useCreateAdminUser();
  const invalidateSuppliers = useInvalidateAdminSuppliers();

  const filteredSuppliers = useMemo(
    () =>
      (suppliers || []).filter((s) => {
        const q = searchQuery.trim();
        if (!q) return true;
        return (
          s.businessName.toLowerCase().includes(q.toLowerCase()) ||
          (s.user?.name || "").includes(q) ||
          (s.user?.phone || "").includes(q)
        );
      }),
    [suppliers, searchQuery]
  );

  const handleToggle = async (s: AdminSupplier) => {
    if (!s.user) {
      showToast.error("کاربر این فروشنده یافت نشد");
      return;
    }
    try {
      await toggleActive.mutateAsync(s.user._id);
      showToast.success(s.isActive ? "فروشنده غیرفعال شد" : "فروشنده فعال شد");
    } catch {
      showToast.error("خطا در تغییر وضعیت فروشنده");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">فروشندگان</h1>
          <p className="text-sm text-muted-foreground">
            مدیریت فروشندگان — ایجاد، ارتقا، وضعیت و تسویه
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "suppliers" && (
            <>
              <Button variant="outline" onClick={() => setShowPromoteModal(true)} className="gap-2">
                <UserCog className="h-4 w-4" />
                ارتقای کاربر به فروشنده
              </Button>
              <Button onClick={() => setShowCreateModal(true)} className="gap-2">
                <UserPlus className="h-4 w-4" />
                ایجاد فروشنده جدید
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Session 67 — tabs: suppliers list / approval queue */}
      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("suppliers")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "suppliers"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          فروشندگان
        </button>
        <button
          type="button"
          onClick={() => setTab("applications")}
          className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "applications"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Inbox className="h-4 w-4" />
          درخواست‌های فروشندگی
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {pendingCount.toLocaleString("fa-IR")}
            </span>
          )}
        </button>
      </div>

      {tab === "applications" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">صف بررسی درخواست‌ها</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierApplicationsPanel />
          </CardContent>
        </Card>
      ) : (
      <>
      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجوی فروشنده (نام کسب‌وکار، نام یا موبایل کاربر)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Suppliers list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">لیست فروشندگان</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${filteredSuppliers.length} فروشنده`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="mb-4 text-muted-foreground">خطا در دریافت فروشندگان</p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="ml-2 h-4 w-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Store className="mx-auto mb-3 h-8 w-8" />
              <p>فروشنده‌ای یافت نشد</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-right font-medium">فروشنده</th>
                    <th className="px-4 py-3 text-right font-medium">کاربر</th>
                    <th className="px-4 py-3 text-right font-medium">تماس</th>
                    <th className="px-4 py-3 text-right font-medium">موجودی</th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                    <th className="px-4 py-3 text-center font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((s) => {
                    const userActive = s.user?.isActive !== false;
                    const supplierActive = s.isActive;
                    const active = userActive && supplierActive;
                    return (
                      <tr
                        key={s._id}
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                              {s.businessName?.[0] || "?"}
                            </div>
                            <div>
                              <p className="font-medium">{s.businessName}</p>
                              <p className="text-xs text-muted-foreground">
                                {s.createdAt
                                  ? new Date(s.createdAt).toLocaleDateString("fa-IR")
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {s.user ? (
                            <div>
                              <p>{s.user.name}</p>
                              <p className="text-xs text-muted-foreground" dir="ltr">
                                {s.user.phone}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              کاربر حذف‌شده
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {s.contactPhone ? (
                            <span className="flex items-center gap-1 text-muted-foreground" dir="ltr">
                              <Phone className="h-3 w-3" />
                              {s.contactPhone}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{formatPrice(s.balance || 0)}</p>
                            {s.pendingReserve > 0 && (
                              <p className="text-xs text-amber-600">
                                رزرو: {formatPrice(s.pendingReserve)}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className={`h-2 w-2 rounded-full ${
                                active ? "bg-emerald-500" : "bg-red-500"
                              }`}
                            />
                            <span className="text-xs">
                              {active ? "فعال" : "غیرفعال"}
                            </span>
                            {!supplierActive && (
                              <span className="text-[10px] text-muted-foreground">
                                (فروشگاه مخفی)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              asChild
                            >
                              <Link href="/admin/payouts">
                                <Wallet className="h-3.5 w-3.5" />
                                تسویه
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-8 w-8 ${
                                active
                                  ? "text-destructive"
                                  : "text-emerald-500"
                              }`}
                              onClick={() => handleToggle(s)}
                              disabled={!s.user || toggleActive.isPending}
                              title={active ? "غیرفعال کردن" : "فعال کردن"}
                            >
                              {active ? (
                                <Ban className="h-3.5 w-3.5" />
                              ) : (
                                <CheckCircle className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {/* Create supplier modal */}
      {showCreateModal && (
        <CreateUserModal
          defaultRole="supplier"
          onClose={() => setShowCreateModal(false)}
          onSubmit={async (data) => {
            try {
              await createUser.mutateAsync({
                ...data,
                role: "supplier" as UserRole,
              });
              // useCreateAdminUser only invalidates the USER lists — refresh the
              // suppliers management list too so the new row appears instantly.
              invalidateSuppliers();
              showToast.success("فروشنده جدید با موفقیت ایجاد شد");
              setShowCreateModal(false);
            } catch (err: unknown) {
              const message =
                err && typeof err === "object" && "response" in err
                  ? (err as { response: { data: { error: string } } }).response?.data
                      ?.error || "خطا در ایجاد فروشنده"
                  : "خطا در ایجاد فروشنده";
              showToast.error(message);
            }
          }}
          isSubmitting={createUser.isPending}
        />
      )}

      {/* Promote customer modal */}
      {showPromoteModal && (
        <PromoteSupplierModal
          onClose={() => setShowPromoteModal(false)}
          onPromote={async (userId: string) => {
            try {
              await promote.mutateAsync(userId);
              showToast.success("کاربر به فروشنده ارتقا یافت");
              setShowPromoteModal(false);
            } catch (err: unknown) {
              const message =
                err && typeof err === "object" && "response" in err
                  ? (err as { response: { data: { error: string } } }).response?.data
                      ?.error || "خطا در ارتقای کاربر"
                  : "خطا در ارتقای کاربر";
              showToast.error(message);
            }
          }}
          isSubmitting={promote.isPending}
        />
      )}
    </div>
  );
}

// ============================================================
// Promote Customer → Supplier Modal
// ============================================================

interface PromoteSupplierModalProps {
  onClose: () => void;
  onPromote: (userId: string) => Promise<void>;
  isSubmitting: boolean;
}

/**
 * Lists existing CUSTOMER accounts (searchable) and promotes one to supplier
 * via the existing admin users change-role flow. Only active customers that
 * are NOT already suppliers/admins are offered.
 */
function PromoteSupplierModal({
  onClose,
  onPromote,
  isSubmitting,
}: PromoteSupplierModalProps) {
  const [search, setSearch] = useState("");
  const {
    data: customers,
    isLoading,
    isError,
  } = useAdminUsers("customer");

  const filtered = useMemo(
    () =>
      (customers || []).filter((u) => {
        const q = search.trim();
        if (!q) return true;
        return u.name.includes(q) || u.phone.includes(q);
      }),
    [customers, search]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <UserCog className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">ارتقای کاربر به فروشنده</h2>
              <p className="text-sm text-muted-foreground">
                یک مشتری موجود را به پنل فروشندگان دعوت کنید
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجوی مشتری (نام یا موبایل)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              خطا در دریافت کاربران
            </p>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              مشتری یافت نشد
            </p>
          ) : (
            filtered.map((u) => (
              <div
                key={u._id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {u.phone}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs"
                  onClick={() => onPromote(u._id)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <UserCog className="h-3 w-3" />
                  )}
                  ارتقا
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            پس از ارتقا، جلسه فعلی کاربر باطل می‌شود و با ورود مجدد به پنل
            فروشندگان دسترسی پیدا می‌کند.
          </p>
        </div>
      </div>
    </div>
  );
}
