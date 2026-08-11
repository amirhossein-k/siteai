"use client";

import { ProductDescription } from "@/components/storefront/product-description";
import type { RichDescriptionNode } from "@/types";

/**
 * Storefront-equivalent preview for the unsaved rich description.
 *
 * Reuses the SAME closed-set structured renderer as the storefront
 * (ProductDescription) — there is deliberately NO second HTML-rendering
 * system: what the admin previews is byte-for-byte what the storefront will
 * render (same node allowlist, same link/image guards, same escaping). The
 * only extra layer is the legacy plain-text fallback, mirroring the
 * product-detail-view logic (descriptionRich present ? structured : plain).
 *
 * Directive-free at the data level; the storefront renderer has no "use
 * client" and is importable from client components unchanged.
 */
export function DescriptionPreview({
  value,
  legacyText,
}: {
  value?: RichDescriptionNode[];
  legacyText?: string;
}) {
  if (Array.isArray(value) && value.length > 0) {
    return (
      <div dir="rtl" className="text-sm">
        <ProductDescription value={value} />
      </div>
    );
  }
  if (legacyText && legacyText.trim().length > 0) {
    return (
      <p
        dir="auto"
        className="whitespace-pre-line text-sm leading-7 text-muted-foreground"
      >
        {legacyText}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      هنوز توضیحی وارد نشده است
    </p>
  );
}
