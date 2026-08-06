"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginFormData, loginSchema } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { showToast } from "@/components/ui/toast";
import { OtpPanel } from "@/components/auth/otp-panel";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon } from "lucide-react";
import type { UserRole } from "@/types";

/**
 * Role-based redirect map:
 * After successful login, users are sent to their role-appropriate dashboard.
 */
const roleRedirects: Record<UserRole, string> = {
  admin: "/admin/dashboard",
  supplier: "/supplier/dashboard",
  customer: "/",
};

export default function LoginPage() {
  const router = useRouter();
  // Session 62 — OTP is an additional sign-in option; password stays default.
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  function handleAuthenticated(role: UserRole) {
    const redirectPath = roleRedirects[role] || "/";
    router.push(redirectPath);
    router.refresh();
  }

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      phone: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setServerError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        phone: data.phone,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setServerError("شماره موبایل یا رمز عبور اشتباه است");
        return;
      }

      showToast.success("با موفقیت وارد شدید!");

      // Fetch session to get the role before redirecting
      // NextAuth session may not be immediately available after signIn,
      // so we fetch it to determine the correct redirect
      try {
        const sessionRes = await fetch("/api/auth/session");
        const sessionData = await sessionRes.json();
        const role = (sessionData?.user?.role || "customer") as UserRole;
        const redirectPath = roleRedirects[role] || "/";
        router.push(redirectPath);
      } catch {
        router.push("/");
      }

      router.refresh();
    } catch {
      setServerError("خطایی رخ داده است، دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-50 to-white p-4 dark:from-zinc-950 dark:to-zinc-900"
    >
      <Card className="w-full max-w-md border shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <Link
            href="/"
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-700 text-xl font-bold text-white shadow-lg dark:from-zinc-50 dark:to-zinc-300 dark:text-zinc-900"
          >
            S
          </Link>
          <CardTitle className="text-2xl">ورود به حساب کاربری</CardTitle>
          <CardDescription>
            برای ورود شماره موبایل و رمز عبور خود را وارد کنید
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Session 62 — sign-in method toggle (password default) */}
          <div
            role="group"
            aria-label="روش ورود"
            className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          >
            <button
              type="button"
              aria-pressed={mode === "password"}
              onClick={() => setMode("password")}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                mode === "password"
                  ? "bg-background text-foreground shadow-sm"
                  // Session 62 — muted-foreground on muted measures 4.39:1
                  // (axe color-contrast); zinc-600 is 7+:1 and dark-mode safe.
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              )}
            >
              ورود با رمز عبور
            </button>
            <button
              type="button"
              aria-pressed={mode === "otp"}
              onClick={() => setMode("otp")}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                mode === "otp"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              )}
            >
              ورود با کد یک‌بارمصرف
            </button>
          </div>

          {mode === "password" ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>شماره موبایل</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        placeholder="09xxxxxxxxx"
                        autoComplete="tel"
                        dir="ltr"
                        className="text-left"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>رمز عبور</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {serverError && (
                <div
                  className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {serverError}
                </div>
              )}

              <Button
                type="submit"
                loading={loading}
                className="w-full"
                size="lg"
              >
                {loading ? "در حال ورود..." : "ورود"}
              </Button>
            </form>
          </Form>
          ) : (
            <OtpPanel purpose="login" onAuthenticated={handleAuthenticated} />
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            حساب کاربری ندارید؟{" "}
            <Link
              href="/register"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              ثبت‌نام کنید
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              بازگشت به صفحه اصلی
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
