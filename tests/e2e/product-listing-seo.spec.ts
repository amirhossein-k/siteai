import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  expectOk,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 20 — catalog listing SEO (Sessions 74 + 76).
 *
 * The /products page is a Server Component whose `generateMetadata`
 * (delegating to src/lib/catalog-seo.ts) emits title, description, canonical,
 * Open Graph, Twitter and robots in the INITIAL HTML. This spec verifies the
 * policy with raw HTTP (no client JavaScript — exactly what Googlebot
 * receives on first crawl):
 *
 * Session 74 (unchanged):
 *   - `/products` (clean)              → indexable, self-canonical, NO noindex
 *   - `/products?search=…`             → noindex,follow, canonical → /products
 *   - `/products?sort=…`               → noindex,follow, canonical → /products
 *   - `/products?minPrice=…`           → noindex,follow, canonical → /products
 *   - `/products?attributes[color]=…`  → noindex,follow, canonical → /products
 *   - `/products?category=<id>`        → noindex,follow, canonical → /categories/<slug>
 *
 * Session 76 (URL-driven pagination) — 21 products seeded so the base
 * catalog actually has ≥ 2 pages (page-only `?page=N` must reflect real
 * content, not a thin page):
 *   - `/products?page=2`               → index,follow, SELF-canonical ?page=2
 *   - `/products?page=1`               → indexable, canonical → clean /products
 *   - `/products?page=0` / `?page=abc` → indexable (page-1 content), canonical → clean
 *   - `/products?page=999` (out of range) → noindex,follow, canonical → clean
 *   - `/products?sort=…&page=2`        → noindex,follow, canonical → /products
 *   - `/products?category=<id>&page=2` → noindex,follow, canonical → /categories/<slug>
 *
 * Plus a browser smoke proving the interactive catalog still hydrates and
 * fetches (the refactors must preserve functionality).
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

    // Session 76 — seed 21 ACTIVE in-stock products so the base catalog has
    // ≥ 2 pages (the page-only `?page=N` indexability policy must reflect a
    // REAL page, not a thin one). Prefix-slugged → global-teardown cleans them.
    for (let i = 1; i <= 21; i++) {
      await createProduct(adminCtx, {
        slug: `${state.prefix}seo-prod-${i}`,
        name: `محصول لیستینگ SEO ${state.prefix}${i}`,
        categoryId,
        supplierId: state.supplierId,
        price: 100_000 * i,
        supplierPrice: 80_000 * i,
        stock: 5,
      });
    }
  });

  test.afterAll(async () => {
    // cleanupByPrefix in global-teardown removes the category + products
    // (slugs carry the prefix); nothing per-test to delete here.
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

  test("Session 76: /products?page=2 is index,follow with a SELF-canonical ?page=2", async ({
    request,
  }) => {
    const res = await request.get("/products?page=2");
    expect(res.status()).toBe(200);
    const html = await res.text();

    // index,follow — exactly one robots meta.
    const robots = html.match(
      /<meta name="robots" content="([^"]*)"/g
    ) as string[] | null;
    expect(robots).not.toBeNull();
    expect(robots!.length).toBe(1);
    expect(robots![0]).toContain('content="index, follow"');

    // EXACTLY one canonical → the self ?page=2 form.
    const canonicals = canonicalHrefs(html);
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]).toBe(`${state.baseURL}/products?page=2`);
    // No noindex anywhere.
    expect(html).not.toContain('content="noindex');
  });

  test("Session 76: ?page=1 and invalid page values canonicalize to the clean /products", async ({
    request,
  }) => {
    const cases = [
      ["page=1", "/products?page=1"],
      ["page=0", "/products?page=0"],
      ["page=abc", "/products?page=abc"],
      ["page=-2", "/products?page=-2"],
    ] as const;
    for (const [label, url] of cases) {
      const res = await request.get(url);
      expect(res.status(), `${label}: ${url}`).toBe(200);
      const html = await res.text();
      // indexable (content = page 1) — no noindex.
      expect(html, label).not.toContain('content="noindex');
      // exactly one canonical → clean /products.
      const canonicals = canonicalHrefs(html);
      expect(canonicals, `${label}: exactly one canonical`).toHaveLength(1);
      expect(canonicals[0], label).toBe(`${state.baseURL}/products`);
    }
  });

  test("Session 76: out-of-range page-only URL is noindex,follow with canonical to clean /products", async ({
    request,
  }) => {
    // 21 seeded products → totalPages = 2 → page=999 is beyond range.
    const res = await request.get("/products?page=999");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('content="noindex, follow"');
    const canonicals = canonicalHrefs(html);
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]).toBe(`${state.baseURL}/products`);
  });

  test("Session 76: filtered + page stays noindex with the Session 74 canonical", async ({
    request,
  }) => {
    // Filter param + page → noindex,follow → base /products.
    const filtered = await request.get("/products?sort=price_desc&page=2");
    const filteredHtml = await filtered.text();
    expect(filteredHtml).toContain('content="noindex, follow"');
    expect(canonicalHrefs(filteredHtml)).toEqual([`${state.baseURL}/products`]);

    // Category param + page → noindex,follow → the /categories/<slug> route.
    const categoryFiltered = await request.get(
      `/products?category=${categoryId}&page=2`
    );
    const catHtml = await categoryFiltered.text();
    expect(catHtml).toContain('content="noindex, follow"');
    expect(canonicalHrefs(catHtml)).toEqual([
      `${state.baseURL}/categories/${encodeURIComponent(categorySlug)}`,
    ]);
  });

  test("Session 76: a direct ?page=2 URL load KEEPS the page (no mount-time strip)", async ({
    page,
  }) => {
    // The catalog derives `page` from the URL; the filter-reset effect must
    // NOT strip ?page on mount (regression caught in review: a fresh ?page=N
    // load bounced to page 1). Assert the URL survives AND the API fetch
    // actually targets page 2.
    const apiReq = page.waitForRequest((r) => {
      if (!r.url().includes("/api/products")) return false;
      const u = new URL(r.url());
      return u.searchParams.get("page") === "2";
    });
    await page.goto("/products?page=2");
    await apiReq;
    await expect(page).toHaveURL(/\/products\?page=2/);
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

/**
 * Session 79 — the discounted catalog lens at /products?discounted=true.
 *
 * The client catalog now honors the URL-derived lens (previously the page
 * silently showed the FULL catalog). Fixtures: one currently-discounted
 * product (finite endsAt ~10 min out — no real-time expiry wait), one plain
 * product, one future-discount product. The discounted membership rules are
 * the server's (verify-product-discounts.js covers them at the API level —
 * NOT duplicated here); this journey proves the CATALOG renders the lens,
 * the SEO head stays noindex,follow → /products, pagination keeps the lens,
 * and the exit link restores the full catalog.
 */
test.describe("Session 79 — discounted catalog lens", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  let categoryId: string;
  let categorySlug: string;
  const lensSlug = (n: number) => `${state.prefix.replace(/_/g, "-")}dccat-${n}`;

  const canonicalHrefs = (html: string): string[] =>
    [...html.matchAll(/rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    // Reuse the listing-SEO category when the whole file runs; create one
    // when this describe runs in isolation (-g filter). Idempotent either way.
    categorySlug = `${state.prefix}cat-12`;
    const catsRes = await adminCtx.get("/api/admin/categories");
    expect(catsRes.ok()).toBeTruthy();
    const cats = (await catsRes.json()) as Array<{ _id: string; slug: string }>;
    categoryId = cats.find((c) => c.slug === categorySlug)?._id ?? "";
    if (!categoryId) {
      for (let idx = 14; idx < 40; idx++) {
        try {
          categoryId = await createCategory(adminCtx, state.prefix, idx);
          categorySlug = `${state.prefix}cat-${idx}`;
          break;
        } catch (e) {
          // Duplicate-slug 409 → try the next index; anything else fails loudly.
          if (!String(e).includes("409")) throw e;
        }
      }
    }
    expect(categoryId).toBeTruthy();

    // Idempotent seeding: reuse a fixture left behind by a failed earlier run.
    const ensureProduct = async (seed: {
      slug: string;
      name: string;
      price: number;
      stock: number;
      discount?: unknown;
    }): Promise<void> => {
      const search = await adminCtx.get(
        `/api/admin/products?search=${encodeURIComponent(seed.slug)}`
      );
      expect(search.ok()).toBeTruthy();
      const existing = (
        (await search.json()) as { data: Array<{ slug: string }> }
      ).data.find((p) => p.slug === seed.slug);
      if (existing) return;
      const res = await adminCtx.post("/api/admin/products", {
        data: {
          name: seed.name,
          slug: seed.slug,
          description: "محصول E2E — حذف میشود",
          images: [],
          category: categoryId,
          supplier: state.supplierId,
          supplierPrice: Math.round(seed.price * 0.6),
          price: seed.price,
          stock: seed.stock,
          hasVariants: false,
          variants: [],
          isActive: true,
          discount: seed.discount,
        },
      });
      await expectOk(res, `seed ${seed.slug}`);
    };

    const t = Date.now();
    await ensureProduct({
      slug: lensSlug(1),
      name: `هدفون تخفیف‌دار کاتالوگ ${state.prefix}`,
      price: 1_000_000,
      stock: 10,
      discount: {
        type: "percent",
        value: 20,
        startsAt: null,
        endsAt: new Date(t + 600_000).toISOString(), // +10 min — no real-time wait
        isActive: true,
      },
    });
    await ensureProduct({
      slug: lensSlug(2),
      name: `محصول عادی کاتالوگ ${state.prefix}`,
      price: 500_000,
      stock: 10,
    });
    await ensureProduct({
      slug: lensSlug(3),
      name: `تخفیف آینده کاتالوگ ${state.prefix}`,
      price: 700_000,
      stock: 10,
      discount: {
        type: "percent",
        value: 30,
        startsAt: new Date(t + 3_600_000).toISOString(), // +1h — future, NOT active
        endsAt: null,
        isActive: true,
      },
    });
  });

  test.afterAll(async () => {
    // cleanupByPrefix (global-teardown) removes prefix-slugged products +
    // categories; nothing per-test to delete here.
    await adminCtx.dispose();
  });

  test("raw HTTP: the discounted lens stays noindex,follow canonical /products (initial HTML)", async ({
    request,
  }) => {
    const cases: Array<[string, string]> = [
      ["discounted", "/products?discounted=true"],
      ["discounted+page", "/products?discounted=true&page=2"],
    ];
    for (const [label, url] of cases) {
      const res = await request.get(url);
      expect(res.status(), `${label}: ${url}`).toBe(200);
      const html = await res.text();
      const robots = html.match(/<meta name="robots" content="([^"]*)"/g);
      expect(robots, `${label}: exactly one robots meta`).not.toBeNull();
      expect(robots!.length, `${label}: exactly one robots meta`).toBe(1);
      expect(robots![0]).toContain('content="noindex, follow"');
      expect(canonicalHrefs(html), `${label}: exactly one canonical`).toEqual([
        `${state.baseURL}/products`,
      ]);
    }

    // discounted + category respects the existing category canonical rule.
    const catRes = await request.get(
      `/products?discounted=true&category=${categoryId}`
    );
    expect(catRes.status()).toBe(200);
    const catHtml = await catRes.text();
    expect(catHtml).toContain('content="noindex, follow"');
    expect(canonicalHrefs(catHtml)).toEqual([
      `${state.baseURL}/categories/${encodeURIComponent(categorySlug)}`,
    ]);
  });

  test("the discounted lens renders only active discounted products, keeps the lens on page 2, and the exit link restores the full catalog", async ({
    page,
  }) => {
    // 1. Direct load of the lens (the homepage rail's «مشاهده همه» target).
    await page.goto("/products?discounted=true");
    // Tolerant of the نیم‌فاصله variant: the H1 is «محصولات تخفیف‌دار» (ZWNJ)
    // to match the homepage section title exactly.
    await expect(
      page.getByRole("heading", { name: /محصولات تخفیف[\u200C]?دار/ })
    ).toBeVisible();

    // Exit chip present and pointing at the clean catalog.
    const exit = page.getByRole("link", { name: "مشاهده همه محصولات" });
    await expect(exit).toBeVisible();
    await expect(exit).toHaveAttribute("href", "/products");

    // Membership: discounted product present; plain + future-discount absent.
    await expect(
      page.getByRole("link", {
        name: new RegExp(`هدفون تخفیف‌دار کاتالوگ ${state.prefix}`),
      })
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(`محصول عادی کاتالوگ ${state.prefix}`),
      })
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: new RegExp(`تخفیف آینده کاتالوگ ${state.prefix}`),
      })
    ).toHaveCount(0);

    // Discount presentation on the card: badge, effective price, struck
    // through original, countdown chip (20% of 1,000,000 = 800,000).
    await expect(page.getByText("٪20 تخفیف")).toBeVisible();
    await expect(page.getByText(/۸۰۰٬۰۰۰/)).toBeVisible();
    const original = page.getByText(/۱٬۰۰۰٬۰۰۰/);
    await expect(original).toBeVisible();
    await expect(original).toHaveClass(/line-through/);
    await expect(page.getByText(/باقی مانده/).first()).toBeVisible();

    // 2. Pagination preserves the lens: ?discounted=true&page=2 still
    // requests discounted=true and keeps the lens H1.
    const apiReq = page.waitForRequest((r) => {
      if (!r.url().includes("/api/products")) return false;
      const u = new URL(r.url());
      return (
        u.searchParams.get("discounted") === "true" &&
        u.searchParams.get("page") === "2"
      );
    });
    await page.goto("/products?discounted=true&page=2");
    await apiReq;
    await expect(page).toHaveURL(/\/products\?discounted=true&page=2/);
    await expect(
      page.getByRole("heading", { name: /محصولات تخفیف[\u200C]?دار/ })
    ).toBeVisible();

    // 3. The exit link returns to the full catalog (plain product now shown).
    await page.getByRole("link", { name: "مشاهده همه محصولات" }).click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(
      page.getByRole("heading", { name: "محصولات", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(`محصول عادی کاتالوگ ${state.prefix}`),
      })
    ).toBeVisible();
  });
});
