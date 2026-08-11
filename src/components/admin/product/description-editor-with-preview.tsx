"use client";

import { useState } from "react";
import { ProductDescriptionEditor } from "@/components/admin/product/product-description-editor";
import { DescriptionPreview } from "@/components/admin/product/description-preview";
import { cn } from "@/lib/utils";
import type { RichDescriptionNode } from "@/types";

/**
 * Rich-description field with an edit / preview toggle (RTL, Persian).
 *
 * - "ویرایش": the Plate editor (unchanged behavior).
 * - "پیشنمایش": the storefront-equivalent renderer (DescriptionPreview →
 *   ProductDescription) applied to the CURRENT unsaved descriptionRich —
 *   toggling back remounts the editor with the same live state, so no work
 *   is lost and the preview is always what will be saved.
 * - Legacy plain-text products (descriptionRich undefined) preview their
 *   existing `description` through the same fallback the storefront uses.
 */
export function DescriptionEditorWithPreview({
  id,
  initialValue,
  legacyText,
  onChange,
  disabled,
}: {
  id?: string;
  initialValue?: RichDescriptionNode[];
  legacyText?: string;
  onChange: (value: RichDescriptionNode[] | undefined) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div className="space-y-2">
      {/* Simple toggle buttons (aria-pressed) — full ARIA tab semantics
          (roving tabindex / arrow-key navigation) are unnecessary for two
          static modes and would be a false affordance. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={mode === "edit"}
          onClick={() => setMode("edit")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            mode === "edit"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          ویرایش
        </button>
        <button
          type="button"
          aria-pressed={mode === "preview"}
          onClick={() => setMode("preview")}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            mode === "preview"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          پیشنمایش
        </button>
      </div>

      {mode === "edit" ? (
        <ProductDescriptionEditor
          id={id}
          initialValue={initialValue}
          onChange={onChange}
          disabled={disabled}
        />
      ) : (
        <div
          className="min-h-[160px] rounded-md border border-input bg-muted/20 px-3 py-2"
          data-testid="description-preview"
        >
          <DescriptionPreview value={initialValue} legacyText={legacyText} />
        </div>
      )}
    </div>
  );
}
