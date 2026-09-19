import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  createVariantProduct,
  addToCartAndAwaitToast,
  type E2EState,
} from "./helpers/fixtures";
import { formatPrice } from "./helpers/money";

/**
 * Journey 3 — Product detail.
 *
 * Seeds a simple product and a 2-variant product through the admin API, then
 * verifies the customer-facing detail page:
 *  - simple product: name, price, add-to-cart → toast
 *  - variant product: variant selector pre-selects the first in-stock variant
 *    (SKU badge + resolved price), add-to-cart → toast
 */
test.describe("Product detail", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  const simpleSlug = "detail-simple";
  const variantSlug = "detail-variant";
  const simplePrice = 2_450_000;
  const variantBase = 1_200_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 2);

    await createProduct(adminCtx, {
      slug: `${state.prefix}${simpleSlug}`,
      name: `لپتاپ ${state.prefix}ساده`,
      categoryId,
      supplierId: state.supplierId,
      price: simplePrice,
      supplierPrice: 1_800_000,
      stock: 6,
    });

    await createVariantProduct(adminCtx, {
      slug: `${state.prefix}${variantSlug}`,
      name: `پیراهن ${state.prefix}تنوع`,
      categoryId,
      supplierId: state.supplierId,
      price: variantBase,
      supplierPrice: 700_000,
      stock: 10,
      values: ["کوچک", "بزرگ"],
    });
  });

  test("simple product shows price and adds to cart", async ({ page }) => {
    await page.goto(`/products/${state.prefix}${simpleSlug}`);

    await expect(
      page.getByRole("heading", { name: `لپتاپ ${state.prefix}ساده` })
    ).toBeVisible();
    await expect(page.getByText(formatPrice(simplePrice)).first()).toBeVisible();
    await expect(page.getByText("موجود در انبار")).toBeVisible();

    await page.getByRole("button", { name: "افزودن به سبد خرید" }).click();
    await addToCartAndAwaitToast(page);
  });

  test("variant product pre-selects a variant and adds to cart", async ({
    page,
  }) => {
    await page.goto(`/products/${state.prefix}${variantSlug}`);

    await expect(
      page.getByRole("heading", { name: `پیراهن ${state.prefix}تنوع` })
    ).toBeVisible();

    // VariantSelector auto-selects the first in-stock variant → SKU badge.
    // `.first()`: the same SKU can appear on the selector and the detail copy.
    const sku = `${state.prefix}${variantSlug}`.toUpperCase() + "-SKU1";
    await expect(page.getByText(`SKU: ${sku}`).first()).toBeVisible();
    // Resolved variant price (base + 0).
    await expect(page.getByText(formatPrice(variantBase)).first()).toBeVisible();

    await page.getByRole("button", { name: "افزودن به سبد خرید" }).click();
    await addToCartAndAwaitToast(page);
  });
});
