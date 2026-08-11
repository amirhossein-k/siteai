import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, type E2EState } from "./helpers/fixtures";

// Admin product-form journeys — run with the admin session.
test.use({ storageState: getState().adminStatePath });

/**
 * Journey 19 — Persian product names, SEO slugs & visible validation
 * (Sessions 70–71).
 *
 * Regression guards for the two proven root causes:
 *  1. A Persian-only product name auto-generated an INVALID slug ("-" after
 *     stripping every non-ASCII char), RHF validation blocked the submit, and
 *     the error was invisible (React Compiler) — the dead-click bug.
 *  2. The first slug fix used a p-<hash> fallback; the SEO audit replaced it
 *     with human-readable Unicode slugs («هدفون-بیسیم-بلوتوثی») + a
 *     deterministic -2 suffix for auto-generated collisions.
 *
 * Test 1 drives the REAL form with a Persian-only name and asserts the
 * auto-slug is a readable Unicode slug, the POST fires (201), the storefront
 * renders the product, and the canonical link + JSON-LD url use the Unicode
 * product URL.
 *
 * Test 2 asserts the deterministic collision handling through the REAL admin
 * API: the same Persian name/slug created twice with autoSlug:true → the
 * second gets «-2» (201, not 409); a manual slug (autoSlug:false) keeps the
 * 409 behavior.
 *
 * Test 3 submits with missing required selects and asserts the actual Persian
 * FormMessage text is visible on screen — not just a silent scroll-to-top —
 * and that no request is fired.
 */
test.describe("Persian product name auto-slug", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  let categoryId: string;
  const createdIds: string[] = [];

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // Category index 11 is free (1=product-search, 2=product-detail, 3=cart,
    // 4=checkout, 5=coupon, 6=payment, 7=order-tracking, 8=admin-order-workflow,
    // 9=supplier-workflow, 10=rich-description, 33=cart mobile, 99=accessibility).
    categoryId = await createCategory(adminCtx, state.prefix, 11);
  });

  test.afterAll(async () => {
    // The Unicode slug contains the Latin timestamp so prefix teardown CAN
    // find it — but delete explicitly anyway (runs even if a test failed
    // mid-way, and test 2's slugs are shared across the two API creations).
    for (const id of createdIds) {
      await adminCtx.delete(`/api/admin/products?id=${id}`);
    }
    await adminCtx.dispose();
  });

  test("Persian-only name auto-generates a readable Unicode slug and renders on the storefront", async ({
    page,
  }) => {
    // Unique-but-purely-Persian name: Persian digits (U+06F0-06F9) are
    // normalized to Latin digits by slugify, so the auto-slug ends with a
    // Latin timestamp — unique per run, no leftover collision.
    const faDigits = "۰۱۲۳۴۵۶۷۸۹";
    const persianStamp = String(Date.now()).replace(/\d/g, (d) =>
      faDigits[Number(d)]
    );
    const persianName = `هدفون بیسیم بلوتوثی ${persianStamp}`;

    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    // Type the Persian-only name — the slug MUST auto-generate as a readable
    // Unicode slug (previously it became "-" and blocked submit; the interim
    // fix produced p-<hash>). The regex is ZWNJ-tolerant: «بیسیم» may be
    // typed with or without a نیمفاصله (U+200C → "-") — either way the slug
    // is fully Persian words joined by single hyphens, ending with the
    // Latin-digit stamp. Read the value BEFORE submitting: the submit
    // redirects away from this page, so the input is detached afterwards.
    await page.getByLabel("نام محصول").fill(persianName);
    const slugInput = page.getByLabel("اسلاگ (لینک)");
    await expect(slugInput).toHaveValue(
      /^[\u0600-\u06FF]+(?:-[\u0600-\u06FF]+)*-\d+$/
    );
    const slug = (await slugInput.inputValue()).trim();
    // Sanity: it must NOT be a hash fallback and must be human-readable.
    expect(slug).not.toMatch(/^p-[0-9a-f]+$/);

    // Required selects + pricing. Select the CREATED category by value (not
    // index) so the storefront breadcrumb assertions below are deterministic
    // (Home → Category → Product).
    await page.getByLabel(/دسته/).selectOption({ value: categoryId });
    await page.getByLabel(/فروشنده/).selectOption({ index: 1 });
    await page.getByLabel("قیمت فروش (تومان)").fill("850000");
    await page.getByLabel("قیمت تأمین (تومان)").fill("650000");
    await page.getByLabel("موجودی").fill("5");

    // Type a Persian description into the real Plate editor — the derived
    // plain-text projection must feed the <meta name="description"> below
    // (a crawler must see it in the initial HTML, not only after hydration).
    const descEditor = page.getByLabel("توضیحات محصول");
    await expect(descEditor).toBeVisible();
    await descEditor.click();
    await page.keyboard.type(
      "هدفون بیسیم با کیفیت عالی و ارسال سریع — تست توضیحات محصول"
    );

    // Submit → the POST must fire (this was the dead-click signature).
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/api/admin/products")
      ),
      page.getByRole("button", { name: "ایجاد محصول" }).click(),
    ]);
    expect(createRes.status()).toBe(201);

    await expect(page.getByText("محصول با موفقیت ایجاد شد")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products$/);

    // Persisted with the readable Unicode slug.
    const listRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(slug)}`
    );
    expect(listRes.ok()).toBeTruthy();
    const listBody = (await listRes.json()) as { data: { _id: string }[] };
    expect(listBody.data.length).toBeGreaterThan(0);
    createdIds.push(listBody.data[0]._id);

    // Storefront renders the product by its Unicode slug (the browser/Next
    // percent-encode the non-ASCII path automatically).
    await page.goto(`/products/${slug}`);
    await expect(
      page.getByRole("heading", { name: persianName })
    ).toBeVisible();

    // Session 72 — visible breadcrumb (server-rendered initial HTML).
    // Home → Category → Product (the category is root — no parent chain).
    const categoryName = `دسته E2E ${state.prefix}11`;
    const breadcrumb = page.getByRole("navigation", { name: "مسیر دسترسی" });
    await expect(breadcrumb).toBeVisible();
    const homeLink = breadcrumb.getByRole("link", { name: "صفحه اصلی" });
    await expect(homeLink).toBeVisible();
    // The Home link is an absolute URL (from APP_URL).
    await expect(homeLink).toHaveAttribute("href", state.baseURL);
    const categoryLink = breadcrumb.getByRole("link", { name: categoryName });
    await expect(categoryLink).toBeVisible();
    // Session 75 — category breadcrumb links point to the REAL indexable
    // category page /categories/<slug> (createCategory builds the slug as
    // `${prefix}cat-<index>`), never the noindex filter surface. Absolute
    // URL (from APP_URL).
    const categorySlug = `${state.prefix}cat-11`;
    await expect(categoryLink).toHaveAttribute(
      "href",
      `${state.baseURL}/categories/${categorySlug}`
    );
    // The product name is the FINAL breadcrumb item — plain text with aria-current.
    const productCrumb = breadcrumb.getByText(persianName, { exact: true });
    await expect(productCrumb).toBeVisible();
    await expect(productCrumb).toHaveAttribute("aria-current", "page");

    // Canonical link — the href carries the product URL. Next.js's metadata
    // serializer percent-encodes the Unicode slug on the wire (browsers and
    // search engines decode it — the encoded and decoded forms identify the
    // SAME resource), so accept either form.
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    const href = await canonical.getAttribute("href");
    const expectedRaw = `${state.baseURL}/products/${slug}`;
    const expectedEncoded = `${state.baseURL}/products/${encodeURIComponent(slug)}`;
    expect(
      href === expectedRaw || href === expectedEncoded,
      `canonical must point at the product URL (got: ${href})`
    ).toBe(true);

    // JSON-LD Product schema — same Unicode product URL (SEO structured data).
    const allLdScripts = page.locator('script[type="application/ld+json"]');
    const productLd = await allLdScripts.evaluateAll((scripts) => {
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent || "{}") as Record<string, unknown>;
          if (data["@type"] === "Product") return data;
        } catch {
          // skip non-JSON / malformed scripts
        }
      }
      return null;
    });
    expect(productLd).not.toBeNull();
    expect(productLd?.["name"]).toBe(persianName);
    expect(productLd?.["url"]).toBe(`${state.baseURL}/products/${slug}`);

    // BreadcrumbList JSON-LD — same evaluateAll, look for BreadcrumbList.
    const bcLd = await allLdScripts.evaluateAll((scripts) => {
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent || "{}") as Record<string, unknown>;
          if (data["@type"] === "BreadcrumbList") return data;
        } catch {
          // skip
        }
      }
      return null;
    });
    expect(bcLd).not.toBeNull();
    const elements = (bcLd as Record<string, unknown[]>)["itemListElement"];
    expect(elements).toHaveLength(3);
    expect((elements[0] as { position: number }).position).toBe(1);
    expect((elements[1] as { position: number }).position).toBe(2);
    expect((elements[2] as { position: number }).position).toBe(3);
    // First item = Home (absolute URL).
    expect((elements[0] as { item: string }).item).toBe(state.baseURL);
    // Second item = Category (absolute URL — the /categories/<slug> page,
    // Session 75).
    expect((elements[1] as { item: string }).item).toBe(
      `${state.baseURL}/categories/${state.prefix}cat-11`
    );
    // Third item = Product (the current page) — no `item` per Google guidance.
    expect((elements[2] as { item?: string }).item).toBeUndefined();

    // Session 71 — SEO metadata must live in the INITIAL server HTML (a
    // crawler with no JavaScript must see title/description/canonical/OG/
    // Twitter/JSON-LD). Raw fetch = no client JS, exactly what Googlebot
    // receives on first crawl.
    const raw = await page.request.get(`/products/${slug}`);
    expect(raw.status()).toBe(200);
    const html = await raw.text();
    expect(html).toContain(`<title>`);
    // The meta description is emitted (the product HAS a description now) and
    // carries the Persian plain-text projection, not raw HTML or nothing.
    expect(html).toContain(`<meta name="description"`);
    expect(html).toContain(
      'name="description" content="هدفون بیسیم با کیفیت عالی و ارسال سریع'
    );
    expect(html).toContain(`rel="canonical"`);
    expect(html).toContain(`property="og:title"`);
    expect(html).toContain(`property="og:url"`);
    expect(html).toContain(`name="twitter:card"`);
    expect(html).toContain(`application/ld+json`);
    expect(html).toContain(`${state.baseURL}/products/${slug}`);
    // Session 72 — the initial HTML must contain the BreadcrumbList structured
    // data (server-rendered, not hydration-dependent).
    expect(html).toContain('"@type":"BreadcrumbList"');
    // The page must NOT emit noindex anywhere.
    expect(html).not.toContain('content="noindex');
  });

  test("sitemap.xml lists indexable products (incl. Unicode slugs) and excludes inactive ones", async () => {
    const stamp = Date.now();
    const latinSlug = `sitemap-${stamp}`;
    const unicodeSlug = `کولر-گازی-${stamp}`;
    const inactiveSlug = `sitemap-inactive-${stamp}`;
    const mkPayload = (slug: string, isActive: boolean) => ({
      name: `محصول sitemap ${stamp}`,
      slug,
      autoSlug: false,
      description: "محصول E2E — تست sitemap",
      images: [],
      category: categoryId,
      supplier: state.supplierId,
      supplierPrice: 650000,
      price: 850000,
      stock: 5,
      hasVariants: false,
      variants: [],
      isActive,
    });

    const [latinRes, unicodeRes, inactiveRes] = await Promise.all([
      adminCtx.post("/api/admin/products", { data: mkPayload(latinSlug, true) }),
      adminCtx.post("/api/admin/products", { data: mkPayload(unicodeSlug, true) }),
      adminCtx.post("/api/admin/products", { data: mkPayload(inactiveSlug, false) }),
    ]);
    // Register for cleanup BEFORE asserting — a failure here must not leak rows.
    const bodies = (await Promise.all([
      latinRes.json(),
      unicodeRes.json(),
      inactiveRes.json(),
    ])) as { _id: string }[];
    for (const b of bodies) createdIds.push(b._id);
    expect(latinRes.status()).toBe(201);
    expect(unicodeRes.status()).toBe(201);
    expect(inactiveRes.status()).toBe(201);

    const smRes = await adminCtx.get("/sitemap.xml");
    expect(smRes.status()).toBe(200);
    const sm = await smRes.text();

    // Active products — Latin and Unicode slugs — are discoverable.
    expect(sm).toContain(`/products/${latinSlug}`);
    // Next emits UTF-8 XML; tolerate raw vs percent-encoded Unicode loc.
    const hasRaw = sm.includes(`/products/${unicodeSlug}`);
    const hasEncoded = sm.includes(`/products/${encodeURIComponent(unicodeSlug)}`);
    expect(
      hasRaw || hasEncoded,
      "sitemap contains the Unicode product URL"
    ).toBe(true);
    // Inactive (unpublished) products must NOT be listed.
    expect(sm).not.toContain(`/products/${inactiveSlug}`);
  });

  test("duplicate Persian names get a deterministic -2 suffix; manual slugs keep 409", async () => {
    const stamp = Date.now();
    const baseName = `هدفون بیسیم بلوتوثی ${stamp}`;
    const baseSlug = `هدفون-بیسیم-بلوتوثی-${stamp}`;
    const payload = {
      name: baseName,
      slug: baseSlug,
      autoSlug: true, // derived from the name — collision → deterministic suffix
      description: "محصول E2E — تست اسلاگ",
      images: [],
      category: categoryId,
      supplier: state.supplierId,
      supplierPrice: 650000,
      price: 850000,
      stock: 5,
      hasVariants: false,
      variants: [],
      isActive: true,
    };

    // First product keeps the base slug.
    const first = await adminCtx.post("/api/admin/products", { data: payload });
    expect(first.status(), `first create: ${await first.text()}`).toBe(201);
    const firstBody = (await first.json()) as { _id: string; slug: string };
    expect(firstBody.slug).toBe(baseSlug);
    createdIds.push(firstBody._id);

    // Same name again → auto-generated slug gets the deterministic -2 suffix
    // (NOT a 409, NOT a hash).
    const second = await adminCtx.post("/api/admin/products", { data: payload });
    expect(second.status(), `second create: ${await second.text()}`).toBe(201);
    const secondBody = (await second.json()) as { _id: string; slug: string };
    expect(secondBody.slug).toBe(`${baseSlug}-2`);
    createdIds.push(secondBody._id);

    // A MANUALLY-entered slug (autoSlug absent) stays authoritative → 409 on
    // conflict, exactly as before Session 70.
    const manual = await adminCtx.post("/api/admin/products", {
      data: { ...payload, autoSlug: false },
    });
    expect(manual.status()).toBe(409);
  });

  test("missing required fields show visible Persian validation messages", async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/admin/products")) {
        posts.push(r.url());
      }
    });

    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    // Valid name (Latin → valid auto-slug) so ONLY category/supplier are
    // missing — the exact scenario that used to silently scroll to the top.
    await page.getByLabel("نام محصول").fill(`ValidName${Date.now()}`);
    await expect(page.getByLabel("اسلاگ (لینک)")).not.toHaveValue(/^-/);

    await page.getByRole("button", { name: "ایجاد محصول" }).click();

    // The actual Persian validation messages must be VISIBLE (this was the
    // invisible-error half of the bug — no message, no request). Regex
    // locators tolerate the ZWNJ (نیمفاصله) inside «دستهبندی».
    await expect(page.getByText(/بندی الزامی است/)).toBeVisible();
    await expect(page.getByText(/فروشنده الزامی است/)).toBeVisible();

    // No request may have been fired — the submit was blocked client-side.
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(0);
  });
});
