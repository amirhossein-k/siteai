import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  getState,
  createCategory,
  createProduct,
  placeOrder,
  E2E_PASSWORD,
  type E2EState,
} from "./helpers/fixtures";
import { apiLogin } from "./helpers/auth";
import { connectDb, disconnectDb } from "./helpers/db";

/**
 * Session 80 — Admin notification bell journey.
 *
 * The shared seeded admin (09120000000) accumulates notifications across all
 * suites (every admin-targeted event hits it), so badge counts would be
 * non-deterministic. This journey creates a FRESH admin per run (unique phone,
 * name embedding the run prefix → global-teardown removes it + its
 * notifications automatically) and logs it in via the REAL credentials API,
 * writing a temporary storageState for the browser tests.
 *
 * Events are triggered through real flows where possible: a customer checkout
 * produces the admin `new_order` notification (Session 80 wiring). Read/mark
 * state is verified server-side through the notifications API.
 */
const AUTH_DIR = path.resolve(process.cwd(), "tests/e2e/.auth");

/** Deterministic fresh admin phone (11 digits, unique per run). */
function genPhone(): string {
  const n = Date.now() % 100000000;
  return `09${String(n).padStart(8, "0")}`;
}

test.describe("Admin notification bell", () => {
  let state: E2EState;
  let adminId: string;
  let statePath: string;
  let adminCtx: APIRequestContext;
  let customerCtx: APIRequestContext;
  let categoryId = "";
  let productId = "";
  const productName = `کالای اعلان ادمین`;
  const price = 150_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    customerCtx = await playwright.request.newContext({
      storageState: state.customerStatePath,
    });

    // --- Fresh, isolated admin (deterministic badge counts + empty state) ---
    await connectDb();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Not connected to MongoDB");
    const phone = genPhone();
    const inserted = await db.collection("users").insertOne({
      name: `ادمین ${state.prefix}`,
      phone,
      passwordHash: await bcrypt.hash(E2E_PASSWORD, 10),
      role: "admin",
      isActive: true,
      address: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    adminId = inserted.insertedId.toString();

    statePath = path.join(AUTH_DIR, `admin-notif-${Date.now()}.json`);
    const loginCtx = await playwright.request.newContext({
      baseURL: state.baseURL,
    });
    await apiLogin(loginCtx, phone, E2E_PASSWORD);
    await loginCtx.storageState({ path: statePath });
    await loginCtx.dispose();

    adminCtx = await playwright.request.newContext({ storageState: statePath });

    // Product for the real checkout event (owned by the run's supplier).
    categoryId = await createCategory(adminCtx, state.prefix, 88);
    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}admin-notif-prod`,
      name: `${productName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 90_000,
      stock: 5,
    });
  });

  test.afterAll(async () => {
    fs.rmSync(statePath, { force: true });
    await adminCtx?.dispose();
    await customerCtx?.dispose();
    await disconnectDb();
  });

  // Track the per-test browser contexts so every one is closed after the
  // test (the `browser` fixture lives for the whole worker — a leak would
  // accumulate open contexts across the full suite).
  const openContexts: Array<Awaited<ReturnType<Browser["newContext"]>>> = [];

  async function openPage(browser: Browser): Promise<Page> {
    const ctx = await browser.newContext({ storageState: statePath });
    openContexts.push(ctx);
    return ctx.newPage();
  }

  test.afterEach(async () => {
    await Promise.all(openContexts.splice(0).map((c) => c.close()));
  });

  test("badge shows the real unread count and clicking a notification navigates + marks read", async ({
    browser,
  }) => {
    const page = await openPage(browser);
    await page.goto("/admin/dashboard");

    const bell = page.getByRole("button", { name: "اعلان‌ها" });
    await expect(bell).toBeVisible();
    // Fresh admin → zero unread → no badge chip.
    await expect(bell.locator("span")).toHaveCount(0);

    // Real event: customer places an order → the fresh admin gets new_order.
    const { orderId } = await placeOrder({
      customer: customerCtx,
      items: [{ id: productId, quantity: 1, price, name: `${productName} ${state.prefix}` }],
      paymentMethod: "manual",
    });

    // Server-side confirmation of the event wiring (authoritative).
    await expect
      .poll(async () => {
        const res = await adminCtx.get("/api/notifications?limit=10");
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          data: Array<{
            type: string;
            link: string;
            relatedOrder?: string | null;
            isRead: boolean;
          }>;
        };
        const item = body.data.find(
          (n) => n.type === "new_order" && n.relatedOrder === orderId
        );
        return item ?? null;
      })
      .not.toBeNull();

    // Badge reflects exactly one unread (fresh admin, real count).
    await expect(bell.locator("span")).toHaveText("1");

    // Open the dropdown panel.
    await bell.click();
    const panel = page.getByRole("dialog", { name: "پنل اعلان‌ها" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/سفارش جدید/).first()).toBeVisible();

    // Click the notification → marks read + navigates to the admin order page.
    await panel.getByText(/سفارش جدید/).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${orderId}$`));

    // Marked read server-side.
    await expect
      .poll(async () => {
        const res = await adminCtx.get("/api/notifications?limit=10");
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          data: Array<{ type: string; relatedOrder?: string | null; isRead: boolean }>;
        };
        const item = body.data.find(
          (n) => n.type === "new_order" && n.relatedOrder === orderId
        );
        return item?.isRead ?? null;
      })
      .toBe(true);

    // Badge hidden again (0 unread) — on the navigated page's header bell.
    const bellAfter = page.getByRole("button", { name: "اعلان‌ها" });
    await expect(bellAfter.locator("span")).toHaveCount(0);
  });

  test("mark-all-read clears the badge; panel shows the empty state after items are gone", async ({
    browser,
  }) => {
    // Seed two unread notifications directly for the fresh admin (the read/
    // mark-all/empty-state flows; event wiring is covered by the first test).
    const db = mongoose.connection.db;
    if (!db) throw new Error("Not connected to MongoDB");
    const keyBase = `${state.prefix}markall_${Date.now()}`;
    const recipient = new mongoose.Types.ObjectId(adminId);
    for (let i = 0; i < 2; i++) {
      await db.collection("notifications").insertOne({
        recipient,
        type: "supplier_application",
        category: "system",
        message: `درخواست تست اعلان ${keyBase}${i}`,
        link: "/admin/suppliers?tab=applications",
        notificationKey: `${keyBase}${i}`,
        isRead: false,
        readAt: null,
        sentToTelegram: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const page = await openPage(browser);
    await page.goto("/admin/dashboard");
    const bell = page.getByRole("button", { name: "اعلان‌ها" });
    await expect(bell.locator("span")).toHaveText("2");

    await bell.click();
    const panel = page.getByRole("dialog", { name: "پنل اعلان‌ها" });
    await expect(panel.getByText(/درخواست تست اعلان/).first()).toBeVisible();

    // Mark all read → badge disappears.
    await panel.getByRole("button", { name: "علامت‌گذاری همه" }).click();
    await expect(bell.locator("span")).toHaveCount(0);
    // Unread dots gone.
    await expect(panel.locator("li button span.bg-sky-600")).toHaveCount(0);

    // Empty state: remove every notification for the fresh admin, reload,
    // reopen → «اعلانی وجود ندارد».
    await db.collection("notifications").deleteMany({ recipient });
    await page.reload();
    await page.getByRole("button", { name: "اعلان‌ها" }).click();
    await expect(
      page.getByRole("dialog", { name: "پنل اعلان‌ها" }).getByText("اعلانی وجود ندارد")
    ).toBeVisible();
  });

  test("panel stays usable within a mobile viewport", async ({ browser }) => {
    const page = await openPage(browser);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/dashboard");

    await page.getByRole("button", { name: "اعلان‌ها" }).click();
    const panel = page.getByRole("dialog", { name: "پنل اعلان‌ها" });
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
