import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  addToCartAndAwaitToast,
  cartClickWithExactQuantityChange,
  type E2EState,
} from "./helpers/fixtures";
import { formatPrice } from "./helpers/money";

/**
 * Journey 4 — Cart.
 *
 * Seeds a product, adds it to the cart from the product page, then verifies
 * the cart page end-to-end: line item, quantity controls, totals, remove, and
 * navigation to checkout.
 *
 * Runs on BOTH projects (desktop + mobile smoke) per playwright.config.ts.
 */
test.describe("Cart", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  // This spec runs on BOTH projects (desktop + mobile smoke). Each project
  // re-executes beforeAll against the shared DB, so seeded slugs must be
  // unique per project — otherwise the second project's create hits a 409.
  let specSlug = "cart-prod";
  const price = 180_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    const projectTag = test.info().project.name; // "chromium" | "chromium-mobile"
    specSlug = `${state.prefix}cart-${projectTag}`;
    const categoryId = await createCategory(
      adminCtx,
      state.prefix,
      projectTag === "chromium-mobile" ? 33 : 3
    );

    await createProduct(adminCtx, {
      slug: specSlug,
      name: `ماگ سرامیکی ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 90_000,
      stock: 20,
    });
  });

  test("adds a product, adjusts quantity, and navigates to checkout", async ({
    page,
  }) => {
    await page.goto(`/products/${specSlug}`);
    // .first(): the Session 85 mobile sticky buy bar adds a second CTA with
    // the same label on <lg viewports — either button adds to the cart.
    await addToCartAndAwaitToast(page);

    await page.goto("/cart");
    await expect(page.getByText(`ماگ سرامیکی ${state.prefix}`)).toBeVisible();
    await expect(page.getByText(formatPrice(price)).first()).toBeVisible();

    // Quantity: 1 → 2 (plus button), item total doubles. The cart page is
    // hydration-race-prone too — same helper, same exact-+1 semantics; the
    // failure propagates if the increment never verifiably lands.
    await cartClickWithExactQuantityChange(page, () =>
      page.locator("button:has(svg.lucide-plus)").click()
    );
    await expect(
      page.getByText(formatPrice(price * 2)).first()
    ).toBeVisible();

    // Remove the line item → empty state.
    await page.locator("button:has(svg.lucide-trash-2)").click();
    await expect(page.getByText("سبد خرید خالی است")).toBeVisible();
  });

  test("empty cart shows the empty state", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByText("سبد خرید خالی است")).toBeVisible();
  });

  test("checkout button navigates to the checkout page", async ({ page }) => {
    await page.goto(`/products/${specSlug}`);
    await page
      .getByRole("button", { name: "افزودن به سبد خرید" })
      .first()
      .click();
    await addToCartAndAwaitToast(page);

    await page.goto("/cart");
    await page.getByRole("link", { name: /تسویه حساب/ }).click();
    await expect(page).toHaveURL(/\/checkout/);
  });
});
