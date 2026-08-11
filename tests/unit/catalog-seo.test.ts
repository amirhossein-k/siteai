import { describe, it, expect } from "vitest";
import {
  normalizeCatalogParams,
  isIndexableCatalogUrl,
  getCatalogRobots,
  getCatalogCanonicalUrl,
  buildCatalogMetadata,
  resolveCategorySlug,
  CATALOG_TITLE,
  CATALOG_DESCRIPTION,
} from "@/lib/catalog-seo";
import { APP_URL } from "@/lib/constants";

// Base derived from the LIVE APP_URL constant (not a hardcoded origin) so the
// suite stays hermetic and CI-safe when NEXT_PUBLIC_APP_URL is set (the same
// env-agnostic principle constants.test.ts enforces with stubEnv).
const BASE = APP_URL;
const PRODUCTS_URL = `${BASE}/products`;

/**
 * Session 74 — catalog listing SEO policy (hermetic).
 *
 * The /products page delegates its metadata to src/lib/catalog-seo.ts, the
 * single reusable policy: clean URL → indexable + self-canonical; EVERY
 * parameterized variant (search/brand/tag/sort/minPrice/maxPrice/attributes
 * /page/supplier/limit/unknown) → noindex,follow canonicalized to the base;
 * ?category → noindex canonicalized toward the future /categories/<slug>.
 *
 * The pure policy functions are tested directly; `resolveCategorySlug` only
 * needs its fail-safe null path here (the DB path is covered by the E2E spec
 * against the real API + real dev MongoDB).
 */

describe("normalizeCatalogParams", () => {
  it("collapses array values to the first value (Next 16 searchParams)", () => {
    expect(normalizeCatalogParams({ sort: ["price_desc", "newest"] })).toEqual({
      sort: "price_desc",
    });
  });

  it("drops undefined and empty values (API treats them as absent)", () => {
    expect(
      normalizeCatalogParams({
        search: undefined,
        sort: "",
        category: "c1",
        page: " ",
      })
    ).toEqual({ category: "c1", page: " " });
  });

  it("passes attribute facet keys through unchanged", () => {
    expect(
      normalizeCatalogParams({ "attributes[color]": "قرمز", sort: "newest" })
    ).toEqual({ "attributes[color]": "قرمز", sort: "newest" });
  });
});

describe("isIndexableCatalogUrl", () => {
  it("clean /products is indexable", () => {
    expect(isIndexableCatalogUrl({})).toBe(true);
  });

  it("every faceted/filter/sort param makes it non-indexable (page NOT in this set — Session 76)", () => {
    for (const params of [
      { search: "هدفون" },
      { brand: "b1" },
      { tag: "t1" },
      { sort: "price_desc" },
      { sort: "newest" },
      { minPrice: "100000" },
      { maxPrice: "500000" },
      { category: "c1" },
      { supplier: "s1" },
      { limit: "100" },
      { "attributes[color]": "قرمز" },
      { category: "c1", sort: "price_asc", search: "x" },
      { search: "x", page: "2" },
      { sort: "price_desc", page: "2" },
      { category: "c1", page: "2" },
    ]) {
      expect(isIndexableCatalogUrl(params), JSON.stringify(params)).toBe(false);
    }
  });

  it("Session 76 — page-only URLs are indexable (base pagination)", () => {
    expect(isIndexableCatalogUrl({ page: "2" })).toBe(true);
    expect(isIndexableCatalogUrl({ page: "3" })).toBe(true);
  });

  it("page 1 / invalid page values are indexable (content IS page 1)", () => {
    expect(isIndexableCatalogUrl({ page: "1" })).toBe(true);
    for (const bad of ["0", "-2", "1.5", "abc", "NaN", " ", ""]) {
      expect(isIndexableCatalogUrl({ page: bad }), `page=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it("Session 76 — out-of-range page-only URLs are NOT indexable (thin page)", () => {
    expect(isIndexableCatalogUrl({ page: "2" }, { pageOutOfRange: true })).toBe(false);
    expect(isIndexableCatalogUrl({ page: "999" }, { pageOutOfRange: true })).toBe(false);
  });

  it("fail-closed: an unknown future param is never indexable", () => {
    expect(isIndexableCatalogUrl({ utm_source: "newsletter" })).toBe(false);
  });
});

describe("getCatalogRobots", () => {
  it("index,follow on the clean URL", () => {
    expect(getCatalogRobots({})).toEqual({ index: true, follow: true });
  });

  it("noindex,follow on parameterized URLs", () => {
    expect(getCatalogRobots({ search: "x" })).toEqual({
      index: false,
      follow: true,
    });
    expect(getCatalogRobots({ category: "c1" })).toEqual({
      index: false,
      follow: true,
    });
    expect(getCatalogRobots({ search: "x", page: "2" })).toEqual({
      index: false,
      follow: true,
    });
  });

  it("Session 76 — index,follow on in-range page-only URLs, noindex on out-of-range", () => {
    expect(getCatalogRobots({ page: "2" })).toEqual({ index: true, follow: true });
    expect(getCatalogRobots({ page: "1" })).toEqual({ index: true, follow: true });
    expect(getCatalogRobots({ page: "abc" })).toEqual({ index: true, follow: true });
    expect(getCatalogRobots({ page: "2" }, { pageOutOfRange: true })).toEqual({
      index: false,
      follow: true,
    });
  });
});

describe("getCatalogCanonicalUrl", () => {
  it("clean URL → self-canonical /products", () => {
    expect(getCatalogCanonicalUrl({})).toBe(PRODUCTS_URL);
  });

  it("search/sort/brand/etc → base /products", () => {
    expect(getCatalogCanonicalUrl({ search: "هدفون" })).toBe(PRODUCTS_URL);
    expect(getCatalogCanonicalUrl({ sort: "price_desc" })).toBe(PRODUCTS_URL);
    expect(getCatalogCanonicalUrl({ minPrice: "1", sort: "name" })).toBe(
      PRODUCTS_URL
    );
  });

  it("category with a resolvable slug → future /categories/<slug> route", () => {
    expect(getCatalogCanonicalUrl({ category: "c1" }, "الکترونیک")).toBe(
      `${BASE}/categories/الکترونیک`
    );
  });

  it("category with an unresolvable slug → falls back to /products (no fabricated URL)", () => {
    expect(getCatalogCanonicalUrl({ category: "c1" }, null)).toBe(PRODUCTS_URL);
    expect(getCatalogCanonicalUrl({ category: "c1" }, "")).toBe(PRODUCTS_URL);
  });

  it("category + other params still canonicalize toward the category route", () => {
    expect(
      getCatalogCanonicalUrl({ category: "c1", sort: "price_desc" }, "الکترونیک")
    ).toBe(`${BASE}/categories/الکترونیک`);
  });

  it("Session 76 — in-range page-only URL → self-canonical /products?page=N", () => {
    expect(getCatalogCanonicalUrl({ page: "2" })).toBe(`${PRODUCTS_URL}?page=2`);
    expect(getCatalogCanonicalUrl({ page: "7" })).toBe(`${PRODUCTS_URL}?page=7`);
  });

  it("Session 76 — page 1 / invalid / out-of-range page-only → clean /products", () => {
    expect(getCatalogCanonicalUrl({ page: "1" })).toBe(PRODUCTS_URL);
    for (const bad of ["0", "-2", "1.5", "abc"]) {
      expect(getCatalogCanonicalUrl({ page: bad }), `page=${bad}`).toBe(PRODUCTS_URL);
    }
    expect(
      getCatalogCanonicalUrl({ page: "2" }, null, { pageOutOfRange: true })
    ).toBe(PRODUCTS_URL);
  });

  it("Session 76 — category + page canonical ignores page (points at the canonical page-1 category URL)", () => {
    expect(getCatalogCanonicalUrl({ category: "c1", page: "2" }, "الکترونیک")).toBe(
      `${BASE}/categories/الکترونیک`
    );
  });
});

describe("buildCatalogMetadata", () => {
  it("clean URL: indexable metadata with self-canonical and OG/Twitter", () => {
    const meta = buildCatalogMetadata({});
    expect(meta.title).toBe(CATALOG_TITLE);
    expect(meta.description).toBe(CATALOG_DESCRIPTION);
    expect(meta.alternates.canonical).toBe(PRODUCTS_URL);
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph.url).toBe(PRODUCTS_URL);
    expect(meta.openGraph.locale).toBe("fa_IR");
    expect(meta.twitter.card).toBe("summary");
  });

  it("parameterized URL: noindex,follow + canonical to base", () => {
    const meta = buildCatalogMetadata({ search: "هدفون", sort: "newest" });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates.canonical).toBe(PRODUCTS_URL);
    // The title/description stay the same — natural Persian, no stuffing.
    expect(meta.title).toBe(CATALOG_TITLE);
  });

  it("category URL: noindex,follow + canonical toward the future route", () => {
    const meta = buildCatalogMetadata({ category: "c1" }, "الکترونیک");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates.canonical).toBe(
      `${BASE}/categories/الکترونیک`
    );
  });

  it("Session 76 — page-only metadata: in-range page 2 is indexable with self-canonical", () => {
    const meta = buildCatalogMetadata({ page: "2" });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates.canonical).toBe(`${PRODUCTS_URL}?page=2`);
    expect(meta.openGraph.url).toBe(`${PRODUCTS_URL}?page=2`);
  });

  it("Session 76 — page 1 canonicalizes to the clean URL (no ?page=1 duplicate)", () => {
    const meta = buildCatalogMetadata({ page: "1" });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates.canonical).toBe(PRODUCTS_URL);
  });

  it("Session 76 — out-of-range page → noindex with canonical to clean /products", () => {
    const meta = buildCatalogMetadata({ page: "999" }, null, { pageOutOfRange: true });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates.canonical).toBe(PRODUCTS_URL);
  });

  it("Session 76 — filtered + page stays noindex with the base canonical", () => {
    const meta = buildCatalogMetadata({ sort: "price_desc", page: "2" });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates.canonical).toBe(PRODUCTS_URL);
  });
});

describe("resolveCategorySlug", () => {
  // Hermetic unit-test boundary (repo convention): ONLY the DB-free path is
  // tested here. The real-DB paths — a resolvable category slug and the
  // unknown-id → /products canonical fallback — are covered by the E2E spec
  // (product-listing-seo.spec.ts) against the real API + dev MongoDB.
  it("fail-safe: malformed ObjectId → null (no DB call, no CastError)", async () => {
    expect(await resolveCategorySlug("not-an-objectid")).toBeNull();
    expect(await resolveCategorySlug("")).toBeNull();
    expect(await resolveCategorySlug("123")).toBeNull();
  });
});
