import { test, expect, type Page } from "@playwright/test";
import { getState } from "./helpers/fixtures";

/**
 * Session 64 — account security journey (Journey 14).
 *
 * Proves the tokenVersion session-revocation layer through the REAL UI + APIs:
 *   1. change-password: the profile page form requires the current password,
 *      rejects a wrong one, and on success bumps tokenVersion → the old
 *      session is dead (a second browser context holding the OLD cookie is
 *      401 on a protected API) and the user signs in again with the NEW
 *      password (the old password no longer works);
 *   2. logout-all: bumps tokenVersion → a second context with the same user's
 *      pre-bump cookie is revoked, and the local session cookie is cleared;
 *   3. admin revoke: an admin revokes a customer's session via the admin API
 *      → the customer's existing browser session is dead (protected API 401).
 *
 * Runs on the desktop chromium project only (like otp-login / accessibility —
 * the mobile smoke keeps its narrow testMatch).
 */

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}${phoneCounter}`;
}

// ONE shared customer for the whole journey. The three auth tests run
// sequentially in the same worker (workers:1), so they share this customer
// and the CURRENT password (test 1 changes it; tests 2–3 re-login with the
// new one). This keeps the journey to a SINGLE /api/register call — the
// per-IP register limiter (5/15min) is shared with global-setup + the OTP
// journey, so registering per-test would 429 mid-run.
const CUSTOMER_PASSWORD = "old-pass-123";
let sharedPhone: string | null = null;
let sharedPassword = CUSTOMER_PASSWORD;
let registered: Promise<void> | null = null;

function ensureCustomer(baseURL: string): Promise<void> {
  if (!registered) {
    registered = (async () => {
      sharedPhone = uniquePhone();
      const res = await fetch(`${baseURL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `مشتری امنیت ${getState().prefix}`,
          phone: sharedPhone,
          password: CUSTOMER_PASSWORD,
        }),
      });
      expect(res.status).toBe(201);
    })();
  }
  return registered;
}

async function liveSession(page: Page): Promise<{
  user?: { phone?: string; role?: string } | null;
}> {
  return page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    return (await res.json()) as {
      user?: { phone?: string; role?: string } | null;
    };
  });
}

/** Login through the REAL UI (password tab is the default). */
async function uiLogin(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByLabel("رمز عبور").fill(password);
  // `exact` — the OTP tab labels contain «ورود» as a substring.
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test("changes the password from the profile page and the old session dies", async ({
  page,
  baseURL,
}) => {
  await ensureCustomer(baseURL!);
  const phone = sharedPhone!;
  await uiLogin(page, phone, CUSTOMER_PASSWORD);

  await page.goto("/profile");
  // Session 64 security card is visible with the current-password field
  // (this account has a password).
  await expect(
    page.getByRole("heading", { name: "امنیت حساب" })
  ).toBeVisible();
  await expect(page.getByLabel("رمز عبور فعلی")).toBeVisible();

  // Wrong current password → rejected, session stays alive.
  await page.getByLabel("رمز عبور فعلی").fill("wrong-current");
  await page.getByLabel("رمز عبور جدید").fill("new-pass-456");
  await page.getByLabel("تکرار رمز عبور").fill("new-pass-456");
  await page.getByRole("button", { name: "تغییر رمز عبور" }).click();
  await expect(page.getByText("رمز عبور فعلی صحیح نیست")).toBeVisible();
  let session = await liveSession(page);
  expect(session.user?.phone).toBe(phone);

  // Capture the CURRENT cookie (pre-bump) into a second context BEFORE the
  // change — it must be revoked by the tokenVersion bump.
  const oldCookieCtx = await page.context().browser()!.newContext();
  const cookies = await page.context().cookies();
  await oldCookieCtx.addCookies(cookies);
  await oldCookieCtx.request.get(`${baseURL}/api/auth/csrf`);
  // Confirm the pre-bump cookie is currently valid.
  let oldRes = await oldCookieCtx.request.get(`${baseURL}/api/profile`);
  expect(oldRes.status()).toBe(200);

  // Correct change → success toast + sign-out to /login.
  await page.getByLabel("رمز عبور فعلی").fill(CUSTOMER_PASSWORD);
  await page.getByLabel("رمز عبور جدید").fill("new-pass-456");
  await page.getByLabel("تکرار رمز عبور").fill("new-pass-456");
  await page.getByRole("button", { name: "تغییر رمز عبور" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

  // The OLD cookie (pre-bump) is now revoked at the protected API.
  oldRes = await oldCookieCtx.request.get(`${baseURL}/api/profile`);
  expect(oldRes.status()).toBe(401);
  await oldCookieCtx.close();

  // Old password no longer logs in; new password does.
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByLabel("رمز عبور").fill(CUSTOMER_PASSWORD);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(
    page.getByText("شماره موبایل یا رمز عبور اشتباه است")
  ).toBeVisible();

  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByLabel("رمز عبور").fill("new-pass-456");
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  session = await liveSession(page);
  expect(session.user?.phone).toBe(phone);

  // Subsequent tests reuse this customer and the NEW password.
  sharedPassword = "new-pass-456";
});

test("logout-all revokes every session and clears the local cookie", async ({
  page,
  baseURL,
}) => {
  await ensureCustomer(baseURL!);
  const phone = sharedPhone!;
  await uiLogin(page, phone, sharedPassword);

  // A second device holds the same user's pre-bump cookie.
  const otherDevice = await page.context().browser()!.newContext();
  const cookies = await page.context().cookies();
  await otherDevice.addCookies(cookies);
  let otherRes = await otherDevice.request.get(`${baseURL}/api/profile`);
  expect(otherRes.status()).toBe(200);

  await page.goto("/profile");
  await page.getByRole("button", { name: "خروج از همه دستگاه‌ها" }).click();

  // Redirected to the storefront with the session cookie cleared.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  const live = await liveSession(page);
  expect(live.user).toBeFalsy();
  await expect(page.getByRole("link", { name: "ورود" })).toBeVisible();

  // The other device's pre-bump session is revoked at the protected API.
  otherRes = await otherDevice.request.get(`${baseURL}/api/profile`);
  expect(otherRes.status()).toBe(401);
  await otherDevice.close();
});

test("an admin can revoke a customer's session", async ({ page, baseURL }) => {
  // Admin flow is API-driven (the admin storageState from global-setup).
  const adminState = getState().adminStatePath;
  await ensureCustomer(baseURL!);
  const phone = sharedPhone!;

  // Customer logs in through the UI and has a live session.
  await uiLogin(page, phone, sharedPassword);
  let profileRes = await page.evaluate(async () => {
    const res = await fetch("/api/profile");
    return res.status;
  });
  expect(profileRes).toBe(200);

  // Admin revokes the customer's session. First find the customer's user id
  // via the admin users API (the admin storageState from global-setup).
  const adminCtx = await page.context().browser()!.newContext({
    storageState: adminState,
  });
  const usersRes = await adminCtx.request.get(
    `${baseURL}/api/admin/users?role=customer`
  );
  expect(usersRes.status()).toBe(200);
  const users = (await usersRes.json()) as Array<{ _id: string; phone: string }>;
  const target = users.find((u) => u.phone === phone);
  expect(target, "the created customer must exist").toBeTruthy();

  const revokeRes = await adminCtx.request.post(
    `${baseURL}/api/admin/users/${target!._id}/revoke-session`
  );
  expect(revokeRes.status()).toBe(200);
  await adminCtx.close();

  // The customer's existing browser session is now dead at the protected API
  // (the tokenVersion bump took effect).
  profileRes = await page.evaluate(async () => {
    const res = await fetch("/api/profile");
    return res.status;
  });
  expect(profileRes).toBe(401);
});

test("an anonymous visitor cannot use the security endpoints", async ({
  page,
  baseURL,
}) => {
  const body = { newPassword: "whatever-123" };
  const changeRes = await page.request.post(
    `${baseURL}/api/auth/change-password`,
    { data: body }
  );
  expect(changeRes.status()).toBe(401);

  const logoutAllRes = await page.request.post(
    `${baseURL}/api/auth/logout-all`
  );
  expect(logoutAllRes.status()).toBe(401);

  const revokeRes = await page.request.post(
    `${baseURL}/api/admin/users/000000000000000000000000/revoke-session`
  );
  expect(revokeRes.status()).toBe(401);
});
