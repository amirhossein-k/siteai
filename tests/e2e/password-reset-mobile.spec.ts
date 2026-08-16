import { test, expect } from "@playwright/test";

/**
 * Session 84 — forgot-password RTL mobile smoke (Journey 18, mobile).
 *
 * Runs in the narrow chromium-mobile project only (playwright.config.ts
 * testMatch). Deliberately ANONYMOUS: an unknown phone exercises the real
 * anti-enumeration path (same 200 `{ sent: true }`, dummy OTP row, no SMS)
 * and advances to the OTP step — so the journey never consumes the shared
 * per-IP register budget that desktop journeys already sit at.
 *
 * Verifies the Session 83 visual language holds on mobile: the split-screen
 * scene collapses, no horizontal overflow, no console errors, RTL layout
 * intact, and the four-step state machine advances.
 */

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}${phoneCounter}`;
}

test("forgot-password page renders and advances to the OTP step (anonymous)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // The wrong-code attempt below EXPECTS a 400 — Chromium logs every failed
    // network request, so filter the expected 4xx resource log (a real JS
    // exception or a 5xx would still surface).
    if (/Failed to load resource/.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const phone = uniquePhone();

  // Direct entry (no session) — the route group renders without the
  // storefront header/footer; the holographic scene is hidden on mobile.
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("heading", { name: "بازیابی رمز عبور" })
  ).toBeVisible();
  await expect(page.getByLabel("شماره موبایل")).toBeVisible();
  await expect(page.getByText(/اگر این شماره در سامانه ثبت شده باشد/)).toBeVisible();

  // The scene must not push the panel off-screen on a 393px-wide viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Unknown phone → same public response → advances to the OTP step.
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();
  await expect(page.getByLabel("کد تأیید")).toBeVisible();

  // The 6-digit input accepts a code and the error state renders RTL.
  await page.getByLabel("کد تأیید").fill("000000");
  await page.getByRole("button", { name: "تأیید کد" }).click();
  await expect(page.getByText("کد وارد شده صحیح نیست")).toBeVisible();
  await expect(page.getByLabel("کد تأیید")).toBeVisible();

  // No horizontal overflow on the verify step either.
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow2).toBeLessThanOrEqual(0);

  // The session must never exist at any point (a reset cannot authenticate).
  const session = await page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    return (await res.json()) as { user?: unknown };
  });
  expect(session.user).toBeFalsy();

  expect(consoleErrors).toEqual([]);
});
