import { afterEach, describe, expect, it } from "vitest";
import {
  cn,
  formatDate,
  formatPrice,
  getBaseUrl,
  isAllowedImageSrc,
  relationId,
  slugify,
  truncate,
} from "@/lib/utils";

describe("cn", () => {
  it("merges classes and resolves conflicts via tailwind-merge", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles conditional and falsy inputs", () => {
    expect(cn("base", false && "hidden", null, undefined, 0 && "x")).toBe(
      "base"
    );
    expect(cn("base", true && "active")).toBe("base active");
  });
});

describe("formatPrice", () => {
  it("formats with Persian digits and the تومان suffix", () => {
    expect(formatPrice(0)).toBe("۰ تومان");
    expect(formatPrice(1000000)).toBe("۱٬۰۰۰٬۰۰۰ تومان");
    expect(formatPrice(123456)).toBe("۱۲۳٬۴۵۶ تومان");
  });
});

describe("formatDate", () => {
  it("formats a Date as a Persian (Jalali) long date", () => {
    // Jan 15, 2025 (Gregorian) is 26 Dey 1403 in the Jalali calendar.
    const out = formatDate(new Date(2025, 0, 15));
    expect(out).toContain("۱۴۰۳");
    expect(out).toContain("دی");
    expect(out).toContain("۲۶");
  });

  it("formats in English when requested", () => {
    expect(formatDate(new Date(2025, 0, 15), "en")).toBe("January 15, 2025");
  });
});

describe("slugify", () => {
  // The product slug validation contract — the single source of truth is
  // src/lib/product-slug.ts SLUG_PATTERN (validations/product.ts and
  // product-csv.ts import it). Session 70 made it Unicode-aware so Persian
  // product names keep their own script in the URL.
  const SLUG_CONTRACT = /^[a-z0-9\u0600-\u06FF]+(?:-[a-z0-9\u0600-\u06FF]+)*$/;

  it("lowercases and dashes internal whitespace", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips leading/trailing dashes so the result is always valid", () => {
    // "  Hello   World  " used to produce "-hello-world-", which the
    // validation contract rejects (leading/trailing dashes).
    expect(slugify("  Hello   World  ")).toBe("hello-world");
    expect(SLUG_CONTRACT.test(slugify("  Hello   World  "))).toBe(true);
  });

  it("removes non-word characters", () => {
    expect(slugify("Multiple   spaces & special # chars")).toBe(
      "multiple-spaces-special-chars"
    );
    expect(slugify("Café!")).toBe("caf");
  });

  it("collapses repeated dashes", () => {
    expect(slugify("A--B")).toBe("a-b");
  });

  it("maps underscores to dashes (underscores violate the slug contract)", () => {
    expect(slugify("foo_bar_baz")).toBe("foo-bar-baz");
    expect(SLUG_CONTRACT.test(slugify("foo_bar_baz"))).toBe(true);
  });

  it("handles empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("returns empty for whitespace/punctuation-only input (the form's min(1) then surfaces «اسلاگ الزامی است»)", () => {
    expect(slugify(" ")).toBe("");
    expect(slugify("---")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("keeps Persian product names readable — «هدفون بیسیم بلوتوثی» → «هدفون-بیسیم-بلوتوثی»", () => {
    // Session 70 — SEO-first: Persian keeps its own script in the slug
    // (originally every Persian char was stripped → "-" → the dead-click
    // bug; the first fix fell back to a p-<hash>, which the SEO audit
    // replaced with the readable Unicode slug).
    expect(slugify("هدفون بیسیم بلوتوثی")).toBe("هدفون-بیسیم-بلوتوثی");
    expect(SLUG_CONTRACT.test(slugify("هدفون بیسیم بلوتوثی"))).toBe(true);
    // Deterministic — same input, same slug, no timestamps/randomness.
    expect(slugify("هدفون بیسیم بلوتوثی")).toBe(slugify("هدفون بیسیم بلوتوثی"));
  });

  it("preserves the Latin/numeric portion of mixed names — «مایکروویو X200» → «مایکروویو-x200»", () => {
    expect(slugify("مایکروویو X200")).toBe("مایکروویو-x200");
    expect(SLUG_CONTRACT.test(slugify("مایکروویو X200"))).toBe(true);
    expect(slugify("کولر گازی 24000 BTU")).toBe("کولر-گازی-24000-btu");
    expect(SLUG_CONTRACT.test(slugify("کولر گازی 24000 BTU"))).toBe(true);
  });

  it("normalizes Arabic ي/ك to Persian ی/ک — «يخچال كلاسيك» → «یخچال-کلاسیک»", () => {
    // Arabic ye (U+064A) → Persian ye (U+06CC), Arabic kaf (U+0643) → Persian
    // kaf (U+06A9): normalized names produce consistent, readable slugs.
    expect(slugify("يخچال كلاسيك")).toBe("یخچال-کلاسیک");
    expect(slugify("يخچال كلاسيك")).toBe(slugify("یخچال کلاسیک"));
  });

  it("removes Arabic/Persian diacritics", () => {
    // Fatha (U+064E) on «ب» and tashdid (U+0651) on «ق» — both INSIDE the
    // U+0600–U+06FF block, so they must be stripped BEFORE the alphabet
    // filter or they would leak into the slug.
    expect(slugify("بَرق قویّ")).toBe("برق-قوی");
    expect(SLUG_CONTRACT.test(slugify("بَرق قویّ"))).toBe(true);
  });

  it("treats ZWNJ (نیمفاصله U+200C) as a word separator", () => {
    expect(slugify("بی\u200Cسیم")).toBe("بی-سیم");
    expect(SLUG_CONTRACT.test(slugify("بی\u200Cسیم"))).toBe(true);
  });

  it("normalizes Persian/Arabic digits to Latin digits", () => {
    expect(slugify("هدفون ۲۴۰۰۰")).toBe("هدفون-24000");
    expect(slugify("کولر ٠١٢")).toBe("کولر-012");
    expect(SLUG_CONTRACT.test(slugify("هدفون ۲۴۰۰۰"))).toBe(true);
  });

  it("strips punctuation and symbols — «قیمت: ۸۵۰,۰۰۰ تومان!» → «قیمت-850000-تومان»", () => {
    expect(slugify("قیمت: ۸۵۰,۰۰۰ تومان!")).toBe("قیمت-850000-تومان");
    expect(SLUG_CONTRACT.test(slugify("قیمت: ۸۵۰,۰۰۰ تومان!"))).toBe(true);
  });

  it("always emits a contract-valid slug for representative inputs", () => {
    for (const input of [
      "Hello World",
      "  Hello   World  ",
      "هدفون بیسیم بلوتوثی",
      "مایکروویو X200",
      "کولر گازی 24000 BTU",
      "يخچال كلاسيك",
      "بَرق قویّ",
      "بی\u200Cسیم",
      "هدفون ۲۴۰۰۰",
      "A--B",
      "foo_bar_baz",
      "Café!",
      "123",
    ]) {
      expect(SLUG_CONTRACT.test(slugify(input)), JSON.stringify(input)).toBe(true);
    }
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("returns exact-length text unchanged", () => {
    expect(truncate("exactly", 7)).toBe("exactly");
  });
});

describe("isAllowedImageSrc", () => {
  // Session 61 — the storefront next/image migration guard. Mirrors the
  // next.config.ts remotePatterns allowlist; an unknown host must be rejected
  // (the caller then renders its placeholder instead of crashing).
  it("accepts the known Liara S3 host", () => {
    expect(isAllowedImageSrc("https://c589564.parspack.net/uploads/a.jpg")).toBe(
      true
    );
  });

  it("accepts localhost (dev) http + https", () => {
    expect(isAllowedImageSrc("http://localhost:3000/x.jpg")).toBe(true);
    expect(isAllowedImageSrc("https://localhost/x.jpg")).toBe(true);
  });

  it("accepts same-origin relative paths", () => {
    expect(isAllowedImageSrc("/uploads/a.jpg")).toBe(true);
  });

  it("rejects protocol-relative URLs (//host is NOT same-origin)", () => {
    // `new URL("//host/x")` without a base throws → rejected, never allowed
    // through the startsWith("/") fast path.
    expect(isAllowedImageSrc("//example.com/s.jpg")).toBe(false);
  });

  it("rejects unconfigured hosts (the example.com placeholder case)", () => {
    expect(isAllowedImageSrc("https://example.com/s.jpg")).toBe(false);
    expect(isAllowedImageSrc("https://cdn.other.dev/x.png")).toBe(false);
  });

  it("rejects empty / null / malformed / data: values", () => {
    expect(isAllowedImageSrc("")).toBe(false);
    expect(isAllowedImageSrc(undefined)).toBe(false);
    expect(isAllowedImageSrc(null)).toBe(false);
    expect(isAllowedImageSrc("not-a-url")).toBe(false);
    expect(isAllowedImageSrc("data:image/png;base64,AAAA")).toBe(false);
  });
});

describe("relationId", () => {
  // Session 65 — edit pages normalize populated relations that can be null
  // (deleted Category/Supplier/Brand) or a raw id string at runtime.
  it("extracts _id from a populated relation doc", () => {
    expect(relationId({ _id: "64eabc123", name: "دسته" })).toBe("64eabc123");
    expect(relationId({ _id: "64eabc456", businessName: "فروشنده" })).toBe(
      "64eabc456"
    );
  });

  it("passes through a raw ObjectId string", () => {
    expect(relationId("64eabc789")).toBe("64eabc789");
  });

  it("reads the hex string from a raw ObjectId instance (custom toString)", () => {
    const objectIdLike = {
      toString: () => "64eabc012",
      toHexString: () => "64eabc012",
    };
    expect(relationId(objectIdLike)).toBe("64eabc012");
    // Plain objects without an _id must NOT collapse to "[object Object]"
    expect(relationId({ name: "بدون شناسه" })).toBe("");
  });

  it("returns an empty string for null / undefined (deleted refs)", () => {
    expect(relationId(null)).toBe("");
    expect(relationId(undefined)).toBe("");
  });

  it("returns an empty string for other values", () => {
    expect(relationId("")).toBe("");
    expect(relationId(123)).toBe("");
    expect(relationId({ _id: null })).toBe("");
    expect(relationId({ _id: undefined })).toBe("");
  });
});

describe("getBaseUrl", () => {
  afterEach(() => {
    delete process.env.VERCEL_URL;
    delete process.env.PORT;
  });

  it("defaults to localhost:3000 in a node environment", () => {
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });

  it("honors PORT", () => {
    process.env.PORT = "8080";
    expect(getBaseUrl()).toBe("http://localhost:8080");
  });

  it("prefers VERCEL_URL when set", () => {
    process.env.VERCEL_URL = "my-app.vercel.app";
    expect(getBaseUrl()).toBe("https://my-app.vercel.app");
  });
});
