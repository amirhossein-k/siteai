"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { User, Phone, ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpCodeInput } from "@/components/auth/otp-code-input";
import { showToast } from "@/components/ui/toast";
import { otpRequestSchema, otpVerifySchema } from "@/lib/validations/auth";
import {
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_LABEL_CLASS,
} from "@/components/auth/auth-styles";
import type { UserRole } from "@/types";

const RESEND_COOLDOWN_SECONDS = 60;

interface OtpPanelProps {
  /** login → existing account; register → creates a passwordless customer. */
  purpose: "login" | "register";
  /** Called after a successful signIn with the resolved role (for redirect). */
  onAuthenticated: (role: UserRole) => void;
}

/**
 * Session 62 — SMS OTP panel (shared by the login + register pages).
 *
 * Two steps:
 *   1. request — phone (+ name for register) → POST /api/auth/otp/request
 *   2. verify  — 6-digit code → POST /api/auth/otp/verify → { loginToken }
 *                → signIn("credentials", { phone, loginToken })
 *
 * Session 83 — visual restyle only (marloo-login language). Every label,
 * button, error text, endpoint call and the whole state machine are
 * unchanged.
 */
export function OtpPanel({ purpose, onAuthenticated }: OtpPanelProps) {
  const isRegister = purpose === "register";
  const [step, setStep] = useState<"request" | "verify">("request");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // 60s resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    setError("");
    const parsed = otpRequestSchema.safeParse({ phone, purpose });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || "اطلاعات نامعتبر است");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "خطایی رخ داده است");
        return;
      }
      setStep("verify");
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      showToast.success(
        isRegister ? "کد تأیید ارسال شد" : "کد ورود پیامک شد"
      );
    } catch {
      setError("خطایی رخ داده است، دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError("");
    const parsed = otpVerifySchema.safeParse({
      phone,
      code,
      purpose,
      ...(isRegister ? { name } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || "اطلاعات نامعتبر است");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          code,
          purpose,
          ...(isRegister ? { name } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        loginToken?: string;
      };
      if (!res.ok || !data.loginToken) {
        setError(data.error || "کد وارد شده صحیح نیست");
        return;
      }

      const result = await signIn("credentials", {
        phone,
        loginToken: data.loginToken,
        redirect: false,
      });
      if (result?.error) {
        setError("ورود ناموفق بود، دوباره تلاش کنید");
        return;
      }

      showToast.success(
        isRegister
          ? "حساب کاربری شما با موفقیت ایجاد شد!"
          : "با موفقیت وارد شدید!"
      );

      // Resolve the role for the role-based redirect (mirrors the pages).
      try {
        const sessionRes = await fetch("/api/auth/session");
        const session = (await sessionRes.json()) as {
          user?: { role?: UserRole } | null;
        };
        onAuthenticated(session?.user?.role || "customer");
      } catch {
        onAuthenticated("customer");
      }
    } catch {
      setError("خطایی رخ داده است، دوباره تلاش کنید");
    } finally {
      setLoading(false);
    }
  }

  const inputId = (base: string) => `otp-${base}-${purpose}`;

  return (
    <div className="space-y-5">
      {step === "request" ? (
        <>
          {isRegister && (
            <div className="space-y-2">
              <label
                htmlFor={inputId("name")}
                className={`mb-2 block ${AUTH_LABEL_CLASS}`}
              >
                نام و نام خانوادگی
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                  <User className="h-5 w-5" aria-hidden="true" />
                </span>
                <Input
                  id={inputId("name")}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: علی محمدی"
                  autoComplete="name"
                  disabled={loading}
                  className={AUTH_INPUT_CLASS}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor={inputId("phone")}
              className={`mb-2 block ${AUTH_LABEL_CLASS}`}
            >
              شماره موبایل
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                <Phone className="h-5 w-5" aria-hidden="true" />
              </span>
              <Input
                id={inputId("phone")}
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xxxxxxxxx"
                autoComplete="tel"
                dir="ltr"
                disabled={loading}
                className={`${AUTH_INPUT_CLASS} text-left`}
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
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            کد ۶ رقمی به شماره{" "}
            <span dir="ltr" className="font-medium text-zinc-900">
              {phone}
            </span>{" "}
            ارسال شد.
          </p>

          <div className="space-y-2">
            <label
              htmlFor={inputId("code")}
              className={`mb-2 block ${AUTH_LABEL_CLASS}`}
            >
              کد تأیید
            </label>
            <OtpCodeInput
              id={inputId("code")}
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
                {isRegister ? "تأیید و ورود" : "ورود"}
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
              {cooldown > 0 ? `ارسال مجدد کد (${cooldown} ثانیه)` : "ارسال مجدد کد"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
