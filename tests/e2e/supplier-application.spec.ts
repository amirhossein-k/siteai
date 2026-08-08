import { test, expect, type APIRequestContext } from "@playwright/test";
import path from "path";
import { getState, type E2EState } from "./helpers/fixtures";
import { apiLogin } from "./helpers/auth";

/**
 * Journey 16 — Supplier application + admin approval queue (Session 67).
 *
 * A dedicated per-run applicant is registered + logged in (NEVER the shared
 * seeded customer): approving bumps the applicant's tokenVersion, which would
 * otherwise invalidate the shared customer storageState used by every other
 * journey. The shared seeded customer only exercises the public page's
 * anonymous/sign-in path implicitly — the applicant owns the full lifecycle:
 *   apply via the «فروشنده شوید» UI → admin approves via the
 *   «درخواستهای فروشندگی» tab → old customer session revoked → fresh login
 *   reaches the supplier panel.
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Supplier application queue", () => {
  // The browser `page` fixture acts as the ADMIN (approving via the queue).
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let applicantPhone = "";
  const applicantPassword = "app-e2e-pass-123";
  const businessName = () => `فروشگاه E2E ${state.prefix}`;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    applicantPhone = `0995${String(Date.now()).slice(-7)}`;

    // Register the per-run applicant through the real API (name carries the
    // run prefix so global-teardown removes the user + linked rows).
    const reg = await fetch(`${state.baseURL}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `متقاضی ${state.prefix}`,
        phone: applicantPhone,
        password: applicantPassword,
      }),
    });
    expect(reg.status).toBe(201);
  });

  test("customer applies via the become-supplier page, then admin approves via the queue", async ({
    page,
    playwright,
    browser,
  }) => {
    // --- Applicant side: login + submit through the UI ---
    const applicantCtx = await playwright.request.newContext({
      baseURL: state.baseURL,
    });
    await apiLogin(applicantCtx, applicantPhone, applicantPassword);
    const applicantStatePath = path.resolve(
      process.cwd(),
      "tests/e2e/.auth/applicant.json"
    );
    await applicantCtx.storageState({ path: applicantStatePath });
    await applicantCtx.dispose();

    const applicantContext = await browser.newContext({
      storageState: applicantStatePath,
      baseURL: state.baseURL,
    });
    const applicantPage = await applicantContext.newPage();
    await applicantPage.goto("/become-supplier");
    await expect(
      applicantPage.getByRole("heading", { name: "فروشنده شوید" })
    ).toBeVisible();
    await applicantPage.getByLabel("نام کسبوکار").fill(businessName());
    await applicantPage.getByLabel("توضیحات فروشگاه").fill("توضیحات E2E");
    await applicantPage
      .getByRole("button", { name: "ثبت درخواست فروشندگی", exact: true })
      .click();
    await expect(
      applicantPage.getByText("درخواست شما در انتظار بررسی است")
    ).toBeVisible();
    await applicantPage.close();
    await applicantContext.close();

    // --- Admin side: approve through the queue tab ---
    await page.goto("/admin/suppliers");
    await page
      .getByRole("button", { name: /درخواست[‌]?های فروشندگی/ })
      .click();
    const pendingRow = page
      .getByRole("button", { name: /تأیید و فعال[‌]?سازی فروشنده/ })
      .first();
    await expect(pendingRow).toBeVisible();

    await page.getByPlaceholder(/یادداشت/).first().fill("خوش آمدید E2E");
    await pendingRow.click();

    // The pending row leaves the queue; the decided history shows it approved.
    await expect(pendingRow).not.toBeVisible();
    await expect(page.getByText("تأیید شده").first()).toBeVisible();

    // --- Server-side verification ---
    // 1) The applicant's OLD customer session is revoked (tokenVersion bump).
    const staleCtx = await playwright.request.newContext({
      storageState: applicantStatePath,
    });
    const profileRes = await staleCtx.get("/api/profile");
    expect(profileRes.status()).toBe(401);
    await staleCtx.dispose();

    // 2) The management list now contains the auto-provisioned supplier
    //    seeded from the APPLICATION (businessName matches the application).
    const listRes = await adminCtx.get("/api/admin/suppliers?all=true");
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as Array<{ businessName: string }>;
    expect(
      list.some((s) => s.businessName === businessName())
    ).toBeTruthy();

    // 3) A FRESH login reaches the supplier panel.
    const freshCtx = await playwright.request.newContext({
      baseURL: state.baseURL,
    });
    await apiLogin(freshCtx, applicantPhone, applicantPassword);
    const statsRes = await freshCtx.get("/api/supplier/stats");
    expect(statsRes.status()).toBe(200);
    await freshCtx.dispose();
  });
});
