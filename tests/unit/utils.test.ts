import { afterEach, describe, expect, it } from "vitest";
import {
  cn,
  formatDate,
  formatPrice,
  getBaseUrl,
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
