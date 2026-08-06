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
