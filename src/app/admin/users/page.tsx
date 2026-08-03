"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Search,
  Shield,
  UserCog,
  Ban,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Users as UsersIcon,
  X,
  UserPlus,
  KeyRound,
  ArrowUpDown,
} from "lucide-react";
import { useAdminUsers, useCreateAdminUser, useUpdateUser } from "@/hooks/use-admin-users";
import { showToast } from "@/components/ui/toast";
import type { UserRole } from "@/types";

const roleConfig: Record<
  UserRole,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  admin: { label: "مدیر", variant: "default" },
  supplier: { label: "فروشنده", variant: "warning" },
  customer: { label: "مشتری", variant: "secondary" },
};

const roleFilters = [
  { value: null, label: "همه" },
  { value: "admin" as const, label: "مدیران" },
  { value: "supplier" as const, label: "فروشندگان" },
  { value: "customer" as const, label: "مشتریان" },
];

export default function AdminUsers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Action modals
  const [actionModal, setActionModal] = useState<{
    type: "change-role" | "reset-password" | null;
    user: { _id: string; name: string; role: UserRole } | null;
  }>({ type: null, user: null });

  const {
    data: users,
    isLoading,
    isError,
    refetch,
  } = useAdminUsers(roleFilter);

  const createUser = useCreateAdminUser();
  const updateUser = useUpdateUser();

  const filteredUsers = useMemo(
    () =>
      (users || []).filter((user) => {
        const matchesSearch =
          (user.name || "").includes(searchQuery) ||
          (user.phone || "").includes(searchQuery);
        return matchesSearch;
      }),
    [users, searchQuery]
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">کاربران</h1>
            <p className="text-sm text-muted-foreground">مدیریت کاربران و فروشندگان</p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">خطا در دریافت کاربران</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">کاربران</h1>
          <p className="text-sm text-muted-foreground">
            مدیریت کاربران و فروشندگان
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          ایجاد کاربر جدید
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="جستجوی کاربر..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {roleFilters.map((role) => (
                <Button
                  key={role.label}
                  variant={
                    roleFilter === role.value ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setRoleFilter(role.value)}
                >
                  {role.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">لیست کاربران</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${filteredUsers.length} کاربر`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <UsersIcon className="mx-auto mb-3 h-8 w-8" />
              <p>کاربری یافت نشد</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-right font-medium">کاربر</th>
                    <th className="px-4 py-3 text-right font-medium">شماره موبایل</th>
                    <th className="px-4 py-3 text-right font-medium">نقش</th>
                    <th className="px-4 py-3 text-right font-medium">وضعیت</th>
                    <th className="px-4 py-3 text-right font-medium">تاریخ ثبت‌نام</th>
                    <th className="px-4 py-3 text-center font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr
                      key={user._id}
                      className="border-b last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                            {user.name?.[0] || "?"}
                          </div>
                          <div>
                            <p className="font-medium">{user.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-left" dir="ltr">
                        {user.phone}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={roleConfig[user.role]?.variant || "secondary"}
                          className="text-xs"
                        >
                          {user.role === "admin" && <Shield className="ml-1 h-3 w-3" />}
                          {user.role === "supplier" && <UserCog className="ml-1 h-3 w-3" />}
                          {roleConfig[user.role]?.label || user.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-2 w-2 rounded-full ${
                              user.isActive ? "bg-emerald-500" : "bg-red-500"
                            }`}
                          />
                          <span className="text-xs">
                            {user.isActive ? "فعال" : "غیرفعال"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(user.createdAt).toLocaleDateString("fa-IR")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          {/* Change role button (not for admins changing other admins) */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              setActionModal({
                                type: "change-role",
                                user: {
                                  _id: user._id,
                                  name: user.name,
                                  role: user.role,
                                },
                              })
                            }
                            title="تغییر نقش"
                          >
                            <ArrowUpDown className="h-3.5 w-3.5" />
                          </Button>

                          {/* Reset password button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              setActionModal({
                                type: "reset-password",
                                user: {
                                  _id: user._id,
                                  name: user.name,
                                  role: user.role,
                                },
                              })
                            }
                            title="بازنشانی رمز عبور"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>

                          {/* Toggle active/inactive */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 ${
                              user.isActive
                                ? "text-destructive"
                                : "text-emerald-500"
                            }`}
                            onClick={async () => {
                              try {
                                await updateUser.mutateAsync({
                                  userId: user._id,
                                  action: "toggle-active",
                                });
                                showToast.success(
                                  user.isActive
                                    ? "کاربر غیرفعال شد"
                                    : "کاربر فعال شد"
                                );
                              } catch {
                                showToast.error("خطا در تغییر وضعیت کاربر");
                              }
                            }}
                            title={
                              user.isActive
                                ? "غیرفعال کردن"
                                : "فعال کردن"
                            }
                          >
                            {user.isActive ? (
                              <Ban className="h-3.5 w-3.5" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={async (data) => {
            try {
              await createUser.mutateAsync(data);
              showToast.success("کاربر جدید با موفقیت ایجاد شد");
              setShowCreateModal(false);
            } catch (err: unknown) {
              const message =
                err && typeof err === "object" && "response" in err
                  ? (err as { response: { data: { error: string } } }).response?.data
                      ?.error || "خطا در ایجاد کاربر"
                  : "خطا در ایجاد کاربر";
              showToast.error(message);
            }
          }}
          isSubmitting={createUser.isPending}
        />
      )}

      {/* Change Role Modal */}
      {actionModal.type === "change-role" && actionModal.user && (
        <ChangeRoleModal
          user={actionModal.user}
          onClose={() => setActionModal({ type: null, user: null })}
          onSubmit={async (newRole) => {
            try {
              await updateUser.mutateAsync({
                userId: actionModal.user!._id,
                action: "change-role",
                value: newRole,
              });
              showToast.success(`نقش کاربر به ${newRole} تغییر یافت`);
              setActionModal({ type: null, user: null });
            } catch (err: unknown) {
              const message =
                err && typeof err === "object" && "response" in err
                  ? (err as { response: { data: { error: string } } }).response?.data
                      ?.error || "خطا در تغییر نقش"
                  : "خطا در تغییر نقش";
              showToast.error(message);
            }
          }}
          isSubmitting={updateUser.isPending}
        />
      )}

      {/* Reset Password Modal */}
      {actionModal.type === "reset-password" && actionModal.user && (
        <ResetPasswordModal
          user={actionModal.user}
          onClose={() => setActionModal({ type: null, user: null })}
          onSubmit={async (newPassword) => {
            try {
              await updateUser.mutateAsync({
                userId: actionModal.user!._id,
                action: "reset-password",
                value: newPassword,
              });
              showToast.success("رمز عبور با موفقیت بازنشانی شد");
              setActionModal({ type: null, user: null });
            } catch (err: unknown) {
              const message =
                err && typeof err === "object" && "response" in err
                  ? (err as { response: { data: { error: string } } }).response?.data
                      ?.error || "خطا در بازنشانی رمز عبور"
                  : "خطا در بازنشانی رمز عبور";
              showToast.error(message);
            }
          }}
          isSubmitting={updateUser.isPending}
        />
      )}
    </div>
  );
}

// ============================================================
// Create User Modal
// ============================================================

interface CreateUserModalProps {
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    phone: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
  isSubmitting: boolean;
}

// ============================================================
// Change Role Modal
// ============================================================

interface ChangeRoleModalProps {
  user: { _id: string; name: string; role: UserRole };
  onClose: () => void;
  onSubmit: (newRole: string) => Promise<void>;
  isSubmitting: boolean;
}

function ChangeRoleModal({ user, onClose, onSubmit, isSubmitting }: ChangeRoleModalProps) {
  const [newRole, setNewRole] = useState(user.role);

  const roleOptions: { value: UserRole; label: string; desc: string }[] = [
    { value: "customer", label: "مشتری", desc: "دسترسی به فروشگاه و سفارش‌دهی" },
    { value: "supplier", label: "فروشنده", desc: "دسترسی به پنل فروشندگان" },
    { value: "admin", label: "مدیر", desc: "دسترسی کامل به پنل مدیریت" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newRole === user.role) {
      showToast.info("نقش کاربر تغییری نکرده است");
      return;
    }
    await onSubmit(newRole);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <ArrowUpDown className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">تغییر نقش کاربر</h2>
              <p className="text-sm text-muted-foreground">
                {user.name}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            {roleOptions.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  newRole === option.value
                    ? "border-primary bg-primary/5"
                    : "hover:bg-accent"
                }`}
              >
                <input
                  type="radio"
                  name="newRole"
                  value={option.value}
                  checked={newRole === option.value}
                  onChange={() => setNewRole(option.value)}
                  className="h-4 w-4 text-primary"
                />
                <div>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground">{option.desc}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-4">
            <Button
              type="submit"
              className="flex-1"
              disabled={newRole === user.role || isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "در حال تغییر..." : "تغییر نقش"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              انصراف
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Reset Password Modal
// ============================================================

interface ResetPasswordModalProps {
  user: { _id: string; name: string; role: UserRole };
  onClose: () => void;
  onSubmit: (newPassword: string) => Promise<void>;
  isSubmitting: boolean;
}

function ResetPasswordModal({ user, onClose, onSubmit, isSubmitting }: ResetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const isFormValid = newPassword.length >= 6 && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    await onSubmit(newPassword);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">بازنشانی رمز عبور</h2>
              <p className="text-sm text-muted-foreground">
                {user.name}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-password">رمز عبور جدید</Label>
            <div className="relative">
              <Input
                id="reset-password"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر"
                dir="ltr"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showPassword ? "مخفی" : "نمایش"}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-password-confirm">تکرار رمز عبور جدید</Label>
            <Input
              id="reset-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="رمز عبور را دوباره وارد کنید"
              dir="ltr"
              required
            />
          </div>

          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-sm text-destructive">رمز عبور و تکرار آن یکسان نیستند</p>
          )}

          <div className="flex items-center gap-3 pt-4">
            <Button
              type="submit"
              className="flex-1"
              disabled={!isFormValid || isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "در حال بازنشانی..." : "بازنشانی رمز عبور"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              انصراف
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Create User Modal
// ============================================================

function CreateUserModal({ onClose, onSubmit, isSubmitting }: CreateUserModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("supplier");
  const [showPassword, setShowPassword] = useState(false);

  const isFormValid = name.trim() && phone.trim() && password.length >= 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    await onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      password,
      role,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">ایجاد کاربر جدید</h2>
              <p className="text-sm text-muted-foreground">
                ادمین یا فروشنده جدید بسازید
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="new-user-name">نام و نام خانوادگی</Label>
            <Input
              id="new-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: علی محمدی"
              required
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="new-user-phone">شماره موبایل</Label>
            <Input
              id="new-user-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="مثال: ۰۹۱۲۳۴۵۶۷۸۹"
              dir="ltr"
              required
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="new-user-password">رمز عبور</Label>
            <div className="relative">
              <Input
                id="new-user-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر"
                dir="ltr"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                {showPassword ? "مخفی" : "نمایش"}
              </button>
            </div>
          </div>

          {/* Role */}
          <div className="space-y-2">
            <Label>نقش کاربر</Label>
            <div className="flex gap-3">
              <label
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors ${
                  role === "admin"
                    ? "border-primary bg-primary/5"
                    : "hover:bg-accent"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="admin"
                  checked={role === "admin"}
                  onChange={() => setRole("admin")}
                  className="h-4 w-4 text-primary"
                />
                <div>
                  <p className="text-sm font-medium">مدیر</p>
                  <p className="text-xs text-muted-foreground">دسترسی کامل به پنل مدیریت</p>
                </div>
              </label>
              <label
                className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors ${
                  role === "supplier"
                    ? "border-primary bg-primary/5"
                    : "hover:bg-accent"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="supplier"
                  checked={role === "supplier"}
                  onChange={() => setRole("supplier")}
                  className="h-4 w-4 text-primary"
                />
                <div>
                  <p className="text-sm font-medium">فروشنده</p>
                  <p className="text-xs text-muted-foreground">دسترسی به پنل فروشندگان</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-4">
            <Button
              type="submit"
              className="flex-1 gap-2"
              disabled={!isFormValid || isSubmitting}
              loading={isSubmitting}
            >
              {isSubmitting ? "در حال ایجاد..." : "ایجاد کاربر"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              انصراف
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
