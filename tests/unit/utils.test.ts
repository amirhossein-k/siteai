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
  it("lowercases and dashes internal whitespace", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    // Leading/trailing whitespace becomes leading/trailing dashes (not
    // stripped by the current implementation).
    expect(slugify("  Hello   World  ")).toBe("-hello-world-");
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

  it("handles empty input", () => {
    expect(slugify("")).toBe("");
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
