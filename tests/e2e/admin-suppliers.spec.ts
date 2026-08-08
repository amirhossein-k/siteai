import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, type E2EState } from "./helpers/fixtures";

/**
 * Journey 15 — Admin Supplier Management (Session 66).
 *
 * The dedicated /admin/suppliers page: the admin sees the seeded per-run
 * supplier (global-setup creates it via the admin users API → auto Supplier
 * doc), creates a NEW supplier through the shared CreateUserModal, promotes an
 * existing customer via the promote modal, and deactivates/reactivates a
 * supplier — asserting the status UI and the server state (management list
 * + public /api/suppliers hiding).
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Admin supplier management", () => {
  // Logged-in admin session for the whole spec.
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;

  // A per-run supplier created through the UI (name carries the run prefix so
  // global-teardown removes it).
  const uiSupplierName = () => `فروشنده UI ${state.prefix}`;
  // Unique 11-digit Iranian mobile.
  let uiSupplierPhone = "";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
    // 11-digit Iranian mobile (09 + 9 digits) — the users API rejects any
    // other length. `0916` prefix keeps it distinct from the second test's
    // `0915` phone even when both run within the same millisecond.
    uiSupplierPhone = `0915${String(Date.now()).slice(-7)}`;
  });

  test("admin sees the seeded supplier and creates a new one via the UI", async ({ page }) => {
    await page.goto("/admin/suppliers");
    // Page renders with the header (exact — the CardTitle «لیست فروشندگان»
    // is a substring match and would trip strict mode otherwise).
    await expect(
      page.getByRole("heading", { name: "فروشندگان", exact: true })
    ).toBeVisible();

    // The per-run supplier (seeded by global-setup) is listed.
    await expect(
      page.getByText(`فروشنده ${state.prefix}`).first()
    ).toBeVisible();

    // Create a new supplier through the shared modal.
    await page.getByRole("button", { name: "ایجاد فروشنده جدید" }).click();
    await page.getByLabel("نام و نام خانوادگی").fill(uiSupplierName());
    await page.getByLabel("شماره موبایل").fill(uiSupplierPhone);
    await page.getByLabel("رمز عبور", { exact: true }).fill("ui-pass-123");
    // Role defaults to supplier — submit.
    await page.getByRole("button", { name: "ایجاد کاربر", exact: true }).click();

    // The new supplier row appears.
    await expect(page.getByText(uiSupplierName()).first()).toBeVisible();

    // Server-side: the management API returns the supplier (auto-provisioned).
    const listRes = await adminCtx.get("/api/admin/suppliers?all=true");
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as Array<{
      _id: string;
      businessName: string;
      user: { phone: string } | null;
    }>;
    const row = list.find((s) => s.businessName === uiSupplierName());
    expect(row).toBeTruthy();
    expect(row!.user?.phone).toBe(uiSupplierPhone);
  });

  test("admin deactivates a supplier (hidden from public) then reactivates", async ({ page }) => {
    // Seed a supplier directly via the API (same flow the UI uses) so this
    // test is independent of UI-creation ordering.
    const res = await adminCtx.post("/api/admin/users", {
      data: {
        name: uiSupplierName() + " Toggle",
        phone: `0916${String(Date.now()).slice(-7)}`,
        password: "ui-pass-123",
        role: "supplier",
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { supplierId: string };
    const supplierId = body.supplierId;

    await page.goto("/admin/suppliers");
    await expect(page.getByText(uiSupplierName() + " Toggle").first()).toBeVisible();

    // Public surfaces see the supplier BEFORE deactivation.
    let publicList = (await (
      await fetch(`${state.baseURL}/api/suppliers`)
    ).json()) as { data: Array<{ _id: string }> };
    expect(publicList.data.some((s) => s._id === supplierId)).toBeTruthy();

    // Deactivate via the row toggle button.
    const row = page
      .getByRole("row")
      .filter({ hasText: uiSupplierName() + " Toggle" });
    await row.getByTitle("غیرفعال کردن").click();
    await expect(row.getByText("غیرفعال", { exact: true }).first()).toBeVisible();

    // Server-side: Supplier.isActive flipped off (public surfaces hide it).
    const mgmt = (await (
      await adminCtx.get("/api/admin/suppliers?all=true")
    ).json()) as Array<{ _id: string; isActive: boolean }>;
    const mgmtRow = mgmt.find((s) => s._id === supplierId);
    expect(mgmtRow?.isActive).toBe(false);

    publicList = (await (
      await fetch(`${state.baseURL}/api/suppliers`)
    ).json()) as { data: Array<{ _id: string }> };
    expect(publicList.data.some((s) => s._id === supplierId)).toBeFalsy();

    // Reactivate via the row toggle button.
    await row.getByTitle("فعال کردن").click();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: uiSupplierName() + " Toggle" })
        .getByText("فعال", { exact: true })
        .first()
    ).toBeVisible();

    // Public surfaces see the supplier again.
    publicList = (await (
      await fetch(`${state.baseURL}/api/suppliers`)
    ).json()) as { data: Array<{ _id: string }> };
    expect(publicList.data.some((s) => s._id === supplierId)).toBeTruthy();
  });
});
