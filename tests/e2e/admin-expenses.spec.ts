import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, type E2EState } from "./helpers/fixtures";

/**
 * ZWNJ-tolerant Persian matcher: some UI labels contain U+200C (e.g.
 * «هزینه‌ها»), which invisible bytes would break an exact-string match on.
 * Building a regex with `\u200c?` between every char keeps assertions robust
 * regardless of whether the label contains the zero-width joiner.
 */
function fa(text: string): RegExp {
  return new RegExp(
    text
      .split("")
      .map((ch) => (ch === " " ? "\\s+" : `${ch}\u200c?`))
      .join("")
  );
}

const PERSIAN = {
  expenses: "هزینه‌ها",
  newExpense: "ثبت هزینه جدید",
  submit: "ثبت هزینه",
  paid: "پرداخت شده",
  pending: "در انتظار پرداخت",
  voided: "باطل شده",
  markPaid: "ثبت به‌عنوان پرداخت‌شده",
  void: "باطل‌سازی",
  voidReason: "دلیل باطل‌سازی",
  confirmVoid: "تأیید باطل‌سازی",
  details: "جزئیات",
  expensesReport: "گزارش هزینه‌ها",
  operatingExpenses: "هزینه‌های عملیاتی",
  netProfit: "سود خالص",
};

/**
 * Journey 22 — Admin Expenses (Session 82 Phase E).
 *
 * The admin creates an operating expense through the real /admin/expenses UI,
 * sees it in the list, marks it paid, then audited-voids it with a required
 * reason — and verifies the server-side accounting integration: the expense
 * report totals EXCLUDE voided rows, and the P&L shows net profit = gross
 * profit − operating expenses.
 *
 * The expense description embeds the run prefix so cleanupByPrefix (which
 * matches `expenses.description`) removes every fixture row on teardown.
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Admin expenses", () => {
  // Logged-in admin session for the whole spec.
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  const activeDesc = "اجاره دفتر (فاز E)";
  const voidDesc = "هزینه خطا (فاز E)";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    // Rate limiter: expense-write is 60/actor/15min shared with the regression
    // verify suites — clear this suite's own keys first (test-state only).
    const { connectDb, disconnectDb } = await import("./helpers/db");
    await connectDb();
    const { default: mongoose } = await import("mongoose");
    await mongoose.connection.db
      ?.collection<{ _id: string }>("ratelimits")
      .deleteMany({ _id: { $regex: "^rl:expense-write:" } });
    await disconnectDb();
  });

  test.afterAll(async () => {
    // cleanupByPrefix (global teardown) removes PREFIX'd expense rows via the
    // description regex — nothing extra needed here.
  });

  test("admin creates an expense, marks it paid, and audited-voids a second one", async ({
    page,
  }) => {
    const fullActiveDesc = `${activeDesc} ${state.prefix}`;
    const fullVoidDesc = `${voidDesc} ${state.prefix}`;

    // --- Create the ACTIVE expense through the real UI ---
    await page.goto("/admin/expenses");
    await expect(
      page.getByRole("heading", { name: fa(PERSIAN.expenses) }).first()
    ).toBeVisible();

    await page.getByRole("button", { name: fa(PERSIAN.newExpense) }).click();
    await page.getByLabel("دسته‌بندی هزینه").selectOption("rent");
    await page.getByLabel("مبلغ (تومان)").fill("3000000");
    await page.getByLabel("دریافت‌کننده").fill("صاحب ساختمان");
    await page.getByLabel("شرح هزینه").fill(fullActiveDesc);
    // exact: true — the toggle button «ثبت هزینه جدید» must not match.
    await page.getByRole("button", { name: PERSIAN.submit, exact: true }).click();

    await expect(
      page.getByText(fullActiveDesc, { exact: true })
    ).toBeVisible();
    await expect(page.getByText(fa(PERSIAN.pending)).first()).toBeVisible();

    // --- Detail page: mark paid ---
    await page.getByRole("link", { name: fa(PERSIAN.details) }).first().click();
    await expect(
      page.getByRole("heading", { name: fullActiveDesc })
    ).toBeVisible();
    await expect(page.getByText("۳٬۰۰۰٬۰۰۰")).toBeVisible();

    await page
      .getByRole("button", { name: fa(PERSIAN.markPaid) })
      .click();
    await expect(page.getByText(fa(PERSIAN.paid)).first()).toBeVisible();

    // --- Back to list: create the VOIDED expense ---
    await page.goto("/admin/expenses");
    await page.getByRole("button", { name: fa(PERSIAN.newExpense) }).click();
    await page.getByLabel("دسته‌بندی هزینه").selectOption("shipping");
    await page.getByLabel("مبلغ (تومان)").fill("500000");
    await page.getByLabel("شرح هزینه").fill(fullVoidDesc);
    await page.getByRole("button", { name: PERSIAN.submit, exact: true }).click();
    await expect(page.getByText(fullVoidDesc, { exact: true })).toBeVisible();

    // --- Void it with a required reason ---
    await page
      .getByRole("row")
      .filter({ hasText: fullVoidDesc })
      .getByRole("link", { name: fa(PERSIAN.details) })
      .click();
    await page.getByRole("button", { name: fa(PERSIAN.void) }).click();
    // Reason is required — submit empty first → error.
    await page.getByRole("button", { name: fa(PERSIAN.confirmVoid) }).click();
    await expect(page.getByText("دلیل باطل‌سازی الزامی است")).toBeVisible();
    await page.getByLabel("دلیل باطل‌سازی").fill("ارسال لغو شد — خطای داخلی");
    await page.getByRole("button", { name: fa(PERSIAN.confirmVoid) }).click();
    await expect(page.getByText(fa(PERSIAN.voided)).first()).toBeVisible();
    // The audit trail is shown on the detail page.
    await expect(page.getByText(/دلیل: ارسال لغو شد/)).toBeVisible();
  });

  test("expense report excludes voided rows from totals and P&L shows net profit", async () => {
    // Expense report: the active (non-void) expense counts; the voided one is
    // visible for audit but excluded from totals.
    const reportRes = await adminCtx.get(
      `/api/admin/reports/expenses?preset=year&q=${encodeURIComponent(state.prefix)}`
    );
    expect(reportRes.ok()).toBeTruthy();
    const report = (await reportRes.json()) as {
      rows: Array<{ description: string; amount: number; status: string }>;
      totals: { amount: number };
    };
    const active = report.rows.find((r) => r.description.includes(activeDesc));
    const voided = report.rows.find((r) => r.description.includes(voidDesc));
    expect(active?.amount).toBe(3_000_000);
    expect(voided?.status).toBe("void"); // visible for audit
    // Total = only the non-void 3,000,000 (the voided 500,000 is excluded).
    expect(report.totals.amount).toBe(3_000_000);

    // P&L: operating expenses include the non-void expense and net profit =
    // gross profit − operating expenses (available — never flagged).
    const pnlRes = await adminCtx.get("/api/admin/reports/pnl?preset=year");
    expect(pnlRes.ok()).toBeTruthy();
    const pnl = (await pnlRes.json()) as {
      current: {
        rows: Array<{
          key: string;
          amount: number | null;
          unavailable?: boolean;
        }>;
      };
    };
    const rows = pnl.current.rows;
    const grossProfit = rows.find((r) => r.key === "grossProfit")?.amount ?? 0;
    const operating = rows.find((r) => r.key === "operatingExpenses");
    const netProfit = rows.find((r) => r.key === "netProfit");
    expect(operating?.amount).toBeLessThanOrEqual(-3_000_000);
    expect(netProfit?.unavailable).toBeUndefined();
    expect(netProfit?.amount).toBe(grossProfit + (operating?.amount ?? 0));
  });
});
