import { test, expect } from "@playwright/test";
import { getState, E2E_PASSWORD } from "./helpers/fixtures";

/**
 * Journey 1 — Customer login (real UI form, no storageState).
 *
 * Proves the credentials flow end-to-end in the browser:
 *  - success: the per-run customer logs in and lands on the storefront
 *    (customer role redirects to "/") with a session in the header
 *  - failure: wrong password shows the inline error alert
 *
 * Runs on BOTH projects (desktop + mobile smoke) per playwright.config.ts.
 */
test.describe("Customer login", () => {
  test("logs in with valid credentials", async ({ page }) => {
    const state = getState();

    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "ورود به حساب کاربری" })
    ).toBeVisible();

    await page.locator('input[name="phone"]').fill(state.customerPhone);
    await page.locator('input[name="password"]').fill(E2E_PASSWORD);
    // Session 62 — the login page gained method tabs («ورود با رمز عبور» /
    // «ورود با کد یک‌بارمصرف») that contain «ورود» as a substring; `exact`
    // pins this to the password submit button.
    await page.getByRole("button", { name: "ورود", exact: true }).click();

    // Customer role redirects to the storefront home.
    await page.waitForURL((url) => url.pathname === "/");
    // Logged-in header (Session 63): the account menu replaced the plain
    // profile link — the menu trigger only renders when a session exists.
    await expect(
      page.getByRole("button", { name: "حساب کاربری" })
    ).toBeVisible();
    await expect(page.locator('a[href="/notifications"]')).toBeVisible();
  });

  test("rejects a wrong password", async ({ page }) => {
    const state = getState();

    await page.goto("/login");
    await page.locator('input[name="phone"]').fill(state.customerPhone);
    await page.locator('input[name="password"]').fill("wrong-password-123");
    await page.getByRole("button", { name: "ورود", exact: true }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    // Still on the login page — no redirect.
    await expect(page).toHaveURL(/\/login/);
  });
});
