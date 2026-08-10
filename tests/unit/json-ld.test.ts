import { describe, expect, it } from "vitest";
import { productSchema, serializeJsonLd } from "@/lib/schemas/json-ld";

describe("serializeJsonLd", () => {
  it("escapes < > & and U+2028/U+2029 so hostile data cannot break out of the <script> tag", () => {
    // JSON.stringify alone would emit raw `</script>` — the HTML parser would
    // close the script element early (markup injection / broken JSON-LD).
    const out = serializeJsonLd({
      name: "</script><script>alert(1)</script>",
      x: "a<b&c>d\u2028\u2029",
    });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script\\u003e");
    expect(out).toContain("a\\u003cb\\u0026c\\u003ed");
    expect(out).toContain("\\u2028\\u2029");
  });

  it("emits still-valid JSON that parses back to the original data", () => {
    const out = serializeJsonLd({
      "@type": "Product",
      name: "هدفون X200",
      url: "https://example.com/products/هدفون-x200",
      offer: "<b>bold</b>",
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Product");
    expect(parsed.name).toBe("هدفون X200");
    expect(parsed.offer).toBe("<b>bold</b>");
  });

  it("keeps Persian text intact", () => {
    const out = serializeJsonLd({ name: "هدفون بی‌سیم بلوتوثی" });
    expect(JSON.parse(out)).toEqual({ name: "هدفون بی‌سیم بلوتوثی" });
  });
});

describe("productSchema", () => {
  const baseOffers = {
    price: 850000,
    priceCurrency: "IRR",
    availability: "InStock" as const,
  };

  it("emits @type Product with name/description/url/offers", () => {
    const schema = productSchema({
      name: "هدفون X200",
      description: "توضیح کوتاه",
      url: "https://example.com/products/هدفون-x200",
      offers: baseOffers,
    });
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("Product");
    expect(schema.name).toBe("هدفون X200");
    expect(schema.description).toBe("توضیح کوتاه");
    expect(schema.url).toBe("https://example.com/products/هدفون-x200");
    const offers = schema.offers as Record<string, unknown>;
    expect(offers.price).toBe(850000);
    expect(offers.priceCurrency).toBe("IRR");
    expect(offers.availability).toBe("https://schema.org/InStock");
  });

  it("omits image/sku/brand when absent — never invents values", () => {
    const schema = productSchema({
      name: "x",
      description: "d",
      offers: baseOffers,
    });
    expect(schema.image).toBeUndefined();
    expect(schema.sku).toBeUndefined();
    expect(schema.brand).toBeUndefined();
  });

  it("adds aggregateRating ONLY when real data is provided", () => {
    const withRating = productSchema({
      name: "x",
      description: "d",
      offers: baseOffers,
      aggregateRating: { ratingValue: 4.5, reviewCount: 12 },
    });
    expect(withRating.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 12,
    });

    const withoutRating = productSchema({
      name: "x",
      description: "d",
      offers: baseOffers,
    });
    expect(withoutRating.aggregateRating).toBeUndefined();
  });

  it("includes image/brand/sku when present", () => {
    const schema = productSchema({
      name: "x",
      description: "d",
      image: ["https://example.com/a.jpg"],
      sku: "SKU-1",
      brand: "نشان تجاری",
      offers: baseOffers,
    });
    expect(schema.image).toEqual(["https://example.com/a.jpg"]);
    expect(schema.sku).toBe("SKU-1");
    expect(schema.brand).toEqual({ "@type": "Brand", name: "نشان تجاری" });
  });
});
