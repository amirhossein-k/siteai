"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, X } from "lucide-react";
import type { UserRole } from "@/types";

interface CreateUserModalProps {
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    phone: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
  isSubmitting: boolean;
  /** Default selected role — defaults to "supplier" (matches the original
   *  admin users page behavior). Session 66 — shared by /admin/users and
   *  /admin/suppliers. */
  defaultRole?: UserRole;
}

/**
 * Shared «ایجاد کاربر جدید» modal — creates an admin or supplier account via
 * POST /api/admin/users (admin-only). Session 66 extracted this from the admin
 * users page so the suppliers page reuses the identical UI/flow — NO duplicate
 * supplier-creation API was added; the server auto-provisions the Supplier doc.
 */
export function CreateUserModal({
  onClose,
  onSubmit,
  isSubmitting,
  defaultRole = "supplier",
}: CreateUserModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>(defaultRole);
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
