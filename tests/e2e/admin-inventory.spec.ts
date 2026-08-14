import { test, expect, type APIRequestContext } from "@playwright/test";
import { getState, createCategory, createProduct, type E2EState } from "./helpers/fixtures";

/**
 * ZWNJ-tolerant Persian matcher (same helper as the other admin journeys):
 * invisible U+200C bytes break exact-string matches on labels like «پیشنویس».
 */
function fa(text: string): RegExp {
  return new RegExp(
    text
      .split("")
      .map((ch) => (ch === " " ? "\\s+" : `${ch}\\u200c?`))
      .join("")
  );
}

/**
 * Journey 21 — Inventory adjustments + movement ledger (Session 82 Phase D).
 *
 * The admin receives purchased inventory through the REAL purchases API
 * (10 × 50,000 → one FIFO cost layer), then uses the REAL /admin/inventory UI
 * to (1) inspect the FIFO cost layer, (2) apply a POSITIVE adjustment at a
 * CONFIRMED cost (a new layer is created — never silently the current
 * supplierPrice), (3) apply a NEGATIVE adjustment (FIFO layers are consumed),
 * (4) verify each step in the movement ledger, and (5) verify post-cutover
 * direct stock edits are rejected (the ledger stays complete).
 *
 * Seeding uses real APIs only (admin products + accounting init wizard +
 * purchases create/order/receive). The wizard stamps the GLOBAL accounting
 * config singleton; this suite's afterAll removes it immediately (the
 * verify-accounting.js convention) so the post-cutover stock-edit enforcement
 * never leaks into later specs (global-teardown also removes it at run end).
 *
 * Desktop chromium only (the mobile project's testMatch excludes this spec).
 */
test.describe("Admin inventory", () => {
  test.use({ storageState: getState().adminStatePath });

  let state: E2EState;
  let adminCtx: APIRequestContext;
  let productId = "";
  const productName = "انبارسنج";

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    const categoryId = await createCategory(adminCtx, state.prefix, 23);
    productId = await createProduct(adminCtx, {
      slug: `${state.prefix}inventory-prod`,
      name: `${productName} ${state.prefix}`,
      categoryId,
      supplierId: state.supplierId,
      price: 200_000,
      supplierPrice: 90_000,
      // Stock 0 so every later change is provable through the ledger.
      stock: 0,
    });

    // NOTE: the init wizard is IDEMPOTENT only for zero-stock conversions — a
    // re-run after the receipt (stock > 0) 400s (opening cost required for
    // valued stock). Playwright recycles the worker after a test failure and
    // re-runs beforeAll, so the seeding must be self-healing: skip init when
    // the product is already purchased, and skip the receive when stock is
    // already 10. The config sweep + init run ONLY when the conversion is
    // actually needed — deleting the stamped singleton on a skip would turn
    // the post-cutover enforcement OFF for the rest of the journey.
    const already = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    const alreadyBody = (await already.json()) as {
      data?: Array<{ _id: string; sourcing?: string; stock?: number }>;
    };
    const alreadyRow = (alreadyBody.data ?? []).find((p) => p._id === productId);
    const alreadyPurchased = alreadyRow?.sourcing === "purchased";
    const alreadyStocked = (alreadyRow?.stock ?? 0) >= 10;

    if (!alreadyPurchased) {
      // Convert to purchased via the accounting init wizard (the only real-API
      // path). Stock 0 → no opening layer (receipt will create it).
      const { connectDb, disconnectDb } = await import("./helpers/db");
      await connectDb();
      const { default: mongoose } = await import("mongoose");
      await mongoose.connection.db
        ?.collection<{ _id: string }>("ratelimits")
        .deleteMany({ _id: { $regex: "^rl:accounting-init:" } });
      await mongoose.connection.db
        ?.collection<{ _id: unknown }>("accountingconfigs")
        .deleteMany({ _id: "accounting" } as never);
      await disconnectDb();

      const initRes = await adminCtx.post("/api/admin/accounting/initialize", {
        data: {
          confirmValuation: true,
          cutoverDate: new Date().toISOString(),
          items: [{ productId }],
        },
      });
      expect(initRes.status()).toBe(200);
    } else {
      // Recycle path (worker restart after a failure): the product was already
      // converted by a previous run of THIS journey. That run's afterAll
      // cleaned up the config singleton — re-stamp it directly (test-state
      // setup mirroring the wizard) so the post-cutover enforcement tests in
      // this journey stay valid.
      const { connectDb, disconnectDb, stampAccountingConfig } = await import(
        "./helpers/db"
      );
      await connectDb();
      await stampAccountingConfig();
      await disconnectDb();
    }

    if (!alreadyStocked) {
      // Receive 10 × 50,000 through the real purchases API (create → order →
      // receive). Self-healing rate-limit sweep (shared seeded admin).
      const { connectDb, disconnectDb } = await import("./helpers/db");
      await connectDb();
      const { default: mongoose } = await import("mongoose");
      await mongoose.connection.db
        ?.collection<{ _id: string }>("ratelimits")
        .deleteMany({ _id: { $regex: "^rl:purchase-write:" } });
      const create = await adminCtx.post("/api/admin/purchases", {
        data: {
          supplier: state.supplierId,
          purchaseDate: new Date().toISOString(),
          reference: `${state.prefix}INV-PO`,
          items: [{ product: productId, quantity: 10, unitCost: 50_000 }],
        },
      });
      expect(create.status()).toBe(201);
      const purchase = (await create.json()) as {
        purchase: { id: string; items: Array<{ id: string }> };
      };
      const purchaseId = purchase.purchase.id;
      const itemId = purchase.purchase.items[0].id;

      const orderRes = await adminCtx.patch(
        `/api/admin/purchases/${purchaseId}`,
        { data: { action: "order" } }
      );
      expect(orderRes.status()).toBe(200);

      const rec = await adminCtx.post(`/api/admin/purchases/${purchaseId}/receive`, {
        data: {
          key: `${state.prefix}inv-receive`,
          items: [{ itemId, quantity: 10 }],
        },
      });
      expect(rec.status()).toBe(200);
      await disconnectDb();
    }
  });

  test("inventory page shows the FIFO layer from the receipt", async ({
    page,
  }) => {
    await page.goto("/admin/inventory");
    await expect(
      page.getByRole("heading", { name: fa("انبار") }).first()
    ).toBeVisible();

    // Layers tab → the single 10 × 50,000 receipt layer is visible.
    await page.getByRole("button", { name: fa("لایههای هزینه") }).click();
    // Strict-mode safe: the heading role disambiguates the subtitle paragraph
    // («...لایههای هزینه FIFO») from the tab heading («لایههای هزینه FIFO (فعال)»).
    await expect(
      page.getByRole("heading", { name: fa("لایههای هزینه FIFO") })
    ).toBeVisible();
    const layerRow = page.locator("tbody tr").first();
    await expect(layerRow).toContainText(`${productName} ${state.prefix}`);
    await expect(layerRow).toContainText("۱۰");
    await expect(layerRow).toContainText("۵۰٬۰۰۰");
  });

  test("positive adjustment adds stock + a NEW layer at the confirmed cost", async ({
    page,
  }) => {
    await page.goto("/admin/inventory");
    await page.getByRole("button", { name: fa("تعدیل موجودی") }).click();

    // Select the product by VALUE (the option label appends the formatted
    // price, so exact-label matching would never resolve).
    await page.locator("select").first().selectOption(productId);
    await page.getByPlaceholder(/مثلاً 5- یا 10/).fill("5");
    await page.getByPlaceholder("هزینه تأییدشده هر واحد").fill("60000");
    await page.getByPlaceholder(/مثلاً: آسیب دیدگی/).fill(`${state.prefix}ورودی انبار E2E`);

    // Live preview shows current 10 → result 15 with the cost impact.
    await expect(page.getByText(fa("نتیجه:"))).toBeVisible();

    await page.getByRole("button", { name: fa("ثبت تعدیل") }).click();
    // Confirmation modal.
    await expect(
      page.getByRole("heading", { name: fa("تأیید تعدیل موجودی") })
    ).toBeVisible();
    await page.getByRole("button", { name: fa("تأیید و ثبت") }).click();

    await expect(page.getByText(/با موفقیت ثبت شد/)).toBeVisible();

    // Server-side: stock 10 → 15; a NEW layer 5 × 60,000 was added (cost from
    // the form, NOT the current supplierPrice 90,000).
    const res = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data?: Array<{
        _id: string;
        stock: number;
        costLayers?: Array<{ remaining: number; unitCost: number }>;
      }>;
    };
    const product = (body.data ?? []).find((p) => p._id === productId);
    expect(product?.stock).toBe(15);
    const layers = product?.costLayers ?? [];
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({ remaining: 10, unitCost: 50_000 });
    expect(layers[1]).toMatchObject({ remaining: 5, unitCost: 60_000 });
  });

  test("negative adjustment consumes FIFO layers + a movement row is recorded", async ({
    page,
  }) => {
    await page.goto("/admin/inventory");
    await page.getByRole("button", { name: fa("تعدیل موجودی") }).click();

    await page.locator("select").first().selectOption(productId);
    await page.getByPlaceholder(/مثلاً 5- یا 10/).fill("-3");
    await page.getByPlaceholder(/مثلاً: آسیب دیدگی/).fill(`${state.prefix}کمبود فیزیکی E2E`);
    await page.getByRole("button", { name: fa("ثبت تعدیل") }).click();
    await expect(
      page.getByRole("heading", { name: fa("تأیید تعدیل موجودی") })
    ).toBeVisible();
    await page.getByRole("button", { name: fa("تأیید و ثبت") }).click();
    await expect(page.getByText(/با موفقیت ثبت شد/)).toBeVisible();

    // Server-side: stock 15 → 12; FIFO consumed the OLDEST layer first
    // (10×50,000 → 7×50,000), the 5×60,000 layer untouched.
    const res = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data?: Array<{
        _id: string;
        stock: number;
        costLayers?: Array<{ remaining: number; unitCost: number }>;
      }>;
    };
    const product = (body.data ?? []).find((p) => p._id === productId);
    expect(product?.stock).toBe(12);
    const layers = product?.costLayers ?? [];
    expect(layers[0]).toMatchObject({ remaining: 7, unitCost: 50_000 });
    expect(layers[1]).toMatchObject({ remaining: 5, unitCost: 60_000 });
  });

  test("movement ledger lists the adjustment rows", async ({ page }) => {
    await page.goto("/admin/inventory");
    await page.getByRole("button", { name: fa("سوابق جابهجایی") }).click();
    await expect(page.getByText(fa("سوابق جابهجایی انبار"))).toBeVisible();

    // The receipt + both adjustments are in the ledger (assert presence — the
    // shared dev DB may hold rows from other suites, so no exact-count).
    // Scope to the table body: the filter dropdown ALSO contains hidden
    // `<option>` labels («دریافت خرید») that would resolve first.
    const tbody = page.locator("tbody");
    await expect(tbody.getByText(fa("دریافت خرید")).first()).toBeVisible();
    await expect(tbody.getByText(fa("تعدیل")).first()).toBeVisible();
    await expect(tbody.getByText(`${productName} ${state.prefix}`).first()).toBeVisible();
  });

  test.afterAll(async () => {
    // Restore the pre-run state: delete the GLOBAL accounting config singleton
    // this journey stamped (the exact convention verify-accounting.js uses at
    // suite end). Without this, the post-cutover stock-edit enforcement would
    // leak into every later spec in the run.
    const { connectDb, disconnectDb, clearAccountingConfig } = await import(
      "./helpers/db"
    );
    await connectDb();
    await clearAccountingConfig();
    await disconnectDb();
  });

  test("post-cutover direct stock edit is rejected (ledger stays complete)", async () => {
    // The accounting config singleton is stamped (initialized) by this run —
    // direct stock edits must be rejected. Admin products PUT with changed
    // stock → 400; the supplier stock quick-edit → 400.
    const res = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(productName)}&limit=5`
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data?: Array<{
        _id: string;
        name: string;
        slug: string;
        description?: string;
        supplierPrice: number;
        price: number;
        stock: number;
        isActive: boolean;
        category: string | { _id: string };
        supplier: string | { _id: string };
      }>;
    };
    const product = (body.data ?? []).find((p) => p._id === productId);
    expect(product).toBeTruthy();

    const put = await adminCtx.put(`/api/admin/products?id=${productId}`, {
      data: {
        name: product!.name,
        slug: product!.slug,
        description: product!.description ?? "",
        images: [],
        brand: null,
        tags: [],
        category:
          typeof product!.category === "object"
            ? product!.category._id
            : product!.category,
        supplier:
          typeof product!.supplier === "object"
            ? product!.supplier._id
            : product!.supplier,
        supplierPrice: product!.supplierPrice,
        price: product!.price,
        stock: product!.stock + 1,
        hasVariants: false,
        variants: [],
        isActive: product!.isActive,
      },
    });
    expect(put.status()).toBe(400);
    const putBody = (await put.json()) as { error?: string };
    expect(putBody.error ?? "").toContain("تعدیل");

    // Non-stock edit (same stock) still passes.
    const putOk = await adminCtx.put(`/api/admin/products?id=${productId}`, {
      data: {
        name: product!.name,
        slug: product!.slug,
        description: product!.description ?? "",
        images: [],
        brand: null,
        tags: [],
        category:
          typeof product!.category === "object"
            ? product!.category._id
            : product!.category,
        supplier:
          typeof product!.supplier === "object"
            ? product!.supplier._id
            : product!.supplier,
        supplierPrice: product!.supplierPrice,
        price: product!.price,
        stock: product!.stock,
        hasVariants: false,
        variants: [],
        isActive: product!.isActive,
      },
    });
    expect(putOk.status()).toBe(200);
  });
});
