import { describe, it, expect } from "vitest";
import {
  buildCategoryBreadcrumbTrail,
  buildCategoryItemList,
  buildCategoryMetadata,
  normalizeCategorySlug,
} from "@/lib/category-pages";
import { itemListSchema } from "@/lib/schemas/json-ld";
import { buildCategoryUrl } from "@/lib/category-url";

/**
 * Session 75 — category page builders (hermetic).
 *
 * The DB-backed `getCategoryPage` is not unit-tested here (it connects to
 * MongoDB, same convention as breadcrumbs.ts's DB functions); its pure
 * consumers — the visible breadcrumb trail, the ItemList data, the metadata
 * and the slug normalization — are the contract under test.
 */
const BASE = "https://mystore.com";

const node = (id: string, name: string, slug: string) => ({ _id: id, name, slug });

describe("buildCategoryBreadcrumbTrail", () => {
  it("Home → Category (root category — no fabricated levels)", () => {
    const trail = buildCategoryBreadcrumbTrail({
      ancestorChain: [node("c1", "الکترونیک", "الکترونیک")],
      baseUrl: BASE,
    });
    expect(trail).toEqual([
      { name: "صفحه اصلی", url: BASE },
      { name: "الکترونیک" }, // current page — no url
    ]);
  });

  it("Home → Parent → Child (nested chain, intermediates link to /categories/<slug>)", () => {
    const trail = buildCategoryBreadcrumbTrail({
      ancestorChain: [
        node("p1", "پوشاک", "پوشاک"),
        node("c2", "مردانه", "مردانه"),
      ],
      baseUrl: BASE,
    });
    expect(trail.map((t) => t.name)).toEqual(["صفحه اصلی", "پوشاک", "مردانه"]);
    expect(trail[1].url).toBe(`${BASE}/categories/پوشاک`);
    expect(trail[2].url).toBeUndefined(); // final — no self-link
  });

  it("Persian Unicode category slugs produce readable /categories/<slug> URLs (intermediate items only)", () => {
    const trail = buildCategoryBreadcrumbTrail({
      ancestorChain: [
        node("p1", "کالای دیجیتال", "کالای-دیجیتال"),
        node("c1", "هدفون", "هدفون-بیسیم-بلوتوثی"),
      ],
      baseUrl: BASE,
    });
    expect(trail[1].url).toBe(`${BASE}/categories/کالای-دیجیتال`);
    expect(trail[2].url).toBeUndefined(); // final (current) — no self-link
  });

  it("Latin legacy slugs work unchanged", () => {
    const trail = buildCategoryBreadcrumbTrail({
      ancestorChain: [
        node("p1", "Store", "store"),
        node("c1", "Accessories", "accessories"),
      ],
      baseUrl: BASE,
    });
    expect(trail[1].url).toBe(`${BASE}/categories/store`);
    expect(trail[2].url).toBeUndefined();
  });

  it("the final (current) category never self-links — root category yields Home → Category(no url)", () => {
    const trail = buildCategoryBreadcrumbTrail({
      ancestorChain: [node("c1", "الکترونیک", "الکترونیک")],
      baseUrl: BASE,
    });
    expect(trail).toHaveLength(2);
    expect(trail[0]).toEqual({ name: "صفحه اصلی", url: BASE });
    expect(trail[1]).toEqual({ name: "الکترونیک" });
  });
});

describe("buildCategoryItemList + itemListSchema (ItemList JSON-LD)", () => {
  it("emits only factual position/name/url for first-page products", () => {
    const items = buildCategoryItemList(
      [
        { _id: "p1", name: "هدفون بیسیم", slug: "هدفون-بیسیم" },
        { _id: "p2", name: "کابل شارژ", slug: "کابل-شارژ" },
      ],
      BASE
    );
    expect(items).toEqual([
      { name: "هدفون بیسیم", url: `${BASE}/products/هدفون-بیسیم` },
      { name: "کابل شارژ", url: `${BASE}/products/کابل-شارژ` },
    ]);
  });

  it("itemListSchema produces sequential 1-based positions", () => {
    const schema = itemListSchema([
      { name: "الف", url: `${BASE}/products/a` },
      { name: "ب", url: `${BASE}/products/b` },
    ]);
    expect(schema["@type"]).toBe("ItemList");
    expect(schema["@context"]).toBe("https://schema.org");
    const elements = schema.itemListElement as Array<{
      position: number;
      name: string;
      url: string;
    }>;
    expect(elements.map((e) => e.position)).toEqual([1, 2]);
    expect(elements[0].name).toBe("الف");
    expect(elements[0].url).toBe(`${BASE}/products/a`);
  });

  it("never fabricates price/rating/reviewCount/availability", () => {
    const schema = itemListSchema([
      { name: "محصول", url: `${BASE}/products/x` },
    ]);
    const element = (schema.itemListElement as Record<string, unknown>[])[0];
    expect(element).not.toHaveProperty("price");
    expect(element).not.toHaveProperty("rating");
    expect(element).not.toHaveProperty("reviewCount");
    expect(element).not.toHaveProperty("availability");
    expect(Object.keys(element).sort()).toEqual(["@type", "name", "position", "url"]);
  });

  it("empty product list → empty ItemList (rendered nothing, never a broken schema)", () => {
    expect(buildCategoryItemList([], BASE)).toEqual([]);
    expect(itemListSchema([]).itemListElement).toEqual([]);
  });
});

describe("buildCategoryMetadata", () => {
  const category = {
    _id: "c1",
    name: "هدفون بیسیم",
    slug: "هدفون-بیسیم-بلوتوثی",
    description: "انواع هدفون بیسیم با کیفیت",
    image: "",
    metaTitle: "",
    metaDescription: "",
  };

  it("metaTitle/metaDescription win when present", () => {
    const meta = buildCategoryMetadata(
      {
        ...category,
        metaTitle: "خرید هدفون بیسیم",
        metaDescription: "بهترین هدفونهای بیسیم با ضمانت اصالت",
      },
      BASE
    );
    expect(meta.title).toBe("خرید هدفون بیسیم");
    expect(meta.description).toBe("بهترین هدفونهای بیسیم با ضمانت اصالت");
  });

  it("falls back to name/description naturally (no invented copy)", () => {
    const meta = buildCategoryMetadata(category, BASE);
    expect(meta.title).toBe("هدفون بیسیم");
    expect(meta.description).toBe("انواع هدفون بیسیم با کیفیت");
  });

  it("final fallback is factual and never keyword-stuffed", () => {
    const meta = buildCategoryMetadata(
      { ...category, description: "", metaDescription: "" },
      BASE
    );
    expect(meta.description).toBe("محصولات دسته‌بندی هدفون بیسیم در فروشگاه من");
  });

  it("canonical = /categories/<slug> via APP_URL-style base (single origin)", () => {
    const meta = buildCategoryMetadata(category, BASE);
    expect(meta.alternates.canonical).toBe(`${BASE}/categories/هدفون-بیسیم-بلوتوثی`);
  });

  it("valid active category → index,follow robots", () => {
    const meta = buildCategoryMetadata(category, BASE);
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("OG/Twitter carry title/description/url; image only when allowlisted", () => {
    const withImage = buildCategoryMetadata(
      { ...category, image: "/uploads/cat.png" },
      BASE
    );
    expect(withImage.openGraph.title).toBe("هدفون بیسیم");
    expect(withImage.openGraph.url).toBe(withImage.alternates.canonical);
    expect(withImage.openGraph.images).toEqual([`${BASE}/uploads/cat.png`]);
    expect(withImage.twitter.images).toEqual([`${BASE}/uploads/cat.png`]);

    // Disallowed host / malformed image → NO image anywhere (allowlist intact).
    const badImage = buildCategoryMetadata(
      { ...category, image: "https://evil.example/x.png" },
      BASE
    );
    expect(badImage.openGraph.images).toBeUndefined();
    expect(badImage.twitter.images).toBeUndefined();
  });
});

describe("buildCategoryUrl", () => {
  it("strips trailing slashes from the base and appends /categories/<slug>", () => {
    expect(buildCategoryUrl("https://mystore.com/", "هدفون-بیسیم")).toBe(
      "https://mystore.com/categories/هدفون-بیسیم"
    );
  });
});

describe("normalizeCategorySlug (Next 16 Turbopack param quirk)", () => {
  it("decodes percent-encoded Unicode slugs", () => {
    expect(normalizeCategorySlug("%D9%87%D8%AF%D9%81%D9%88%D9%86")).toBe(
      "هدفون"
    );
  });

  it("is a no-op on already-decoded slugs", () => {
    expect(normalizeCategorySlug("هدفون-بیسیم")).toBe("هدفون-بیسیم");
  });

  it("falls back to the raw value on malformed sequences (→ 404, never 500)", () => {
    expect(normalizeCategorySlug("%E0%A4%A")).toBe("%E0%A4%A");
  });
});
