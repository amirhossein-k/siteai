"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  User,
  Phone,
  MapPin,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Save,
  Calendar,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerProfile, useUpdateCustomerProfile } from "@/hooks/use-customer-profile";
import { showToast } from "@/components/ui/toast";

export default function ProfilePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: profile, isLoading, isError, refetch } = useCustomerProfile();
  const updateProfile = useUpdateCustomerProfile();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Sync form fields when profile loads
  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setAddress(profile.address || "");
      setIsDirty(false);
    }
  }, [profile]);

  const handleFieldChange = (field: string, value: string) => {
    if (field === "name") setName(value);
    if (field === "address") setAddress(value);
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast.error("نام نمی‌تواند خالی باشد");
      return;
    }

    try {
      await updateProfile.mutateAsync({
        name: name.trim(),
        address: address.trim(),
      });
      showToast.success("پروفایل با موفقیت بروزرسانی شد");
      setIsDirty(false);
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در بروزرسانی پروفایل"
          : "خطا در بروزرسانی پروفایل";
      showToast.error(message);
    }
  };

  // --- Not logged in ---
  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <User className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">پروفایل کاربری</h1>
          <p className="mb-8 text-muted-foreground">
            برای مشاهده و ویرایش پروفایل وارد حساب خود شوید
          </p>
          <Button size="lg" onClick={() => router.push("/login?callbackUrl=/profile")}>
            ورود به حساب
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          صفحه اصلی
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">پروفایل من</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/10">
            <User className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">پروفایل من</h1>
            <p className="text-sm text-muted-foreground">
              اطلاعات حساب کاربری خود را مدیریت کنید
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href="/orders">
            مشاهده سفارشات من
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">خطا در دریافت اطلاعات پروفایل</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      ) : !profile ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            اطلاعات پروفایل یافت نشد
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Personal Info Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">اطلاعات شخصی</CardTitle>
              <CardDescription>
                نام و آدرس خود را ویرایش کنید
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium">نام و نام خانوادگی</label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={name}
                    onChange={(e) => handleFieldChange("name", e.target.value)}
                    placeholder="نام خود را وارد کنید"
                    className="pr-9"
                  />
                </div>
              </div>

              {/* Phone (read-only) */}
              <div className="space-y-2">
                <label className="text-sm font-medium">شماره موبایل</label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={profile.phone}
                    readOnly
                    className="pr-9 bg-muted/50 cursor-not-allowed"
                    dir="ltr"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  شماره موبایل قابل تغییر نیست
                </p>
              </div>

              {/* Address */}
              <div className="space-y-2">
                <label className="text-sm font-medium">آدرس</label>
                <div className="relative">
                  <MapPin className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <textarea
                    value={address}
                    onChange={(e) => handleFieldChange("address", e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="استان، شهر، خیابان..."
                  />
                </div>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={!isDirty || updateProfile.isPending}
                  loading={updateProfile.isPending}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {updateProfile.isPending ? "در حال ذخیره..." : "ذخیره تغییرات"}
                </Button>
                {isDirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setName(profile.name || "");
                      setAddress(profile.address || "");
                      setIsDirty(false);
                    }}
                  >
                    لغو
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Account Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">اطلاعات حساب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">نقش کاربری</p>
                    <p className="text-xs text-muted-foreground">
                      سطح دسترسی شما
                    </p>
                  </div>
                </div>
                <Badge variant={profile.role === "admin" ? "default" : "secondary"}>
                  {profile.role === "admin"
                    ? "مدیر"
                    : profile.role === "supplier"
                    ? "فروشنده"
                    : "مشتری"}
                </Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">تاریخ عضویت</p>
                    <p className="text-xs text-muted-foreground">
                      تاریخ ثبت نام شما
                    </p>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {new Date(profile.createdAt).toLocaleDateString("fa-IR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/orders">
                    مشاهده سفارشات
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/products">
                    فروشگاه
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
