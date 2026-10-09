import { test, expect } from "@playwright/test";

test.describe("Reference catalog UX", () => {
  test("renders the new catalog and keeps grid/list controls", async ({ page }) => {
    await page.goto("/products");
    await expect(page.locator(".cr-hero h1")).toContainText("لیست محصولات");
    await page.getByRole("button", { name: "نمایش فهرستی", exact: true }).click();
    await expect(page.getByRole("button", { name: "نمایش فهرستی", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "نمایش شبکه‌ای", exact: true }).click();
    await expect(page.getByRole("button", { name: "نمایش شبکه‌ای", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
  test("mobile drawer locks focus, closes with Escape, and has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/products");
    const open = page.locator(".cr-mobile-filter");
    await open.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test("price values reach the real catalog API", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/products");
    const request = page.waitForRequest(r => {
      const url = new URL(r.url());
      return url.pathname === "/api/products" && url.searchParams.get("minPrice") === "10000000" && url.searchParams.get("maxPrice") === "50000000";
    });
    await page.locator(".cr-sidebar").getByRole("button", { name: "۱۰ تا ۵۰ میلیون", exact: true }).click();
    await request;
    await expect(page.locator("#desktop-min")).toHaveValue("10000000");
    await page.locator(".cr-sidebar").getByRole("button", { name: "حذف همه", exact: true }).click();
    await expect(page.locator("#desktop-min")).toHaveValue("");
    await expect(page.locator("#desktop-max")).toHaveValue("");
  });
});
