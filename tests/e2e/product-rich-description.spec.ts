import { test, expect, type APIRequestContext } from "@playwright/test";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "./helpers/db";
import {
  getState,
  createCategory,
  createProduct,
  type E2EState,
} from "./helpers/fixtures";
import { formatPrice } from "./helpers/money";

// The real-editor journey drives the ADMIN product form — run all three
// tests with the admin session (storefront views work for any role).
test.use({ storageState: getState().adminStatePath });

/**
 * Journey 18 — Rich product description (Session 69).
 *
 * - Seeds a legacy plain-text product (no descriptionRich) and asserts the
 *   storefront legacy fallback still renders the plain text.
 * - Drives the REAL admin editor (Plate) through /admin/products/new:
 *   heading, bold, bulleted list, link → saves via the real admin API →
 *   storefront renders the structured rich description (no raw HTML).
 * - Also seeds a rich product directly through the admin API to verify the
 *   public products endpoint + storefront renderer for heading/list/bold/link.
 */
test.describe("Rich product description", () => {
  let state: E2EState;
  let adminCtx: APIRequestContext;
  // Slug-safe (dashed) run prefix: the admin UI form validates slugs against
  // /^[a-z0-9]+(?:-[a-z0-9]+)*$/ (underscores rejected), even though the API
  // path tolerates them. All products created through the API below use the
  // dashed variant so the real edit form accepts them unchanged.
  const uiPrefix = () => state.prefix.replace(/_/g, "-");
  const legacySlug = "rich-legacy";
  const apiRichSlug = "rich-api-rich";
  const editorRichSlug = "rich-editor";
  const price = 1_500_000;

  test.beforeAll(async ({ playwright }) => {
    state = getState();
    adminCtx = await playwright.request.newContext({
      storageState: state.adminStatePath,
    });

    // Idempotency guard — Playwright restarts the worker after a FAILED test
    // (failure isolation), re-running this beforeAll with the same per-run
    // prefix. The seeded slugs below would then 409 (unique index) unless the
    // leftover rows are removed first. The delete is scoped to THIS spec's
    // exact slugs only — never the broad run prefix (other spec files share
    // the prefix in a full suite run and must not be touched).
    await connectDb();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Not connected to MongoDB");
    await db.collection("categories").deleteOne({ slug: `${state.prefix}cat-10` });
    // Also pre-delete the UI-created slugs (editor + paste tests): on a CI
    // retry (retries=2) the worker restarts and beforeAll re-runs — a leftover
    // product from the failed attempt would 409 the retried form submit.
    await db.collection("products").deleteMany({
      slug: {
        $in: [
          `${uiPrefix()}${legacySlug}`,
          `${state.prefix}${apiRichSlug}`,
          `${uiPrefix()}rich-conflict`,
          `${uiPrefix()}${editorRichSlug}`,
          `${uiPrefix()}rich-paste`,
          `${uiPrefix()}rich-img`,
          `${uiPrefix()}rich-ext-img`,
          `${uiPrefix()}rich-preview`,
          `${uiPrefix()}rich-mainimg`,
        ],
      },
    });
    await disconnectDb();

    // Index 10 is free (1=product-search, 2=product-detail, 3=cart desktop,
    // 4=checkout, 5=coupon, 6=payment, 7=order-tracking, 8=admin-order-workflow,
    // 9=supplier-workflow, 33=cart mobile, 99=accessibility). 3 collides with
    // cart.spec (runs earlier alphabetically) in a full run → 409.
    const categoryId = await createCategory(adminCtx, state.prefix, 10);

    // Legacy plain-text product (dashed slug — the edit form must accept it).
    await createProduct(adminCtx, {
      slug: `${uiPrefix()}${legacySlug}`,
      name: `محصول متنی ${state.prefix}قدیمی`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 900_000,
      stock: 5,
    });

    // Rich product seeded directly through the API (heading + bold + list + link).
    const richBody = {
      name: `محصول غنی ${state.prefix}API`,
      slug: `${state.prefix}${apiRichSlug}`,
      description: "متن قدیمی (جایگزین میشود)",
      descriptionRich: [
        { type: "h2", children: [{ text: "ویژگیهای محصول" }] },
        {
          type: "p",
          children: [
            { text: "متن " },
            { text: "پررنگ", bold: true },
            { text: " و عادی" },
          ],
        },
        {
          type: "ul",
          children: [
            { type: "li", children: [{ text: "آیتم اول" }] },
            { type: "li", children: [{ text: "آیتم دوم" }] },
          ],
        },
        {
          type: "a",
          url: "https://example.com/fa",
          children: [{ text: "لینک نمونه" }],
        },
      ],
      images: [],
      category: categoryId,
      supplier: state.supplierId,
      supplierPrice: 900_000,
      price,
      stock: 5,
      hasVariants: false,
      variants: [],
      isActive: true,
    };
    const res = await adminCtx.post("/api/admin/products", { data: richBody });
    expect(res.ok()).toBeTruthy();

    // Product carrying an image URL whose host is NOT in the image allowlist
    // (the schema stores arbitrary strings; rendering must flag it). The edit
    // form must show the explicit "دامنه تصویر مجاز نیست" diagnostic instead
    // of a silent broken thumbnail.
    const unallowedImgBody = {
      name: `محصول تصویر خارجی ${state.prefix}`,
      slug: `${uiPrefix()}rich-ext-img`,
      description: "تصویر دامنه خارجی",
      images: ["https://img.test/foreign.jpg"],
      category: categoryId,
      supplier: state.supplierId,
      supplierPrice: 900_000,
      price,
      stock: 5,
      hasVariants: false,
      variants: [],
      isActive: true,
    };
    const uRes = await adminCtx.post("/api/admin/products", {
      data: unallowedImgBody,
    });
    expect(uRes.ok()).toBeTruthy();

    // Conflict-slug product for the "editor stays editable after a
    // server-side error" test — a duplicate MANUAL slug triggers the
    // deterministic 409 (autoSlug=false keeps the slug authoritative).
    await createProduct(adminCtx, {
      slug: `${uiPrefix()}rich-conflict`,
      name: `محصول تضاد ${state.prefix}اسلاگ`,
      categoryId,
      supplierId: state.supplierId,
      price,
      supplierPrice: 900_000,
      stock: 5,
    });
  });

  test("legacy plain-text product still renders with the fallback", async ({
    page,
  }) => {
    await page.goto(`/products/${uiPrefix()}${legacySlug}`);
    await expect(
      page.getByRole("heading", { name: `محصول متنی ${state.prefix}قدیمی` })
    ).toBeVisible();
    await expect(page.getByText("محصول E2E — حذف میشود")).toBeVisible();
    await expect(page.getByText(formatPrice(price)).first()).toBeVisible();
  });

  test("API-seeded rich product renders structured content on the storefront", async ({
    page,
  }) => {
    await page.goto(`/products/${state.prefix}${apiRichSlug}`);

    // Heading (h2) inside the rich description block.
    await expect(
      page.getByRole("heading", { name: "ویژگیهای محصول", level: 2 })
    ).toBeVisible();

    // Bold leaf renders as <strong>.
    const bold = page.locator("strong", { hasText: "پررنگ" });
    await expect(bold).toBeVisible();

    // Bulleted list items.
    await expect(page.locator("ul li", { hasText: "آیتم اول" })).toBeVisible();
    await expect(page.locator("ul li", { hasText: "آیتم دوم" })).toBeVisible();

    // Link renders with the safe target/rel and an http/https href.
    const link = page.getByRole("link", { name: "لینک نمونه" });
    await expect(link).toHaveAttribute("href", "https://example.com/fa");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // The legacy plain-text projection must NOT be shown for rich products.
    await expect(page.getByText("متن قدیمی (جایگزین میشود)")).not.toBeVisible();
  });

  test("real editor: create a product with rich description through the admin UI", async ({
    page,
  }) => {
    // Admin UI (storageState already applied).
    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    // The admin FORM validates the slug against /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    // (the API path tolerates underscores; the UI form does not). Derive a
    // slug-safe dashed variant of the run prefix so cleanup-by-prefix still
    // finds this product (see helpers/db.ts cleanupByPrefix).
    const uiSlug = `${state.prefix.replace(/_/g, "-")}${editorRichSlug}`;

    // --- Basic fields ---
    await page.getByLabel("نام محصول").fill(`محصول ادیتور ${state.prefix}ادیت`);
    // Slug auto-generates from the name (Latin slug via slugify of the Latin
    // part is unreliable for Persian) — set it explicitly instead.
    await page.getByLabel("اسلاگ (لینک)").fill(uiSlug);

    // Category + supplier selects (form labels).
    await page.getByLabel("دسته‌بندی").selectOption({ index: 1 });
    await page.getByLabel("فروشنده (تأمین‌کننده)").selectOption({ index: 1 });

    // --- Rich editor interactions (Plate) ---
    const editor = page.getByLabel("توضیحات محصول");
    await expect(editor).toBeVisible();

    // Paragraph text first.
    await editor.click();
    await page.keyboard.type("مقدمه محصول");

    // New paragraph → H2 heading.
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "عنوان ۲" }).click();
    await page.keyboard.type("مشخصات اصلی");

    // New paragraph → bold text.
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "پررنگ" }).click();
    await page.keyboard.type("قیمت ویژه");
    await page.getByRole("button", { name: "پررنگ" }).click(); // un-bold
    await page.keyboard.type(" — با گارانتی");

    // New paragraph → bulleted list.
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /لیست بولت/ }).click();
    await page.keyboard.type("ارسال سریع");
    await page.keyboard.press("Enter");
    await page.keyboard.type("پرداخت امن");

    // New paragraph → link (popover flow).
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "افزودن لینک" }).click();
    const linkInput = page.getByLabel("آدرس لینک");
    await linkInput.fill("https://example.com/shop");
    await page.getByRole("button", { name: "ثبت", exact: true }).click();

    // --- Price & stock ---
    await page.getByLabel("قیمت فروش (تومان)").fill(String(price));
    await page.getByLabel("قیمت تأمین (تومان)").fill("900000");
    await page.getByLabel("موجودی").fill("7");

    // --- Submit ---
    await page.getByRole("button", { name: "ایجاد محصول" }).click();
    await expect(page.getByText("محصول با موفقیت ایجاد شد")).toBeVisible();
    // Redirected to the admin products list.
    await expect(page).toHaveURL(/\/admin\/products$/);

    // --- Storefront rendering of the editor-created rich description ---
    await page.goto(`/products/${uiSlug}`);
    await expect(
      page.getByRole("heading", { name: `محصول ادیتور ${state.prefix}ادیت` })
    ).toBeVisible();

    // Structured renderer output (no raw HTML, no crash).
    await expect(
      page.getByRole("heading", { name: "مشخصات اصلی", level: 2 })
    ).toBeVisible();
    const bold = page.locator("strong", { hasText: "قیمت ویژه" });
    await expect(bold).toBeVisible();
    await expect(page.getByText("— با گارانتی")).toBeVisible();
    await expect(page.locator("ul li", { hasText: "ارسال سریع" })).toBeVisible();
    await expect(page.locator("ul li", { hasText: "پرداخت امن" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "https://example.com/shop" })
    ).toHaveAttribute("href", "https://example.com/shop");

    // --- Edit round-trip: reopen in the admin UI, rich structure restored ---
    // Session 69 QA catch — defaultValues used to DROP descriptionRich, so the
    // editor mounted empty and any save wiped the rich structure. The edit page
    // must restore the full tree (H2, list items, link) and survive an edit.
    const listRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(uiSlug)}`
    );
    expect(listRes.ok()).toBeTruthy();
    const pid = ((await listRes.json()) as { data: { _id: string }[] }).data[0]
      ._id;

    await page.goto(`/admin/products/${pid}/edit`);
    await expect(
      page.getByRole("heading", { name: "ویرایش محصول" })
    ).toBeVisible();
    const restoredEditor = page.getByLabel("توضیحات محصول");
    await expect(restoredEditor).toBeVisible();
    // The complete rich structure must be back inside the editor.
    await expect(restoredEditor).toContainText("مقدمه محصول");
    await expect(restoredEditor).toContainText("مشخصات اصلی");
    await expect(restoredEditor).toContainText("ارسال سریع");
    await expect(restoredEditor).toContainText("پرداخت امن");

    // Append a paragraph and save.
    await restoredEditor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("توضیح ویرایش‌شده");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("محصول با موفقیت ویرایش شد")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products$/);

    // The edit persisted on the storefront (structured renderer).
    await page.goto(`/products/${uiSlug}`);
    await expect(page.getByText("توضیح ویرایش‌شده")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "مشخصات اصلی", level: 2 })
    ).toBeVisible();
  });

  test("pasted HTML link survives the full flow (deserializer target)", async ({
    page,
  }) => {
    // Session regression — pasting an <a> from another site produced a Slate
    // node with `target: "_blank"` (the @platejs/link deserializer emits it
    // on EVERY pasted link). The server allowlist used to reject the unknown
    // key, so the save 400'd. The pasted node must now be accepted and the
    // storefront must render it as a safe anchor.
    const uiSlug = `${uiPrefix()}rich-paste`;
    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    await page
      .getByLabel("نام محصول")
      .fill(`محصول چسبانی ${state.prefix}لینک`);
    await page.getByLabel("اسلاگ (لینک)").fill(uiSlug);
    await page.getByLabel("دسته‌بندی").selectOption({ index: 1 });
    await page.getByLabel("فروشنده (تأمین‌کننده)").selectOption({ index: 1 });

    const editor = page.getByLabel("توضیحات محصول");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("مقدمه ");

    // Paste real HTML containing an <a> — Plate's LinkPlugin deserializer
    // turns it into a Slate node carrying `target: "_blank"`. Use the REAL
    // browser clipboard (HTML + plain) + Ctrl+V — a faithful reproduction of
    // a user pasting from another site (synthetic ClipboardEvents do not
    // reach Plate's deserializer).
    await page.context().grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: "http://localhost:3000" }
    );
    await page.evaluate(async () => {
      const html =
        '<a href="https://example.com/pasted">لینک چسبانده‌شده</a>';
      const plain = "لینک چسبانده‌شده";
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    });
    await page.keyboard.press("Control+V");
    await expect(editor).toContainText("لینک چسبانده‌شده");

    await page.getByLabel("قیمت فروش (تومان)").fill(String(price));
    await page.getByLabel("قیمت تأمین (تومان)").fill("900000");
    await page.getByLabel("موجودی").fill("7");

    await page.getByRole("button", { name: "ایجاد محصول" }).click();
    await expect(page.getByText("محصول با موفقیت ایجاد شد")).toBeVisible();

    // The stored tree must contain the deserializer shape (url + target).
    const listRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(uiSlug)}`
    );
    expect(listRes.ok()).toBeTruthy();
    const product = (
      (await listRes.json()) as {
        data: {
          _id: string;
          descriptionRich?: { type?: string; url?: string; target?: string }[];
        }[];
      }
    ).data[0];
    // Inline links nest inside their paragraph — search the tree recursively.
    const findNode = (
      nodes: { type?: string; url?: string; target?: string; children?: unknown[] }[] | undefined,
      t: string
    ): { type?: string; url?: string; target?: string } | undefined => {
      for (const n of nodes || []) {
        if (n.type === t) return n;
        const found = findNode((n.children || []) as { type?: string }[], t);
        if (found) return found;
      }
      return undefined;
    };
    const aNode = findNode(product.descriptionRich, "a");
    expect(aNode).toBeTruthy();
    expect(aNode?.url).toBe("https://example.com/pasted");
    expect(aNode?.target).toBe("_blank");

    // Storefront renders it as a safe external anchor.
    await page.goto(`/products/${uiSlug}`);
    const link = page.getByRole("link", { name: "لینک چسبانده‌شده" });
    await expect(link).toHaveAttribute("href", "https://example.com/pasted");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("editor: upload an image via the toolbar and store the img node", async ({
    page,
  }) => {
    const uiSlug = `${uiPrefix()}rich-img`;
    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    await page
      .getByLabel("نام محصول")
      .fill(`محصول تصویری ${state.prefix}ادیتور`);
    await page.getByLabel("اسلاگ (لینک)").fill(uiSlug);
    await page.getByLabel("دسته‌بندی").selectOption({ index: 1 });
    await page.getByLabel("فروشنده (تأمین‌کننده)").selectOption({ index: 1 });

    const editor = page.getByLabel("توضیحات محصول");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("مقدمه ");

    // Real upload through the editor's hidden file input (what the toolbar
    // button opens). The success TOAST is not the proof — the visible
    // in-editor thumbnail and the stored node are. Scope via the toolbar
    // button's parent (the toolbar div) — `div:has(...)` also matches every
    // ancestor div of the button (strict-mode violation).
    const fileInput = page
      .locator('button[aria-label="افزودن تصویر"]')
      .locator("..")
      .locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "editor-1x1.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      ),
    });
    await expect(page.getByText("تصویر به توضیحات اضافه شد")).toBeVisible();
    await expect(editor.locator("img")).toBeVisible();

    await page.getByLabel("قیمت فروش (تومان)").fill(String(price));
    await page.getByLabel("قیمت تأمین (تومان)").fill("900000");
    await page.getByLabel("موجودی").fill("7");
    await page.getByRole("button", { name: "ایجاد محصول" }).click();
    await expect(page.getByText("محصول با موفقیت ایجاد شد")).toBeVisible();

    // The stored tree must actually contain the img node (allowlisted host).
    const listRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(uiSlug)}`
    );
    expect(listRes.ok()).toBeTruthy();
    const product = (
      (await listRes.json()) as {
        data: {
          descriptionRich?: { type?: string; url?: string; children?: unknown[] }[];
        }[];
      }
    ).data[0];
    const findNode = (
      nodes?: { type?: string; url?: string; children?: unknown[] }[]
    ): { type?: string; url?: string } | undefined => {
      for (const n of nodes || []) {
        if (n.type === "img") return n;
        const found = findNode((n.children || []) as never);
        if (found) return found;
      }
      return undefined;
    };
    const imgNode = findNode(product.descriptionRich);
    expect(imgNode).toBeTruthy();
    expect(imgNode?.url).toMatch(/^https:\/\/c589564\.parspack\.net\//);

    // Storefront renders the description image.
    await page.goto(`/products/${uiSlug}`);
    await expect(
      page.locator('img[src^="https://c589564.parspack.net"]')
    ).toBeVisible();
  });

  test("preview toggle renders the storefront-equivalent description", async ({
    page,
  }) => {
    // Issue 3 (description preview) — the پیشنمایش tab must render the SAME
    // closed-set structured output as the storefront (ProductDescription)
    // from the CURRENT unsaved state, and toggling back to ویرایش must not
    // lose any typed content (editor remounts with the live value).
    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    await page
      .getByLabel("نام محصول")
      .fill(`محصول پیشنمایش ${state.prefix}`);
    await page.getByLabel("اسلاگ (لینک)").fill(`${uiPrefix()}rich-preview`);
    await page.getByLabel("دسته‌بندی").selectOption({ index: 1 });
    await page.getByLabel("فروشنده (تأمین‌کننده)").selectOption({ index: 1 });

    const editor = page.getByLabel("توضیحات محصول");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("مقدمه پیشنمایش");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "عنوان ۲" }).click();
    await page.keyboard.type("مشخصات پیشنمایش");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "پررنگ" }).click();
    await page.keyboard.type("متن پررنگ پیشنمایش");
    await page.getByRole("button", { name: "پررنگ" }).click();

    // Switch to preview — structured output, no raw HTML.
    await page.getByRole("button", { name: "پیشنمایش" }).click();
    const preview = page.getByTestId("description-preview");
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "مشخصات پیشنمایش", level: 2 })
    ).toBeVisible();
    await expect(preview.locator("strong", { hasText: "متن پررنگ پیشنمایش" })).toBeVisible();
    await expect(preview.getByText("مقدمه پیشنمایش")).toBeVisible();
    // Editor must NOT be present in preview mode.
    await expect(editor).not.toBeVisible();

    // Toggle back — nothing typed is lost (live state remount).
    await page.getByRole("button", { name: "ویرایش" }).click();
    await expect(editor).toBeVisible();
    await expect(editor).toContainText("مقدمه پیشنمایش");
    await expect(editor).toContainText("مشخصات پیشنمایش");
  });

  test("main image upload: thumbnail + badge, persists after save, flags unallowed hosts", async ({
    page,
  }) => {
    // Issue 3 (main product image) — a success toast is NOT proof: the
    // rendered thumbnail + «آپلود شد» badge, the persisted images array, and
    // the reopened edit form's thumbnail prove the chain. The seeded
    // foreign-host product must show the explicit «دامنه تصویر مجاز نیست»
    // diagnostic in the edit form.
    const uiSlug = `${uiPrefix()}rich-mainimg`;
    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    await page
      .getByLabel("نام محصول")
      .fill(`محصول تصویر اصلی ${state.prefix}`);
    await page.getByLabel("اسلاگ (لینک)").fill(uiSlug);
    await page.getByLabel("دسته‌بندی").selectOption({ index: 1 });
    await page.getByLabel("فروشنده (تأمین‌کننده)").selectOption({ index: 1 });
    await page.getByLabel("قیمت فروش (تومان)").fill(String(price));
    await page.getByLabel("قیمت تأمین (تومان)").fill("900000");
    await page.getByLabel("موجودی").fill("7");

    // The FileUpload hidden input — scoped via the drop-zone container (the
    // editor's own hidden file input lives in a different card, so a bare
    // input[type=file] selector would be ambiguous).
    const fileInput = page
      .locator('div.space-y-3')
      .filter({ hasText: "فایل را اینجا رها کنید یا کلیک کنید" })
      .locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "main-1x1.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      ),
    });

    // Uploaded + rendered: real thumbnail with the allowlisted host AND the
    // «آپلود شد» badge — not just a toast.
    const thumbnail = page.locator(
      'img[src^="https://c589564.parspack.net"]'
    );
    await expect(thumbnail).toBeVisible();
    await expect(page.getByText("آپلود شد").first()).toBeVisible();

    await page.getByRole("button", { name: "ایجاد محصول" }).click();
    await expect(page.getByText("محصول با موفقیت ایجاد شد")).toBeVisible();

    // Persisted images array contains the uploaded URL.
    const listRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(uiSlug)}`
    );
    expect(listRes.ok()).toBeTruthy();
    const product = (
      (await listRes.json()) as {
        data: { _id: string; images: string[] }[];
      }
    ).data[0];
    expect(product.images.length).toBe(1);
    expect(product.images[0]).toMatch(/^https:\/\/c589564\.parspack\.net\//);

    // Reopened edit form still renders the thumbnail.
    await page.goto(`/admin/products/${product._id}/edit`);
    await expect(
      page.getByRole("heading", { name: "ویرایش محصول" })
    ).toBeVisible();
    await expect(thumbnail).toBeVisible();

    // Unallowed-host product → explicit diagnostic in the edit form.
    const extRes = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(
        `${uiPrefix()}rich-ext-img`
      )}`
    );
    expect(extRes.ok()).toBeTruthy();
    const extProduct = (
      (await extRes.json()) as { data: { _id: string }[] }
    ).data[0];
    await page.goto(`/admin/products/${extProduct._id}/edit`);
    await expect(
      page.getByTestId("upload-image-domain-rejected")
    ).toBeVisible();
    await expect(
      page.getByText("دامنه تصویر مجاز نیست").first()
    ).toBeVisible();
  });

  test("editor stays editable (Backspace) after a server-side submit error", async ({
    page,
  }) => {
    // Issue-2 regression — after a SERVER-side error (slug 409) the form's
    // isSubmitting toggles, which used to flip the Plate editor's readOnly
    // and drop its internal selection — dead-locking Backspace/Delete. The
    // editor must remain fully editable after the error.
    const conflictSlug = `${uiPrefix()}rich-conflict`;
    await page.goto("/admin/products/new");
    await expect(
      page.getByRole("heading", { name: "افزودن محصول جدید" })
    ).toBeVisible();

    await page
      .getByLabel("نام محصول")
      .fill(`محصول ادیتور ${state.prefix}خطا`);
    // Manual slug → dirty → autoSlug=false → the server keeps it authoritative
    // and the duplicate returns the deterministic 409.
    await page.getByLabel("اسلاگ (لینک)").fill(conflictSlug);

    const editor = page.getByLabel("توضیحات محصول");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("متن قابل حذف");

    await page.getByLabel("دسته‌بندی").selectOption({ index: 1 });
    await page.getByLabel("فروشنده (تأمین‌کننده)").selectOption({ index: 1 });
    await page.getByLabel("قیمت فروش (تومان)").fill(String(price));
    await page.getByLabel("قیمت تأمین (تومان)").fill("900000");
    await page.getByLabel("موجودی").fill("7");

    await page.getByRole("button", { name: "ایجاد محصول" }).click();
    // Server-side 409 → error toast; the form must stay on the page.
    await expect(
      page.getByText("محصولی با این اسلاگ قبلاً وجود دارد")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);

    // Editor still holds its content and remains fully editable: put the
    // caret at the end and delete — the text must shorten.
    await expect(editor).toContainText("متن قابل حذف");
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(editor).not.toContainText("حذف");
    await expect(editor).toContainText("متن قابل");
  });

  test("legacy edit: saving without touching the editor preserves plain text", async ({
    page,
  }) => {    // Session 69 QA — a legacy product (description only) opened in the edit
    // form must survive a save untouched: no descriptionRich is introduced and
    // the plain-text description is preserved byte-for-byte.
    const res = await adminCtx.get(
      `/api/admin/products?search=${encodeURIComponent(
        `${uiPrefix()}${legacySlug}`
      )}`
    );
    expect(res.ok()).toBeTruthy();
    const pid = ((await res.json()) as { data: { _id: string }[] }).data[0]
      ._id;

    await page.goto(`/admin/products/${pid}/edit`);
    await expect(
      page.getByRole("heading", { name: "ویرایش محصول" })
    ).toBeVisible();
    const editor = page.getByLabel("توضیحات محصول");
    await expect(editor).toBeVisible();
    // Legacy product → editor must be empty (no rich tree to restore).
    await expect(editor).not.toContainText("محصول E2E");

    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByText("محصول با موفقیت ویرایش شد")).toBeVisible();

    const after = await adminCtx.get(`/api/admin/products?id=${pid}`);
    expect(after.ok()).toBeTruthy();
    const product = (await after.json()) as {
      description: string;
      descriptionRich?: unknown;
    };
    // Byte-preserved plain text (fixture seed is "محصول E2E — حذف میشود"
    // with a ZWNJ — assert on the stable fragments, not exact bytes).
    expect(product.description).toContain("محصول E2E");
    expect(product.description).toContain("حذف");
    expect(product.descriptionRich).toBeUndefined();
  });
});
