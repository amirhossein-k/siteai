import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  getState,
  createCategory,
  createProduct,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 2 — Product search.
 *
 * Seeds a category + two distinctly-named products through the real admin API,
 * then proves both search entry points end-to-end:
 *  - header search box: type-ahead suggestions (listbox) → click → catalog
 *  - catalog page search input: filters the live results grid
 */
test.describe("Product search", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  const slugA = "srch-prod-a";
  const slugB = "srch-prod-b";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    const categoryId = await createCategory(adminCtx, state.prefix, 1);

    await createProduct(adminCtx, {
      slug: `${state.prefix}${slugA}`,
      name: `گوشی هوشمند ${state.prefix}الف`,
      categoryId,
      supplierId: state.supplierId,
      price: 12_500_000,
      supplierPrice: 10_000_000,
      stock: 5,
    });
    await createProduct(adminCtx, {
      slug: `${state.prefix}${slugB}`,
      name: `کیف چرم ${state.prefix}ب`,
      categoryId,
      supplierId: state.supplierId,
      price: 850_000,
      supplierPrice: 500_000,
      stock: 8,
    });
  });

  test("header search suggestions navigate to the catalog", async ({
    page,
  }) => {
    await page.goto("/");

    const searchBox = page.getByRole("searchbox", {
      name: "جستجو در محصولات",
    });
    await searchBox.fill(`گوشی هوشمند ${state.prefix}`);

    // Suggestions listbox appears with the matching product option.
    const suggestion = page
      .getByRole("option")
      .filter({ hasText: `گوشی هوشمند ${state.prefix}الف` });
    await expect(suggestion).toBeVisible();

    await suggestion.click();

    // Navigator to the catalog with the search term committed.
    await expect(page).toHaveURL(/\/products\?search=/);
    await expect(
      page.getByRole("heading", { name: `گوشی هوشمند ${state.prefix}الف` })
    ).toBeVisible();
  });

  test("catalog search input filters the product grid", async ({ page }) => {
    await page.goto("/products");

    await page
      .getByPlaceholder("جستجوی محصولات...")
      .fill(`کیف چرم ${state.prefix}`);

    await expect(
      page.getByRole("heading", { name: `کیف چرم ${state.prefix}ب` })
    ).toBeVisible();
  });
});
