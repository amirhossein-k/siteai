"use client";

import { cn } from "@/lib/utils";

interface OtpCodeInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}

/**
 * Session 62 — OTP code input.
 *
 * A labelled, LTR, 6-digit code field. Accepts digits only (auto-strips
 * everything else), surfaces the `one-time-code` autocomplete hint so mobile
 * keyboards offer the SMS code, and marks itself invalid for assistive tech.
 *
 * Session 83 — visual restyle only (rounded-2xl marloo input, cyan focus);
 * the id/label contract, digit filtering and autocomplete hints are unchanged.
 */
export function OtpCodeInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
  autoFocus,
}: OtpCodeInputProps) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      pattern="\d{6}"
      dir="ltr"
      placeholder="••••••"
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
        onChange(digits);
      }}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-auto w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 py-3.5 text-center font-mono text-xl tracking-[0.35em] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-500 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-red-400 focus:border-red-400 focus:ring-red-400/10"
      )}
    />
  );
}
