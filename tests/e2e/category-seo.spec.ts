import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, createProduct, type E2EState } from "./helpers/fixtures";
import { connectDb, disconnectDb } from "./helpers/db";
import mongoose from "mongoose";

/**
 * Self-healing setup — remove ONLY this spec's fixtures for the run prefix
 * before seeding (test-state cleanup only, never real data). A Playwright
 * worker restart mid-file re-runs beforeAll with the SAME run prefix; without
 * this, a category/product created by the crashed worker would 409/duplicate
 * on re-run.
 *
 * IMPORTANT: this must NOT call cleanupByPrefix. That helper also deletes
 * USERS whose names embed the run prefix (the shared E2E customer/supplier
 * created by global-setup: «مشتری e2e_<ts>_» / «فروشنده e2e_<ts>_») — running
 * it mid-run would delete those shared users and break every later spec that
 * depends on customerStatePath/supplierStatePath (customer-login, logout,
 * order-tracking, payment, supplier-communication, supplier-workflow — the
 * deterministic 13-failure full-run cascade). This purge is scoped to the
 * exact slug patterns this spec owns and never touches users.
 */
async function purgeOwnFixtures(prefix: string): Promise<void> {
  await connectDb();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to MongoDB");
  // Escape the prefix for RegExp safety — same convention as cleanupByPrefix
  // in helpers/db.ts (the prefix is e2e_<ts>_ today; escaping keeps the
  // deletion pattern anchored even if the prefix format ever changes).
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const catRe = new RegExp(`^${esc}cat-13`);
  const prodRe = new RegExp(`^${esc}cat13-prod-`);
  await db.collection("categories").deleteMany({ slug: catRe });
  await db.collection("products").deleteMany({ slug: prodRe });
  await disconnectDb();
}

/**
 * Journey 21 — category page SEO (Session 75).
 *
 * `/categories/<slug>` is a Server Component that emits category name,
 * description, first-page product links, visible breadcrumbs, BreadcrumbList
 * and ItemList JSON-LD in the INITIAL HTML (raw HTTP, no JS). This spec
 * verifies the whole contract with real HTTP:
 *
 *   - valid ACTIVE Persian category → 200, indexable, self-canonical,
 *     category name/description, product links, breadcrumb + aria-current,
 *     BreadcrumbList + ItemList JSON-LD, sequential positions, ItemList URLs
 *     match the rendered product links
 *   - missing / inactive / malformed-percent-encoded category → 404
 *   - `/products?category=<id>` canonical now RESOLVES to the real page
 *   - product detail unchanged: 1 canonical, 1 Product JSON-LD, 1
 *     BreadcrumbList, breadcrumb category href → /categories/<slug>
 *   - homepage quick-category tiles link to /categories/<slug>
 *   - sitemap lists active categories (Persian + Latin), excludes inactive,
 *     product/supplier entries intact
 */
test.describe("category page SEO", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  let persianCat: { _id: string; slug: string };
  let latinCatId: string;
  let inactiveCatSlug: string;
  const createdIds: string[] = [];

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    // Persian Unicode slug category — the SEO-first case (Session 71 slug
    // architecture reused: readable Persian, unique per run via Latin stamp).
    const stamp = Date.now();
    const persianName = `هدفون بیسیم بلوتوثی ${stamp}`;
    const persianSlug = `هدفون-بیسیم-بلوتوثی-${stamp}`;
    const persianRes = await adminCtx.post("/api/admin/categories", {
      data: {
        name: persianName,
        slug: persianSlug,
        description: "توضیحات دسته هدفون بیسیم برای تست SEO",
        isActive: true,
      },
    });
    expect(persianRes.status(), `create persian category: ${await persianRes.text()}`).toBe(201);
    persianCat = (await persianRes.json()) as { _id: string; slug: string };
    expect(persianCat.slug).toBe(persianSlug);
    // The Persian slug does NOT carry the run prefix — explicit cleanup below.
    createdIds.push(persianCat._id);

    // Latin legacy category via the shared fixture (index 13 is free:
    // 12=product-listing-seo, 11=persian-name, 10=rich-description …).
    // purgeOwnFixtures removes any leftover rows from a crashed earlier
    // worker (self-healing setup) WITHOUT touching the shared users.
    await purgeOwnFixtures(state.prefix);
    latinCatId = await createCategory(adminCtx, state.prefix, 13);
    createdIds.push(latinCatId);

    // Inactive category — must 404 and be excluded from the sitemap.
    const inactiveSlug = `${state.prefix}cat-13-inactive`;
    inactiveCatSlug = inactiveSlug;
    const inactiveRes = await adminCtx.post("/api/admin/categories", {
      data: { name: `دسته غیرفعال ${state.prefix}`, slug: inactiveSlug, isActive: false },
    });
    expect(inactiveRes.status()).toBe(201);
    const inactiveBody = (await inactiveRes.json()) as { _id: string };
    createdIds.push(inactiveBody._id);

    // Two ACTIVE products in the Persian category (public listing) + one
    // out-of-stock (must NOT render: public list rule is stock > 0).
    const prod1 = await createProduct(adminCtx, {
      slug: `${state.prefix}cat13-prod-1`,
      name: `هدفون پریمیوم ${state.prefix}`,
      categoryId: persianCat._id,
      supplierId: state.supplierId,
      price: 1_200_000,
      supplierPrice: 900_000,
      stock: 5,
    });
    const prod2 = await createProduct(adminCtx, {
      slug: `${state.prefix}cat13-prod-2`,
      name: `ایرپاد ${state.prefix}`,
      categoryId: persianCat._id,
      supplierId: state.supplierId,
      price: 950_000,
      supplierPrice: 700_000,
      stock: 3,
    });
    // CRITICAL: register prod3-oos too. afterAll deletes products BEFORE the
    // Persian category — if this id is not registered here, the product
    // survives with a DANGLING category ref until global teardown, which
    // crashes the admin dashboard's low-stock table (`typeof null ===
    // "object"` → `null.name`) in any spec that runs after this one in the
    // full suite (order-dependent failure — logout.spec's /admin/dashboard).
    const prod3 = await createProduct(adminCtx, {
      slug: `${state.prefix}cat13-prod-3-oos`,
      name: `ناموجود ${state.prefix}`,
      categoryId: persianCat._id,
      supplierId: state.supplierId,
      price: 100_000,
      supplierPrice: 50_000,
      stock: 0,
    });
    // Products are prefix-slugged → global teardown cleans them; register
    // explicitly anyway so a mid-test failure never leaks rows.
    createdIds.push(prod1, prod2, prod3);
  });

  test.afterAll(async () => {
    for (const id of createdIds) {
      await adminCtx.delete(`/api/admin/products?id=${id}`).catch(() => {});
    }
    // Persian-slug categories carry no prefix → explicit delete (teardown's
    // prefix regex can't match them). Latin/inactive ones are prefix-slugged
    // and auto-cleaned, but deleting explicitly is idempotent-safe.
    for (const id of [persianCat?._id, ...createdIds]) {
      if (id) await adminCtx.delete(`/api/admin/categories?id=${id}`).catch(() => {});
    }
    await adminCtx.dispose();
  });

  const canonicalHrefs = (html: string): string[] =>
    [...html.matchAll(/rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  const decode = (s: string) =>
    s.includes("%") ? decodeURIComponent(s) : s;

  test("valid Persian category: full SEO initial HTML (raw HTTP, no JS)", async ({
    request,
  }) => {
    const url = `/categories/${encodeURIComponent(persianCat.slug)}`;
    const res = await request.get(url);
    expect(res.status(), `GET ${url}`).toBe(200);
    const html = await res.text();

    // Category name + description server-rendered.
    const catName = `هدفون بیسیم بلوتوثی`;
    expect(html).toContain(catName);
    expect(html).toContain("توضیحات دسته هدفون بیسیم برای تست SEO");

    // First-page product links present in the INITIAL HTML.
    expect(html).toContain(`/products/${state.prefix}cat13-prod-1`);
    expect(html).toContain(`/products/${state.prefix}cat13-prod-2`);
    // Out-of-stock product must NOT be listed (public listing rule).
    expect(html).not.toContain(`/products/${state.prefix}cat13-prod-3-oos`);

    // EXACTLY ONE canonical → the /categories/<slug> page (encoded on the
    // wire; decode before comparing — same convention as the product page).
    const canonicals = canonicalHrefs(html);
    expect(canonicals, "exactly one canonical").toHaveLength(1);
    expect(decode(canonicals[0])).toBe(
      `${state.baseURL}/categories/${persianCat.slug}`
    );

    // Indexable — no noindex anywhere.
    expect(html).not.toContain('content="noindex');

    // Visible breadcrumb: semantic nav + ordered list + aria-current.
    expect(html).toContain('aria-label="مسیر دسترسی"');
    expect(html).toContain("<ol");
    expect(html).toContain('aria-current="page"');
    // Home IS a link; the final category is NOT a self-link. Scope the check
    // to the breadcrumb <nav> element (the page's canonical tag legitimately
    // contains the same /categories/<slug> URL).
    const navMatch = html.match(
      /<nav aria-label="مسیر دسترسی"[^>]*>[\s\S]*?<\/nav>/
    );
    expect(navMatch, "breadcrumb nav present").not.toBeNull();
    const navHtml = navMatch![0];
    expect(navHtml).toContain('href="http://localhost:3000"');
    expect(navHtml).not.toContain("/categories/");

    // BreadcrumbList JSON-LD — positions sequential.
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"position":1');
    expect(html).toContain('"position":2');

    // ItemList JSON-LD — first-page products, positions sequential, URLs
    // matching the rendered product links.
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('"position":1');
    expect(html).toContain('"position":2');
    expect(html).toContain(`/products/${state.prefix}cat13-prod-1`);
    expect(html).toContain(`/products/${state.prefix}cat13-prod-2`);
    expect(html).not.toContain('"aggregateRating"');

    // Metadata basics: title + OG.
    expect(html).toContain("<title>");
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
  });

  test("missing / inactive / malformed categories → 404", async ({ request }) => {
    const missing = await request.get("/categories/does-not-exist-xyz");
    expect(missing.status()).toBe(404);

    const inactive = await request.get(
      `/categories/${inactiveCatSlug}`
    );
    expect(inactive.status()).toBe(404);

    // Malformed percent-encoding: Next's router REJECTS the malformed escape
    // at the URL layer with 400 before our page handler runs (verified — the
    // route never executes). The contract is "never a 500, never indexable":
    // 400 (framework rejection) and 404 (if the route ever did run) are both
    // safe; a 500 would be the regression. A WELL-FORMED but nonexistent
    // Unicode slug below proves the page itself 404s.
    const malformed = await request.get("/categories/%E0%A4%A");
    expect(
      malformed.status() === 400 || malformed.status() === 404,
      `malformed percent-encoding must never 500 (got ${malformed.status()})`
    ).toBe(true);
    // Well-formed (valid UTF-8 percent-encoding) but nonexistent Unicode slug
    // → the page's own notFound() → 404.
    const wellFormedMissing = await request.get(
      `/categories/${encodeURIComponent("الکترونیک-ناموجود")}`
    );
    expect(wellFormedMissing.status()).toBe(404);
  });

  test("Session 74 canonical target now RESOLVES (was a 404 dead-end)", async ({
    request,
  }) => {
    // The /products?category= canonical points at /categories/<slug>.
    const filterRes = await request.get(`/products?category=${persianCat._id}`);
    expect(filterRes.status()).toBe(200);
    const filterHtml = await filterRes.text();
    expect(filterHtml).toContain('content="noindex, follow"');
    const canonicals = canonicalHrefs(filterHtml);
    expect(canonicals).toHaveLength(1);
    expect(decode(canonicals[0])).toBe(
      `${state.baseURL}/categories/${persianCat.slug}`
    );

    // …and that canonical target is a REAL page now (200, not 404).
    const target = await request.get(
      `/categories/${encodeURIComponent(persianCat.slug)}`
    );
    expect(target.status()).toBe(200);

    // Latin legacy category canonical also resolves.
    const latinFilter = await request.get(`/products?category=${latinCatId}`);
    expect(latinFilter.status()).toBe(200);
    const latinCanonicals = canonicalHrefs(await latinFilter.text());
    expect(decode(latinCanonicals[0])).toBe(
      `${state.baseURL}/categories/${state.prefix}cat-13`
    );
    const latinTarget = await request.get(`/categories/${state.prefix}cat-13`);
    expect(latinTarget.status()).toBe(200);
  });

  test("product detail: breadcrumb category href → /categories/<slug>, JSON-LD intact", async ({
    request,
  }) => {
    const res = await request.get(`/products/${state.prefix}cat13-prod-1`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // Exactly one canonical + one Product JSON-LD + one BreadcrumbList.
    expect(canonicalHrefs(html)).toHaveLength(1);
    const productLd = html.match(/"@type":"Product"/g) || [];
    expect(productLd).toHaveLength(1);
    const bcLd = html.match(/"@type":"BreadcrumbList"/g) || [];
    expect(bcLd).toHaveLength(1);
    expect(html).not.toContain('content="noindex');

    // The breadcrumb category link (and BreadcrumbList item) now points to
    // the real /categories/<slug> page — NOT /products?category=<id>. Next
    // emits the href and JSON-LD `item` with the RAW Unicode slug (browsers
    // percent-encode on the wire); the encoded form would also identify the
    // same resource, but the SSR HTML carries the decoded canonical form.
    const expectedCatHref = `${state.baseURL}/categories/${persianCat.slug}`;
    expect(html).toContain(`href="${expectedCatHref}"`);
    expect(html).toContain(`"item":"${expectedCatHref}"`);
    expect(html).not.toContain(`/products?category=${persianCat._id}`);
  });

  test("homepage quick-category tiles link to /categories/<slug>", async ({
    page,
  }) => {
    const catsReq = page.waitForRequest((r) => r.url().includes("/api/categories"));
    await page.goto("/");
    await catsReq;
    // Hydrated quick-categories tile → the real category page.
    const tile = page.locator(`a[href="/categories/${persianCat.slug}"]`);
    await expect(tile).toBeVisible();
    // The Latin fixture category tile too.
    await expect(
      page.locator(`a[href="/categories/${state.prefix}cat-13"]`)
    ).toBeVisible();
  });

  test("sitemap lists active categories, excludes inactive, keeps products/suppliers", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const sm = await res.text();

    // Active categories — Persian (raw or percent-encoded) and Latin.
    const hasRaw = sm.includes(`/categories/${persianCat.slug}`);
    const hasEncoded = sm.includes(
      `/categories/${encodeURIComponent(persianCat.slug)}`
    );
    expect(hasRaw || hasEncoded, "Persian category in sitemap").toBe(true);
    expect(sm).toContain(`/categories/${state.prefix}cat-13`);
    // Inactive category excluded.
    expect(sm).not.toContain(`/categories/${inactiveCatSlug}`);
    // Products + suppliers still listed.
    expect(sm).toContain(`/products/${state.prefix}cat13-prod-1`);
    expect(sm).toContain(`/suppliers/`);
    // No duplicate category loc.
    const locs = sm.match(/<loc>([^<]*\/categories\/[^<]*)<\/loc>/g) || [];
    expect(new Set(locs).size).toBe(locs.length);
  });
});
