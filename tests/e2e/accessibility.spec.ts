import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
// `AxeResults` is NOT re-exported by @axe-core/playwright (only AxeBuilder is)
// — it comes from the axe-core package it depends on (hoisted at the root).
import type { AxeResults } from "axe-core";
import {
  getState,
  createCategory,
  createProduct,
  type E2EState,
} from "./helpers/fixtures";

/**
 * Journey 11 — Accessibility (Session 61).
 *
 * Runs axe-core (WCAG A/AA tags) over the highest-traffic PUBLIC storefront
 * pages and asserts ZERO serious/critical violations after the Session 61
 * fixes. Runs in the desktop `chromium` project only (the mobile project is
 * matched to customer-login + cart).
 *
 * Scope freeze (approved): Session 61 fixed ONLY the listed files
 * (search-suggestions, image-lightbox, hero-carousel, mobile-drawer,
 * storefront-header + the 12 storefront image components). Any serious/
 * critical violation axe discovers in files OUTSIDE that set is recorded in
 * OUT_OF_SCOPE_RULE_IDS below and intentionally NOT fixed — those are the
 * documented Session 62 backlog (see the final session report). The allowlist
 * is keyed by axe rule id and must carry a file/component comment.
 */
const OUT_OF_SCOPE_RULE_IDS: { id: string; note: string }[] = [
  // Populated from the first full-scan run — empty when the scanned pages
  // are fully clean after the Session 61 fixes.
];

/**
 * Assert zero serious/critical violations, printing every violation (all
 * impacts) to the run log so regressions are debuggable from CI output.
 */
async function expectNoSeriousCritical(
  results: AxeResults,
  pageLabel: string
): Promise<void> {
  for (const v of results.violations) {
    const targets = v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ");
    console.log(
      `[axe:${pageLabel}] ${v.impact ?? "n/a"} ${v.id} — ${v.help} → ${targets}`
    );
  }

  const outOfScopeIds = new Set(OUT_OF_SCOPE_RULE_IDS.map((e) => e.id));
  const blocking = results.violations.filter(
    (v) =>
      (v.impact === "serious" || v.impact === "critical") &&
      !outOfScopeIds.has(v.id)
  );

  expect(
    blocking,
    `${pageLabel}: unexpected serious/critical violations → ${blocking
      .map((v) => `${v.id} (${v.nodes.length} nodes)`)
      .join(", ")}`
  ).toHaveLength(0);
}

test.describe("Accessibility (axe-core)", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  const slug = "a11y-prod";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // Index 99 — deliberately far from the other journeys' slots (1..9 for the
    // product/detail/checkout/coupon/payment/tracking/admin/supplier specs, 33
    // for the mobile cart project) since every journey shares the per-run
    // prefix and duplicate slugs 409.
    const categoryId = await createCategory(adminCtx, state.prefix, 99);
    await createProduct(adminCtx, {
      slug: `${state.prefix}${slug}`,
      name: `محصول دسترس‌پذیری ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 1_000_000,
      supplierPrice: 800_000,
      stock: 5,
    });
  });

  const scan = (page: Page) =>
    new AxeBuilder({ page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
    ]);

  test("homepage has no serious/critical violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expectNoSeriousCritical(await scan(page).analyze(), "homepage");
  });

  test("catalog page has no serious/critical violations", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoSeriousCritical(await scan(page).analyze(), "products");
  });

  test("product detail has no serious/critical violations", async ({
    page,
  }) => {
    await page.goto(`/products/${state.prefix}${slug}`);
    await expect(
      page.getByRole("heading", { name: `محصول دسترس‌پذیری ${state.prefix}` })
    ).toBeVisible();
    await expectNoSeriousCritical(await scan(page).analyze(), "product-detail");
  });

  test("supplier detail has no serious/critical violations", async ({
    page,
  }) => {
    await page.goto(`/suppliers/${state.supplierId}`);
    await expect(
      page.getByRole("heading", { name: `فروشنده ${state.prefix}` })
    ).toBeVisible();
    await expectNoSeriousCritical(
      await scan(page).analyze(),
      "supplier-detail"
    );
  });

  test("login page has no serious/critical violations", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "ورود به حساب کاربری" })
    ).toBeVisible();
    await expectNoSeriousCritical(await scan(page).analyze(), "login");
  });

  test("register page has no serious/critical violations", async ({
    page,
  }) => {
    await page.goto("/register");
    // The register page's page-level heading is the CardTitle «ساخت حساب کاربری».
    await expect(
      page.getByRole("heading", { name: "ساخت حساب کاربری" })
    ).toBeVisible();
    await expectNoSeriousCritical(await scan(page).analyze(), "register");
  });
});
