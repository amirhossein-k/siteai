import { describe, it, expect } from "vitest";
import { buildProductBreadcrumbTrail } from "@/lib/breadcrumbs";
import { breadcrumbSchema } from "@/lib/schemas/json-ld";

/**
 * Session 72 — breadcrumb trail + BreadcrumbList JSON-LD (hermetic).
 *
 * `buildProductBreadcrumbTrail` is the single source for both the visible
 * UI and the structured data, so its shape (no fabricated levels, product
 * = current page with NO url, category URLs from the storefront's real
 * /products?category=<id> convention) is the contract under test.
 */
const BASE = "https://mystore.com";

const cat = (id: string, name: string) => ({ _id: id, name, slug: `slug-${id}`, });

describe("buildProductBreadcrumbTrail", () => {
  it("Home → Category → Product", () => {
    const trail = buildProductBreadcrumbTrail({
      categoryChain: [cat("c1", "الکترونیک")],
      productName: "هدفون بیسیم",
      baseUrl: BASE,
    });
    expect(trail).toEqual([
      { name: "صفحه اصلی", url: BASE },
      { name: "الکترونیک", url: `${BASE}/products?category=c1` },
      { name: "هدفون بیسیم" }, // current page — no url
    ]);
  });

  it("Home → Parent Category → Child Category → Product", () => {
    const trail = buildProductBreadcrumbTrail({
      categoryChain: [
        cat("p1", "پوشاک"),
        cat("c2", "مردانه"),
      ],
      productName: "پیراهن آکسفورد",
      baseUrl: BASE,
    });
    expect(trail.map((t) => t.name)).toEqual([
      "صفحه اصلی",
      "پوشاک",
      "مردانه",
      "پیراهن آکسفورد",
    ]);
    expect(trail[1].url).toBe(`${BASE}/products?category=p1`);
    expect(trail[2].url).toBe(`${BASE}/products?category=c2`);
    expect(trail[3].url).toBeUndefined();
  });

  it("Home → Product when the category is absent (no fabricated levels)", () => {
    const trail = buildProductBreadcrumbTrail({
      categoryChain: [],
      productName: "محصول بدون دسته",
      baseUrl: BASE,
    });
    expect(trail).toEqual([
      { name: "صفحه اصلی", url: BASE },
      { name: "محصول بدون دسته" },
    ]);
  });

  it("Persian category names + Persian product names pass through unchanged", () => {
    const trail = buildProductBreadcrumbTrail({
      categoryChain: [cat("c1", "کالای دیجیتال")],
      productName: "هدفون بیسیم بلوتوثی",
      baseUrl: BASE,
    });
    expect(trail[1].name).toBe("کالای دیجیتال");
    expect(trail[2].name).toBe("هدفون بیسیم بلوتوثی");
    // Category URL is id-based (the real storefront convention) — no
    // transliteration or slug guesswork anywhere.
    expect(trail[1].url).toBe(`${BASE}/products?category=c1`);
  });

  it("Latin legacy product names work unchanged", () => {
    const trail = buildProductBreadcrumbTrail({
      categoryChain: [cat("c1", "Accessories")],
      productName: "Wireless Charger",
      baseUrl: BASE,
    });
    expect(trail[2].name).toBe("Wireless Charger");
    expect(trail[2].url).toBeUndefined();
  });
});

describe("breadcrumbSchema (BreadcrumbList JSON-LD)", () => {
  it("emits sequential 1-based positions and absolute item URLs", () => {
    const schema = breadcrumbSchema([
      { name: "صفحه اصلی", url: BASE },
      { name: "الکترونیک", url: `${BASE}/products?category=c1` },
      { name: "هدفون بیسیم" }, // final — no url
    ]);
    expect(schema["@type"]).toBe("BreadcrumbList");
    expect(schema["@context"]).toBe("https://schema.org");
    const elements = schema.itemListElement as Array<{
      position: number;
      name: string;
      item?: string;
    }>;
    expect(elements.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(elements[0].item).toBe(BASE);
    expect(elements[1].item).toBe(`${BASE}/products?category=c1`);
    // Google: item is optional on the FINAL (current page) element.
    expect(elements[2].item).toBeUndefined();
    expect(elements[2].name).toBe("هدفون بیسیم");
  });

  it("never fabricates a URL for the current page", () => {
    const schema = breadcrumbSchema([
      { name: "صفحه اصلی", url: BASE },
      { name: "محصول بدون دسته" },
    ]);
    const elements = schema.itemListElement as Array<{
      position: number;
      item?: string;
    }>;
    expect(elements).toHaveLength(2);
    expect(elements[1].item).toBeUndefined();
  });

  it("serializes safely through serializeJsonLd (no script breakout)", async () => {
    const { serializeJsonLd } = await import("@/lib/schemas/json-ld");
    const schema = breadcrumbSchema([
      { name: "صفحه اصلی", url: BASE },
      { name: "محصول </script><script>alert(1)</script>", url: `${BASE}/products?category=c1` },
      { name: "قیمت <و> & تست" },
    ]);
    const json = serializeJsonLd(schema);
    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c/script\\u003e");
    // Still valid JSON after escaping.
    expect(JSON.parse(json)).toBeTruthy();
  });
});
