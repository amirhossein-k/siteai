import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey — Discount Countdown & Automatic Expiry (Session 78).
 *
 * A product discount ending ~90 seconds in the future (REAL server clock, no
 * faked time) drives a Persian countdown chip on the product detail page, on
 * the catalog card, and a section-level countdown in the homepage
 * «محصولات تخفیف‌دار» rail aside. An open-ended discount (endsAt=null) shows
 * NO countdown anywhere while staying normally discounted. When the countdown
 * reaches zero the rail refetches ONCE (no polling, no reload), the expired
 * product leaves the rail (server-authoritative), and a fresh render of the
 * detail page shows only the normal price — no stale badge, no countdown.
 */
test.describe("Discount Countdown Journey", () => {
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let categoryId = "";
  let expireId = "";
  let noEndId = "";
  const EXPIRE_MS = 90_000; // discount window: now + 90s
  const price = 2_000_000;

  const expireSlug = () => `${state.prefix.replace(/_/g, "-")}cd-expire`;
  const noEndSlug = () => `${state.prefix.replace(/_/g, "-")}cd-noend`;
  const expireName = () => `هدفون کانتردان ${state.prefix}`;
  const noEndName = () => `هدفون بی‌پایان ${state.prefix}`;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // Idempotent category (free-index loop; a duplicate-slug 409 = try next).
    for (let idx = 24; idx < 50; idx++) {
      try {
        categoryId = await createCategory(adminCtx, state.prefix, idx);
        break;
      } catch (e) {
        if (!String(e).includes("409")) throw e;
      }
    }
    expect(categoryId).toBeTruthy();

    const now = Date.now();
    const endsAt = new Date(now + EXPIRE_MS).toISOString();

    const findExisting = async (slug: string) => {
      const res = await adminCtx.get(
        `/api/admin/products?search=${encodeURIComponent(slug)}`
      );
      const list = (await res.json()) as {
        data: Array<{ _id: string; slug: string }>;
      };
      return list.data.find((p) => p.slug === slug) ?? null;
    };
    const payload = (slug: string, name: string, discount: object) => ({
      name,
      slug,
      description: "محصول E2E — حذف می‌شود",
      images: [],
      category: categoryId,
      supplier: state.supplierId,
      supplierPrice: 800_000,
      price,
      stock: 10,
      hasVariants: false,
      variants: [],
      isActive: true,
      discount,
    });
    // Create or (idempotently) RE-fresh the discount window on a previous run's
    // leftover — the countdown test must always start from now+90s.
    const upsert = async (slug: string, name: string, discount: object) => {
      const existing = await findExisting(slug);
      if (existing) {
        const put = await adminCtx.put(
          `/api/admin/products?id=${existing._id}`,
          { data: payload(slug, name, discount) }
        );
        await expect(put.ok()).toBeTruthy();
        return existing._id;
      }
      const post = await adminCtx.post("/api/admin/products", {
        data: payload(slug, name, discount),
      });
      await expect(post.ok()).toBeTruthy();
      return ((await post.json()) as { _id: string })._id;
    };

    // Expiring discount — a real finite window from NOW.
    expireId = await upsert(expireSlug(), expireName(), {
      type: "percent",
      value: 20,
      startsAt: null,
      endsAt,
      isActive: true,
    });
    // Open-ended discount — active, but no finite end → no countdown anywhere.
    noEndId = await upsert(noEndSlug(), noEndName(), {
      type: "percent",
      value: 15,
      startsAt: null,
      endsAt: null,
      isActive: true,
    });
    expect(expireId).toBeTruthy();
    expect(noEndId).toBeTruthy();
  });

  test("product detail and catalog card show a countdown; an endsAt=null discount shows none", async ({
    page,
  }) => {
    // Detail — expiring product: badge + effective price + countdown.
    await page.goto(`/products/${expireSlug()}`);
    await expect(page.getByText("٪20 تخفیف")).toBeVisible();
    await expect(page.getByText(/۱٬۶۰۰٬۰۰۰/).first()).toBeVisible();
    const detailTimer = page.getByRole("timer");
    await expect(detailTimer).toBeVisible();
    await expect(detailTimer).toContainText("باقی مانده");

    // Detail — open-ended discount: badge yes, countdown NO.
    await page.goto(`/products/${noEndSlug()}`);
    await expect(page.getByText("٪15 تخفیف")).toBeVisible();
    await expect(page.getByRole("timer")).toHaveCount(0);

    // Catalog grid cards (the same ProductCard the rails use).
    await page.goto("/products");
    const expireCard = page.locator("div.group").filter({
      has: page.getByRole("link", { name: new RegExp(expireName()) }),
    });
    await expect(expireCard.getByRole("timer")).toBeVisible();
    const noEndCard = page.locator("div.group").filter({
      has: page.getByRole("link", { name: new RegExp(noEndName()) }),
    });
    await expect(noEndCard.getByRole("timer")).toHaveCount(0);
  });

  test("homepage «محصولات تخفیف‌دار» rail shows a section-level countdown", async ({
    page,
  }) => {
    await page.goto("/");
    // The rail mounts lazily (IntersectionObserver) — scroll until it renders.
    await page.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        window.scrollBy(0, 500);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const rail = page.locator("section", {
      has: page.getByRole("heading", { name: "محصولات تخفیف‌دار" }),
    });
    await expect(
      rail.getByRole("heading", { name: "محصولات تخفیف‌دار" })
    ).toBeVisible();
    // Section-level countdown chip in the ProductRail aside slot.
    await expect(
      rail.locator("div.flex.items-center.gap-3").getByRole("timer")
    ).toBeVisible();
    // Both discounted products are in the rail (expiring + open-ended).
    await expect(
      rail.getByRole("link", { name: new RegExp(expireName()) })
    ).toBeVisible();
    await expect(
      rail.getByRole("link", { name: new RegExp(noEndName()) })
    ).toBeVisible();
  });

  test("on expiry the product leaves the rail and returns to its normal price", async ({
    page,
  }) => {
    test.setTimeout(200_000);
    await page.goto("/");
    await page.evaluate(async () => {
      for (let i = 0; i < 30; i++) {
        window.scrollBy(0, 500);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const rail = page.locator("section", {
      has: page.getByRole("heading", { name: "محصولات تخفیف‌دار" }),
    });
    await expect(
      rail.getByRole("heading", { name: "محصولات تخفیف‌دار" })
    ).toBeVisible();

    // The countdown reaching zero triggers exactly ONE refetch — the expiring
    // product must disappear from the rail without a reload or a fake clock.
    await expect
      .poll(
        async () =>
          rail
            .getByRole("link", { name: new RegExp(expireName()) })
            .count(),
        { timeout: 150_000, intervals: [2_000, 5_000] }
      )
      .toBe(0);

    // Server-authoritative: the discounted list no longer returns the expired
    // product, while the open-ended one remains.
    const res = await adminCtx.get("/api/products?discounted=true&limit=50");
    expect(res.ok()).toBeTruthy();
    const slugs = ((await res.json()) as { data: { slug: string }[] }).data.map(
      (p) => p.slug
    );
    expect(slugs).not.toContain(expireSlug());
    expect(slugs).toContain(noEndSlug());

    // Fresh server render of the detail page: normal price only — no stale
    // badge, no countdown, no strikethrough.
    await page.goto(`/products/${expireSlug()}`);
    await expect(page.getByText("٪20 تخفیف")).toHaveCount(0);
    await expect(page.getByRole("timer")).toHaveCount(0);
    const original = page.getByText(/۲٬۰۰۰٬۰۰۰/).first();
    await expect(original).toBeVisible();
    await expect(original).not.toHaveClass(/line-through/);
  });
});
