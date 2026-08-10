import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, type E2EState } from "./helpers/fixtures";

/**
 * Journey 20 — catalog listing SEO (Session 74).
 *
 * The /products page is now a Server Component whose `generateMetadata`
 * (delegating to src/lib/catalog-seo.ts) emits title, description, canonical,
 * Open Graph, Twitter and robots in the INITIAL HTML. This spec verifies the
 * policy with raw HTTP (no client JavaScript — exactly what Googlebot
 * receives on first crawl):
 *
 *   - `/products` (clean)              → indexable, self-canonical, NO noindex
 *   - `/products?search=…`             → noindex,follow, canonical → /products
 *   - `/products?sort=…`               → noindex,follow, canonical → /products
 *   - `/products?minPrice=…`           → noindex,follow, canonical → /products
 *   - `/products?attributes[color]=…`  → noindex,follow, canonical → /products
 *   - `/products?category=<id>`        → noindex,follow, canonical → /categories/<slug>
 *
 * Plus a browser smoke proving the interactive catalog still hydrates and
 * fetches (the Session 74 page refactor must preserve functionality).
 */
test.describe("catalog listing SEO policy", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  let categoryId: string;
  let categorySlug: string;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // Category index 12 is free (1=product-search, 2=product-detail, 3=cart,
    // 4=checkout, 5=coupon, 6=payment, 7=order-tracking, 8=admin-order-workflow,
    // 9=supplier-workflow, 10=rich-description, 11=persian-name,
    // 33=cart mobile, 99=accessibility). createCategory builds the slug as
    // `${prefix}cat-${index}`.
    categoryId = await createCategory(adminCtx, state.prefix, 12);
    categorySlug = `${state.prefix}cat-12`;
  });

  test.afterAll(async () => {
    // cleanupByPrefix in global-teardown removes the category (slug carries
    // the prefix); nothing per-test to delete here.
    await adminCtx.dispose();
  });

  const canonicalHrefs = (html: string): string[] =>
    [...html.matchAll(/rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);

  test("clean /products is indexable with a self-canonical in the initial HTML", async ({
    request,
  }) => {
    const res = await request.get("/products");
    expect(res.status()).toBe(200);
    const html = await res.text();

    // Title is the natural Persian «محصولات | فروشگاه من» (root template).
    expect(html).toContain("<title>");
    expect(html).toContain("محصولات");
    // Meta description is server-rendered and natural Persian.
    expect(html).toContain('<meta name="description"');
    expect(html).toContain("مرور و خرید آنلاین محصولات فروشگاه");
    // EXACTLY ONE canonical → the clean self URL.
    const canonicals = canonicalHrefs(html);
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]).toBe(`${state.baseURL}/products`);
    // Open Graph + Twitter server-rendered.
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:url"');
    expect(html).toContain('name="twitter:card"');
    // NO noindex on the clean URL.
    expect(html).not.toContain('content="noindex');
  });

  test("parameterized URLs are noindex,follow with canonical to /products", async ({
    request,
  }) => {
    const cases: Array<[string, string]> = [
      ["search", `/products?search=${encodeURIComponent("هدفون")}`],
      ["sort", "/products?sort=price_desc"],
      ["sort default", "/products?sort=newest"],
      ["minPrice", "/products?minPrice=100000"],
      ["maxPrice", "/products?maxPrice=500000"],
      [
        "attributes",
        `/products?${encodeURIComponent("attributes[color]")}=red`,
      ],
      ["brand+sort combo", "/products?brand=abc123&sort=price_asc"],
    ];

    for (const [label, url] of cases) {
      const res = await request.get(url);
      expect(res.status(), `${label}: ${url}`).toBe(200);
      const html = await res.text();

      // noindex,follow — exactly one robots meta.
      const robots = html.match(
        /<meta name="robots" content="([^"]*)"/g
      ) as string[] | null;
      expect(robots, `${label}: exactly one robots meta`).not.toBeNull();
      expect(robots!.length, `${label}: exactly one robots meta`).toBe(1);
      expect(robots![0]).toContain('content="noindex, follow"');

      // Exactly one canonical → the clean /products base.
      const canonicals = canonicalHrefs(html);
      expect(canonicals, `${label}: exactly one canonical`).toHaveLength(1);
      expect(canonicals[0], `${label}`).toBe(`${state.baseURL}/products`);
    }
  });

  test("?category canonicalizes toward the future /categories/<slug> route", async ({
    request,
  }) => {
    const res = await request.get(`/products?category=${categoryId}`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // noindex,follow.
    expect(html).toContain('content="noindex, follow"');
    // Exactly one canonical → the future category route with the resolved slug.
    const canonicals = canonicalHrefs(html);
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]).toBe(
      `${state.baseURL}/categories/${encodeURIComponent(categorySlug)}`
    );

    // Unknown/foreign category id → canonical falls back to /products.
    const foreignRes = await request.get(
      "/products?category=000000000000000000000000"
    );
    expect(foreignRes.status()).toBe(200);
    const foreignHtml = await foreignRes.text();
    expect(foreignHtml).toContain('content="noindex, follow"');
    const foreignCanonicals = canonicalHrefs(foreignHtml);
    expect(foreignCanonicals).toHaveLength(1);
    expect(foreignCanonicals[0]).toBe(`${state.baseURL}/products`);
  });

  test("the interactive catalog still hydrates and fetches products", async ({
    page,
  }) => {
    // The client component must mount and fire the public products request
    // after the refactor — behavior preserved, not just HTML.
    const apiReq = page.waitForRequest((r) =>
      r.url().includes("/api/products")
    );
    await page.goto("/products");
    await apiReq;
    // The page shell renders server-side and the client grid hydrates
    // (either the empty state or product cards — both prove the client
    // mounted and received a response).
    await expect(page.getByRole("heading", { name: "محصولات" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /فیلترها/ })
    ).toBeVisible();
  });
});
