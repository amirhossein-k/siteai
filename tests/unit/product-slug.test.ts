import { describe, expect, it, vi } from "vitest";
import {
  SLUG_PATTERN,
  isValidSlug,
  isSlugDuplicateError,
  createWithUniqueSlug,
  buildProductUrl,
} from "@/lib/product-slug";

/**
 * Session 70 — the product slug contract + deterministic collision handling.
 *
 * slugify() (src/lib/utils.ts) ALWAYS emits a string matching SLUG_PATTERN;
 * these tests pin the contract itself (what the server accepts) and the
 * auto-suffix retry (createWithUniqueSlug) that keeps auto-generated slugs
 * deterministic while user-entered slugs keep the 409 behavior.
 */
describe("SLUG_PATTERN / isValidSlug", () => {
  it("accepts Unicode Persian slugs (human-readable product URLs)", () => {
    expect(isValidSlug("هدفون-بیسیم-بلوتوثی")).toBe(true);
    expect(isValidSlug("مایکروویو-x200")).toBe(true);
    expect(isValidSlug("کولر-گازی-24000-btu")).toBe(true);
    expect(isValidSlug("یخچال-کلاسیک")).toBe(true);
    // Arabic letters are inside U+0600–U+06FF too (slugify normalizes ي→ی,
    // but a pre-normalized Arabic slug is still contract-valid).
    expect(isValidSlug("يخچال-كلاسيك")).toBe(true);
  });

  it("keeps Latin + digits + single hyphens valid", () => {
    expect(isValidSlug("headphone-x200")).toBe(true);
    expect(isValidSlug("p-a13f82c1")).toBe(true);
    expect(isValidSlug("123")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
  });

  it("rejects unsafe / invalid slugs", () => {
    for (const bad of [
      "",           // empty
      "-abc",       // leading hyphen
      "abc-",       // trailing hyphen
      "ab--c",      // consecutive hyphens
      "ABC",        // uppercase Latin (model stores lowercase:true → URL 404)
      "ab cd",      // whitespace inside the final slug
      "ab/cd",      // path separator
      "ab?cd",      // query delimiter
      "ab#cd",      // fragment delimiter
      "ab%cd",      // percent-encoding
      "ab\\cd",     // backslash
      "a<b>c",      // HTML
      "ab:cd",      // colon
      "ab,cd",      // comma
      "ab'cd",      // quote
      "ab\u0000cd", // control character
    ]) {
      expect(isValidSlug(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("SLUG_PATTERN and isValidSlug agree", () => {
    expect(SLUG_PATTERN.test("هدفون-بیسیم-بلوتوثی")).toBe(true);
    expect(SLUG_PATTERN.test("-x")).toBe(false);
  });
});

describe("buildProductUrl", () => {
  it("builds the canonical product URL with a Unicode slug", () => {
    expect(
      buildProductUrl("https://example.com", "هدفون-بیسیم-بلوتوثی")
    ).toBe("https://example.com/products/هدفون-بیسیم-بلوتوثی");
  });

  it("never leaks localhost when a production baseUrl is provided", () => {
    const url = buildProductUrl("https://shop.example.com", "x200");
    expect(url).toBe("https://shop.example.com/products/x200");
    expect(url).not.toContain("localhost");
  });

  it("normalizes a trailing slash on the base", () => {
    expect(buildProductUrl("https://example.com/", "x")).toBe(
      "https://example.com/products/x"
    );
  });
});

describe("isSlugDuplicateError", () => {
  it("recognizes an E11000 on the slug path", () => {
    expect(isSlugDuplicateError({ code: 11000, keyPattern: { slug: 1 } })).toBe(
      true
    );
  });

  it("does NOT claim SKU conflicts (the nested variants.sku unique index)", () => {
    // If the suffix retry consumed a SKU E11000 it would silently re-create
    // with a different slug — so only real slug conflicts may retry.
    expect(
      isSlugDuplicateError({ code: 11000, keyPattern: { "variants.sku": 1 } })
    ).toBe(false);
    expect(isSlugDuplicateError({ code: 11000, keyPattern: { variants: {} } })).toBe(
      false
    );
  });

  it("treats a legacy E11000 without keyPattern info as a slug conflict", () => {
    expect(isSlugDuplicateError({ code: 11000 })).toBe(true);
  });

  it("returns false for non-duplicate errors and junk", () => {
    expect(isSlugDuplicateError({ code: 1000 })).toBe(false);
    expect(isSlugDuplicateError(new Error("boom"))).toBe(false);
    expect(isSlugDuplicateError(null)).toBe(false);
    expect(isSlugDuplicateError(undefined)).toBe(false);
    expect(isSlugDuplicateError("E11000")).toBe(false);
  });
});

describe("createWithUniqueSlug", () => {
  it("returns the first candidate when it succeeds", async () => {
    const attempt = vi.fn(async (candidate: string) => candidate);
    const res = await createWithUniqueSlug("هدفون-بیسیم", attempt);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("هدفون-بیسیم");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith("هدفون-بیسیم");
  });

  it("applies a deterministic -2 suffix on a slug collision", async () => {
    const attempt = vi
      .fn<(candidate: string) => Promise<string>>()
      .mockRejectedValueOnce({ code: 11000, keyPattern: { slug: 1 } })
      .mockResolvedValueOnce("هدفون-بیسیم-2");
    const res = await createWithUniqueSlug("هدفون-بیسیم", attempt);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("هدفون-بیسیم-2");
    expect(attempt).toHaveBeenNthCalledWith(1, "هدفون-بیسیم");
    expect(attempt).toHaveBeenNthCalledWith(2, "هدفون-بیسیم-2");
  });

  it("escalates to -2, -3, … for repeated collisions", async () => {
    const calls: string[] = [];
    const attempt = vi.fn(async (candidate: string) => {
      calls.push(candidate);
      if (candidate === "x-3") return "ok";
      throw { code: 11000, keyPattern: { slug: 1 } };
    });
    const res = await createWithUniqueSlug("x", attempt);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("ok");
    expect(calls).toEqual(["x", "x-2", "x-3"]);
  });

  it("refuses an empty/whitespace-only base slug — never emits \"-2\"-style candidates", async () => {
    // Defense-in-depth: a direct API caller bypassing the client Zod gate
    // must not persist a leading-hyphen candidate through the suffix retry.
    const attempt = vi.fn(async (candidate: string) => candidate);
    const res = await createWithUniqueSlug("", attempt);
    expect(res.ok).toBe(false);
    expect(attempt).not.toHaveBeenCalled();
    const res2 = await createWithUniqueSlug("   ", attempt);
    expect(res2.ok).toBe(false);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("accepts non-empty legacy slugs (underscores) — backward compat", async () => {
    // The E2E fixtures create slugs like `e2e_<ts>_detail-simple`
    // (underscores violate the NEW SLUG_PATTERN but were accepted by the API
    // before Session 71) — the empty-guard must NOT regress them into 409s.
    const attempt = vi.fn(async (candidate: string) => candidate);
    const res = await createWithUniqueSlug("e2e_123_prod-1", attempt);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("e2e_123_prod-1");
    expect(attempt).toHaveBeenCalledWith("e2e_123_prod-1");
  });

  it("manual slug (maxTries=1) keeps the 409 semantics — never suffixes", async () => {
    const attempt = vi.fn(async () => {
      throw { code: 11000, keyPattern: { slug: 1 } };
    });
    const res = await createWithUniqueSlug("my-slug", attempt, 1);
    expect(res.ok).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-slug errors instead of suffixing (SKU conflicts, 500s)", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("SKU conflict");
    });
    await expect(createWithUniqueSlug("x", attempt)).rejects.toThrow(
      "SKU conflict"
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxTries exhausted", async () => {
    const attempt = vi.fn(async () => {
      throw { code: 11000, keyPattern: { slug: 1 } };
    });
    const res = await createWithUniqueSlug("x", attempt, 3);
    expect(res.ok).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
