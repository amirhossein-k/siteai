import { test, expect, type Page } from "@playwright/test";
import { getState } from "./helpers/fixtures";

/**
 * Session 62 — SMS OTP authentication journey (Journey 12).
 *
 * Requires the dev server running with SMS_MOCK=1 (the hermetic SMS seam):
 *   - the mock provider logs the code to the server console AND stores the
 *     plaintext on the OtpCode row (dev-only);
 *   - GET /api/auth/otp/dev-last?phone=… returns it back — the journey reads
 *     the code exactly like a user reading their SMS inbox.
 * playwright.config.ts sets SMS_MOCK=1 in the CI webServer env; locally the
 * dev server must be started with it (same convention as ZARINPAL_MOCK).
 *
 * Users are named with the run prefix so global-teardown removes them; phones
 * are unique per run (fixed 11-digit 09… format).
 */

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}${phoneCounter}`;
}

async function readDevCode(baseURL: string, phone: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/auth/otp/dev-last?phone=${phone}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  expect(body.code).toMatch(/^\d{6}$/);
  return body.code;
}

/** Read the session through the BROWSER context (shares its cookie jar). */
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

test("registers a new account with SMS OTP and is logged in", async ({
  page,
  baseURL,
}) => {
  const phone = uniquePhone();
  const name = `مشتری OTP ${getState().prefix}`;

  await page.goto("/register");
  await page.getByRole("button", { name: "ثبت‌نام با کد یک‌بارمصرف" }).click();

  await page.getByLabel("نام و نام خانوادگی").fill(name);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();

  await expect(page.getByLabel("کد تأیید")).toBeVisible();
  const code = await readDevCode(baseURL!, phone);
  await page.getByLabel("کد تأیید").fill(code);
  await page.getByRole("button", { name: "تأیید و ورود" }).click();

  await expect(page).toHaveURL(new RegExp("/$"), { timeout: 15_000 });
  const session = await liveSession(page);
  expect(session.user?.phone).toBe(phone);
  expect(session.user?.role).toBe("customer");
});

test("logs in an existing account with SMS OTP", async ({ page, baseURL }) => {
  // Create the account through the REAL register API (like global-setup).
  const phone = uniquePhone();
  const name = `مشتری OTP ${getState().prefix}`;
  const registerRes = await fetch(`${baseURL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      phone,
      password: "otp-e2e-pass-123",
    }),
  });
  expect(registerRes.status).toBe(201);

  await page.goto("/login");
  await page.getByRole("button", { name: "ورود با کد یک‌بارمصرف" }).click();

  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();

  await expect(page.getByLabel("کد تأیید")).toBeVisible();
  const code = await readDevCode(baseURL!, phone);
  await page.getByLabel("کد تأیید").fill(code);
  // `exact` — the "ورود با …" tab labels contain "ورود" as a substring.
  await page.getByRole("button", { name: "ورود", exact: true }).click();

  await expect(page).toHaveURL(new RegExp("/$"), { timeout: 15_000 });
  const session = await liveSession(page);
  expect(session.user?.phone).toBe(phone);
  expect(session.user?.role).toBe("customer");
});

test("rejects a wrong OTP code without creating a session", async ({
  page,
  baseURL,
}) => {
  const phone = uniquePhone();
  const registerRes = await fetch(`${baseURL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `مشتری OTP ${getState().prefix}`,
      phone,
      password: "otp-e2e-pass-123",
    }),
  });
  expect(registerRes.status).toBe(201);

  await page.goto("/login");
  await page.getByRole("button", { name: "ورود با کد یک‌بارمصرف" }).click();
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();

  await expect(page.getByLabel("کد تأیید")).toBeVisible();
  // A wrong-but-well-formed 6-digit code (not the real one).
  await page.getByLabel("کد تأیید").fill("000000");
  await page.getByRole("button", { name: "ورود", exact: true }).click();

  await expect(page.getByText("کد وارد شده صحیح نیست")).toBeVisible();
  // No session was created, and we are still on the login page.
  const session = await liveSession(page);
  expect(session.user).toBeFalsy();
  await expect(page).toHaveURL(/\/login$/);
});

/**
 * Login-OTP account-existence gate (backend-enforced).
 *
 * For a phone with NO account, POST /api/auth/otp/request (purpose=login)
 * answers 404 { reason: "not_registered" } — no OtpCode row is created,
 * no SMS is dispatched, and the UI must NOT show a success toast or enter
 * the verify step; it offers registration with the phone preserved.
 */
test("login OTP for an unregistered phone never fakes an SMS and offers registration", async ({
  page,
  baseURL,
}) => {
  const phone = uniquePhone();

  // A) Server contract — direct API assertion (never trusts the client).
  const apiRes = await fetch(`${baseURL}/api/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, purpose: "login" }),
  });
  expect(apiRes.status).toBe(404);
  const apiBody = (await apiRes.json()) as {
    error?: string;
    reason?: string;
    sent?: boolean;
  };
  expect(apiBody.reason).toBe("not_registered");
  expect(apiBody.sent).toBeUndefined();

  // Server-side side effects: NO OtpCode row (nothing was issued) and NO
  // mock SMS (dev-last would return the plaintext code of the last SMS —
  // but for this phone nothing exists).
  const devLast = await fetch(`${baseURL}/api/auth/otp/dev-last?phone=${phone}`);
  expect(devLast.status).toBe(404);

  // B) UI journey — no success toast, no verify step, registration offered.
  await page.goto("/login");
  await page.getByRole("button", { name: "ورود با کد یک‌بارمصرف" }).click();
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();

  // The verify step is never entered and no "code sent" toast appears.
  await expect(page.getByLabel("کد تأیید")).toHaveCount(0);
  await expect(page.getByText("کد ورود پیامک شد")).toHaveCount(0);

  // The unregistered-phone alert offers registration with the SAME phone.
  await expect(
    page.getByText("ثبت‌نامی با این شماره موبایل پیدا نشد")
  ).toBeVisible();
  const registerLink = page.getByRole("link", {
    name: "ثبت‌نام با همین شماره",
  });
  await expect(registerLink).toBeVisible();

  // C) Phone preservation — the CTA links to /register?phone=<number> and
  //     the register page prefills the field from it (server re-validates).
  await registerLink.click();
  await expect(page).toHaveURL(new RegExp("/register\\?phone="));
  await expect(page.getByLabel("شماره موبایل")).toHaveValue(phone);

  // D) Completing registration for THIS phone through the prefilled password
  // form works (the number was genuinely unregistered).
  await page.getByLabel(/^نام و نام خانوادگی/).fill(`مشتری ${getState().prefix}`);
  await page.getByLabel("رمز عبور", { exact: true }).fill("otp-e2e-pass-123");
  await page.getByLabel("تکرار رمز عبور").fill("otp-e2e-pass-123");
  await page.getByRole("button", { name: "ثبت‌نام", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/$"), { timeout: 15_000 });

  // E) And now the login-OTP request for the SAME phone succeeds (sent).
  const okRes = await fetch(`${baseURL}/api/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, purpose: "login" }),
  });
  expect(okRes.status).toBe(200);
  const okBody = (await okRes.json()) as { sent?: boolean };
  expect(okBody.sent).toBe(true);

  // Cleanup — remove the account created in step D (prefix-tagged name;
  // global-teardown sweeps users by name prefix).
});

test("login OTP rejects an invalid phone number", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "ورود با کد یک‌بارمصرف" }).click();
  await page.getByLabel("شماره موبایل").fill("12345");
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();

  // Client-side zod validation blocks the request (no verify step, no toast).
  await expect(page.getByLabel("کد تأیید")).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
});
