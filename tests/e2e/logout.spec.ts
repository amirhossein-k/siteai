import { test, expect } from "@playwright/test";
import { getState } from "./helpers/fixtures";

/**
 * Journey 13 — Logout / Sign-out (Session 63).
 *
 * Proves logout works for all three roles through the REAL signOut flow
 * (NextAuth POST /api/auth/signout) and that session state is fully
 * terminated client-side:
 *   - customer: header account-menu logout + profile-page logout;
 *   - customer: after logout the profile page prompts to sign in;
 *   - admin / supplier: sidebar logout (desktop) or mobile-drawer logout
 *     (< lg, opened via the header Menu button) → redirected to the
 *     storefront; the protected /admin + /supplier routes then bounce to
 *     /login (middleware guard);
 *   - anonymous: no account menu is rendered at all.
 *
 * Each test starts from a storageState copy (global-setup), so logging out in
 * one test can never affect another journey. Runs on the desktop project and
 * (customer flows + responsive dashboard logout) on the mobile project.
 */
test.describe("Logout / sign-out", () => {
  const state = getState();

  test.describe("customer — header account menu", () => {
    test.use({ storageState: state.customerStatePath });

    test("logs out from the header account menu and the session ends", async ({
      page,
      context,
    }) => {
      await page.goto("/");

      // Session 63.1 — the coupons nav entry is session-gated. The link only
      // renders in the DESKTOP nav (hidden lg:flex) — on mobile the storefront
      // header has no nav links at all, so assert the positive only on desktop
      // viewports (the negative assertions below hold on both).
      const width = page.viewportSize()?.width ?? 1280;
      if (width >= 1024) {
        await expect(page.getByRole("link", { name: "کدهای تخفیف" })).toHaveCount(1);
      }

      // Menu trigger (replaces the plain profile link) is visible when signed in.
      const trigger = page.getByRole("button", { name: "حساب کاربری" });
      await expect(trigger).toBeVisible();

      // Open the menu — the logout item is discoverable alongside the account links.
      await trigger.click();
      await expect(page.getByRole("menuitem", { name: "پروفایل" })).toBeVisible();
      // Session 63.1 — wishlist is customer-only: the item is present for customers.
      await expect(
        page.getByRole("menuitem", { name: "علاقه‌مندی‌ها" })
      ).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "خروج" })).toBeVisible();

      // Logout is immediate (no confirmation) and redirects to the storefront.
      await page.getByRole("menuitem", { name: "خروج" }).click();
      await page.waitForURL((url) => url.pathname === "/");

      // Signed-out header: no account menu, login/register back.
      await expect(page.getByRole("button", { name: "حساب کاربری" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "ورود" })).toBeVisible();
      // Session 63.1 — the coupons entry disappears with the session.
      await expect(page.getByRole("link", { name: "کدهای تخفیف" })).toHaveCount(0);

      // The NextAuth session cookie is gone from the browser.
      const cookies = await context.cookies();
      expect(
        cookies.some((c) => c.name.includes("next-auth.session-token"))
      ).toBe(false);
    });

    test("logs out from the profile page", async ({ page }) => {
      await page.goto("/profile");
      const logout = page.getByRole("button", { name: "خروج از حساب" });
      await expect(logout).toBeVisible();
      await logout.click();
      await page.waitForURL((url) => url.pathname === "/");
      await expect(page.getByRole("button", { name: "حساب کاربری" })).toHaveCount(0);
    });

    test("after logout the profile page prompts to sign in", async ({ page }) => {
      await page.goto("/profile");
      await page.getByRole("button", { name: "خروج از حساب" }).click();
      await page.waitForURL((url) => url.pathname === "/");
      // The existing unauthenticated profile UI (no redirect — same as before).
      await page.goto("/profile");
      await expect(
        page.getByText("برای مشاهده و ویرایش پروفایل وارد حساب خود شوید")
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "ورود به حساب" })
      ).toBeVisible();
    });
  });

  test.describe("admin — sidebar logout", () => {
    test.use({ storageState: state.adminStatePath });

    test("admin browsing the storefront sees no wishlist entry (customer-only)", async ({
      page,
    }) => {
      await page.goto("/");

      // Session 63.1 — coupons is session-gated: present for any authenticated
      // role (desktop nav only — hidden lg:flex, absent from mobile's a11y tree).
      const width = page.viewportSize()?.width ?? 1280;
      if (width >= 1024) {
        await expect(page.getByRole("link", { name: "کدهای تخفیف" })).toHaveCount(1);
      }

      // Wishlist is customer-only: the nav link AND the heart icon are hidden
      // for an authenticated admin — they must never land on the "sign in" prompt.
      await expect(page.getByRole("link", { name: "علاقه‌مندی‌ها" })).toHaveCount(0);

      // ...and the account menu omits the wishlist item too.
      await page.getByRole("button", { name: "حساب کاربری" }).click();
      await expect(page.getByRole("menuitem", { name: "پروفایل" })).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "علاقه‌مندی‌ها" })
      ).toHaveCount(0);
    });

    test("logs out from the sidebar and /admin stays guarded", async ({ page }) => {
      await page.goto("/admin/dashboard");

      // On < lg the sidebar lives in the mobile drawer — open it via the
      // header Menu button (the button holding the .lucide-menu icon).
      const width = page.viewportSize()?.width ?? 1280;
      if (width < 1024) {
        await page.locator("header button:has(.lucide-menu)").click();
        await expect(
          page.getByRole("dialog", { name: "منوی پیمایش" })
        ).toBeVisible();
      }

      // The drawer slides in (300ms) and the long nav can overlap the footer
      // button while settling — scroll it fully into view, then click through
      // (force) so the animated overlay can't swallow the pointer events.
      const logout = page.getByRole("button", { name: "خروج" });
      await logout.scrollIntoViewIfNeeded();
      await expect(logout).toBeVisible();
      await logout.click({ force: true });
      await page.waitForURL((url) => url.pathname === "/");

      // Middleware still guards the dashboard for signed-out visitors.
      await page.goto("/admin/dashboard");
      await page.waitForURL((url) => url.pathname === "/login");
    });
  });

  test.describe("supplier — sidebar logout", () => {
    test.use({ storageState: state.supplierStatePath });

    test("logs out from the sidebar and /supplier stays guarded", async ({ page }) => {
      await page.goto("/supplier/dashboard");

      const width = page.viewportSize()?.width ?? 1280;
      if (width < 1024) {
        await page.locator("header button:has(.lucide-menu)").click();
        await expect(
          page.getByRole("dialog", { name: "منوی پیمایش" })
        ).toBeVisible();
      }

      const logout = page.getByRole("button", { name: "خروج" });
      await logout.scrollIntoViewIfNeeded();
      await expect(logout).toBeVisible();
      await logout.click({ force: true });
      await page.waitForURL((url) => url.pathname === "/");

      await page.goto("/supplier/dashboard");
      await page.waitForURL((url) => url.pathname === "/login");
    });
  });

  test.describe("anonymous", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("sees no account menu when signed out", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "حساب کاربری" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "ورود" })).toBeVisible();
      await expect(page.getByRole("link", { name: "ثبت‌نام" })).toBeVisible();
      // Session 63.1 — the coupons entry is session-gated: hidden for anonymous.
      await expect(page.getByRole("link", { name: "کدهای تخفیف" })).toHaveCount(0);
    });
  });
});
