import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  extractPlainText,
  MAX_RICH_DEPTH,
  MAX_RICH_NODES,
  MAX_PLAIN_DESCRIPTION,
  prepareRichDescription,
  validateRichDescription,
} from "@/lib/product-description";
import { ProductDescription } from "@/components/storefront/product-description";
import type { RichDescriptionNode } from "@/types";

// ============================================================
// validateRichDescription — allowlist validation
// ============================================================

describe("validateRichDescription", () => {
  it("accepts a valid tree (paragraphs, headings, marks, lists, links)", () => {
    const value: RichDescriptionNode[] = [
      { type: "h2", children: [{ text: "ویژگی‌ها" }] },
      {
        type: "p",
        children: [
          { text: "متن " },
          { text: "بولد", bold: true },
          { text: " و " },
          { text: "ایتالیک", italic: true },
        ],
      },
      {
        type: "ul",
        children: [
          { type: "li", children: [{ text: "آیتم اول" }] },
          { type: "li", children: [{ text: "آیتم دوم" }] },
        ],
      },
      {
        type: "a",
        url: "https://example.com",
        children: [{ text: "لینک" }],
      },
      { type: "hr", children: [{ text: "" }] },
    ];
    expect(validateRichDescription(value)).toEqual({ ok: true });
  });

  it("accepts null/undefined as legacy (no rich content)", () => {
    expect(validateRichDescription(undefined)).toEqual({ ok: true });
    expect(validateRichDescription(null)).toEqual({ ok: true });
  });

  it("rejects non-array input", () => {
    expect(validateRichDescription({})).toMatchObject({ ok: false });
    expect(validateRichDescription("text")).toMatchObject({ ok: false });
    expect(validateRichDescription(42)).toMatchObject({ ok: false });
  });

  it("accepts Plate node ids (short alphanumeric) and rejects hostile ids", () => {
    const ok = [
      {
        type: "p",
        id: "O2hJtHdg9F",
        children: [{ text: "x", id: "AbC1" }],
      },
    ];
    expect(validateRichDescription(ok)).toEqual({ ok: true });

    for (const badId of [
      '" onmouseover="alert(1)',
      "x".repeat(40),
      "a b c",
      "a<b>",
      42,
      null,
    ]) {
      expect(
        validateRichDescription([
          { type: "p", id: badId, children: [{ text: "x" }] },
        ]),
        `id=${String(badId)}`
      ).toMatchObject({ ok: false });
    }
  });

  it("rejects unknown node types", () => {
    const value = [{ type: "script", children: [{ text: "alert(1)" }] }];
    expect(validateRichDescription(value)).toMatchObject({ ok: false });
    const value2 = [{ type: "iframe", children: [{ text: "" }] }];
    expect(validateRichDescription(value2)).toMatchObject({ ok: false });
  });

  it("rejects element nodes without children", () => {
    expect(
      validateRichDescription([{ type: "p" }])
    ).toMatchObject({ ok: false });
  });

  it("rejects unknown / arbitrary properties on nodes (style, class, onclick)", () => {
    const value = [
      {
        type: "p",
        children: [{ text: "x" }],
        // Hostile payload: style smuggling is exactly what must fail. The
        // node is intentionally NOT typed as RichDescriptionNode — the
        // validator receives `unknown` and must reject it at runtime.
        style: "color:red;position:fixed",
      },
    ];
    expect(validateRichDescription(value)).toMatchObject({ ok: false });

    const value2 = [
      {
        type: "p",
        children: [{ text: "x" }],
        className: "evil",
      },
    ];
    expect(validateRichDescription(value2)).toMatchObject({ ok: false });

    const value3 = [
      {
        type: "p",
        children: [{ text: "x" }],
        onclick: "alert(1)",
      },
    ];
    expect(validateRichDescription(value3)).toMatchObject({ ok: false });
  });

  it("rejects unknown properties on text leaves (event handlers, html)", () => {
    const value = [
      {
        type: "p",
        children: [
          { text: "x", bold: true, italic: true },
          { text: "y", contenteditable: "true" },
        ],
      },
    ];
    expect(validateRichDescription(value)).toMatchObject({ ok: false });
  });

  it("accepts only allowlisted marks on leaves and rejects arbitrary mark keys", () => {
    const ok = [
      {
        type: "p",
        children: [
          {
            text: "x",
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
            highlight: true,
            code: true,
            color: "#ff0000",
            backgroundColor: "#ffff00",
          },
        ],
      },
    ];
    expect(validateRichDescription(ok)).toEqual({ ok: true });

    const bad = [
      {
        type: "p",
        children: [{ text: "x", fontWeight: "900" }],
      },
    ];
    expect(validateRichDescription(bad)).toMatchObject({ ok: false });
  });

  // ─── Links ────────────────────────────────────────────────────────────
  it("accepts http/https links only", () => {
    expect(
      validateRichDescription([
        { type: "a", url: "http://example.com", children: [{ text: "l" }] },
      ])
    ).toEqual({ ok: true });
    expect(
      validateRichDescription([
        { type: "a", url: "https://example.com/x?y=1", children: [{ text: "l" }] },
      ])
    ).toEqual({ ok: true });
  });

  it("rejects javascript:, data:, mailto:, protocol-relative and malformed links", () => {
    for (const url of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:evil@example.com",
      "//evil.example.com/x",
      "ftp://example.com/x",
      "not a url",
      "",
      "https://",
      42,
      undefined,
    ]) {
      expect(
        validateRichDescription([
          { type: "a", url, children: [{ text: "l" }] },
        ]),
        `url=${String(url)}`
      ).toMatchObject({ ok: false });
    }
  });

  // ─── Images ───────────────────────────────────────────────────────────
  it("accepts same-origin and allowed-host images", () => {
    expect(
      validateRichDescription([
        {
          type: "img",
          url: "/uploads/products/pic.jpg",
          children: [{ text: "" }],
        },
      ])
    ).toEqual({ ok: true });
  });

  it("rejects unsafe / disallowed image sources", () => {
    for (const url of [
      "data:image/png;base64,AAAA",
      "https://evil.example.com/x.png",
      "javascript:alert(1)",
      "blob:https://evil.example.com/x",
      "",
      42,
      undefined,
    ]) {
      expect(
        validateRichDescription([
          { type: "img", url, children: [{ text: "" }] },
        ]),
        `url=${String(url)}`
      ).toMatchObject({ ok: false });
    }
  });

  // ─── Alignment ────────────────────────────────────────────────────────
  it("accepts allowlisted alignment values and rejects others", () => {
    for (const align of ["left", "center", "right", "justify"]) {
      expect(
        validateRichDescription([
          { type: "p", align, children: [{ text: "x" }] },
        ]),
        `align=${align}`
      ).toEqual({ ok: true });
    }
    expect(
      validateRichDescription([
        { type: "p", align: "start", children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateRichDescription([
        { type: "p", align: "position:fixed", children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
  });

  // ─── Lists (Plate emits listStyleType on li) ─────────────────────────
  it("accepts Plate v53 flat lists (block + listStyleType + indent)", () => {
    // The v53 ListPlugin emits list items as flat blocks carrying
    // listStyleType/indent (no ul/ol/li wrapper nodes).
    const ok = [
      { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "آیتم اول" }] },
      { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "آیتم دوم" }] },
      { type: "p", listStyleType: "ol", indent: 1, listStart: 3, children: [{ text: "مرحله" }] },
    ];
    expect(validateRichDescription(ok)).toEqual({ ok: true });

    // Nested depth is allowed within the bounded range.
    const nested = [
      { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "سطح ۱" }] },
      { type: "p", listStyleType: "ul", indent: 2, children: [{ text: "سطح ۲" }] },
    ];
    expect(validateRichDescription(nested)).toEqual({ ok: true });

    // Classic nested model (ul/ol > li) still passes.
    const classic = [
      {
        type: "ul",
        children: [
          {
            type: "li",
            listStyleType: "disc",
            children: [{ text: "آیتم" }],
          },
        ],
      },
    ];
    expect(validateRichDescription(classic)).toEqual({ ok: true });
  });

  it("rejects arbitrary / unbounded listStyleType values", () => {
    expect(
      validateRichDescription([
        {
          type: "ul",
          children: [
            {
              type: "li",
              listStyleType: "position:fixed;background:url(javascript:alert(1))",
              children: [{ text: "آیتم" }],
            },
          ],
        },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "x" }] },
      ])
    ).toEqual({ ok: true });
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "url(javascript:alert(1))", indent: 1, children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
  });

  it("rejects unbounded indent / listStart values", () => {
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "ul", indent: 11, children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "ul", indent: -1, children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "ol", indent: 1, listStart: 0, children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "ol", indent: 1, listStart: 1.5, children: [{ text: "x" }] },
      ])
    ).toMatchObject({ ok: false });
    expect(
      validateRichDescription([
        { type: "p", listStyleType: "ul", indent: 1, listStart: 2, children: [{ text: "x" }] },
      ])
    ).toEqual({ ok: true });
  });

  // ─── Tables ───────────────────────────────────────────────────────────
  it("accepts a well-formed table and rejects bad table structure", () => {
    const ok: RichDescriptionNode[] = [
      {
        type: "table",
        children: [
          {
            type: "tr",
            children: [
              {
                type: "td",
                children: [{ type: "p", children: [{ text: "سلول" }] }],
              },
            ],
          },
        ],
      },
    ];
    expect(validateRichDescription(ok)).toEqual({ ok: true });

    expect(
      validateRichDescription([
        {
          type: "table",
          children: [{ type: "p", children: [{ text: "x" }] }],
        },
      ])
    ).toMatchObject({ ok: false });

    expect(
      validateRichDescription([
        {
          type: "tr",
          children: [{ type: "p", children: [{ text: "x" }] }],
        },
      ])
    ).toMatchObject({ ok: false });

    // Table cells now accept ANY allowlisted block type (not just p).
    // `li` is a valid block — the cell-level restriction was removed
    // because Plate v53 may produce other block types or bare text
    // inside cells during normal editing (the nested allowlist + property
    // checks still provide full security).
    expect(
      validateRichDescription([
        {
          type: "td",
          children: [{ type: "li", children: [{ text: "x" }] }],
        },
      ])
    ).toEqual({ ok: true });

    // Bare text node inside a table cell is also accepted (the normalizer
    // wraps it, but edge cases may produce it before the normalizer runs).
    expect(
      validateRichDescription([
        {
          type: "td",
          children: [{ text: "متن خام در سلول" }],
        },
      ])
    ).toEqual({ ok: true });

    // Non-allowlisted block types are still rejected (security).
    expect(
      validateRichDescription([
        {
          type: "td",
          children: [{ type: "div", children: [{ text: "x" }] }],
        },
      ])
    ).toMatchObject({ ok: false });

    // Unknown properties on nodes inside cells are still rejected.
    expect(
      validateRichDescription([
        {
          type: "td",
          children: [
            {
              type: "p",
              children: [{ text: "x" }],
              style: "color:red",
            },
          ],
        },
      ])
    ).toMatchObject({ ok: false });
  });

  // ─── Limits / DoS guards ──────────────────────────────────────────────
  it("rejects trees deeper than the depth cap", () => {
    const deep = (depth: number): RichDescriptionNode => ({
      type: "p",
      children:
        depth > 0 ? [deep(depth - 1)] : [{ text: "x" }],
    });
    const value = [deep(MAX_RICH_DEPTH + 1)];
    expect(validateRichDescription(value)).toMatchObject({ ok: false });
  });

  it("rejects trees with more nodes than the node cap", () => {
    const value: RichDescriptionNode[] = Array.from(
      { length: MAX_RICH_NODES + 1 },
      () => ({ type: "p", children: [{ text: "x" }] })
    );
    expect(validateRichDescription(value)).toMatchObject({ ok: false });
  });

  it("rejects oversized serialized payloads", () => {
    const huge = { text: "x".repeat(70 * 1024) };
    const value = [{ type: "p", children: [huge] }];
    expect(validateRichDescription(value)).toMatchObject({ ok: false });
  });

  it("rejects leaf text longer than the per-leaf cap", () => {
    const value = [
      { type: "p", children: [{ text: "x".repeat(2001) }] },
    ];
    expect(validateRichDescription(value)).toMatchObject({ ok: false });
  });

  it("rejects primitive / array garbage nodes", () => {
    expect(
      validateRichDescription([{ type: "p", children: ["plain", 42] }])
    ).toMatchObject({ ok: false });
  });
});

// ============================================================
// extractPlainText — derived plain-text projection
// ============================================================

describe("extractPlainText", () => {
  it("joins text from paragraphs, headings, lists and links", () => {
    const value: RichDescriptionNode[] = [
      { type: "h2", children: [{ text: "عنوان" }] },
      { type: "p", children: [{ text: "متن اول " }, { text: "ادامه" }] },
      {
        type: "ul",
        children: [
          { type: "li", children: [{ text: "آیتم ۱" }] },
          { type: "li", children: [{ text: "آیتم ۲" }] },
        ],
      },
      {
        type: "a",
        url: "https://example.com",
        children: [{ text: "لینک" }],
      },
    ];
    const text = extractPlainText(value);
    expect(text).toContain("عنوان");
    expect(text).toContain("متن اول ادامه");
    expect(text).toContain("آیتم ۱");
    expect(text).toContain("لینک");
  });

  it("hr and img contribute no text", () => {
    const value: RichDescriptionNode[] = [
      { type: "hr", children: [{ text: "" }] },
      { type: "img", url: "/x.jpg", children: [{ text: "" }] },
      { type: "p", children: [{ text: "فقط این" }] },
    ];
    expect(extractPlainText(value)).toBe("فقط این");
  });

  it("returns empty string for non-array / empty input", () => {
    expect(extractPlainText(undefined)).toBe("");
    expect(extractPlainText([])).toBe("");
    expect(extractPlainText({})).toBe("");
  });

  it("caps the projection at the legacy 2000-char description limit", () => {
    const value: RichDescriptionNode[] = [
      { type: "p", children: [{ text: "x".repeat(3000) }] },
    ];
    const text = extractPlainText(value);
    expect(text).toHaveLength(MAX_PLAIN_DESCRIPTION);
    expect(text).toBe("x".repeat(2000));
  });
});

// ============================================================
// prepareRichDescription — save-path normalization
// ============================================================

describe("prepareRichDescription", () => {
  it("legacy path: no descriptionRich → unchanged, ok", () => {
    const result = prepareRichDescription({ description: "متن قدیمی" });
    expect(result).toEqual({ ok: true });
    expect(result.description).toBeUndefined();
  });

  it("rich path: validates, derives plain text, keeps the rich tree", () => {
    const rich: RichDescriptionNode[] = [
      { type: "h3", children: [{ text: "جزئیات محصول" }] },
      { type: "p", children: [{ text: "توضیح کامل" }] },
    ];
    const result = prepareRichDescription({
      description: "متن کهنه",
      descriptionRich: rich,
    });
    expect(result.ok).toBe(true);
    expect(result.description).toBe("جزئیات محصول\nتوضیح کامل");
    expect(result.descriptionRich).toBe(rich);
  });

  it("invalid rich content → { ok:false } with a Persian error", () => {
    const result = prepareRichDescription({
      description: "x",
      descriptionRich: [
        { type: "script", children: [{ text: "alert(1)" }] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ============================================================
// ProductDescription — closed-set renderer (react-dom/server)
// ============================================================

describe("ProductDescription renderer", () => {
  const render = (value: RichDescriptionNode[]) =>
    renderToStaticMarkup(React.createElement(ProductDescription, { value }));

  it("renders headings, paragraphs, lists, blockquote and hr", () => {
    const html = render([
      { type: "h2", children: [{ text: "عنوان" }] },
      { type: "p", children: [{ text: "پاراگراف" }] },
      {
        type: "ul",
        children: [{ type: "li", children: [{ text: "آیتم" }] }],
      },
      { type: "blockquote", children: [{ text: "نقل قول" }] },
      { type: "hr", children: [{ text: "" }] },
    ]);
    expect(html).toContain("<h2");
    expect(html).toContain("عنوان");
    expect(html).toContain("<p");
    expect(html).toContain("پاراگراف");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li");
    expect(html).toContain("آیتم");
    expect(html).toContain("<blockquote");
    expect(html).toContain("نقل قول");
    expect(html).toContain("<hr");
  });

  it("renders marks (bold/italic/underline/strikethrough/highlight/code)", () => {
    const html = render([
      {
        type: "p",
        children: [
          { text: "b", bold: true },
          { text: "i", italic: true },
          { text: "u", underline: true },
          { text: "s", strikethrough: true },
          { text: "h", highlight: true },
          { text: "c", code: true },
        ],
      },
    ]);
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<u>u</u>");
    expect(html).toContain("<s>s</s>");
    expect(html).toContain("<mark");
    expect(html).toContain("<code");
  });

  it("renders links with http/https and safe attributes", () => {
    const html = render([
      {
        type: "a",
        url: "https://example.com/fa",
        children: [{ text: "سایت" }],
      },
    ]);
    expect(html).toContain(
      '<a href="https://example.com/fa"'
    );
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("NEVER renders unsafe links as anchors (inert text instead)", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "//evil.com"]) {
      const html = render([
        { type: "a", url, children: [{ text: "متن لینک" }] },
      ]);
      expect(html).not.toContain("<a");
      expect(html).toContain("متن لینک");
    }
  });

  it("renders safe images and drops unsafe images entirely", () => {
    const safe = render([
      { type: "img", url: "/uploads/x.jpg", children: [{ text: "" }] },
    ]);
    expect(safe).toContain("<img");
    expect(safe).toContain("src=\"/uploads/x.jpg\"");

    const unsafe = render([
      { type: "img", url: "data:image/png;base64,AAAA", children: [{ text: "" }] },
    ]);
    expect(unsafe).not.toContain("<img");
  });

  it("renders tables (table/tr/td/th)", () => {
    const html = render([
      {
        type: "table",
        children: [
          {
            type: "tr",
            children: [
              {
                type: "th",
                children: [{ type: "p", children: [{ text: "سر" }] }],
              },
              {
                type: "td",
                children: [{ type: "p", children: [{ text: "بدن" }] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain("<table");
    expect(html).toContain("<tr>");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("سر");
    expect(html).toContain("بدن");
  });

  it("renders alignment classes", () => {
    const html = render([
      { type: "p", align: "center", children: [{ text: "وسط" }] },
    ]);
    expect(html).toContain('class="text-center"');
  });

  it("groups Plate flat lists (block + listStyleType) into ul/ol", () => {
    // v53 emits list items as flat blocks — the renderer must synthesize
    // the ul/ol wrappers (and never render the raw flat blocks).
    const html = render([
      { type: "p", children: [{ text: "قبل" }] },
      { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "آیتم اول" }] },
      { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "آیتم دوم" }] },
      { type: "p", listStyleType: "ol", indent: 1, listStart: 3, children: [{ text: "مرحله" }] },
      { type: "p", children: [{ text: "بعد" }] },
    ]);
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("آیتم اول");
    expect(html).toContain("آیتم دوم");
    expect(html).toContain("<ol");
    expect(html).toContain('start="3"');
    expect(html).toContain("مرحله");
    // The flat blocks must NOT leak their internal list props into <p> tags.
    expect(html).not.toContain("listStyleType");
    expect(html).not.toContain("indent");
  });

  it("renders nested flat-list depths with indentation", () => {
    const html = render([
      { type: "p", listStyleType: "ul", indent: 1, children: [{ text: "سطح ۱" }] },
      { type: "p", listStyleType: "ul", indent: 2, children: [{ text: "سطح ۲" }] },
    ]);
    expect(html).toContain("سطح ۱");
    expect(html).toContain("سطح ۲");
  });

  it("ESCAPES hostile text content — never raw HTML", () => {
    const html = render([
      { type: "p", children: [{ text: "<script>alert(1)</script>" }] },
      {
        type: "p",
        children: [
          { text: "x" },
          {
            // Hostile mark VALUE (the key itself is allowlisted; the value
            // must be escaped by React, never injected as an attribute).
            color: '" onmouseover="alert(1)',
          },
        ],
      },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("unknown node types render as inert text (no raw HTML)", () => {
    const html = render([
      { type: "iframe", children: [{ text: "تهی" }] },
      { type: "p", children: [{ text: "بعدش" }] },
    ]);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("تهی");
    expect(html).toContain("بعدش");
  });

  it("renders nothing for empty / missing value", () => {
    expect(render([])).toBe("");
    expect(
      renderToStaticMarkup(React.createElement(ProductDescription, { value: [] }))
    ).toBe("");
  });
});
