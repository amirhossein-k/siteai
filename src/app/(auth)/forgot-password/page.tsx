"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Phone,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpCodeInput } from "@/components/auth/otp-code-input";
import { showToast } from "@/components/ui/toast";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { AuthPanel } from "@/components/auth/auth-panel";
import HolographicScene from "@/components/auth/holographic-scene";
import {
  AUTH_INPUT_CLASS,
  AUTH_INPUT_WITH_ACTION_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_LABEL_CLASS,
} from "@/components/auth/auth-styles";
import { cn } from "@/lib/utils";

const PHONE_RE = /^09\d{9}$/;
const RESEND_COOLDOWN_SECONDS = 60;

type Step = "request" | "verify" | "password" | "success";

/**
 * Session 84 — «بازیابی رمز عبور» (forgot password).
 *
 * Four steps, reusing the Session 83 auth visual language:
 *   1. request  → POST /api/auth/otp/request   { phone, purpose: "password_reset" }
 *   2. verify   → POST /api/auth/otp/verify    { phone, code, purpose: "password_reset" }
 *                 → { resetToken } (a purpose-scoped one-time token — NEVER a
 *                   loginToken, and signIn() is NEVER called: a password reset
 *                   cannot create a session by construction)
 *   3. password → POST /api/auth/password-reset/complete { phone, resetToken, newPassword }
 *   4. success  → «ورود به حساب کاربری» → /login
 *
 * The resetToken is held ONLY in React memory (never localStorage / session
 * storage / cookies) and is cleared on success. The request step shows the
 * same generic message for known and unknown numbers (anti-enumeration); the
 * server gives both the same response AND the same resend-cooldown behavior.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 60s resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    setError("");
    if (!PHONE_RE.test(phone)) {
      setError("شماره موبایل معتبر نیست");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "password_reset" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "خطایی رخ داده است");
        return;
      }
      setStep("verify");
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      showToast.success("کد تأیید ارسال شد");
    } catch {
      setError("خطایی رخ داده است، دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("کد تأیید باید ۶ رقم باشد");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, purpose: "password_reset" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        resetToken?: string;
      };
      if (!res.ok || !data.resetToken) {
        setError(data.error || "کد وارد شده صحیح نیست");
        return;
      }
      // React memory ONLY — never persisted anywhere.
      setResetToken(data.resetToken);
      setStep("password");
      showToast.success("کد تأیید شد");
    } catch {
      setError("خطایی رخ داده است، دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setError("");

    const form = new FormData(e.currentTarget);
    const values = {
      password: String(form.get("password") || ""),
      confirmPassword: String(form.get("confirmPassword") || ""),
    };
    const parsed = resetPasswordSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || "اطلاعات نامعتبر است");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          resetToken,
          newPassword: values.password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "خطایی رخ داده است");
        return;
      }
      // Security hygiene — drop the one-time token from memory.
      setResetToken("");
      setStep("success");
      showToast.success("رمز عبور با موفقیت تغییر کرد");
    } catch {
      setError("خطایی رخ داده است، دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }

  const eyebrow = "بازیابی رمز عبور";
  const backLink = (
    <div className="mt-4 text-center">
      <Link
        href="/login"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-900"
      >
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        بازگشت به صفحه ورود
      </Link>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full">
      <HolographicScene className="hidden lg:block lg:h-screen lg:w-[56%]" />

      <AuthPanel
        className="w-full lg:w-[44%]"
        eyebrow={eyebrow}
        title={
          step === "success" ? (
            <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-zinc-900 sm:text-[2.75rem]">
              رمز عبور با موفقیت{" "}
              <span className="neon-accent">تغییر کرد</span>
            </h1>
          ) : (
            <h1 className="text-4xl font-bold leading-[1.15] tracking-tight text-zinc-900 sm:text-[2.75rem]">
              بازیابی <span className="neon-accent">رمز عبور</span>
            </h1>
          )
        }
        subtitle={
          step === "request"
            ? "شماره موبایل خود را وارد کنید؛ کد تأیید برایتان پیامک می‌شود."
            : step === "verify"
              ? `کد ۶ رقمی ارسال‌شده به شماره ${phone} را وارد کنید.`
              : step === "password"
                ? "رمز عبور جدید خود را تعیین کنید (حداقل ۶ کاراکتر)."
                : "اکنون می‌توانید با رمز عبور جدید وارد حساب خود شوید."
        }
      >
        {step === "request" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="pr-phone" className={`mb-2 block ${AUTH_LABEL_CLASS}`}>
                شماره موبایل
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                  <Phone className="h-5 w-5" aria-hidden="true" />
                </span>
                <Input
                  id="pr-phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="09xxxxxxxxx"
                  autoComplete="tel"
                  dir="ltr"
                  disabled={loading}
                  className={cn(AUTH_INPUT_CLASS, "text-left")}
                />
              </div>
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <Button
              type="button"
              onClick={requestCode}
              loading={loading}
              className={AUTH_SUBMIT_CLASS}
            >
              {loading ? (
                "در حال ارسال..."
              ) : (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  ارسال کد تأیید
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </Button>

            <p className="text-center text-xs leading-relaxed text-zinc-500">
              اگر این شماره در سامانه ثبت شده باشد، کد تأیید ارسال خواهد شد.
            </p>
            {backLink}
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="pr-code" className={`mb-2 block ${AUTH_LABEL_CLASS}`}>
                کد تأیید
              </label>
              <OtpCodeInput
                id="pr-code"
                value={code}
                onChange={setCode}
                disabled={loading}
                autoFocus
              />
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <Button
              type="button"
              onClick={verifyCode}
              loading={loading}
              className={AUTH_SUBMIT_CLASS}
            >
              {loading ? (
                "در حال تأیید..."
              ) : (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  تأیید کد
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("request");
                  setError("");
                }}
                className="text-zinc-500 underline-offset-4 transition hover:text-zinc-900 hover:underline"
              >
                تغییر شماره
              </button>
              <button
                type="button"
                onClick={requestCode}
                disabled={cooldown > 0 || loading}
                className="font-medium text-zinc-900 underline-offset-4 transition hover:text-cyan-500 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cooldown > 0
                  ? `ارسال مجدد کد (${cooldown} ثانیه)`
                  : "ارسال مجدد کد"}
              </button>
            </div>
          </div>
        )}

        {step === "password" && (
          <form onSubmit={submitNewPassword} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="pr-password" className={`mb-2 block ${AUTH_LABEL_CLASS}`}>
                رمز عبور جدید
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                  <Lock className="h-5 w-5" aria-hidden="true" />
                </span>
                <Input
                  id="pr-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="حداقل ۶ کاراکتر"
                  autoComplete="new-password"
                  disabled={loading}
                  className={AUTH_INPUT_WITH_ACTION_CLASS}
                />
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
            </div>

            <div className="space-y-2">
              <label
                htmlFor="pr-confirm"
                className={`mb-2 block ${AUTH_LABEL_CLASS}`}
              >
                تکرار رمز عبور جدید
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                  <Lock className="h-5 w-5" aria-hidden="true" />
                </span>
                <Input
                  id="pr-confirm"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="رمز عبور را دوباره وارد کنید"
                  autoComplete="new-password"
                  disabled={loading}
                  className={AUTH_INPUT_WITH_ACTION_CLASS}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((s) => !s)}
                  aria-label={
                    showConfirmPassword ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"
                  }
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 transition hover:text-zinc-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className={AUTH_SUBMIT_CLASS}>
              {loading ? (
                "در حال ثبت رمز عبور..."
              ) : (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  ثبت رمز عبور جدید
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </Button>
          </form>
        )}

        {step === "success" && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <CheckCircle2 className="h-16 w-16 text-emerald-500" aria-hidden="true" />
            </div>
            <p className="text-center text-sm leading-relaxed text-zinc-500">
              برای ورود با رمز عبور جدید، وارد حساب خود شوید.
            </p>
            <Button
              type="button"
              onClick={() => router.push("/login")}
              className={AUTH_SUBMIT_CLASS}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                ورود به حساب کاربری
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </span>
            </Button>
          </div>
        )}
      </AuthPanel>
    </div>
  );
}
