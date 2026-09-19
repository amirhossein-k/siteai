import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  addToCartAndAwaitToast,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey — Product Discounts / Sale Pricing (Session 77).
 *
 * Admin enables a 20% discount on a product through the REAL edit form (live
 * calculation verified), then the storefront shows the struck-through
 * original + effective price + badge, the homepage «محصولات تخفیف‌دار» rail
 * contains the product, checkout pays the server-authoritative discounted
 * price, and after the discount expires the product returns to its normal
 * price, leaves the discounted rail, and the previously created order stays
 * immutable.
 */
test.describe("Product Discount Journey", () => {
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let productId: string;
  let categoryId: string;
  // Shared across tests (workers: 1, sequential within the file).
  let createdOrderId = "";
  const productName = () => `هدفون تخفیف‌دار ${state.prefix}`;
  // The e2e prefix contains underscores, but the product form's slug regex
  // only allows letters/digits/hyphens — normalize for a form-valid slug.
  const productSlug = () => `${state.prefix.replace(/_/g, "-")}disc-prod`;
  const price = 2_000_000;
  const effective = 1_600_000; // 20% of 2,000,000
  const discountAmount = 400_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // Idempotent fixture creation: a worker restart after a failure re-runs
    // beforeAll against fixtures that may already exist (409 on the slug).
    // Pick the first free category index, then reuse the existing product if
    // a previous run already created it.
    for (let idx = 14; idx < 40; idx++) {
      try {
        categoryId = await createCategory(adminCtx, state.prefix, idx);
        break;
      } catch (e) {
        // Only a duplicate-slug 409 means "try the next index" — anything
        // else (e.g. a 500) must fail loudly instead of being masked.
        if (!String(e).includes("409")) throw e;
      }
    }
    expect(categoryId).toBeTruthy();

    const searchRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productSlug())}`
    );
    const existing = (
      (await searchRes.json()) as { data: Array<{ _id: string; slug: string }> }
    ).data.find((p) => p.slug === productSlug());
    if (existing) {
      productId = existing._id;
    } else {
      productId = await createProduct(adminCtx, {
        slug: productSlug(),
        name: productName(),
        categoryId,
        supplierId: state.supplierId,
        price,
        supplierPrice: 1_100_000,
        stock: 20,
      });
    }
    // Idempotent homepage seed — ensures the «محصولات تخفیف‌دار» section row
    // exists (seedHomepageContent inserts MISSING default sections only).
    const seedRes = await adminCtx.get("/api/admin/homepage/sections");
    expect(seedRes.ok()).toBeTruthy();
  });

  test("admin enables a 20% discount with a correct live calculation", async ({
    page,
  }) => {
    await page.goto(`/admin/products/${productId}/edit`);
    await expect(
      page.getByRole("heading", { name: "ویرایش محصول" })
    ).toBeVisible();

    // Enable the discount card.
    await page.getByRole("switch", { name: /فعال‌سازی تخفیف/ }).click();
    // Type defaults to «درصدی» — just enter the value.
    await page.getByLabel("مقدار تخفیف").fill("20");

    // Live calculation — same math as the server: ۲٬۰۰۰٬۰۰۰ → ۲۰٪ → ۱٬۶۰۰٬۰۰۰.
    // (the input value renders as ASCII digits: "20٪"; formatPrice uses
    // Persian digits for the toman figures).
    await expect(page.getByText("20٪")).toBeVisible();
    await expect(page.getByText(/۱٬۶۰۰٬۰۰۰/)).toBeVisible();

    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("محصول با موفقیت ویرایش شد")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products$/);
  });

  test("storefront shows struck-through original + effective price + badge + discounted JSON-LD", async ({
    page,
  }) => {
    await page.goto(`/products/${productSlug()}`);
    // Discount badge (configured percentage — ASCII digits from the number).
    await expect(page.getByText("٪20 تخفیف")).toBeVisible();
    // Effective price prominent + original struck through. (.first(): the
    // Session 85 mobile sticky buy bar duplicates the price in a lg:hidden
    // bar that getByText still matches — the visible price card is first.)
    await expect(page.getByText(/۱٬۶۰۰٬۰۰۰/).first()).toBeVisible();
    const original = page.getByText(/۲٬۰۰۰٬۰۰۰/).first();
    await expect(original).toHaveClass(/line-through/);

    // Product JSON-LD offers.price = the effective price (server-rendered).
    const ldBlocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const productLd = ldBlocks.find((b) => b.includes('"@type":"Product"'));
    expect(productLd).toBeTruthy();
    expect(productLd).toContain(`"price":${effective}`);
  });

  test("homepage «محصولات تخفیف‌دار» rail shows the product", async ({
    page,
  }) => {
    await page.goto("/");
    // The discounted rail mounts lazily (IntersectionObserver) — scroll down
    // until the section renders.
    await page.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        window.scrollBy(0, 500);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const rail = page.locator("section", {
      has: page.getByRole("heading", { name: "محصولات تخفیف‌دار" }),
    });
    await expect(rail.getByRole("heading", { name: "محصولات تخفیف‌دار" })).toBeVisible();
    await expect(
      rail.getByRole("link", { name: new RegExp(productName()) })
    ).toBeVisible();
  });

  test("checkout pays the server-authoritative discounted price and snapshots it", async ({
    browser,
    playwright,
  }) => {
    // Customer session (the describe uses the admin storageState).
    const ctx = await browser.newContext({
      storageState: getState().customerStatePath,
    });
    const customerPage = await ctx.newPage();

    // 1. Add to cart from the product page (cart stores the EFFECTIVE price).
    await customerPage.goto(`/products/${productSlug()}`);
    await addToCartAndAwaitToast(customerPage);

    // 2. Checkout — fill the shipping form.
    await customerPage.goto("/checkout");
    await expect(
      customerPage.getByRole("heading", { name: "اطلاعات ارسال" })
    ).toBeVisible();
    await customerPage
      .getByPlaceholder("مثال: علی محمدی")
      .fill(`مشتری ${state.prefix}`);
    await customerPage
      .getByPlaceholder("مثال: ۰۹۱۲۳۴۵۶۷۸۹")
      .fill(state.customerPhone);
    await customerPage
      .getByPlaceholder("استان، شهر، خیابان، پلاک، واحد")
      .fill("تهران، خیابان آزادی، پلاک ۱");
    await customerPage
      .getByPlaceholder("مثال: ۱۲۳۴۵۶۷۸۹۰")
      .fill("1234567890");

    // 3. Place the order and capture the created order id.
    const [checkoutRes] = await Promise.all([
      customerPage.waitForResponse(
        (r) => r.url().includes("/api/checkout") && r.request().method() === "POST"
      ),
      customerPage.getByRole("button", { name: "ثبت سفارش" }).click(),
    ]);
    const { orderId } = (await checkoutRes.json()) as { orderId: string };
    expect(orderId).toBeTruthy();
    await ctx.close();

    // 4. Server-side: the order total = discounted price; the item snapshot
    // carries the effective unit price + original price + discount amount.
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const orderRes = await customerCtx.get(`/api/orders?id=${orderId}`);
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      totalAmount: number;
      items: Array<{
        price: number;
        originalPrice?: number | null;
        discountAmount?: number;
      }>;
    };
    expect(order.totalAmount).toBe(effective);
    expect(order.items[0].price).toBe(effective);
    expect(order.items[0].originalPrice).toBe(price);
    expect(order.items[0].discountAmount).toBe(discountAmount);

    // Remember the order for the immutability test (expiry must not touch it).
    createdOrderId = orderId;
  });

  test("after expiration the product returns to normal price, leaves the discounted rail, and the order stays immutable", async ({
    page,
    playwright,
  }) => {
    // Expire the discount via the admin API (a real past window).
    const now = Date.now();
    const putRes = await adminCtx.put(`/api/admin/products?id=${productId}`, {
      data: {
        name: productName(),
        slug: productSlug(),
        description: "محصول E2E — حذف میشود",
        images: [],
        category: categoryId,
        supplier: state.supplierId,
        supplierPrice: 1_100_000,
        price,
        stock: 20,
        hasVariants: false,
        variants: [],
        isActive: true,
        discount: {
          type: "percent",
          value: 20,
          startsAt: new Date(now - 7_200_000).toISOString(),
          endsAt: new Date(now - 3_600_000).toISOString(),
          isActive: true,
        },
      },
    });
    expect(putRes.ok()).toBeTruthy();

    // Storefront: normal price only — no badge, no strikethrough.
    await page.goto(`/products/${productSlug()}`);
    await expect(page.getByText("٪20 تخفیف")).toHaveCount(0);
    const original = page.getByText(/۲٬۰۰۰٬۰۰۰/).first();
    await expect(original).toBeVisible();
    await expect(original).not.toHaveClass(/line-through/);

    // Discounted rail: the product is no longer returned by discounted=true.
    const discRes = await adminCtx.get("/api/products?discounted=true&limit=50");
    expect(discRes.ok()).toBeTruthy();
    const slugs = ((await discRes.json()) as { data: { slug: string }[] }).data.map(
      (p) => p.slug
    );
    expect(slugs).not.toContain(productSlug());

    // The previously created order is immutable — unchanged after expiration.
    expect(createdOrderId).toBeTruthy();
    const customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });
    const orderRes = await customerCtx.get(`/api/orders?id=${createdOrderId}`);
    const order = (await orderRes.json()) as {
      totalAmount: number;
      items: Array<{
        price: number;
        originalPrice?: number | null;
        discountAmount?: number;
      }>;
    };
    expect(order.totalAmount).toBe(effective);
    expect(order.items[0].price).toBe(effective);
    expect(order.items[0].originalPrice).toBe(price);
    expect(order.items[0].discountAmount).toBe(discountAmount);
  });
});
