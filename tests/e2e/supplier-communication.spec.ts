import { test, expect, type Browser, type Page } from "@playwright/test";
import mongoose from "mongoose";
import { getState, type E2EState } from "./helpers/fixtures";
import { connectDb, disconnectDb } from "./helpers/db";

/**
 * Journey 17 — Customer communication / order support (Session 68).
 *
 * The full support loop through the REAL UI on the shared seeded roles:
 *   customer starts a conversation from a purchased order + sends a message
 *   → admin replies from the /admin/support queue
 *   → supplier (the order's supplier) replies from /supplier/support
 *   → the customer sees both replies.
 *
 * The paid Order + SupplierOrder are SEEDED directly in MongoDB in beforeAll
 * (conversation eligibility is DB-derived: order.customer + payment.status
 * paid) and are cleaned by global-teardown (orders of PREFIX'd customers +
 * their supplierorders + customerconversations).
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Customer support communication", () => {
  test.use({ storageState: getState().customerStatePath });

  let state: E2EState;
  let orderId = "";
  let supplierOrderId = "";
  let ghostConvId = "";
  const subject = () => `پیگیری سفارش ${state.prefix}`;
  // A second conversation whose supplier ref points at a DELETED Supplier doc
  // (the Session 68 null-safe hardening case) — the detail pages must render
  // it gracefully instead of crashing on `conversation.supplier.businessName`.
  const ghostSubject = () => `فروشنده حذف‌شده ${state.prefix}`;

  test.beforeAll(async () => {
    state = getState();
    await connectDb();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Not connected to MongoDB");

    // Seed a PAID order for the seeded customer with a supplier-order for the
    // seeded supplier (the conversation's supplier is derived from this).
    const productId = new mongoose.Types.ObjectId();
    const orderRes = await db.collection("orders").insertOne({
      customer: new mongoose.Types.ObjectId(state.customerId),
      items: [
        {
          product: productId,
          supplier: new mongoose.Types.ObjectId(state.supplierId),
          name: `محصول پشتیبانی ${state.prefix}`,
          price: 200000,
          supplierPrice: 150000,
          quantity: 1,
        },
      ],
      totalAmount: 200000,
      status: "processing",
      payment: { status: "paid", method: "zarinpal" },
      shipping: {},
      refund: {},
      stockRestored: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    orderId = String(orderRes.insertedId);

    const soRes = await db.collection("supplierorders").insertOne({
      order: new mongoose.Types.ObjectId(orderId),
      supplier: new mongoose.Types.ObjectId(state.supplierId),
      items: [
        {
          product: productId,
          name: `محصول پشتیبانی ${state.prefix}`,
          supplierPrice: 150000,
          quantity: 1,
        },
      ],
      amountOwed: 150000,
      status: "confirmed",
      isPaidOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    supplierOrderId = String(soRes.insertedId);

    // Seed a SECOND conversation with a supplier ref that resolves to NO
    // Supplier document (deleted). The customer + admin detail GETs return
    // supplier=null here, and the hardened pages must render the fallback
    // (subject visible, thread readable) rather than throw. The ghost
    // supplierOrder id sidesteps the real collection's unique partial index
    // {supplierOrder} where status ∈ [open,pending] (the UI-created
    // conversation in the main test owns the seeded supplierOrder).
    const ghostConvRes = await db.collection("customerconversations").insertOne({
      customer: new mongoose.Types.ObjectId(state.customerId),
      order: new mongoose.Types.ObjectId(orderId),
      supplierOrder: new mongoose.Types.ObjectId(),
      supplier: new mongoose.Types.ObjectId(), // no Supplier doc has this _id
      product: null,
      category: "general",
      subject: ghostSubject(),
      status: "open",
      customerUnread: false,
      staffUnread: true,
      lastMessageAt: new Date(),
      lastMessagePreview: "سلام، فروشنده در دسترس نیست.",
      lastMessageFrom: "customer",
      messages: [
        {
          _id: new mongoose.Types.ObjectId(),
          sender: new mongoose.Types.ObjectId(state.customerId),
          senderRole: "customer",
          text: "سلام، فروشنده در دسترس نیست.",
          createdAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ghostConvId = String(ghostConvRes.insertedId);
  });

  test.afterAll(async () => {
    await disconnectDb();
  });

  async function adminContext(browser: Browser) {
    return browser.newContext({
      storageState: state.adminStatePath,
      baseURL: state.baseURL,
    });
  }

  async function supplierContext(browser: Browser) {
    return browser.newContext({
      storageState: state.supplierStatePath,
      baseURL: state.baseURL,
    });
  }

  /** Open the conversation detail (customer view) and assert it loaded. */
  async function openConversationDetail(
    page: Page,
    id: string
  ): Promise<void> {
    await page.goto(`/support/${id}`);
    await expect(page.getByRole("heading", { name: subject() })).toBeVisible();
  }

  test("customer starts a conversation, admin replies, supplier replies, customer sees both", async ({
    page,
    browser,
  }) => {
    // --- 1. Customer: start a conversation from the purchased order ---
    await page.goto("/support");
    await expect(
      page.getByRole("heading", { name: "پشتیبانی و پیگیری سفارش‌ها" })
    ).toBeVisible();
    // The header CTA is always present; the empty-state may also render a
    // second "شروع گفتگو جدید" CTA once the list resolves — target the header
    // one deterministically (strict mode would reject the ambiguous match).
    await page
      .getByRole("button", { name: "شروع گفتگو جدید" })
      .first()
      .click();

    await page.getByLabel("سفارش").selectOption(orderId);
    await page.getByLabel("فروشنده").selectOption(supplierOrderId);
    await page.getByLabel("عنوان گفتگو").fill(subject());
    await page.getByLabel("پیام شما").fill("سلام، وضعیت ارسال سفارشم چطور است؟");
    await page.getByRole("button", { name: "ایجاد گفتگو" }).click();

    // Redirected to the detail page with the first message visible.
    await expect(page.getByRole("heading", { name: subject() })).toBeVisible();
    await expect(
      page.getByText("سلام، وضعیت ارسال سفارشم چطور است؟")
    ).toBeVisible();
    const convUrl = page.url();
    const convId = convUrl.split("/").pop() || "";

    // --- 2. Customer sends a follow-up message ---
    await page.getByPlaceholder(/پاسخ خود را بنویسید/).fill("کد رهگیری می‌فرستید؟");
    await page.getByRole("button", { name: "ارسال", exact: true }).click();
    await expect(page.getByText("کد رهگیری می‌فرستید؟")).toBeVisible();

    // --- 3. Admin: sees the conversation in the queue and replies ---
    const adminCtx = await adminContext(browser);
    const adminPage = await adminCtx.newPage();
    await adminPage.goto("/admin/support");
    await expect(
      adminPage.getByRole("heading", { name: "مرکز پشتیبانی" })
    ).toBeVisible();
    await expect(adminPage.getByText(subject())).toBeVisible();
    await adminPage.getByText(subject()).click();
    await expect(
      adminPage.getByRole("heading", { name: subject() })
    ).toBeVisible();
    await adminPage
      .getByPlaceholder(/پاسخ پشتیبانی را بنویسید/)
      .fill("در حال بررسی هستیم، به‌زودی پاسخ می‌دهیم.");
    await adminPage.getByRole("button", { name: "ارسال", exact: true }).click();
    await expect(
      adminPage.getByText("در حال بررسی هستیم، به‌زودی پاسخ می‌دهیم.")
    ).toBeVisible();
    await adminPage.close();
    await adminCtx.close();

    // --- 4. Customer: sees the admin reply ---
    await openConversationDetail(page, convId);
    await expect(
      page.getByText("در حال بررسی هستیم، به‌زودی پاسخ می‌دهیم.")
    ).toBeVisible();

    // --- 5. Supplier: sees the conversation in /supplier/support and replies ---
    const supplierCtx = await supplierContext(browser);
    const supplierPage = await supplierCtx.newPage();
    await supplierPage.goto("/supplier/support");
    await expect(
      supplierPage.getByRole("heading", { name: "ارتباط با مشتریان" })
    ).toBeVisible();
    await expect(supplierPage.getByText(subject())).toBeVisible();
    await supplierPage.getByText(subject()).click();
    await expect(
      supplierPage.getByRole("heading", { name: subject() })
    ).toBeVisible();
    await expect(
      supplierPage.getByText("در حال بررسی هستیم، به‌زودی پاسخ می‌دهیم.")
    ).toBeVisible();
    await supplierPage
      .getByPlaceholder(/پاسخ مشتری را بنویسید/)
      .fill("بسته شما امروز ارسال شد؛ کد رهگیری: 1234");
    await supplierPage.getByRole("button", { name: "ارسال", exact: true }).click();
    await expect(
      supplierPage.getByText("بسته شما امروز ارسال شد؛ کد رهگیری: 1234")
    ).toBeVisible();
    await supplierPage.close();
    await supplierCtx.close();

    // --- 6. Customer: sees the supplier reply ---
    await openConversationDetail(page, convId);
    await expect(
      page.getByText("بسته شما امروز ارسال شد؛ کد رهگیری: 1234")
    ).toBeVisible();
  });

  test("dead-supplier conversation renders gracefully on customer + admin detail pages", async ({
    page,
    browser,
  }) => {
    // The conversation's supplier ref points at a deleted Supplier doc — the
    // API returns supplier=null and BOTH detail pages must render the thread
    // (heading + first message) instead of throwing on .businessName.
    await page.goto(`/support/${ghostConvId}`);
    await expect(
      page.getByRole("heading", { name: ghostSubject() })
    ).toBeVisible();
    await expect(page.getByText("سلام، فروشنده در دسترس نیست.")).toBeVisible();

    const adminCtx = await adminContext(browser);
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`/admin/support/${ghostConvId}`);
    await expect(
      adminPage.getByRole("heading", { name: ghostSubject() })
    ).toBeVisible();
    await expect(adminPage.getByText("سلام، فروشنده در دسترس نیست.")).toBeVisible();
    await adminPage.close();
    await adminCtx.close();
  });
});
