import { test, expect } from "@playwright/test";
import mongoose from "mongoose";
import { getState } from "./helpers/fixtures";
import { connectDb, disconnectDb } from "./helpers/db";

/**
 * Session 84 — password recovery journey (Journey 18, desktop).
 *
 * Full user-facing loop through the REAL UI:
 *   login → «رمز عبور را فراموش کردهاید؟» → /forgot-password →
 *   phone → OTP (read via the SMS_MOCK dev seam) → new password →
 *   success → login with the NEW password (lands on the storefront) —
 *   and the OLD password is rejected afterwards.
 *
 * The mobile RTL smoke for this journey lives in password-reset-mobile.spec.ts
 * (an anonymous request-step check — it never registers).
 *
 * Requires the dev server with SMS_MOCK=1 (playwright.config.ts sets it in CI).
 */

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}${phoneCounter}`;
}

// ONE shared customer for the whole journey — the two tests run sequentially
// in the same worker. A full Playwright run already sits at the shared per-IP
// register budget (5/15min: global-setup + otp-login ×2 + session-security +
// supplier-application), so this journey sweeps ONLY the `rl:register:` keys
// before its single registration (the fixture-isolation convention the verify
// suites use; no E2E spec asserts a register 429). Other limiters are
// untouched. After test 1 completes the reset, all OTP rows for the phone are
// consumed, so test 2 can request a fresh code without hitting the 60s
// resend cooldown.
let sharedPhone: string | null = null;
let registered: Promise<void> | null = null;

function ensureCustomer(baseURL: string): Promise<void> {
  if (!registered) {
    registered = (async () => {
      await connectDb();
      const db = mongoose.connection.db;
      if (!db) throw new Error("Not connected to MongoDB");
      // The limiter stores its keys in `_id` as plain strings (same typing
      // convention as helpers/db.ts clearRateLimiterKeys).
      await db.collection<{ _id: string }>("ratelimits").deleteMany({
        _id: { $regex: "^rl:register:" },
      });
      await disconnectDb();

      sharedPhone = uniquePhone();
      const res = await fetch(`${baseURL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `مشتری بازیابی ${getState().prefix}`,
          phone: sharedPhone,
          password: "reset-old-pass-123",
        }),
      });
      expect(res.status).toBe(201);
    })();
  }
  return registered;
}

async function readDevCode(baseURL: string, phone: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/auth/otp/dev-last?phone=${phone}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string };
  expect(body.code).toMatch(/^\d{6}$/);
  return body.code;
}

test("recovers the password and signs in with the new one", async ({
  page,
  baseURL,
}) => {
  await ensureCustomer(baseURL!);
  const phone = sharedPhone!;
  const oldPassword = "reset-old-pass-123";
  const newPassword = "reset-new-pass-456";

  // 1. Entry point on the login page (password tab is the default).
  await page.goto("/login");
  // NOTE: «کرده‌اید» contains U+200C (ZWNJ) — must match the page text exactly.
  await page
    .getByRole("link", { name: "رمز عبور را فراموش کرده‌اید؟" })
    .click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await expect(
    page.getByRole("heading", { name: "بازیابی رمز عبور" })
  ).toBeVisible();

  // 2. Step 1 — phone (generic anti-enumeration note is visible).
  await page.getByLabel("شماره موبایل").fill(phone);
  await expect(page.getByText(/اگر این شماره در سامانه ثبت شده باشد/)).toBeVisible();
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();

  // 3. Step 2 — OTP code.
  await expect(page.getByLabel("کد تأیید")).toBeVisible();
  const code = await readDevCode(baseURL!, phone);
  await page.getByLabel("کد تأیید").fill(code);
  await page.getByRole("button", { name: "تأیید کد" }).click();

  // 4. Step 3 — new password + confirm. (`exact` — «تکرار رمز عبور جدید»
  // contains «رمز عبور جدید» as a substring, so substring matching would
  // resolve both inputs.)
  await expect(page.getByLabel("رمز عبور جدید", { exact: true })).toBeVisible();
  await page.getByLabel("رمز عبور جدید", { exact: true }).fill(newPassword);
  await page.getByLabel("تکرار رمز عبور جدید", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "ثبت رمز عبور جدید" }).click();

  // 5. Step 4 — success.
  await expect(
    page.getByRole("heading", { name: "رمز عبور با موفقیت تغییر کرد" })
  ).toBeVisible();
  await page.getByRole("button", { name: "ورود به حساب کاربری" }).click();

  // 6. Login with the NEW password → customer lands on the storefront.
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByLabel("رمز عبور").fill(newPassword);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(
    page.getByRole("button", { name: "حساب کاربری" })
  ).toBeVisible();

  // 7. The OLD password is dead. (Header account-menu logout — the dropdown
  // exposes a menuitem «خروج», the «خروج از حساب» button lives on /profile.)
  await page.getByRole("button", { name: "حساب کاربری" }).click();
  await page.getByRole("menuitem", { name: "خروج" }).click();
  await page.goto("/login");
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByLabel("رمز عبور").fill(oldPassword);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("rejects a wrong OTP code during recovery", async ({ page, baseURL }) => {
  // Shares the phone registered by the first test (the previous reset
  // consumed all its OTP rows, so a fresh code issues without a cooldown).
  await ensureCustomer(baseURL!);
  const phone = sharedPhone!;

  await page.goto("/forgot-password");
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();
  await expect(page.getByLabel("کد تأیید")).toBeVisible();

  // A wrong-but-well-formed code.
  await page.getByLabel("کد تأیید").fill("000000");
  await page.getByRole("button", { name: "تأیید کد" }).click();
  await expect(page.getByText("کد وارد شده صحیح نیست")).toBeVisible();
  // Still on the recovery flow — no session, no step advance.
  await expect(page.getByLabel("کد تأیید")).toBeVisible();
  const session = await page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    return (await res.json()) as { user?: unknown };
  });
  expect(session.user).toBeFalsy();
});
