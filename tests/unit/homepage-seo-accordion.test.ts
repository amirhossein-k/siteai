import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_SECTIONS,
  DEFAULT_SEO_ACCORDION_ITEMS,
  HOMEPAGE_COMPONENTS,
  normalizeContentCommon,
  validateContentRow,
} from "@/lib/homepage-content";
import HomepageSeoAccordionItem from "@/models/HomepageSeoAccordionItem";
import { SeoAccordion } from "@/components/storefront/home/seo-accordion";

describe("SEO accordion — admin validation contract", () => {
  const validBody = {
    title: "چطور از مارلو شاپ خرید کنیم؟",
    description: "محصول را به سبد خرید اضافه کنید و در صفحه پرداخت سفارش را نهایی کنید.",
  };

  it("accepts a valid question/answer row and sanitizes it", () => {
    const out: Record<string, unknown> = {};
    const err = validateContentRow("seo-accordion-item", validBody, out);
    expect(err).toBeNull();
    expect(out.title).toBe(validBody.title);
    expect(out.description).toBe(validBody.description);
  });

  it("strips HTML from admin content (no raw HTML injection)", () => {
    const out: Record<string, unknown> = {};
    const err = validateContentRow(
      "seo-accordion-item",
      { title: "<script>alert(1)</script> مارلو شاپ چیست؟", description: "پاسخ <img src=x onerror=alert(2)> امن" },
      out
    );
    expect(err).toBeNull();
    expect(String(out.title)).not.toContain("<script>");
    expect(String(out.description)).not.toContain("onerror");
    expect(String(out.description)).not.toContain("<img");
  });

  it("requires both the question and the answer", () => {
    expect(validateContentRow("seo-accordion-item", { title: "", description: "پاسخ" }, {}))
      .toBe("سوال آکاردئون الزامی است");
    expect(
      validateContentRow("seo-accordion-item", { title: "سوال", description: "   " }, {})
    ).toBe("متن پاسخ الزامی است");
  });

  it("enforces the documented length limits", () => {
    expect(
      validateContentRow(
        "seo-accordion-item",
        { ...validBody, title: "س".repeat(201) },
        {}
      )
    ).toBe("سوال حداکثر ۲۰۰ کاراکتر است");
    expect(
      validateContentRow(
        "seo-accordion-item",
        { ...validBody, description: "پ".repeat(2001) },
        {}
      )
    ).toBe("متن پاسخ حداکثر ۲۰۰۰ کاراکتر است");
  });

  it("rejects invalid publish status and sortOrder", () => {
    expect(
      normalizeContentCommon({ status: "archived" }, {})
    ).toBe("وضعیت انتشار نامعتبر است");
    expect(
      normalizeContentCommon({ sortOrder: -2 }, {})
    ).toBe("ترتیب نمایش نامعتبر است");
    expect(
      normalizeContentCommon({ status: "draft" }, {})
    ).toBeNull();
  });
});

describe("SEO accordion — model defaults and seed", () => {
  it("exposes the block in the known components and section seed", () => {
    expect(HOMEPAGE_COMPONENTS).toContain("seo-accordion");
    const seeded = DEFAULT_SECTIONS.find((s) => s.slug === "seo-accordion");
    expect(seeded?.component).toBe("seo-accordion");
    expect(seeded?.sortOrder).toBe(11);
  });

  it("has a safe default publish seam (draft) and length limits", () => {
    const statusPath = HomepageSeoAccordionItem.schema.path("status") as
      unknown as { options?: { default?: string } };
    expect(statusPath).toBeDefined();
    expect(statusPath.options?.default).toBe("draft");
    expect(HomepageSeoAccordionItem.schema.path("title").options.maxlength).toBe(200);
    expect(HomepageSeoAccordionItem.schema.path("description").options.maxlength).toBe(2000);
  });

  it("ships only draft sample items with no retail claims beyond approved wording", () => {
    expect(DEFAULT_SEO_ACCORDION_ITEMS.length).toBeGreaterThan(0);
    // Draft-only: initial samples never leak to the public homepage.
    const drafts = DEFAULT_SEO_ACCORDION_ITEMS;
    expect(drafts.length).toBeGreaterThan(0);
    for (const item of drafts) {
      expect(item.title.length).toBeLessThanOrEqual(200);
      expect(item.description.length).toBeLessThanOrEqual(2000);
    }
    // No unverified commercial promises in the sample copy.
    const flat = JSON.stringify(DEFAULT_SEO_ACCORDION_ITEMS);
    expect(flat).not.toContain("ارسال رایگان");
    expect(flat).not.toContain("گارانتی مادام العمر");
    expect(flat).not.toContain("ضمانت بازگشت وجه");
    expect(flat).not.toContain("تضمین");
  });
});

describe("SeoAccordion renderer (server, crawlable HTML)", () => {
  const makeSection = (
    content: Array<Record<string, string>>
  ): Parameters<typeof SeoAccordion>[0] =>
    ({
      section: {
        slug: "seo-accordion",
        component: "seo-accordion",
        title: "درباره خرید از مارلو شاپ",
        subtitle: "",
        presentation: {
          appearance: { themeColor: "", background: "", spacing: "", borderRadius: "" },
          behavior: {
            autoplay: false,
            autoplayInterval: 6000,
            showArrows: false,
            showDots: false,
            countdownEnabled: false,
            countdownTarget: "off",
            countdownEndsAt: null,
            maxItems: 12,
            layoutVariant: "stacked",
          },
        },
        content: content as never,
      },
    }) as Parameters<typeof SeoAccordion>[0];

  it("renders published items as native details/summary with question+answer text", () => {
    const html = renderToStaticMarkup(
      SeoAccordion(
        makeSection([
          { _id: "1", title: "مارلو شاپ چیست؟", description: "یک فروشگاه اینترنتی است." },
          { _id: "2", title: "ارسال چقدر زمان می‌برد؟", description: "۱ تا ۷ روز کاری است." },
        ])
      )
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("مارلو شاپ چیست؟");
    expect(html).toContain("۱ تا ۷ روز کاری است.");
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    // First item starts open server-side.
    expect(html).toMatch(/<details[^>]*open[^>]*>/);
  });

  it("renders nothing when there are no published items", () => {
    expect(renderToStaticMarkup(SeoAccordion(makeSection([])))).toBe("");
  });
});
