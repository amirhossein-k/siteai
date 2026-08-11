"use client";

import { cn, formatPrice } from "@/lib/utils";
import { getEffectivePrice } from "@/lib/product-pricing";
import { useState } from "react";

/**
 * Admin discount draft (form-local shape). The API payload is derived by the
 * parent form on submit ("" → null, value → Number). Server-side validation
 * (parseProductDiscount in src/lib/product-pricing.ts) is authoritative; the
 * inline checks below are display-only guidance.
 */
export interface DiscountDraft {
  type: "percent" | "fixed";
  value: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

/** Stored UTC ISO → local datetime-local input value (browser-local TZ).
 *  Exported for the form's edit-prefill (stored Date → datetime-local value). */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

interface DiscountFieldsProps {
  value: DiscountDraft | null;
  onChange: (value: DiscountDraft | null) => void;
  /** Current product base price (min active variant price for variants) — for
   *  the live calculation. 0/undefined → variant product not yet priced. */
  basePrice: number;
}

/**
 * Admin-only product discount card (ADMIN form; the supplier form must NOT
 * render this — discounts are a platform margin/marketing decision).
 *
 * - Enable switch, type (درصدی/مبلغ ثابت), value, start/end datetime-local.
 * - Live calculation reuses the SAME pure helper the server uses
 *   (getEffectivePrice) so the preview is always the server's math:
 *   «۲٬۰۰۰٬۰۰۰ → ۲۰٪ → ۱٬۶۰۰٬۰۰۰».
 */
export function DiscountFields({
  value,
  onChange,
  basePrice,
}: DiscountFieldsProps) {
  const [touched, setTouched] = useState(false);

  const enabled = value !== null;
  const draft: DiscountDraft = value ?? {
    type: "percent",
    value: "",
    startsAt: "",
    endsAt: "",
    isActive: true,
  };

  const update = (patch: Partial<DiscountDraft>) =>
    onChange({ ...draft, ...patch });

  const numericValue = Number(draft.value);
  const effective = getEffectivePrice(Number(basePrice) || 0, {
    type: draft.type,
    value: Number.isFinite(numericValue) ? numericValue : 0,
    startsAt: draft.startsAt || null,
    endsAt: draft.endsAt || null,
  });

  // Display-only guidance (the server is authoritative on save).
  let guidance: string | null = null;
  if (enabled && draft.value !== "" && Number.isFinite(numericValue)) {
    if (draft.type === "percent") {
      if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 90) {
        guidance = "درصد تخفیف باید بین ۱ تا ۹۰ باشد";
      }
    } else if (
      !Number.isInteger(numericValue) ||
      numericValue < 1 ||
      (basePrice > 0 && numericValue >= basePrice)
    ) {
      guidance = "مبلغ تخفیف باید کمتر از قیمت محصول باشد";
    }
  }
  if (
    !guidance &&
    draft.startsAt &&
    draft.endsAt &&
    new Date(draft.endsAt) <= new Date(draft.startsAt)
  ) {
    guidance = "تاریخ پایان باید بعد از شروع باشد";
  }

  const inputClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-4">
      {/* Enable switch */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="فعال‌سازی تخفیف محصول"
          onClick={() => {
            setTouched(true);
            onChange(
              enabled
                ? null
                : { type: "percent", value: "", startsAt: "", endsAt: "", isActive: true }
            );
          }}
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            enabled ? "bg-primary" : "bg-input"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-[22px]" : "translate-x-[2px]"
            )}
          />
        </button>
        <div>
          <p className="text-sm font-medium leading-none">فعال‌سازی تخفیف محصول</p>
          <p className="mt-1 text-xs text-muted-foreground">
            قیمت فروش برای بازه زمانی مشخص کاهش می‌یابد
          </p>
        </div>
      </div>

      {enabled && (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            {/* Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">نوع تخفیف</label>
              <select
                value={draft.type}
                onChange={(e) =>
                  update({ type: e.target.value as "percent" | "fixed" })
                }
                className={inputClass}
              >
                <option value="percent">درصدی</option>
                <option value="fixed">مبلغ ثابت (تومان)</option>
              </select>
            </div>

            {/* Value */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                {draft.type === "percent" ? "درصد تخفیف" : "مبلغ تخفیف (تومان)"}
              </label>
              <input
                type="number"
                min={draft.type === "percent" ? 1 : 1}
                max={draft.type === "percent" ? 90 : undefined}
                value={draft.value}
                onChange={(e) => update({ value: e.target.value })}
                placeholder={draft.type === "percent" ? "مثال: ۲۰" : "مثال: ۱۵۰۰۰۰"}
                className={inputClass}
                aria-label="مقدار تخفیف"
              />
            </div>

            {/* Active within window */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">وضعیت</label>
              <select
                value={draft.isActive ? "active" : "inactive"}
                onChange={(e) => update({ isActive: e.target.value === "active" })}
                className={inputClass}
              >
                <option value="active">فعال</option>
                <option value="inactive">غیرفعال</option>
              </select>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">شروع تخفیف (اختیاری)</label>
              <input
                type="datetime-local"
                value={toLocalInputValue(draft.startsAt)}
                onChange={(e) => update({ startsAt: e.target.value })}
                className={inputClass}
                aria-label="زمان شروع تخفیف"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">پایان تخفیف (اختیاری)</label>
              <input
                type="datetime-local"
                value={toLocalInputValue(draft.endsAt)}
                onChange={(e) => update({ endsAt: e.target.value })}
                className={inputClass}
                aria-label="زمان پایان تخفیف"
              />
            </div>
          </div>

          {/* Live calculation — same math as the server (getEffectivePrice). */}
          <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
            {basePrice > 0 && draft.value !== "" && Number.isFinite(numericValue) ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground line-through">
                  {formatPrice(basePrice)}
                </span>
                <span aria-hidden="true">→</span>
                <span className="font-medium text-muted-foreground">
                  {draft.type === "percent" ? `${draft.value}٪` : `-${formatPrice(numericValue)}`}
                </span>
                <span aria-hidden="true">→</span>
                <span className="text-lg font-bold text-emerald-600">
                  {formatPrice(effective.finalPrice)}
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {basePrice <= 0
                  ? "قیمت محصول را وارد کنید تا محاسبه تخفیف نمایش داده شود"
                  : "مقدار تخفیف را وارد کنید"}
              </p>
            )}
          </div>

          {touched && guidance && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {guidance}
            </p>
          )}
        </>
      )}
    </div>
  );
}
