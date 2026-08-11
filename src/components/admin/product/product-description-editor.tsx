"use client";

import { useMemo, useRef, useState } from "react";
import { HistoryPlugin } from "platejs";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin, BlockquotePlugin, HorizontalRulePlugin } from "@platejs/basic-nodes/react";
import { FontColorPlugin, FontBackgroundColorPlugin, TextAlignPlugin } from "@platejs/basic-styles/react";
import { TablePlugin } from "@platejs/table/react";
import { ListPlugin } from "@platejs/list/react";
import { toggleList } from "@platejs/list";
import { LinkPlugin } from "@platejs/link/react";
import { ImagePlugin } from "@platejs/media/react";
import { insertImage } from "@platejs/media";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import axios from "axios";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  AlignRight,
  AlignCenter,
  AlignLeft,
  AlignJustify,
  Palette,
  Minus,
  Table as TableIcon,
  ImagePlus,
  Undo2,
  Redo2,
  Loader2,
} from "lucide-react";
import type { RichDescriptionNode } from "@/types";
import type { NodeComponent } from "platejs";

// ─── Editor image render override ─────────────────────────────────────────
// The @platejs/media react Image component does not render in this v53 setup
// (its preview pipeline never resolves for directly-inserted URLs), so the
// plugin's img element shows as an invisible void line. We replace ONLY the
// render via the documented `override.components` API — the ImagePlugin still
// supplies the node definition (isVoid/isElement) and the IMG paste
// deserializer. The stored shape stays { type: "img", url, children }.
const EditorImageComponent: NodeComponent = ({
  element,
  children,
  attributes,
}: {
  element: { url?: string };
  children: React.ReactNode;
  attributes: Record<string, unknown>;
}) => {
  const url = element.url;
  if (typeof url !== "string" || url.length === 0) return null;
  return (
    <div
      {...(attributes as React.HTMLAttributes<HTMLDivElement>)}
      contentEditable={false}
      className="my-2"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- in-editor preview of a user-uploaded URL */}
      <img
        src={url}
        alt=""
        draggable={false}
        className="max-h-64 rounded-md border border-border"
      />
      {children}
    </div>
  );
};

// ─── Toolbar button primitives ───────────────────────────────────────────
function ToolbarButton({
  label,
  onClick,
  onMouseDown,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  onMouseDown?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={onMouseDown ?? ((e) => e.preventDefault())} // keep editor selection/focus
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-accent text-accent-foreground"
      )}
    >
      {children}
    </button>
  );
}

// ─── Typed access to plugin-namespaced transforms (v53) ───────────────────
// The @platejs/basic-styles/table plugins register transforms under their
// plugin keys (editor.tf.textAlign, editor.tf.color, editor.tf.insert.table).
// We only rely on the subset below — untyped at the package boundary.
interface EditorTransformSubset {
  textAlign?: { setNodes: (value: string) => void };
  color?: { addMark: (value: string) => void };
  insert?: { table?: (opts: { rowCount: number; colCount: number }) => void };
}

const tf = (editor: unknown): EditorTransformSubset =>
  (editor as { tf?: EditorTransformSubset }).tf ?? {};

// ─── Component props ──────────────────────────────────────────────────────
export interface ProductDescriptionEditorProps {
  /** Initial Slate JSON (from product.descriptionRich). undefined → empty editor. */
  initialValue?: RichDescriptionNode[];
  /** Controlled callback with the current Slate JSON (undefined when empty). */
  onChange?: (value: RichDescriptionNode[] | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

/**
 * Plate-based rich-text product description editor.
 *
 * - RTL-first (dir="rtl"), Persian toolbar aria-labels.
 * - Controlled via initialValue + onChange (react-hook-form compatible).
 * - Images upload through the existing POST /api/upload (admin/supplier RBAC
 *   preserved) and are inserted with the returned URL.
 * - Server-side allowlist validation (src/lib/product-description.ts) remains
 *   the authoritative security boundary; this component is presentation only.
 */
export function ProductDescriptionEditor({
  initialValue,
  onChange,
  disabled,
  placeholder = "توضیحات محصول...",
  id,
}: ProductDescriptionEditorProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Plate's ListPlugin emits proper ul/ol/li nodes ONLY through its own
  // toggleList transform — a bare toggleBlock("ul") renames the paragraph
  // without wrapping list items (producing an invalid ul-without-li tree).
  // (The react useListToolbarButton hooks require being inside the <Plate>
  // provider, so we call the plain transform directly instead.)

  const editor = useMemo(
    () =>
      createPlateEditor({
        // Session 69 — the media plugin's own react Image render never fires
        // for directly-inserted URLs (v53 preview pipeline); render img nodes
        // with our own component instead (override.components by plugin key).
        override: { components: { img: EditorImageComponent } },
        plugins: [
          BasicBlocksPlugin,
          BasicMarksPlugin,
          BlockquotePlugin,
          HorizontalRulePlugin,
          TextAlignPlugin,
          FontColorPlugin,
          FontBackgroundColorPlugin,
          TablePlugin,
          ListPlugin,
          LinkPlugin,
          ImagePlugin,
          HistoryPlugin,
        ],
        // createPlateEditor accepts a Slate `Value`; our loosely-typed
        // RichDescriptionNode[] is structurally the same tree — validated
        // strictly server-side on save.
        value: (initialValue && initialValue.length > 0
          ? initialValue
          : undefined) as unknown as Parameters<typeof createPlateEditor>[0] extends infer O
          ? O extends { value?: infer V }
            ? V | undefined
            : never
          : never,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial value is a mount-time seed only
    []
  );

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await axios.post("/api/upload", formData);
      const url: string | undefined = data?.url;
      if (!url) {
        showToast.error("آپلود تصویر ناموفق بود");
        return;
      }
      // Insert via the media plugin's own transform (registers the node with
      // the plugin's img type + preview pipeline so it renders in the editor —
      // a raw insertNode produced an invisible placeholder instead). The stored
      // shape is { type: "img", url, children: [{ text: "" }] } — validated by
      // the server allowlist exactly like the transform's output.
      insertImage(editor, url);
      showToast.success("تصویر به توضیحات اضافه شد");
    } catch {
      showToast.error("خطا در آپلود تصویر");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const insertLink = () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\/.+/.test(url)) {
      showToast.error("لینک فقط می‌تواند http/https باشد");
      return;
    }
    editor.tf.insertNode({
      type: "a",
      url,
      children: [{ text: url }],
    });
    setLinkUrl("");
    setLinkOpen(false);
  };

  return (
    <div
      dir="rtl"
      aria-disabled={disabled || undefined}
      className={cn(
        "w-full overflow-hidden rounded-md border border-input bg-background",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        // Issue 2 — `disabled` must stay a VISUAL affordance only. Forwarding
        // it to PlateContent maps to contentEditable readOnly, and toggling
        // readOnly mid-edit (e.g. when a submit fails server-side and
        // isSubmitting flips) drops the DOM selection — Plate's editor.selection
        // goes stale and Backspace/Delete silently no-op afterwards. pointer-
        // events + opacity give the same disabled UX without touching the
        // editable's readOnly state.
        disabled && "pointer-events-none cursor-not-allowed opacity-60"
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input bg-muted/40 px-1.5 py-1">
        <ToolbarButton label="پاراگراف" onClick={() => editor.tf.toggleBlock("p")}>
          <Pilcrow className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="عنوان ۱" onClick={() => editor.tf.toggleBlock("h1")}>
          <Heading1 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="عنوان ۲" onClick={() => editor.tf.toggleBlock("h2")}>
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="عنوان ۳" onClick={() => editor.tf.toggleBlock("h3")}>
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <ToolbarButton label="پررنگ" onClick={() => editor.tf.toggleMark("bold")}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="ایتالیک" onClick={() => editor.tf.toggleMark("italic")}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="زیرخط" onClick={() => editor.tf.toggleMark("underline")}>
          <Underline className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="خط‌خورده" onClick={() => editor.tf.toggleMark("strikethrough")}>
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="هایلایت" onClick={() => editor.tf.toggleMark("highlight")}>
          <Highlighter className="h-4 w-4" />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <ToolbarButton
          label="لیست بولت‌دار"
          onClick={() => toggleList(editor, { listStyleType: "ul" })}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="لیست شماره‌دار"
          onClick={() => toggleList(editor, { listStyleType: "ol" })}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="نقل‌قول" onClick={() => editor.tf.toggleBlock("blockquote")}>
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="خط افقی" onClick={() => editor.tf.insertNode({ type: "hr", children: [{ text: "" }] })}>
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <ToolbarButton label="تراز راست" onClick={() => tf(editor).textAlign?.setNodes("right") ?? editor.tf.setNodes({ align: "right" })}>
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="تراز وسط" onClick={() => tf(editor).textAlign?.setNodes("center") ?? editor.tf.setNodes({ align: "center" })}>
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="تراز چپ" onClick={() => tf(editor).textAlign?.setNodes("left") ?? editor.tf.setNodes({ align: "left" })}>
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="تراز توجیه‌شده" onClick={() => tf(editor).textAlign?.setNodes("justify") ?? editor.tf.setNodes({ align: "justify" })}>
          <AlignJustify className="h-4 w-4" />
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        {/* Link (popover) */}
        <div className="relative">
          <ToolbarButton label="افزودن لینک" onClick={() => setLinkOpen((v) => !v)}>
            <LinkIcon className="h-4 w-4" />
          </ToolbarButton>
          {linkOpen && (
            <div className="absolute z-20 top-10 right-0 flex w-64 items-center gap-1.5 rounded-md border bg-popover p-1.5 shadow-md">
              <input
                dir="ltr"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") insertLink();
                  if (e.key === "Escape") setLinkOpen(false);
                }}
                placeholder="https://..."
                aria-label="آدرس لینک"
                className="h-8 w-full rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={insertLink}
                className="h-8 shrink-0 rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ثبت
              </button>
            </div>
          )}
        </div>

        {/* Text color */}
        <div className="relative">
          <ToolbarButton
            label="رنگ متن"
            active={colorOpen}
            onClick={() => setColorOpen((v) => !v)}
          >
            <Palette className="h-4 w-4" />
          </ToolbarButton>
          {colorOpen && (
            <div className="absolute z-20 top-10 right-0 grid grid-cols-6 gap-1 rounded-md border bg-popover p-1.5 shadow-md">
              {["#000000", "#dc2626", "#16a34a", "#2563eb", "#d97706", "#7c3aed", "#db2777", "#eab308"].map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  type="button"
                  aria-label={`رنگ ${c}`}
                  onClick={() => {
                    tf(editor).color?.addMark(c);
                    setColorOpen(false);
                  }}
                  className="h-6 w-6 rounded border border-border hover:scale-110 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                type="button"
                aria-label="حذف رنگ"
                onClick={() => {
                  editor.tf.removeMark("color");
                  setColorOpen(false);
                }}
                className="col-span-6 mt-0.5 h-6 rounded border border-border text-[10px] text-muted-foreground hover:bg-accent"
              >
                حذف رنگ
              </button>
            </div>
          )}
        </div>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <ToolbarButton label="جدول" onClick={() => tf(editor).insert?.table?.({ rowCount: 2, colCount: 2 }) ?? editor.tf.insertNode({ type: "table", children: [] })}>
          <TableIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="افزودن تصویر" disabled={uploading || disabled} onClick={() => fileInputRef.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />

        <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <ToolbarButton label="بازگردانی" onClick={() => editor.tf.undo()}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="ازنو" onClick={() => editor.tf.redo()}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* Editable content */}
      <Plate
        editor={editor}
        onValueChange={({ value }) => {
          const hasContent = Array.isArray(value) && value.length > 0;
          onChange?.(hasContent ? (value as RichDescriptionNode[]) : undefined);
        }}
      >
        <PlateContent
          id={id}
          placeholder={placeholder}
          aria-label="توضیحات محصول"
          className="min-h-[160px] px-3 py-2 text-sm leading-7 focus-visible:outline-none [&_[data-slate-placeholder]]:text-muted-foreground"
          onFocus={() => {
            // Issue 2 — after an external re-render (e.g. a failed submit) the
            // editor's internal selection can be null, which dead-locks
            // Backspace/Delete (deleteBackward/deleteForward no-op without a
            // selection). Re-sync Plate's selection with the DOM on focus.
            if (!editor.selection) editor.tf.focus();
          }}
        />
      </Plate>
    </div>
  );
}
