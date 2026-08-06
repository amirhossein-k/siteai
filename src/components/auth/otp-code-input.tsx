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
        "flex h-10 w-full rounded-md border border-input bg-background px-3 text-center font-mono text-lg tracking-[0.35em] ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-destructive focus-visible:ring-destructive"
      )}
    />
  );
}
