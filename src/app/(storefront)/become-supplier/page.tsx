"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Store,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { showToast } from "@/components/ui/toast";
import {
  useMySupplierApplication,
  useSubmitSupplierApplication,
} from "@/hooks/use-supplier-application";

/**
 * Session 67 — «فروشنده شوید» — the PUBLIC supplier application page.
 *
 * Role-aware:
 *  - anonymous            → sign-in prompt (apply requires an account).
 *  - customer (no app)    → application form (businessName / description /
 *                           contactPhone prefilled from the profile).
 *  - customer (pending)   → status card «در انتظار بررسی».
 *  - customer (approved)  → success card + link to the supplier panel.
 *  - customer (rejected)  → rejection card (admin note) + re-apply form.
 *  - supplier / admin     → link to their own dashboard.
 *
 * Submitting only creates a PENDING application — the role flip happens
 * exclusively through the admin approval queue (see RBAC.md Session 67).
 */
export default function BecomeSupplierPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = session?.user?.role;

  const { data: myApp, isLoading: appLoading } = useMySupplierApplication();
  const submit = useSubmitSupplierApplication();

  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [serverError, setServerError] = useState("");

  // Not a customer → dashboard redirects instead of the application form.
  if (status === "authenticated" && role === "supplier") {
    return <RoleRedirect title="شما فروشنده هستید" body="به پنل فروشندگان بروید." href="/supplier/dashboard" cta="ورود به پنل فروشندگان" />;
  }
  if (status === "authenticated" && role === "admin") {
    return <RoleRedirect title="شما مدیر هستید" body="مدیریت درخواستها و فروشندگان از پنل مدیریت انجام میشود." href="/admin/suppliers" cta="ورود به پنل مدیریت" />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    try {
      await submit.mutateAsync({
        businessName,
        description: description || undefined,
        contactPhone: contactPhone.trim() || undefined,
      });
      showToast.success("درخواست شما ثبت شد و در انتظار بررسی است");
      router.refresh();
    } catch (err) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error
          : undefined;
      setServerError(message || "خطا در ثبت درخواست");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
          <Store className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">فروشنده شوید</h1>
          <p className="mt-1 text-muted-foreground">
            محصولات خود را در فروشگاه بفروشید — درخواست شما توسط مدیریت بررسی میشود
          </p>
        </div>
      </div>

      {status === "loading" || appLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
          در حال بارگذاری...
        </div>
      ) : status === "unauthenticated" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-amber-500" />
            <div>
              <p className="mb-1 font-medium">برای ثبت درخواست فروشندگی ابتدا وارد شوید</p>
              <p className="text-sm text-muted-foreground">
                حساب کاربری ندارید؟ ثبتنام فقط چند ثانیه طول میکشد (با رمز عبور یا پیامک).
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => router.push("/login")}>ورود</Button>
              <Button variant="outline" onClick={() => router.push("/register")}>
                ثبتنام
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : myApp?.status === "approved" ? (
        <StatusCard
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="درخواست شما تأیید شد 🎉"
          body="حالا فروشنده هستید. برای دسترسی به پنل فروشندگان دوباره وارد شوید."
          ctaHref="/supplier/dashboard"
          ctaLabel="ورود به پنل فروشندگان"
        />
      ) : myApp?.status === "pending" ? (
        <StatusCard
          icon={<Clock className="h-8 w-8 text-amber-500" />}
          title="درخواست شما در انتظار بررسی است"
          body="مدیریت بهزودی درخواست «{نام کسبوکار}» را بررسی میکند و نتیجه را به شما اطلاع میدهد."
          sub={myApp.businessName}
        />
      ) : (
        <>
          {myApp?.status === "rejected" && (
            <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
                <XCircle className="h-4 w-4" />
                درخواست قبلی رد شد
              </div>
              <p className="text-sm text-muted-foreground">
                {myApp.adminNote
                  ? `یادداشت مدیریت: ${myApp.adminNote}`
                  : "میتوانید با اطلاعات اصلاحشده دوباره درخواست دهید."}
              </p>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">فرم درخواست فروشندگی</CardTitle>
              <CardDescription>
                پس از ثبت، درخواست شما به صف بررسی مدیریت میرود و نتیجه اعلام میشود.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bs-business-name">نام کسبوکار *</Label>
                  <Input
                    id="bs-business-name"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="مثال: فروشگاه دیجیتال پارس"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bs-description">توضیحات فروشگاه</Label>
                  <textarea
                    id="bs-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="درباره محصولات و کسبوکار خود بنویسید (حداکثر ۵۰۰ کاراکتر)"
                    rows={4}
                    maxLength={500}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bs-contact-phone">شماره تماس</Label>
                  <Input
                    id="bs-contact-phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="مثال: ۰۹۱۲۳۴۵۶۷۸۹ (پیشفرض: شماره حساب شما)"
                    dir="ltr"
                  />
                </div>

                {serverError && (
                  <p className="text-sm text-destructive">{serverError}</p>
                )}

                <Button
                  type="submit"
                  className="w-full gap-2"
                  disabled={submit.isPending || !businessName.trim()}
                  loading={submit.isPending}
                >
                  {submit.isPending ? "در حال ثبت..." : "ثبت درخواست فروشندگی"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatusCard({
  icon,
  title,
  body,
  sub,
  ctaHref,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  sub?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        {icon}
        <div>
          <p className="mb-1 font-semibold">{title}</p>
          {sub && <p className="mb-1 text-sm font-medium text-primary">{sub}</p>}
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        {ctaHref && ctaLabel && (
          <Link href={ctaHref}>
            <Button className="gap-2">
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function RoleRedirect({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <p className="mb-2 text-lg font-semibold">{title}</p>
      <p className="mb-6 text-muted-foreground">{body}</p>
      <Link href={href}>
        <Button className="gap-2">
          {cta}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}
