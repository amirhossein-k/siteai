/**
 * Rich product description — server-side allowlist validation + plain-text projection.
 *
 * The admin/supplier editor (@platejs/plate) produces a Slate JSON tree stored in
 * Product.descriptionRich. This module is the AUTHORITATIVE security gate:
 *
 *   - Only allowlisted node types / marks survive.
 *   - Unknown keys are rejected (no arbitrary attributes, no style-smuggled
 *     event handlers, no contenteditable, etc.).
 *   - Links must be http/https. Images must pass the existing
 *     `isAllowedImageSrc` guard.
 *   - Depth / node-count / serialized-size / per-leaf-length caps prevent
 *     bloat & DoS via malformed JSON.
 *   - `extractPlainText` derives the legacy plain-text `description` (≤2000
 *     chars) so search regex, CSV import/export, JSON-LD and legacy rendering
 *     keep working unchanged.
 *
 * Isomorphic (no Node-only imports) so it can be reused by unit tests.
 */

import { isAllowedImageSrc } from "@/lib/utils";

// ─── Node-type allowlists ────────────────────────────────────────────────
export const RICH_BLOCK_TYPES = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "a",
  "img",
  "table",
  "tr",
  "td",
  "th",
] as const;

export type RichBlockType = (typeof RICH_BLOCK_TYPES)[number];

/** Marks emitted by BasicMarksPlugin + FontColorPlugin/FontBackgroundColorPlugin. */
export const RICH_MARKS = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "highlight",
  "code",
  "color",
  "backgroundColor",
] as const;

export type RichMark = (typeof RICH_MARKS)[number];

/** Allowed text-align values (TextAlignPlugin). */
export const RICH_ALIGNMENTS = ["left", "center", "right", "justify"] as const;

/**
 * Allowed list-style-type values emitted by the Plate ListPlugin (v53 stores
 * list style on block nodes as `listStyleType`, with "ul"/"ol" for the two
 * built-in toggles and CSS values after a style change). Bounded — arbitrary
 * CSS values must never pass through.
 */
export const RICH_LIST_STYLE_TYPES = [
  "ul",
  "ol",
  "disc",
  "circle",
  "square",
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
] as const;

/** Blocks that may carry list props (indent/listStyleType/listStart). */
const RICH_LIST_CAPABLE_BLOCKS = [
  "p",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "li",
  "td",
  "th",
] as const;

// ─── Size / depth caps (DoS guard) ───────────────────────────────────────
export const MAX_RICH_DEPTH = 8;
export const MAX_RICH_NODES = 2000;
export const MAX_RICH_SERIALIZED_BYTES = 64 * 1024; // 64 KB
export const MAX_RICH_LEAF_TEXT = 2000;
export const MAX_PLAIN_DESCRIPTION = 2000;

// ─── Recursive node validation ───────────────────────────────────────────
interface RichTextNode {
  type?: string;
  children?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

export interface RichValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Recursively validate a Slate JSON tree against the allowlist.
 * Returns ok:true only when every node is structurally sound.
 */
export function validateRichDescription(
  value: unknown
): RichValidationResult {
  if (value === undefined || value === null) {
    return { ok: true }; // absent → legacy behavior
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "توضیحات غنی باید آرایه‌ای از گره‌ها باشد" };
  }

  // Serialized-size cap (cheap, before walking).
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_RICH_SERIALIZED_BYTES) {
      return {
        ok: false,
        error: `توضیحات غنی بزرگ‌تر از حد مجاز است (حداکثر ${MAX_RICH_SERIALIZED_BYTES} بایت)`,
      };
    }
  } catch {
    return { ok: false, error: "توضیحات غنی قابل خواندن نیست" };
  }

  let nodeCount = 0;
  const errors: string[] = [];
  const walk = (nodes: unknown[], depth: number): void => {
    if (errors.length > 0) return; // fail fast
    if (depth > MAX_RICH_DEPTH) {
      errors.push(`عمق توضیحات غنی بیش از ${MAX_RICH_DEPTH} سطح است`);
      return;
    }
    for (const raw of nodes) {
      nodeCount += 1;
      if (nodeCount > MAX_RICH_NODES) {
        errors.push(`تعداد گره‌های توضیحات غنی بیش از ${MAX_RICH_NODES} است`);
        return;
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push("گره‌ نامعتبر در توضیحات غنی");
        return;
      }
      const node = raw as RichTextNode;

      // Text leaf: must only carry allowed marks + text.
      if (typeof node.text === "string") {
        if (node.text.length > MAX_RICH_LEAF_TEXT) {
          errors.push(`متن یک گره بیش از ${MAX_RICH_LEAF_TEXT} کاراکتر است`);
          return;
        }
        const allowedLeafKeys = new Set(["text", "id", ...RICH_MARKS]);
        for (const key of Object.keys(node)) {
          if (!allowedLeafKeys.has(key)) {
            errors.push(`ویژگی غیرمجاز «${key}» در متن توضیحات غنی`);
            return;
          }
        }
        // Leaf `id` (Plate node ids) must be a short alphanumeric string.
        if (node.id !== undefined) {
          const idOk =
            typeof node.id === "string" &&
            node.id.length <= 32 &&
            /^[A-Za-z0-9_-]+$/.test(node.id);
          if (!idOk) {
            errors.push(`شناسه گره غیرمجاز در توضیحات غنی`);
            return;
          }
        }
        continue;
      }

      // Element node: must declare a known type + children.
      const type = node.type;
      if (!type || !(RICH_BLOCK_TYPES as readonly string[]).includes(type)) {
        errors.push(`نوع گره غیرمجاز «${type ?? "(بدون نوع)"}» در توضیحات غنی`);
        return;
      }
      if (!Array.isArray(node.children)) {
        errors.push(`گره «${type}» بدون children در توضیحات غنی`);
        return;
      }

      // Per-type allowed props (closed set).
      // NOTE: `id` is emitted by the editor on every node (Plate's stable node
      // ids, e.g. "O2hJtHdg9F") — allowed everywhere but value-bounded below.
      const allowedElementKeys: string[] = ["type", "children", "id"];
      // Session (paste fix) — the @platejs/link HTML deserializer emits
      // `target` on EVERY pasted <a> (element.getAttribute("target") ||
      // "_blank"). The key is allowed, but the VALUE is bounded to "_blank"
      // below — the only value the deserializer can produce.
      if (type === "a") allowedElementKeys.push("url", "target");
      if (type === "img") allowedElementKeys.push("url");
      // Alignment may live on block-level elements (p, headings, blockquote, li, table cells).
      if (
        ["p", "h1", "h2", "h3", "blockquote", "li", "td", "th"].includes(type)
      ) {
        allowedElementKeys.push("align");
      }
      // Plate's ListPlugin (v53) stores the bullet/number style + indentation
      // on block nodes (flat model: p/h1... with listStyleType + indent,
      // instead of nested ul/ol/li wrappers).
      if ((RICH_LIST_CAPABLE_BLOCKS as readonly string[]).includes(type)) {
        allowedElementKeys.push("listStyleType", "indent", "listStart");
      }
      for (const key of Object.keys(node)) {
        if (!allowedElementKeys.includes(key)) {
          errors.push(`ویژگی غیرمجاز «${key}» در گره «${type}»`);
          return;
        }
      }

      // Node `id` (and text-leaf `id`) must be a short alphanumeric string —
      // never a vector for attribute injection.
      if (node.id !== undefined) {
        const idOk =
          typeof node.id === "string" &&
          node.id.length <= 32 &&
          /^[A-Za-z0-9_-]+$/.test(node.id);
        if (!idOk) {
          errors.push(`شناسه گره غیرمجاز در توضیحات غنی`);
          return;
        }
      }

      // listStyleType must be one of the bounded CSS value set.
      if (
        node.listStyleType !== undefined &&
        !(RICH_LIST_STYLE_TYPES as readonly string[]).includes(
          String(node.listStyleType)
        )
      ) {
        errors.push(`نوع لیست غیرمجاز «${String(node.listStyleType)}»`);
        return;
      }

      // indent must be a small non-negative integer (nesting depth).
      if (node.indent !== undefined) {
        if (
          typeof node.indent !== "number" ||
          !Number.isInteger(node.indent) ||
          node.indent < 0 ||
          node.indent > 10
        ) {
          errors.push(`سطح تورفتگی غیرمجاز در توضیحات غنی`);
          return;
        }
      }

      // listStart must be a positive integer (ol restart value).
      if (node.listStart !== undefined) {
        if (
          typeof node.listStart !== "number" ||
          !Number.isInteger(node.listStart) ||
          node.listStart < 1 ||
          node.listStart > 99999
        ) {
          errors.push(`شروع لیست غیرمجاز در توضیحات غنی`);
          return;
        }
      }

      // Link URL: http/https only; `target` (paste deserializer key) only the
      // exact "_blank" value — anything else (frame targets, style-smuggled
      // values, empty) is rejected. The closed-set renderer never reads the
      // stored target: it hardcodes target/_blank + rel noopener itself.
      if (type === "a") {
        const url = node.url;
        if (typeof url !== "string" || !/^https?:\/\/.+/.test(url)) {
          errors.push("لینک در توضیحات غنی فقط می‌تواند http/https باشد");
          return;
        }
        if (node.target !== undefined && node.target !== "_blank") {
          errors.push("ویژگی target در لینک فقط می‌تواند _blank باشد");
          return;
        }
      }

      // Image URL: must pass the existing image-source guard.
      if (type === "img") {
        const url = node.url;
        if (typeof url !== "string" || !isAllowedImageSrc(url)) {
          errors.push("منبع تصویر در توضیحات غنی مجاز نیست");
          return;
        }
      }

      // Alignment value must be one of the allowlist.
      if (node.align !== undefined && !(RICH_ALIGNMENTS as readonly string[]).includes(String(node.align))) {
        errors.push(`مقدار تراز غیرمجاز «${String(node.align)}»`);
        return;
      }

      // Table structure sanity: tr only inside table, td/th only inside tr.
      if (type === "table") {
        const bad = node.children.some(
          (c) =>
            c &&
            typeof c === "object" &&
            !Array.isArray(c) &&
            (c as RichTextNode).type !== "tr"
        );
        if (bad) {
          errors.push("گره‌های جدول فقط می‌توانند ردیف (tr) باشند");
          return;
        }
      }
      if (type === "tr") {
        const bad = node.children.some(
          (c) =>
            c &&
            typeof c === "object" &&
            !Array.isArray(c) &&
            (c as RichTextNode).type !== "td" &&
            (c as RichTextNode).type !== "th"
        );
        if (bad) {
          errors.push("گره‌های ردیف جدول فقط می‌توانند سلول (td/th) باشند");
          return;
        }
      }


      walk(node.children as unknown[], depth + 1);
    }
  };

  walk(value, 1);
  if (errors.length > 0) return { ok: false, error: errors[0] };
  return { ok: true };
}

// ─── Plain-text projection ───────────────────────────────────────────────
/**
 * Extract plain text from a validated rich tree (headings/lists/links/blocks
 * all contribute their text; hr/img contribute nothing). Used to derive the
 * legacy `description` field (≤2000 chars) for search/CSV/JSON-LD.
 */
export function extractPlainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const raw of nodes) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }
      const node = raw as RichTextNode;
      if (typeof node.text === "string") {
        parts.push(node.text);
        continue;
      }
      if (Array.isArray(node.children)) {
        walk(node.children as unknown[]);
      }
      // Block-level separators: join blocks with a space so the plain-text
      // projection reads naturally (headings/lists/blockquotes separated).
      if (
        typeof node.type === "string" &&
        ["p", "h1", "h2", "h3", "li", "blockquote"].includes(node.type)
      ) {
        parts.push("\n");
      }
    }
  };
  walk(value);

  // Collapse triple+ newlines (block separators + joins) into double.
  const text = parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.slice(0, MAX_PLAIN_DESCRIPTION);
}

/**
 * Full save-path helper used by the admin & supplier product routes:
 * validates `descriptionRich`, derives the plain-text projection, and returns
 * the normalized pair. Returns `{ ok: false, error }` (→ 400) when invalid.
 */
export function prepareRichDescription(
  body: { description?: unknown; descriptionRich?: unknown }
): {
  ok: boolean;
  error?: string;
  description?: string;
  descriptionRich?: unknown;
} {
  const hasRich =
    body.descriptionRich !== undefined && body.descriptionRich !== null;

  if (!hasRich) {
    // Legacy path — plain text only (existing behavior preserved).
    return { ok: true };
  }

  const validation = validateRichDescription(body.descriptionRich);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return {
    ok: true,
    description: extractPlainText(body.descriptionRich),
    descriptionRich: body.descriptionRich,
  };
}
