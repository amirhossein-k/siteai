"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Phone, Lock, Eye, EyeOff, ArrowLeft, ArrowRight, AlertCircle } from "lucide-react";
import { LoginFormData, loginSchema } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AuthPanel } from "@/components/auth/auth-panel";
import HolographicScene from "@/components/auth/holographic-scene";
import { AUTH_INPUT_CLASS, AUTH_INPUT_WITH_ACTION_CLASS, AUTH_SUBMIT_CLASS, AUTH_LABEL_CLASS } from "@/components/auth/auth-styles";
import { cn } from "@/lib/utils";
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
  const [showPassword, setShowPassword] = useState(false);

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
    <div className="flex min-h-screen w-full">
      <HolographicScene className="hidden lg:block lg:h-screen lg:w-[56%]" />

      <AuthPanel
        className="w-full lg:w-[44%]"
        eyebrow="خوش آمدید"
        title={
          <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-zinc-900 sm:text-[2.75rem]">
            ورود به حساب <span className="neon-accent">کاربری</span>
          </h1>
        }
        subtitle="برای ورود، شماره موبایل و رمز عبور خود را وارد کنید یا از کد یک‌بارمصرف استفاده کنید"
      >
        {/* Session 62 — sign-in method toggle (password default) */}
        <div
          role="group"
          aria-label="روش ورود"
          className="mb-7 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1"
        >
          <button
            type="button"
            aria-pressed={mode === "password"}
            onClick={() => setMode("password")}
            className={cn(
              "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              mode === "password"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
            )}
          >
            ورود با رمز عبور
          </button>
          <button
            type="button"
            aria-pressed={mode === "otp"}
            onClick={() => setMode("otp")}
            className={cn(
              "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              mode === "otp"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-600 hover:text-zinc-900"
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
                    <FormLabel className={AUTH_LABEL_CLASS}>شماره موبایل</FormLabel>
                    {/* NOTE: the relative icon wrapper must sit OUTSIDE FormControl —
                        FormControl (Slot) injects id={formItemId} onto its direct child,
                        so wrapping it would duplicate the input id and break label
                        association (getByLabel). */}
                    <div className="relative">
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Phone className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <FormControl>
                        <Input
                          {...field}
                          type="text"
                          placeholder="09xxxxxxxxx"
                          autoComplete="tel"
                          dir="ltr"
                          className={cn(AUTH_INPUT_CLASS, "text-left")}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={AUTH_LABEL_CLASS}>رمز عبور</FormLabel>
                    <div className="relative">
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Lock className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <FormControl>
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          className={AUTH_INPUT_WITH_ACTION_CLASS}
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 transition hover:text-zinc-600"
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5" aria-hidden="true" />
                        ) : (
                          <Eye className="h-5 w-5" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Session 84 — password recovery entry (login page only) */}
              <div className="-mt-2 text-left">
                <Link
                  href="/forgot-password"
                  className="text-sm text-zinc-500 transition hover:text-cyan-500"
                >
                  رمز عبور را فراموش کرده‌اید؟
                </Link>
              </div>

              {serverError && (
                <div
                  className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {serverError}
                </div>
              )}

              <Button
                type="submit"
                loading={loading}
                className={AUTH_SUBMIT_CLASS}
              >
                {loading ? (
                  "در حال ورود..."
                ) : (
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    ورود
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
              </Button>
            </form>
          </Form>
        ) : (
          <OtpPanel purpose="login" onAuthenticated={handleAuthenticated} />
        )}

        <div className="mt-7 text-center text-sm text-zinc-500">
          حساب کاربری ندارید؟{" "}
          <Link
            href="/register"
            className="font-semibold text-zinc-900 transition hover:text-cyan-500"
          >
            ثبت‌نام کنید
          </Link>
        </div>

        <div className="mt-4 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-900"
          >
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            بازگشت به صفحه اصلی
          </Link>
        </div>
      </AuthPanel>
    </div>
  );
}
