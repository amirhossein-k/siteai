import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, type E2EState } from "./helpers/fixtures";

/**
 * Session 90 — Admin business-SMS management (پیامک‌ها).
 *
 * /admin/sms: the admin creates a template through the UI, the template list
 * reflects it (variables are SERVER-derived from the body), sends a manual
 * SMS from the send tab (the dev mock provider never touches the network)
 * and the send appears in the log tab. A customer session is denied 403 by
 * the /api/admin/sms surfaces (RBAC is server-side, not UI-hidden).
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 * Fixture rows carry the run prefix and are removed by global-teardown
 * (tests/e2e/helpers/db.ts — smstemplates/smslogs sweep).
 */
test.describe("Admin SMS management", () => {
  // Logged-in admin session for the whole spec.
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  const templateName = () => `قالب پیامک ${state.prefix}`;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });
  });

  test("admin creates a template, sends a manual SMS, sees the log row", async ({
    page,
  }) => {
    await page.goto("/admin/sms");
    await expect(
      page.getByRole("heading", { name: "پیامک‌ها", exact: true })
    ).toBeVisible();

    // --- Create a template through the UI ---
    await page.getByRole("button", { name: "قالب جدید" }).click();
    await page.getByLabel("نام قالب").fill(templateName());
    await page
      .getByLabel("متن قالب", { exact: false })
      .fill("سفارش {{orderNo}} ثبت شد");
    await page.getByRole("button", { name: "ذخیره", exact: true }).click();

    // The list reflects the new template with its SERVER-DERIVED variables.
    const row = page.locator("div", { has: page.getByText(templateName()) }).filter({
      has: page.getByText("متغیرها: orderNo"),
    });
    await expect(row.first()).toBeVisible();

    // --- Manual send with the template (mock provider — no real SMS) ---
    await page.getByRole("button", { name: "ارسال دستی" }).click();
    await page.getByLabel("شماره گیرنده").fill("09123456789");
    await page.getByLabel("قالب", { exact: true }).selectOption({
      label: templateName(),
    });
    await page.locator("input.max-w-xs").last().fill("A1B2C3");
    await page.getByRole("button", { name: "ارسال پیامک" }).click();
    await expect(page.getByText("پیامک با موفقیت ارسال شد")).toBeVisible();

    // --- The send is audited in the logs tab ---
    // Scope to the ROW element (div.p-3) — the Card wrapper also contains
    // the filter dropdown whose <option> labels («ارسال شده») would trip
    // strict mode otherwise.
    await page.getByRole("button", { name: "گزارش ارسال" }).click();
    const logRow = page.locator("div.p-3", {
      hasText: "سفارش A1B2C3 ثبت شد",
    });
    await expect(logRow).toBeVisible();
    await expect(logRow).toContainText("09123456789");
    await expect(logRow.getByText("ارسال شده", { exact: true })).toBeVisible();
    await expect(logRow).toContainText(templateName());
  });

  test("business-SMS APIs deny a customer session (403, server-side RBAC)", async () => {
    // The customer storage state proves the denial is server-enforced (the
    // admin UI is never even rendered for a customer).
    const customerCtx = await (
      await import("@playwright/test")
    ).request.newContext({
      storageState: state.customerStatePath,
      baseURL: state.baseURL,
    });
    const list = await customerCtx.get("/api/admin/sms/templates");
    expect(list.status()).toBe(403);
    const send = await customerCtx.post("/api/admin/sms/send", {
      data: { phone: "09123456789", message: "nope" },
    });
    expect(send.status()).toBe(403);
    const logs = await customerCtx.get("/api/admin/sms/logs");
    expect(logs.status()).toBe(403);
    await customerCtx.dispose();
  });

  test("inactive template cannot be sent (server-enforced)", async () => {
    // Deactivate through the API, then attempt the send through the API —
    // the server must refuse regardless of what any UI allows.
    const create = await adminCtx.post("/api/admin/sms/templates", {
      data: {
        name: `قالب غیرفعال ${state.prefix}`,
        type: "custom",
        body: "غیرفعال {{v}}",
      },
    });
    expect(create.status()).toBe(201);
    const { _id } = (await create.json()) as { _id: string };

    const deactivate = await adminCtx.put(`/api/admin/sms/templates?id=${_id}`, {
      data: { isActive: false },
    });
    expect(deactivate.status()).toBe(200);

    const send = await adminCtx.post("/api/admin/sms/send", {
      data: { phone: "09123456789", templateId: _id, variables: { v: "x" } },
    });
    expect(send.status()).toBe(400);
  });
});
