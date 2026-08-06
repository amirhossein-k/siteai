# Project State - فروشگاه من (Online Store)

> **Last Updated:** August 2026 (Session 59 — Playwright E2E)
> **Project Root:** `D:\\New folder\\site`

---

## Project Overview

A Persian (RTL) e-commerce platform built with Next.js 16 App Router. Features phone-based authentication, role-based access (customer/supplier/admin), product management, **brand management**, **tag management**, **full category management** (nested, SEO, CRUD), order processing, admin dashboard, Telegram notifications, **file uploads (S3-compatible)**, storefront product images with lightbox gallery, image thumbnails in cart/checkout, **Zarinpal payment gateway integration**, and **atomic inventory concurrency protection**.

- **Current Version:** 0.5.0
- **Current Milestone:** Session 59 — Playwright E2E (Production Readiness, tranche 1) ✅
- **Next Milestone:** Production Readiness (perf/a11y, CI/CD) or the next Growth feature — see ROADMAP.md / NEXT_SESSION.md
- **Deployment:** Not deployed (localhost:3000 only)
- **Testing:** Inventory concurrency verified (10/10 tests) ✅, API pagination verified (24/24 tests) ✅, attributes & variants verified (16/16 tests) ✅, **attributes & variants E2E verified against the real HTTP API (32/32 tests) ✅**, rate limiting tested ✅, 401/403 auth tested ✅, **upload repro 15/15 ✅, upload formats 9/9 ✅**, **payment retry & abandoned cleanup 13/13 ✅ (real API + Zarinpal sandbox)**, **variant polish 13/13 ✅ (real API)**, **admin refund flow 12/12 ✅ (real API)**, **supplier payout approval 17/17 ✅ (real API)**, **customer reviews & ratings 20/20 ✅ (real API)**, **customer wishlist 14/14 ✅ (real API)**, **customer notifications 18/18 ✅ (real API)**, **supplier review replies 21/21 ✅ (real API)**, **wishlist → cart bulk move 18/18 ✅ (real API + real cart store)**, **discounts & coupons 27/27 ✅ (real API)**, **real-time notifications SSE 11/11 ✅ (real API)**, **admin analytics & reporting 16/16 ✅ (real API)**, **supplier storefront pages 20/20 ✅ (real API)**, **variant-level wishlist 19/19 ✅ (real API)**, **coupon marketing surface 12/12 ✅ (real API)**, **db-outage resilience 9/9 ✅ (hermetic, in-process — `verify-db-reconnect.js`)**, **supplier telegram alerts 16/16 ✅ (real API — `verify-telegram-alerts.js`)**, **customer self-service order cancellation 17/17 ✅ (real API — `verify-order-cancel.js`, incl. strict cancel-vs-payment-verify race)**, **storefront faceted filtering (brand + tag) 22/22 ✅ (real API — `verify-facets.js`, incl. combination filters, 404/empty semantics, leak scan)**, **attribute facets 24/24 ✅ (real API — `verify-attribute-facets.js`, incl. nested `attributes[<slug>]` filters, aggregation counts, sticky self-exclusion)**, **search quality upgrade 17/17 ✅ (real API — `verify-search.js`, incl. expanded coverage name/description/attribute-value/brand/tag/category, weighted relevance ranking exact>prefix>substring>brand/tag/category>attribute>description, explicit-sort override, pagination stability, Persian partial substring, regex special-char escaping, backward-compat keyset + no `score` leak)**, **search suggestions 10/10 ✅ (real API — `verify-search-suggest.js`, incl. public endpoint, prefix match, inactive excluded, brand names, product-before-brand order, dedup, max 10 cap, special-char resilience)**, **homepage UX redesign ✅ (browser QA desktop + mobile: all sections render, header search suggestions live, category tiles pre-filter the catalog, mobile scroll-snap + expanding search row, countdown chip, zero console errors — no new API suite needed)**, **bulk product CSV import/export 22/22 ✅ (real API — `verify-product-import-export.js`, incl. admin + supplier import/export, create-only skip-duplicates in-file/in-DB, per-row atomicity + failure isolation, name-based ref resolution, Persian-digit normalization, supplier auto-ownership + ownership-scoped export, export→import round-trip, formula-injection escaping, sanitization, byte/row caps, rate limit)**, **mobile dashboard navigation fix ✅ (Session 52 — reusable `MobileDrawer` on admin + supplier dashboards; the `Menu` button previously toggled an un-consumed store flag; browser QA at 390px confirmed open/close/navigate; desktop sidebar byte-identical; no API/schema change, no new suite needed)**, **homepage CMS 13/13 ✅ (real API — `verify-homepage-cms.js`, incl. admin authz 401/403, idempotent sections bootstrap + static-config seed, public composition order + strict-projection leak scan, unknown-registry-component fail-safe, shared-renderer isolation, slug/component immutability, enabled/draft/soft-delete visibility rules, publishedAt stamping, per-type CRUD + validation, malformed ObjectId → 400)**, **coupon eligibility 18/18 ✅ (real API — `verify-coupon-eligibility.js`, Session 55, incl. assigned_users single + multi create, user_groups fail-closed until groups exist, non-assigned checkout → 400 with NO order/claim, assigned checkout exact discount, PUT audience reassign, public-list leak scan for eligibility fields, populated admin GET)**, **best-sellers rail 13/13 ✅ (real API — `verify-best-sellers.js`, Session 56, incl. sort=best_selling ranking + newest tie-break, list/detail leak scans (soldCount never exposed), refund + admin-cancel-of-paid reversals by exact quantities, legacy 0 floor never negative, double-refund 400 no double decrement, pending orders never counted, cash checkout never increments, CMS best-sellers block seeded + present in public composition; OPTIONAL `scripts/backfill-sold-count.js` backfill)**, **order management v2 17/17 ✅ (real API — `verify-order-management.js`, Session 57, incl. atomic claim-based admin transitions, claim-guard vs payment-verify race (never `failed` on a paid order), shipping subdocument on shipped/delivered with optional trackingCode + sanitization, actor-labeled history, refund payment-domain separation, paid-cancel soldCount reversal, admin list sort=newest/oldest, customer-cancel invariants, authz)**, **unit test foundation 152/152 ✅ (Vitest — Session 58: `npm test` / `test:watch` / `test:coverage`; 9 hermetic suites over the src/lib helpers — sanitize, utils, pagination, product-variants, product-csv, coupons, inventory, product-sales, payment-cleanup — Mongoose models mocked (`vi.mock` + `vi.hoisted`), no DB/network; target libs 92–100% line coverage, report-only; zero `src/` changes)**, **playwright E2E 21/21 ✅ (Session 59 — `npx playwright test` (chromium 16 + chromium-mobile 5, exit 0): 10 journeys — customer login (real UI form), product search (suggestions + catalog), product detail (simple + variants), cart (incl. mobile smoke), checkout, coupon, payment (hermetic `ZARINPAL_MOCK` seam), order tracking, admin order workflow (lifecycle + shipping metadata), supplier workflow; real API logins + storageState; per-run PREFIX seeding + teardown cleanup; the only `src/` change is the dev-gated `ZARINPAL_MOCK` seam in `src/lib/zarinpal.ts`; regression suites unaffected — they run against the real sandbox with the env unset)**
- **Regression runner:** `scripts/run-regression.js` now runs **33 suites** sequentially (Session 57: `verify-order-management` after `verify-best-sellers`) — `verify-db-reconnect` (hermetic, no server/DB needed) is the **first suite**, so it runs even when the dev server is down (HTTP suites then SKIP, exit 1); `verify-facets` after verify-variant-polish + `verify-attribute-facets` after verify-facets + `verify-search` after verify-attribute-facets + `verify-search-suggest` after verify-search + `verify-product-import-export` after the variant group (before verify-coupons-marketing); `verify-coupons-marketing` near-last + `verify-coupon-eligibility` (Session 55) + `verify-homepage-cms` (Session 53) + `verify-telegram-alerts` last; **Session 52 hermeticity fix:** the runner clears the shared login rate-limiter keys (`_id: /^rl:(login|login_ip):/` on `ratelimits`) before EACH suite — the login limits (`login:<phone>` 10/15min, `login_ip:<ip>` 30/15min) used to accumulate across suites and 401 later ones mid-run (production limiter untouched)
- **Build:** ✅ Zero TypeScript errors (`npx tsc --noEmit`)

---

## Current Progress

### ✅ Features Completed

**Authentication & Authorization**
- Phone + password login/register with NextAuth v4 (JWT strategy)
- Role-based access control (customer, supplier, admin)
- Middleware protecting `/admin/*` and `/supplier/*` routes
- NextAuth types augmented with custom `role` and `id` fields
- **Centralized RBAC utility** (`src/lib/auth-utils.ts`) — all API routes use `requireRole()`/`requireAuth()`
- **Seed script** (`scripts/seed-admin.js`) — creates first admin from env vars, safe to re-run
- **Admin user creation API** (`POST /api/admin/users`) — create admin/supplier accounts
- **User management PATCH API** (`PATCH /api/admin/users`) — toggle active, change role, reset password
- **Supplier auto-creation** — Supplier document auto-created when role set to `supplier` (POST or PATCH)
- **Role-based login redirect** — admin→`/admin/dashboard`, supplier→`/supplier/dashboard`, customer→`/`
- **Documentation** — AUTHENTICATION.md, RBAC.md, SEED.md created

**Database (MongoDB + Mongoose)**
- User, Product, Order, Category, Supplier, SupplierOrder, Notification, Transaction, File, Brand, Tag models (11 total)
- Connection singleton pattern with global caching (`dbName: "marlooai"`)

**UI / shadcn/ui Components**
- Button (with loading + asChild via Slot)
- Input (with FormItemContext consumption for correct label-input id matching)
- Card, Badge (with success/warning variants), Skeleton, Label
- Form (FormProvider + FormField + FormControl + FormMessage + FormItemContext export)
- Slot (custom replacement for @radix-ui/react-slot)
- Sonner Toaster (with MutationObserver-based dark mode detection)
- Toast helper (showToast.success/error/info/warning/promise)
- **FileUpload** (reusable drag-and-drop upload component with previews, progress, remove)
- ErrorBoundary, Spinner, PageLoader, Skeleton helpers
- cn() utility (clsx + tailwind-merge)

**State Management**
- Zustand stores: app-store (sidebar, theme, notifications), auth-store, cart-store (persist middleware)
- React Query provider with optimized defaults (staleTime: 1min, gcTime: 5min)
- React Query hooks for products + admin data + supplier data + customer data + brands + tags

**SEO + Security**
- Root layout metadata with template titles
- JSON-LD schemas (Organization, Website, Product, FAQ, Article, BreadcrumbList, LocalBusiness)
- Dynamic sitemap.ts, robots.txt with GPTBot blocking, manifest.ts for PWA
- Security headers (X-Frame-Options, X-Content-Type-Options, Permissions-Policy, etc.)
- Environment variable validation utility
- Image optimization (AVIF/WebP formats)

**Pages**
- Homepage: Hero section, Features grid, CTA section, Footer (all Persian RTL)
- Login/Register: react-hook-form + zod validation, shadcn Form pattern
- Custom 404 page, Custom Error page

**Admin Panel — Full CRUD + Order Management**
- Dashboard with real stats from MongoDB (auto-refresh every 30s)
- Products: Create, edit, delete with react-hook-form + zod validation + FileUpload for images + brand dropdown + tag multi-select
- Orders: Detail page with status timeline, status change with transition validation
- Users: Role-filtered list with active/inactive status
- Settings: Placeholder form

**Supplier Panel — Full CRUD + Wallet + Telegram**
- Dashboard with products, orders, earnings stats (auto-refresh every 30s)
- Products: CRUD with ownership verification + FileUpload for images + brand dropdown + tag multi-select
- Orders: List + detail with status workflow, Telegram notifications on status change
- Wallet: Balance, payout requests, transaction history
- **Telegram Settings**: Connect/disconnect bot via chat ID, test message button

**Customer Features — Catalog, Cart, Checkout, Orders, Profile**
- Product catalog with search/filter/sort (brands and tags populated in API response)
- Product detail page with **image gallery** (thumbnails, navigation arrows, loading/error states)
- Shopping cart (Zustand with localStorage persistence, header badge)
- Checkout with address form + order placement API
- Order history with status tracking
- User profile and address management

**Telegram Notifications**
- Supplier notification on new order
- Supplier notification on order status change (confirmed/shipped/delivered/rejected)
- Admin notification on new order
- Admin notification on order status changes
- Supplier Telegram settings UI (connect/disconnect, test message)
- In-app Notification records with sentToTelegram flag

**File Upload System**
- S3-compatible storage (Liara/any S3 provider)
- Multipart/form-data and URL-based upload
- File size validation (50MB max) and MIME type validation
- Image, video, and document support
- File metadata persisted in MongoDB (File model)
- Auth-protected API routes (admin/supplier only)
- Reusable FileUpload drag-and-drop component with previews
- Integrated into admin product form and supplier product form
- **Verified working** — S3 upload tested successfully via API (returns public URL)

**Zarinpal Payment Gateway**
- Zarinpal REST API v4 service layer (`requestPayment`, `verifyPayment`)
- Sandbox mode in development, production API in production
- Payment authority stored on order for callback cross-check
- Server-side payment verification (never trust client)
- Duplicate verification prevention (checks already-paid status)
- Authority cross-check (stored authority vs callback authority)
- Stock reversion for cancelled/failed payments
- Double-stock-restoration guard (terminal payment state check)
- Card PAN (last 4 digits) stored on successful payment
- Expanded payment status enum: pending, paid, failed, canceled, refunded
- `NEXT_PUBLIC_APP_URL` for production callback URL (no hardcoded localhost)
- Payment result page (success/cancelled/failed states)
- Checkout UI with Zarinpal payment method option
- Production-ready domain configuration via env vars
- **Payment retry** (`POST /api/payment/retry`) — retry own failed/cancelled payments from order detail with «پرداخت مجدد» button; no stock change for still-pending orders, atomic re-reserve for restored ones
- **Abandoned payment cleanup** (`src/lib/payment-cleanup.ts` + `GET /api/payment/cleanup`) — 24h `pending_payment` → auto-cancel + idempotent stock restore; admin-only + optional CRON_SECRET
- **Latent bug fixed:** `hasZarinpalErrors()` — Zarinpal v4 success returns `errors: []` (truthy) → old check always failed

**Category Management**
- Enhanced Category model: SEO fields (metaTitle, metaDescription), icon, description, sortOrder, nested parent/child
- Full CRUD admin API: GET (tree/flat/parent-filtered), POST, PUT, DELETE
- Validation: duplicate slug detection, parent self-reference prevention
- Safe deletion: children unlinked (not deleted) when parent is removed
- Admin UI page with interactive tree view, expand/collapse, search/filter
- Inline CRUD form with all fields (name, slug, parent, icon, image, description, sortOrder, active toggle, SEO fields)
- React Query hooks for all operations with cache invalidation

**Brand Management**
- Brand model: name, slug, description, logo, website, isActive
- Full CRUD admin API: GET (admin+supplier for dropdowns), POST, PUT, DELETE (admin only)
- Validation: duplicate slug detection, required name/slug
- Admin UI page with search, inline create/edit form, delete with confirmation
- Brand logo display with gradient fallback
- React Query hooks for admin management and dropdown selects
- Integrated into Product model (optional ObjectId ref)
- Integrated into admin and supplier product forms (brand dropdown)
- Product CRUD APIs persist and populate brand

**Tag Management**
- Tag model: name, slug, isActive
- Full CRUD admin API: GET (admin+supplier for dropdowns), POST, PUT, DELETE (admin only)
- Validation: duplicate slug detection, required name/slug
- Admin UI page with search, inline create/edit form, delete with confirmation
- React Query hooks for admin management and dropdown selects
- Chip-based multi-select UI in both admin and supplier product forms
- Tags managed via React state (not FormField), passed at submit time

**Inventory Concurrency Protection (Session 26)**
- See dedicated section below for full details
- **10/10 verification tests passing** including concurrent checkout for last item

**Attributes & Product Variants (NEW — Session 29)**
- See dedicated section below for full details
- **16/16 verification tests passing** including concurrent last-unit variant purchases

**Customer Reviews & Ratings (Session 34)**
- See dedicated section below for full details
- **20/20 verification tests passing** including verified-purchase gating and per-order-item dedupe

**Customer Wishlist (Session 35)**
- See dedicated section below for full details
- **14/14 verification tests passing** including idempotent add/remove and deleted-product placeholders

**Customer Notifications (Session 36)**
- See dedicated section below for full details
- **18/18 verification tests passing** including event dedupe (unique partial index), cross-user isolation, and payment-verify notification hardening

**Supplier Review Replies (Session 37)**
- See dedicated section below for full details
- **21/21 verification tests passing** including ownership (cross-supplier 404), approved-only gating, the atomic single-reply claim (double-reply 400), sanitization, and the `review_replied` notification

**Wishlist → Cart Bulk Move (Session 38)**
- See dedicated section below for full details
- **18/18 verification tests passing** including fresh-DB price/stock resolution (no reservation), first-available-variant selection, cross-user isolation (foreign ids ignored), the dedicated rate limiter, and real zustand cart-store merge tests (quantity increment, maxQuantity cap, distinct composite keys)

**Discounts & Coupons (Session 39)**
- See dedicated section below for full details
- **27/27 verification tests passing** including order-level percent/fixed math (maxDiscount cap, never-negative totals), minSubtotal gating, usage-limit + per-user-limit exhaustion, concurrent same-coupon checkouts (atomic claim), idempotent release on payment NOK/admin-cancel/24h-cleanup, and Zarinpal payable-amount preservation

**Real-time Notifications — SSE (Session 40)**
- See dedicated section below for full details
- **11/11 verification tests passing** including live delivery after real notification creation, customer isolation, supplier isolation, disconnect/reconnect, and heartbeat; zero DB schema changes; polling fallback preserved; `notifyOrderEvent()` remains the only facade

**Admin Analytics & Reporting (Session 41)**
- See dedicated section below for full details
- **16/16 verification tests passing** (baseline→delta design) including admin-only authz (401/403), read-only guarantee, time-series zero-fill + cancelled exclusion, top products/categories, coupon redemption stats, and supplier payout summaries; zero DB schema changes; pure read-only aggregation

**Supplier Storefront Pages (Session 42)**
- See dedicated section below for full details
- **20/20 verification tests passing** including the raw-JSON **projection leak scan** (user/contactPhone/bankAccount/telegramChatId/balance/pendingReserve never exposed), inactive-supplier exclusion + 404, malformed-id 404, productCount = active+in-stock semantics, the additive `supplier=` product filter, and cross-supplier profile isolation; additive `logo`/`description` model fields (no migration)

**Variant-Level Wishlist (Session 43)**
- See dedicated section below for full details
- **19/19 verification tests passing** including product-level + variant-level row **coexistence** (unique index `{user, product, variantId}` — data-first migration with duplicate + invalid-ref scans), variantId validation (foreign/inactive/malformed → 400, no silent default variant), variantSnapshot on GET, ids dedup + total-row count, DELETE variant-row vs remove-all semantics, and the **Session 38 resolver regression** (saved variant B preferred over first in-stock A; product-level row falls back to A)

**Coupon Marketing Surface (Session 44)**
- See dedicated section below for full details
- **12/12 verification tests passing** including the public endpoint without auth, **private coupons NEVER exposed**, the **raw-JSON leak scan** (usageLimit/perUserLimit/usedCount/startsAt/isActive/isPublic/updatedAt never in the paginated response), inactive/out-of-window public coupons hidden, admin isPublic toggle reflected live, **checkout with a public coupon → exact 10% discount (validate/claim flow untouched)**, and private coupons still valid in checkout but never listed; additive `isPublic` model field (no migration)

**Developer Experience**
- TypeScript strict mode
- Prettier + ESLint configuration
- Tailwind CSS v4 with CSS variables + dark mode via `.dark` class
- Vazirmatn font for Persian text
- React Compiler enabled

### 🔄 Features Currently In Development
- None

### ❌ Features Not Started
- SMS/OTP authentication
- Multi-language (i18n)
- Testing (Playwright component/e2e expansion, Testing Library)
- CI/CD, deployment
- Customer support (ticket system)
- Customer email/SMS order notifications

---

## Inventory Concurrency Fix (Session 26)

### Root Cause

The original checkout API used a **read-then-write** pattern that was vulnerable to race conditions:

1. `Product.findById()` reads current stock
2. If stock is sufficient (e.g., stock ≥ 1), creates Order + SupplierOrders
3. Then `Product.findByIdAndUpdate()` with `$inc: { stock: -quantity }` decrements

**Problem:** Two concurrent requests could BOTH pass the stock check in step 1 before either reaches step 3. This allowed stock to go negative, creating two orders for the same last unit.

### Solution: Optimistic Concurrency with stockVersion

**Product Model (`src/models/Product.js`)**
- Added `stockVersion` field (Number, default: 0) — optimistic lock token
- `pre("save")` hook — auto-increments stockVersion when stock changes via `.save()`
- `pre("findOneAndUpdate")` hook — auto-increments stockVersion when stock changes via `findByIdAndUpdate` (admin/supplier edits)
  - **Note:** Hook only fires if stockVersion is NOT already being explicitly set in the update query (avoids Mongoose `$set`/`$inc` conflict)

**Order Model (`src/models/Order.js`)**
- Added `stockRestored` field (Boolean, default: false) — atomic guard against double stock restoration

**Checkout API (`src/app/api/checkout/route.ts`)**
- **Phase 1:** Atomically reserves stock for ALL items BEFORE creating order
  - `reserveStock()` reads current `stockVersion`, then uses `findOneAndUpdate` with `{ stock: { $gte: qty }, stockVersion: currentVersion }`
  - If another request modified stock between read and update, the version check fails → returns null → 409 Conflict
- **Phase 2:** Build order items from successfully reserved stock
- **Phase 3:** Create Order + SupplierOrders
- **Full rollback** on any failure at any phase (all stock restored atomically)

**Payment Verification (`src/app/api/payment/verify/route.ts`)**
- Atomic claim patterns for all transitions:
  - Cancel: `findOneAndUpdate({ payment.status: { $nin: terminalStates } })`
  - Failed: `findOneAndUpdate({ payment.status: { $nin: allTerminal } })`
  - Success: `findOneAndUpdate({ payment.status: "pending" })`
- Idempotent stock restoration: Uses `stockRestored` flag with atomic `findOneAndUpdate({ stockRestored: false }, { $set: { stockRestored: true } })`

**Admin Orders (`src/app/api/admin/orders/route.ts`)**
- Stock restoration when admin cancels an order, using same idempotent pattern

### Verification Results ✅

| # | Scenario | Result |
|---|----------|--------|
| 1 | `stockVersion` auto-increments on stock change | ✅ PASS |
| 2 | Atomic reservation succeeds when stock is sufficient | ✅ PASS |
| 3 | Atomic reservation fails when stock is insufficient | ✅ PASS |
| 4 | **Concurrent checkout for last item** (stock=1, 10 concurrent → exactly 1 success) | ✅ PASS |
| 5 | **Stock never negative** under extreme concurrency (20 req for stock=5, no overselling) | ✅ PASS |
| 6 | Rollback restores all reserved stock on failure | ✅ PASS |
| 7 | `stockRestored` flag makes stock restoration idempotent | ✅ PASS |
| 8 | **Duplicate payment verification** — atomic claim pattern (5 concurrent → 1 wins) | ✅ PASS |
| 9 | Admin cancellation restores stock via same idempotent pattern | ✅ PASS |
| 10 | Pre-`findOneAndUpdate` hook increments `stockVersion` on `$set` stock edits | ✅ PASS |

### Bug Found & Fixed During Verification

**Bug:** The `pre("findOneAndUpdate")` hook unconditionally added `$inc: { stockVersion: 1 }` even when the update already explicitly managed `stockVersion` (via `$set` or `$inc`). This caused a Mongoose conflict error: *"Updating the path 'stockVersion' would create a conflict at 'stockVersion'"*.

**Fix:** Added `versionAlreadyInc` and `versionAlreadySet` guard conditions — the hook only auto-increments when stockVersion is NOT already being explicitly set.

`npx tsc --noEmit` → **zero errors** ✅

---

## Attributes & Product Variants (Session 29)

### Architecture

**Decision:** Embedded `variants[]` inside the Product document (Option A from the design review).

**Reasons:** (1) MongoDB is standalone — no multi-document transactions — so variant stock must use single-document atomic `findOneAndUpdate`, which embedded subdocuments make trivial; (2) no joins — storefront detail reads product + variants in one query; (3) SKU uniqueness enforced via a **global sparse unique index** on `variants.sku` (simple products without variants are excluded by `sparse`); (4) the existing `stockVersion` optimistic-lock pattern extends naturally to per-variant `stockVersion`.

### Data Model

**Product (extended)**
- `hasVariants: Boolean` (default false)
- `variants: [ProductVariantSchema]` — each with `_id` (= `variantId`), `sku`, `attributes[]` (`attributeId` ref + denormalized `name`/`value`), `price`, `supplierPrice`, `stock`, `stockVersion`, `images[]`, `isActive`
- Summary fields stay authoritative for list filters: `price = min(active variant price)`, `stock = sum(active variant stock)` — recomputed by every product write path via `recomputeVariantSummary()`
- Global index: `ProductSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true })`

**Attribute (new)** — name, slug, type (text/color/size/number), values[], isActive. CRUD admin API + admin UI + hooks. Suppliers can read active attributes for the variant builder.

### Shared Helpers

- **`src/lib/product-variants.ts`** — `validateVariants()` (SKU uniqueness, duplicate combos, max 200, ≥1 active, price/stock rules, attribute ids + preset value check), `prepareVariantsForSave()` (fetches Attribute docs in one query, denormalizes names, recomputes summary), `recomputeVariantSummary()`
- **`src/lib/inventory.ts`** — **single source of truth** for reservation/restoration (SINGLE source — no duplicated logic): `reserveStock(productId, qty, variantId?)`, `restoreStock(productId, qty, variantId?)`, `restoreOrderStock(orderId)` (idempotent via `stockRestored`)

### Critical Concurrency Detail

MongoDB does **not** allow the positional `$` operator in a **query filter** — `"variants.$.stock"` in the query never matches. Variant reservation therefore uses **`$elemMatch`** to bind all conditions (`_id`, `isActive`, `stock >= qty`, `stockVersion`) to the same array element, keeping `"variants.$"` only in the `$inc` update. This preserves the exact optimistic-lock semantics of the simple-product path. **Bug found & fixed during verification** — the original `$`-in-query pattern silently failed every variant reservation.

### Checkout / Payment / Admin-Cancel Integration

- **Checkout** reserves each variant atomically in Phase 1 (`reserveStock` with `variantId`), validates variant price + isActive, snapshots `variantId`/`sku`/`variantLabel` into Order + SupplierOrder items, and rolls back every reserved item **with its correct variantId** (`restoreReserved()` helper) on any failure.
- **Payment verify + admin cancel** delegate to the shared `restoreOrderStock()` — variant-aware, `stockRestored`-idempotent.
- **Order/SupplierOrder items** now store immutable `variantId`, `sku`, `variantLabel` snapshots — historical orders never depend on the live Product document.

### Verification Results ✅ (16/16)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Simple product checkout still works | ✅ PASS |
| 2 | Variant product checkout works | ✅ PASS |
| 3 | Variant price overrides base price | ✅ PASS |
| 4 | Wrong variant price rejected | ✅ PASS |
| 5 | Variant stock enforced | ✅ PASS |
| 6 | Concurrent last variant unit → exactly 1 success | ✅ PASS |
| 7 | Variant stock never negative (20 concurrent) | ✅ PASS |
| 8 | Failed payment restores variant stock exactly once | ✅ PASS |
| 9 | Cancelled payment restores variant stock exactly once | ✅ PASS |
| 10 | Duplicate verification cannot double-restore (5 concurrent) | ✅ PASS |
| 11 | Admin cancellation restores variant stock correctly | ✅ PASS |
| 12 | Summary price = min active variant price | ✅ PASS |
| 13 | Summary stock = sum of active variant stock | ✅ PASS |
| 14 | Non-variant products unchanged | ✅ PASS |
| 15 | Pagination still works | ✅ PASS |
| 16 | Search/filter/sort still works | ✅ PASS |

---

## Database Status

**Database:** MongoDB — `marlooai` (via `dbName` config in `dbConnect.js`) — Mongoose ^8.9.0
**Connection:** Cached singleton in `global.mongoose` (see `src/lib/dbConnect.js`)
**Migrations:** None (Mongoose schema-driven — models auto-create/update collections on first use)

### Collections (16 total)

| Collection | Key Fields | Notes |
|------------|-----------|-------|
| **User** | name, phone, passwordHash, role, supplier, address, isActive | role: customer/supplier/admin |
| **Product** | name, slug, description, price, supplierPrice, stock, **stockVersion**, **brand**, **tags[]**, category, supplier, **images[]**, **hasVariants**, **variants[]**, isActive, **soldCount** | variants=embedded subdocs (SKU, attributes, price, supplierPrice, stock, stockVersion, images, isActive); unique sparse index on variants.sku; **soldCount (Session 56)** = units paid + non-refunded/non-cancelled, INTERNAL (excluded from public responses), powers `sort=best_selling` via index `{ soldCount:-1, createdAt:-1 }` |
| **Attribute** | name, slug, type (text/color/size/number), values[], isActive | Variant dimensions (e.g. رنگ/سایز) |
| **Order** | customer, items[], totalAmount, shippingAddress, **shipping** (provider, trackingCode, shippedAt, deliveredAt, note), **payment** (status, method, authority, refId, cardPan, paidAt, retryToken), **refund** (reason, refundedAt, refundedBy), status, statusHistory[], **stockRestored** | items[] now include variantId/sku/variantLabel/**image** snapshot; **shipping (Session 57)** = fulfillment metadata captured on shipped/delivered (additive, optional trackingCode); stockRestored prevents double restoration; refund holds refund audit metadata |
| **SupplierOrder** | order ref, supplier ref, items[], amountOwed, status, isPaidOut, timestamps | items[] include variantId/sku/variantLabel/image snapshot |
| **Category** | name, slug, parent, icon, image, description, sortOrder, isActive, metaTitle, metaDescription | Nested categories |
| **Brand** | name, slug, description, logo, website, isActive | Flat list (no nesting) |
| **Tag** | name, slug, isActive | Simple, flat, used for product tagging |
| **Supplier** | user ref, businessName, **logo** (public), **description** (public, ≤500), contactPhone, bankAccount, balance, **pendingReserve**, **telegramChatId**, isActive | pendingReserve = payout amounts awaiting approval (invariant pendingReserve ≤ balance); telegramChatId for notifications; ONLY businessName/logo/description are ever exposed publicly (strict projection whitelist — Session 42) |
| **Notification** | recipient, type[], message, relatedOrder, isRead, **sentToTelegram**, **category**, **link**, **notificationKey**, **readAt**, **metadata** | In-app + Telegram tracking; category tabs + deep links + atomic event dedupe (unique partial index {recipient, notificationKey}) |
| **Transaction** | supplier ref, type[], amount, relatedOrder, note, balanceAfter, **status** (pending/approved/rejected), **reviewedBy**, **reviewedAt**, **rejectionReason** | Wallet ledger + payout request workflow (status only meaningful for type=payout) |
| **Review** | customer, product, order, itemSnapshot (name/sku/variantId/variantLabel/image/price/quantity), rating, text, status (pending/approved/rejected), reviewedBy, reviewedAt, rejectionReason, **supplier** (denormalized at creation), **reply** ({author, text, at} — single supplier reply, default null) | Verified-purchase reviews (one per order-item via unique {customer, product, order}); approved only exposed publicly; moderation audit trail; supplier reply queue via index {supplier, status, createdAt} |
| **Wishlist** | user, product, variantId (optional), variantSnapshot (sku/label, optional), timestamps | Customer saved products — **unique {user, product, variantId}** (Session 43: product-level rows have variantId null, variant-level rows carry a real variantId; both coexist for one product); deleted products kept as rows (product:null placeholder), inactive surfaced with isActive:false |
| **Coupon** | code (unique, uppercase), type (percent/fixed), value, minSubtotal, maxDiscount, startsAt, endsAt, isActive, **isPublic** (default false), usageLimit, perUserLimit, usedCount | Order-level discounts (Session 39); code normalized to uppercase; atomic global usedCount counter; **isPublic (Session 44)** = marketing opt-in — ONLY isPublic + active + in-window coupons are exposed via `GET /api/coupons/public` (strict projection, no internal limits) |
| **CouponUsage** | coupon ref, user ref, count | Per-user coupon usage — unique {coupon, user}; E11000-atomic limit enforcement |
| **File** | url, key, name, size, mimeType, category, uploadedBy, product | Uploaded file metadata |

### Order Payment Status Flow
```
pending → paid (Zarinpal verification success)
pending → canceled (user cancelled at Zarinpal gateway)
pending → failed (Zarinpal verification failed)
pending → pending (retry issues fresh authority; no state change)
paid → refunded (admin refund — Session 32, stock restored via restoreOrderStock())
```

### Order Status Flow (Main Order)
```
pending_payment → processing → confirmed → shipped → delivered
      ↓               ↓            ↓           ↓
   cancelled       cancelled    cancelled    cancelled
```

### SupplierOrder Status Flow
```
pending → confirmed → shipped → delivered
    ↓
 rejected
```

---

## Bugs / Known Issues

### ✅ Resolved (post-Session 44 bugfix — registration DB-outage resilience)
- **Poisoned cached connect promise** — `src/lib/dbConnect.js` never cleared `global.mongoose.promise` on rejection, so one transient DB outage (e.g. right after a machine restart) made every later `dbConnect()` fail instantly even after the DB recovered, until the dev server was restarted. **Fixed:** `cached.promise = null` on rejection → next call retries a fresh connection.
- **unread-count 500 spam** — `GET /api/notifications/unread-count` returned 500 whenever the DB was unavailable; now returns `{ count: 0 }` (200), isolated to that endpoint (cosmetic header-bell badge only; `notifyOrderEvent()` facade and inbox untouched).
- **Regression guard added** — `scripts/verify-db-reconnect.js` (**9/9 PASS**, hermetic — no server/DB needed, loads the real `dbConnect.js` + unread-count route with stubbed deps) proves both fixes and includes discriminators that fail on a revert. Wired into `scripts/run-regression.js` as the **first suite** (runner now **22 suites**); it runs even when the dev server is down, with the 21 HTTP suites then SKIPping and the runner exiting 1.

### 🟡 Medium
1. **Slot Event Handler Merging:** Custom Slot only keeps the parent's event handlers when both parent and child have the same handler. The real `@radix-ui/react-slot` calls them in sequence.
   - **File:** `src/components/ui/slot.tsx`
   - **Impact:** FormControl's Slot only passes `id`/aria attributes, so no issue yet. But violates expected Slot contract.

2. **Sonner Dark Mode:** Uses `MutationObserver` which is functional but more complex than needed. Should use `next-themes` when available.
   - **File:** `src/components/ui/sonner.tsx`

3. **Storefront variant auto-select:** Product detail shows "انتخاب تنوع" until the customer picks a combination manually. The dead `firstVariant` auto-select code was removed during the hooks crash fix; re-adding auto-select (first in-stock variant) is a possible UX enhancement.

### 🟢 Minor
4. **Middleware deprecation:** Next.js 16 warns that `middleware` convention is deprecated in favor of `proxy`.
5. **Browser file-dialog automation unavailable:** Native OS file choosers can't be automated by browser tooling (CDP `setFileInputFiles` unreliable) — file-select verification is done at the API level (`verify-upload-repro.js` / `verify-upload-formats.js`).
6. **Retry crash-window (accepted):** if the server dies between the retry claim and the final update, the order can be left un-retryable until the 24h cleanup cancels it. Deliberate — no stock-inflation window (see NEXT_SESSION.md).
7. **Dev-server stale network:** after very long dev sessions the server can time out calling sandbox.zarinpal.com while fresh Node probes work — restart the dev server.
8. **Payout approve crash-window (accepted):** the approve claim flips `status → approved` before the Supplier debit — a crash between leaves a stuck approved-but-not-debited payout (reserve held, re-approve → 400), recoverable by manual DB fix, NOT a double-payout path. Do NOT swap to debit-first (Session 33).
9. **`Transaction.status` default is `"pending"` for all types** — harmless because admin list filters `type: "payout"` and wallet UI guards `tx.type === "payout"`.
10. **`reviewedBy` stored but not populated** in the admin payout list — audit records who reviewed, but the UI can't show the name yet.
5. **Unit/E2E tests now exist** (Session 58 Vitest 152/152 + Session 59 Playwright 21/21) — remaining gap: component tests (Testing Library) and a CI runner for both.
6. **Google Fonts unavailable in build env** — `next build` fails on Turbopack when Google Fonts are unreachable (network constraint). Use `npx tsc --noEmit` for TypeScript validation instead.
7. **Lean() type issues:** Mongoose `.lean()` returns complex union types. Need `as any` cast or eslint-disable in API routes.
8. **Rate limiter race:** Under extreme concurrent load, the MongoDB rate limiter may allow a few extra requests through (read-then-write pattern). Acceptable for rate limiting — slight overages are within tolerance.
9. **Variant attribute value check is case-sensitive:** `validateVariants` compares variant values against the attribute's preset `values` list with exact (`includes`) matching — a client sending `"s"` for size `"S"` would be rejected. The variant builder uses preset dropdowns so this is fine today.
10. **Legacy product variants migration:** Products created before Session 29 have no `hasVariants`/`variants` fields — defaults apply and they behave as simple products. No data migration required, but a reindex of `variants.sku` on existing collections may be needed in production.

---

## Vitest Unit-Test Foundation (Session 58)
- **Zero application-code changes** — new test infra only: `vitest.config.ts` (node env, `@/` alias, Windows-safe forks pool, report-only v8 coverage over `src/lib`), `package.json` scripts (`test` / `test:watch` / `test:coverage`) + devDeps `vitest`/`@vitest/coverage-v8`, and `tests/unit/*.test.ts` (9 files / **152 tests**).
- **`npm test` 152/152 PASS**; coverage report-only (target libs: sanitize/pagination/payment-cleanup/product-csv-constants/product-csv/product-sales 100% lines, inventory 100% lines, product-variants ~97.7%, coupons ~94.7%, utils 100% lines); `npx tsc --noEmit` zero errors; ESLint clean on all changed files; full regression **33/33 PASS** (unchanged); no dev-server restart needed (no model/schema/index changes).

## Order Management v2 (Session 57)

- **Approved Rev 2 design preserved:** no packed status (six order statuses only; payment states live ONLY in `payment.status` — `refunded` is a history/display entry, never a settable `order.status`), `SupplierOrder` untouched, no CSV export, no reorder feature.
- **`src/models/Order.js`** — additive `shipping` subdocument `{ provider, trackingCode, shippedAt, deliveredAt, note }` (defaulted — old orders render without tracking) + index `{ status: 1, createdAt: -1 }`. **Model change ⇒ dev-server restart was required** (done).
- **`src/app/api/admin/orders/route.ts`** — atomic claim `findOneAndUpdate({ _id, status: order.status })` (concurrent loser → 400); **cancel claims also gate on `payment.status: "pending"`** (Session 46 race-safe pattern → mutually exclusive with the payment-verify SUCCESS claim; never `payment.status: "failed"` stamped onto a paid order); cancelling an unpaid order records `payment.status: "canceled"`; shipping metadata only on `shipped`/`delivered` (optional provider/trackingCode/note, sanitized + capped); additive `sort=newest|oldest` on the list.
- **Shared components** — `src/components/orders/order-status-badge.tsx` (`ORDER_STATUS_CONFIG`/`OrderStatusBadge`/`PaymentStatusBadge`/`statusNoteLabel`), `order-timeline.tsx` (`OrderEventTimeline`/`OrderProgressTimeline`), `order-invoice.tsx`; admin list sort toggle + shipping inputs on the admin detail + «پیگیری ارسال» on the customer detail; `use-admin-orders.ts` (`sort` + `shipping` payload).
- **`scripts/verify-order-management.js` — 17/17 PASS** (atomicity, shipping validation, optional tracking, refund domain separation, paid-cancel soldCount reversal, list sort, cancel-vs-verify race); regression runner → **33 suites**, full **33/33 PASS**; `tsc` zero errors; lint clean on changed TS/TSX files; code review approved.

## Homepage UX Redesign (Session 50)

- `src/app/page.tsx` **kept as the homepage entry** (no route-group move — approved routing rules) but rebuilt as a thin **server component** composing self-contained sections: Hero Carousel → Quick Categories → Campaign Banner → Special Picks → Newest Products → Premium Collection → Popular Brands → Gift Collections → Trust Badges → Footer.
- `src/lib/homepage-config.ts` — static typed config (hero slides, campaign banner, gift collections; gradient art, no backend, **no fake data/discounts** — Special Picks shows real prices with an end-of-day countdown).
- `src/components/storefront/home/*` (12 new): hero-carousel (fade, RTL-safe, auto-advance), quick-categories, campaign-banner, special-picks, newest-products, premium-collection, popular-brands (initial tiles), gift-collections, trust-badges, section-header, product-rail (native scroll-snap, mobile arrows), lazy-section (IntersectionObserver — defers below-fold mount + fetch).
- **One shared product-pool query** (`sort=newest, limit 36`) feeds the three product rails (React Query key dedup — no duplicate requests); `use-countdown` hydration-safe.
- Header/footer extracted to shared `StorefrontHeader` (+ additive header search reusing Session 49 suggestions) and `StorefrontFooter`; storefront layout is now a server component.
- Additive one-time URL seed in `use-catalog-filters.ts` — homepage category/brand tiles + header search pre-filter `/products` (`?category=`/`?brand=`/`?search=`/`?sort=`); no params → behavior unchanged (useState stays the source of truth).
- **Zero API/model/schema/index changes, zero new dependencies.** `inventory.ts`, checkout reservation, `notifyOrderEvent()`, `coupons.ts`, payment, RBAC, `ProductCard` untouched. Regression **28/28 PASS** (no suites added); `tsc` zero errors; browser QA clean; **no dev-server restart needed**.

## Bulk Product CSV Import/Export (Session 51)

### Server (additive, RBAC, rate-limited)
- `src/lib/product-csv.ts` — `parseProductCsv` (server-authoritative: `csv-parse/sync`, columns/BOM/trim/relax; row validation — slug regex, price/supplierPrice > 0 finite, stock non-negative int, name ≤200 / description ≤2000, category required, `isActive` 1/0 empty→true, Persian+Arabic digit normalization; malformed/empty → 400) + `serializeProductsCsv` (`csv-stringify/sync`, formula-injection escaping, UTF-8 BOM).
- `src/lib/product-csv-constants.ts` — 12-column header order, `MAX_IMPORT_ROWS = 1000`, `MAX_CSV_BYTES = 500_000`.
- `src/lib/product-import.ts` — shared executor: byte cap (`Buffer.byteLength`), row cap, name-based ref resolution (category/brand/tag/supplier, active-only, no N+1), existing-slug pre-scan, **sequential per-row `Product.create`** on the hardened sanitize+validator path. **Create-only v1:** duplicate slug (in-file `seenInFile` marked only on success, or in-DB pre-scan + E11000) → skipped + Persian reason; never overwritten; per-row atomicity.
- `POST /api/admin/products/import` + `POST /api/supplier/products/import` — RBAC; payload validated (empty 400 / byte 413 / row 400) **BEFORE** the rate limiter `product-import:<userId>` (20/15min → 429); supplier route auto-sets ownership and ignores the `supplier` column.
- `GET /api/admin/products/export` + `GET /api/supplier/products/export` — CSV download (attachment, UTF-8 BOM); supplier ownership-scoped; simple products only (`hasVariants: false`).

### Client
- `use-product-import-export.ts` (mutations, key-factory invalidation); `ProductCsvImport` shared UI (file pick, «دانلود قالب» template, column guide, per-row report table, created/skipped/failed badges, Persian toasts); import pages under `/admin/products/import` + `/supplier/products/import`; «ورود انبوه» sidebar entries + «ورود انبوه»/«خروجی CSV» buttons on both products pages; types `ProductImportReport`/`ProductImportRowResult`/`ProductImportRowStatus`.

### Invariants & verification
- **Zero existing-API/schema/model/index/migration changes**; new deps `csv-parse` + `csv-stringify` only. `verify-product-import-export.js` **22/22**; runner **29 suites**; `tsc` zero errors; full regression **29/29 PASS**; code review approved (2 rounds); **no dev-server restart needed**.

## Search Suggestions / Autocomplete (Session 49)

### Architecture

**Decision:** Additive read-only autocomplete endpoint (`GET /api/search/suggest?q=<prefix>`) — Phase 2 of Session 48's search quality upgrade. Returns up to 10 matching product names + brand names (active only, prefix match, case-insensitive). No schema/model/index changes — queries existing `Product` and `Brand` collections with `find({isActive:true, name:{$regex:...}}).select("name").sort({name:1}).limit(8|4)`. Product names appear first, then brand names; duplicates are deduped.

- **`src/app/api/search/suggest/route.ts`** — public endpoint (no auth, matching the public catalog precedent), IP rate-limited (`search-suggest:<ip>`, 30/15min, x-forwarded-for fallback). Min 2 character prefix required → empty `{suggestions:[]}` for shorter queries. Pure read — never writes, never mutates.
- **`src/hooks/use-search-suggestions.ts`** — React Query hook, enabled when `q.length >= 2`, staleTime 5min (product/brand names change rarely), query key `["search", "suggest", q]`.
- **`src/components/storefront/search-suggestions.tsx`** — dropdown component: positioned absolute below the search input, shows matching names with a `Search` icon, click-away-to-close via `mousedown` listener, loading skeleton/error/empty states. Uses `onMouseDown` with `e.preventDefault()` so the selection fires before the input blur handler.
- **`src/app/(storefront)/products/page.tsx`** — search input manages `suggestionsOpen` state; `onChange`/`onFocus` opens dropdown, `Escape` closes, clear button closes, `clearFilters` and mobile chips also close. `<SearchSuggestions>` rendered inside the same `relative` wrapper as the input.

### Invariants Preserved
- No schemas, models, indexes, or migrations created or modified
- `inventory.ts` sole stock authority, checkout only reservation point, `notifyOrderEvent()` only facade, `coupons.ts` untouched, payment verification, RBAC — all unchanged
- Existing search behavior on `/api/products` unchanged (the suggest endpoint is separate, additive, and never consulted by the products route)

### Verification Results ✅ (10/10)

| # | Scenario | Result |
|---|----------|--------|
| 1 | PUBLIC endpoint — no auth required (200) | ✅ PASS |
| 2 | EMPTY / short query returns empty suggestions | ✅ PASS |
| 3 | PREFIX match — matching product names returned | ✅ PASS |
| 4 | INACTIVE product excluded | ✅ PASS |
| 5 | BRAND names included in results | ✅ PASS |
| 6 | ORDER — product names before brand names | ✅ PASS |
| 7 | DEDUP — same name in product + brand appears once | ✅ PASS |
| 8 | LIMIT — max 10 suggestions | ✅ PASS |
| 9 | RESPONSE shape — { suggestions: string[] } | ✅ PASS |
| 10 | SPECIAL CHARACTERS — no 500 | ✅ PASS |

`npx tsc --noEmit` → **zero errors** ✅; full regression **28/28 PASS** (sequential). Code-reviewer approved (cleanup: unused import, dead keyboard-nav code, unused type).

### Ops notes
- **No model/schema/index changes → no dev-server restart needed.**
- Verify scripts MUST run sequentially (shared dev DB).

---

## Files Modified This Session (Session 34 — Customer Reviews & Ratings)

### Created Files
| File | Purpose |
|------|---------|
| `src/models/Review.js` | Review model — unique `{customer, product, order}` (one review per order-item), immutable itemSnapshot, rating 1–5, text ≤1000, status + moderation audit |
| `src/app/api/reviews/route.ts` | `GET` public approved-only paginated + `ratingSummary`; `POST` customer-only (delivered-order gate, dedupe 409, rate-limited 20/15min after validation, sanitized) |
| `src/app/api/reviews/mine/route.ts` | `GET` customer-only — my reviews + eligible delivered orders (form gate) |
| `src/app/api/admin/reviews/route.ts` | `GET` admin moderation queue (status filter, product+customer populated, paginated) |
| `src/app/api/admin/reviews/[id]/moderate/route.ts` | `POST` atomic claim (pending → approved/rejected once; reason required for reject; 404 vs 400) |
| `src/app/admin/reviews/page.tsx` | Admin moderation UI: status tabs, approve + reject-with-reason modal |
| `src/components/storefront/reviews-section.tsx` | Storefront reviews UI: summary, approved list (paginated), gated form, my-review badges |
| `src/hooks/use-reviews.ts` | `useProductReviews` / `useMyReviews` / `useSubmitReview` |
| `src/hooks/use-admin-reviews.ts` | `useAdminReviews` / `useModerateReview` |
| `scripts/verify-reviews.js` | 20-test live suite against the real API |

### Modified Files
| File | Change |
|------|--------|
| `src/app/api/products/route.ts` | Single-product response includes `ratingSummary` (approved-only aggregation) + helper |
| `src/app/(storefront)/products/[slug]/page.tsx` | `<ReviewsSection>` + `ProductJsonLd` with `aggregateRating` (SEO sync) |
| `src/components/layout/admin/admin-sidebar.tsx` | «دیدگاه‌ها» nav entry (Star icon) |
| `src/types/index.ts` | `ReviewStatus`/`RatingSummary`/`Review`/`ReviewsResponse`/`AdminReview`/`MyReviewsResponse`; `Product.ratingSummary?`/`Product.brand?` |

### Key Accomplishments
- ✅ Verified-purchase gating (DELIVERED order required) — no fake reviews
- ✅ One review per purchased order-item (atomic unique index; duplicate → 409)
- ✅ Moderation workflow pending → approved/rejected with atomic claim (no double-moderation) + immutable audit
- ✅ Approved-only storefront display + SEO `aggregateRating` sync (never drifts — computed on the fly)
- ✅ Rate-limited, sanitized, RBAC-clean (401/403) review submission
- ✅ 20/20 verification tests; `npx tsc --noEmit` zero errors; regressions green (payouts 17/17, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- Bugs fixed live: rate limit 5→20/15min, over-1000-char text now 400, TS fixes (lean cast, AdminReview Omit, Product.brand), dead cache key, moderate 404-vs-400

---

## Real-time Notifications — SSE (Session 40)

### Architecture

**Decision:** Server-Sent Events (SSE) on top of the Session 36 in-app Notification model, via the approved Session 40 design review (real-time notifications ranked #1 for value-to-risk: pure additive, zero DB schema changes, no touch to checkout/payment/inventory/coupon/wishlist/order).

- **`src/lib/notification-stream.ts`** — in-memory subscriber registry (`Map<userId, Set<subscriber>>`) stored on **globalThis** (`__notificationStreamRegistry`), mirroring the `global.mongoose` singleton pattern in `dbConnect.js`. This is REQUIRED because Next dev can bundle the route handler and the shared lib separately — a module-level Map would split `subscribe()` from `publish()` and events would never arrive (this exact failure was seen in the first verify-sse run and fixed by the singleton). API: `subscribeToUserStream()` (idempotent unsubscribe; user key removed when the set empties), `publishToUserStream()` (snapshot iteration + dead-subscriber pruning, **never throws**), `countUserConnections()`, `MAX_CONNECTIONS_PER_USER = 5`, `STREAM_HEARTBEAT_MS = 15_000`. Transport layer ONLY — `notifyOrderEvent()` remains the single notification facade.
- **`src/app/api/notifications/stream/route.ts`** — `GET` SSE endpoint: `requireAuth` (401) → connection cap (429) → `ReadableStream` body, `text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`, `dynamic = "force-dynamic"`. Initial `: connected` comment flushes headers; 15s `: ping` heartbeat; **unified idempotent `cleanup()`** (clear interval + unregister) wired to BOTH the client-abort signal and stream `cancel()` — no interval/subscription leak.
- **`src/lib/notifications.ts`** — `notifyOrderEvent()` publishes the created notification **after** the MongoDB write commits (DB stays source of truth; the push is a delivery hint). E11000 dedupe path returns early → deduped events are never re-pushed. Publish wrapped in try/catch — fail-silent, can never affect business flows.
- **`src/hooks/use-notifications.ts`** — `useNotificationStream()`: one EventSource per authenticated session; invalidates `notificationKeys.all` on every event (refetch reads authoritative MongoDB data). `onopen` resets the failure counter (SSE comments don't fire `onmessage`); tracked 5s reconnect timer cleared on unmount; gives up after 10 consecutive failures → the **untouched 30s polling** fallback takes over.
- **`src/components/storefront/notification-bell.tsx`** — mounts `useNotificationStream()` → instant badge updates in storefront + supplier headers; 30s `useUnreadCount` refetch stays as the authoritative fallback.
- **`src/types/index.ts`** — `NotificationStreamEvent`.

### Invariants Preserved
- `notifyOrderEvent()` remains the ONLY notification facade (push plugs into it, not around it)
- Notification DB write remains the source of truth
- Push delivery is fail-silent and can never affect business transactions (wrapped try/catch + never-throwing registry)
- Existing 30s polling remains as fallback
- No changes to checkout, payment, inventory, coupon, wishlist, or order business logic

### Verification Results ✅ (11/11)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Unauthenticated GET /api/notifications/stream → 401 | ✅ PASS |
| 2 | Authenticated stream connects (200, text/event-stream, `: connected`) | ✅ PASS |
| 3 | Live delivery after real notification creation (admin confirm → `order_confirmed`) | ✅ PASS |
| 4 | Customer isolation (B's open stream receives nothing while A's is delivered) | ✅ PASS |
| 5 | Supplier isolation (checkout → supplier gets `new_order`; B gets nothing) | ✅ PASS |
| 6 | Disconnect unregisters; fresh connection keeps receiving events | ✅ PASS |
| 7 | Heartbeat `: ping` within HEARTBEAT + slack | ✅ PASS |

`npx tsc --noEmit` → **zero errors** ✅; regressions green (notifications 18/18, supplier-replies 21/21, coupons 27/27, wishlist-cart 18/18, payouts 17/17, reviews 20/20, wishlist 14/14, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15, variants-e2e 32/32, upload-formats 9/9, concurrency 10/10). Code-reviewer approved (3 rounds).

### Known / Accepted Constraints
- **Single-instance only:** the in-memory registry is per-process. Multi-instance production needs a Redis/Upstash pub/sub adapter swap with an identical subscribe/publish API surface (the route and facade don't change).
- **Dev-mode module duplication:** if SSE events ever stop arriving, check `globalThis.__notificationStreamRegistry` is actually shared across bundles.

---

## Admin Analytics & Reporting (Session 41)

### Architecture

**Decision:** read-only aggregation endpoint (`GET /api/admin/analytics?range=7|30|90`) over existing collections — the highest-value, lowest-risk milestone (pure reads, zero DB schema changes, no business-logic files touched).

- **`src/app/api/admin/analytics/route.ts`** — admin-only (`requireRoleOrError(["admin"])`), invalid range → 400, `dynamic = "force-dynamic"`. **Strictly read-only** — only `aggregate` + `countDocuments`; never writes. 13-element `Promise.all` aligned with a 13-name destructure (a mid-review misalignment bug that 500'd every request was fixed by rewriting with exactly 13/13 bindings).
- **`summary`** — revenue/orders (cancelled excluded, same rule as `/admin/stats`), avgOrderValue, couponSavings, newCustomers.
- **`timeSeries`** — per-UTC-day buckets via `$dateToString`, **zero-filled** by `buildSeries` (iterates the same UTC window, no gaps).
- **`topProducts`** (top 10 by item revenue) + **`topCategories`** (top 10 via `Order.items.product → Product → Category` `$lookup`; deleted refs fall back to «نامشخص»).
- **`couponStats`** — total/active/totalUses from `Coupon.usedCount`, plus `discountedOrders`/`totalDiscount` from an **UNBOUNDED** in-window aggregation (shared `DISCOUNT_MATCH` — never capped by the top-5 display list; code-review fix) and `topCoupons` (top 5).
- **`supplierStats`** — all-time ledger (window-independent by design): earnings (`order_credit`), paidOut (approved payouts), pending payouts, outstandingBalance + pendingReserve (inactive suppliers' balances included deliberately — money owed to a deactivated supplier is still owed).
- **`ordersByStatus`** — status funnel (all statuses incl. cancelled) with Persian labels.

### Client
- **`src/hooks/use-admin-analytics.ts`** — `useAdminAnalytics(range)` (staleTime 30s; range in the query key).
- **`src/app/admin/analytics/page.tsx`** — RTL Persian page: range selector, summary stat cards, **hand-rolled SVG `RevenueChart`** (no chart dependency), ranked top products/categories rows with relative-weight bars, coupon stats card, supplier payouts card, order-status funnel. Skeletons / error-with-retry / empty states.
- **`src/components/layout/admin/admin-sidebar.tsx`** — «گزارش‌ها» nav entry (BarChart3).
- **`src/types/index.ts`** — `AdminAnalytics` + `AnalyticsTimePoint`/`AnalyticsTopRow`/`AnalyticsCouponStats`/`AnalyticsSupplierStats`/`AnalyticsOrderStatusRow`.

### Verification Results ✅ (16/16)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Unauthenticated → 401 | ✅ PASS |
| 2 | Customer → 403 | ✅ PASS |
| 3 | Supplier → 403 | ✅ PASS |
| 4 | Admin → 200 with full shape (zero-filled to range length) | ✅ PASS |
| 5 | Invalid range → 400 | ✅ PASS |
| 6 | Valid range=7 accepted | ✅ PASS |
| 7 | Read-only: collection counts unchanged across repeated calls | ✅ PASS |
| 8 | Time-series delta: today +1 order / +100M (cancelled excluded) | ✅ PASS |
| 9 | Time-series delta: day-5 +1 order / +36M; 60-day-old invisible in 30-day window | ✅ PASS |
| 10 | Top products: ProdA qty 2 / 100M, ProdB qty 1 / 40M | ✅ PASS |
| 11 | Top categories: CatA qty 2, CatB qty 1 | ✅ PASS |
| 12 | Coupon delta: total +2, usedCount +4 | ✅ PASS |
| 13 | Coupon delta: discountedOrders +1, in-window discount +4M, top-coupon row | ✅ PASS |
| 14 | Supplier delta: earnings +800K, paidOut +300K (count 1) | ✅ PASS |
| 15 | Supplier delta: pending +100K (count 1), balance +500K, reserve +100K | ✅ PASS |

`npx tsc --noEmit` → **zero errors** ✅; full regression green across all 16 suites (see CHANGELOG). Code-reviewer approved (4 rounds).

### Bugs found & fixed during verification
1. **Unbounded coupon metrics** — `discountedOrders`/`totalDiscount` were summed from the top-5 `topCoupons` list (undercount when >5 codes used) → now a separate unbounded `Order.aggregate`.
2. **Critical destructure misalignment** — a duplicate `discountSummary` aggregation in the `Promise.all` array vs a single name in the destructure shifted every binding from `topCoupons` onward and 500'd every request (orderStatuses got a number → `.map` crash). Route rewritten with exactly 13/13 aligned bindings.
3. **Test-fixture fixes** — users created *after* login attempts; item snapshot name ≠ product name (topProducts lookup missed the seeded row); absolute global-aggregate assertions → **baseline→delta** design so the suite is robust to pre-existing shared-DB data.
4. **Unused `Badge` import** removed from the analytics page.

### Known / Accepted Constraints
- **UTC day bucketing** — a 23:30 local order lands in the next UTC day (documented in the route; acceptable v1 for UTC+3:30).
- **Test top-10 dominance** — `verify-analytics.js` seeds deliberately large revenue (100M/40M) so the rows stay in the top-10 lists on a shared dev DB; if real dev data ever exceeds that in a 30-day window, the suite flakes (documented in the script header).
- **Verify scripts must run sequentially** — they share the dev DB; parallel runs flake (every flaked suite passed 100% when re-run alone).

---

## Supplier Storefront Pages (Session 42)

### Architecture

**Decision:** public read-only supplier storefront — `_id`-based URLs (`/suppliers/[id]`, matching the `orders/[id]` convention), additive `logo`/`description` profile fields, and a **strict projection whitelist**. Selected as Session 42 for highest marketplace value-per-risk: the only candidate that changes what the product *is* (suppliers become public, discoverable entities with SEO surface), with the lowest structural risk (read-only surface; the only existing-file touch is an additive query param on `/api/products`).

- **`src/app/api/suppliers/route.ts`** — public `GET /api/suppliers` (no auth): active-only, paginated (Session 27 shape), rows `{ _id, businessName, logo, description, productCount }`. `productCount` comes from a single `Product.aggregate` using the **same visibility rules as the storefront catalog** (`isActive: true, stock: { $gt: 0 }`). **STRICT projection whitelist** `_id businessName logo description` — `user`, `contactPhone`, `bankAccount`, `telegramChatId`, `balance`, `pendingReserve` are NEVER selected.
- **`src/app/api/suppliers/[id]/route.ts`** — public detail: `mongoose.isValidObjectId` → 404 (no CastError 500), inactive/missing → 404, same whitelist + `productCount` via `countDocuments`. Response key-set is exactly `{ _id, businessName, logo, description, productCount }`.
- **`src/app/api/products/route.ts`** — additive `supplier=` query filter (ObjectId-validated → 404 on malformed), applied to the existing active+in-stock filter. List + detail populate now `_id businessName logo` (additive).
- **`src/models/Supplier.js`** — `logo` + `description` (both String, default `""`, trim, maxlength 500). **No migration, no index changes** — existing docs render as absent (`|| ""`).
- **`src/app/api/supplier/settings/route.ts`** — `PUT` accepts any of `telegramChatId`/`logo`/`description` (trim + 500 caps), empty body → 400; `telegramChatId` behavior unchanged; `GET` selects `logo description` too.
- **`src/app/sitemap.ts`** — async; dynamic `/suppliers/[id]` entries from active suppliers, **fail-silent** on DB errors.

### Client
- **`src/app/(storefront)/suppliers/page.tsx`** — public listing: header, supplier-card grid, pagination, skeleton/error/empty states.
- **`src/app/(storefront)/suppliers/[id]/page.tsx`** — public detail: breadcrumb, storefront header card (logo/businessName/productCount/description), `usePublicProducts({ supplier: id, limit: 12 })` product grid, pagination.
- **`src/components/storefront/supplier-card.tsx`** — logo (falls back to Store icon on error) / businessName / productCount / description → `/suppliers/[id]`.
- **`product-card.tsx` + `products/[slug]/page.tsx`** — supplier name now links to `/suppliers/[id]`.
- **`src/app/supplier/wallet/page.tsx`** — «پروفایل عمومی فروشگاه» card: logo URL + description (≤500) inputs, dirty-tracking + save/cancel, synced from settings via `useEffect`.
- Hooks: `use-public-suppliers.ts` (`usePublicSuppliers`/`usePublicSupplier`), `use-public-products.ts` (supplier param), `use-supplier-settings.ts` (`useUpdatePublicProfile`). Types: `PublicSupplier`.

### Invariants Preserved
- Strict projection whitelist — only `businessName`/`logo`/`description` (plus `_id`) are ever public; verified by a raw-JSON deep scan in the test suite
- `productCount` = active + in-stock (same visibility rules as the storefront product list)
- `telegramChatId` update behavior unchanged; profile fields sanitized (trim + 500-char caps)
- No changes to checkout, inventory, payment, coupon, wishlist, order, or notification logic

### Verification Results ✅ (20/20)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Public list 200 + paginated + active only | ✅ PASS |
| 2 | Public detail 200 with exact whitelist key-set | ✅ PASS |
| 3 | **PROJECTION LEAK SCAN** — list/detail never expose user/contactPhone/bankAccount/telegramChatId/balance/pendingReserve | ✅ PASS |
| 4 | Inactive supplier excluded from list; detail → 404 | ✅ PASS |
| 5 | Malformed id → 404 (not 500) | ✅ PASS |
| 6 | productCount counts only active + in-stock products | ✅ PASS |
| 7 | `supplier=` filter → only that supplier's visible products (zero-stock/inactive/cross-supplier excluded) | ✅ PASS |
| 8 | Malformed supplier filter → 404 | ✅ PASS |
| 9 | LEAK SCAN on product populate response | ✅ PASS |
| 10 | Supplier updates own logo/description (trimmed + 500-capped) | ✅ PASS |
| 11 | Public API reflects updated profile | ✅ PASS |
| 12 | telegramChatId PUT behavior unchanged | ✅ PASS |
| 13 | Customer PUT settings → 403 | ✅ PASS |
| 14 | Cross-supplier profile isolation (C's edit never touches A) | ✅ PASS |
| 15 | Empty PUT body → 400 | ✅ PASS |
| 16 | Listing pagination shape intact | ✅ PASS |

`npx tsc --noEmit` → **zero errors** ✅; full regression green across all 19 suites (sequential — the one transient failure was a Zarinpal 502 during the post-restart run; re-run passed 13/13). Code-reviewer approved (4 rounds).

### Bugs found & fixed during verification
1. **Missing `Store` lucide import** in the wallet page (tsc TS2552).
2. **`[id]` route lean typing** — Mongoose `FlattenMaps` union → `eslint-disable` `any` cast (matches the products-route precedent).
3. **`SupplierFilters` index signature** needed for the query-key type (TS2345).
4. **Supplier-card broken logo** left an empty square → `logoError` state falls back to the Store icon.
5. **Verify-script fixture bug:** suppliers B and C shared one user → `Supplier.findOne({ user })` in the settings PUT resolved to B, so C's logo update landed on B and the isolation test failed → B got its own dedicated user.

### Ops note (IMPORTANT)
- **Model change ⇒ dev-server restart REQUIRED.** Mongoose caches models by name on `mongoose.models`; the running process kept the OLD Supplier schema, so `$set` silently stripped `logo`/`description` and `select` returned `undefined` (3 verify failures). Force-killed the stale server by PID and booted fresh → 20/20. Any future model edit needs the same restart.
- Verify scripts MUST run sequentially (shared dev DB).

---

## Variant-Level Wishlist (Session 43)

### Architecture

**Decision:** extend the existing wishlist to variant granularity — product-level rows (`variantId: null`) and variant-level rows (`variantId` + denormalized `variantSnapshot { sku, label }`) COEXIST under one unique index `{ user, product, variantId }`. Selected as Session 43 for highest readiness (the model already reserved the fields, and the Session 38 resolver already prefers a row `variantId`) — the only structural risk was the index migration, which was done **data-first**.

- **`scripts/migrate-wishlist-index.js`** — re-runnable, aborts (no index change) on any consistency failure: (a) duplicate `(user, product)` scan, (b) every row with a `variantId` must reference a REAL, ACTIVE variant of that product. Then drops the old unique `{ user, product }` index and creates `{ user, product, variantId }`. **Collision-safe:** pre-migration all rows have `variantId: null` and `{user, product}` was unique → at most one `(user, product, null)` row → no collision on existing data (MongoDB treats `null` as a value, so one product-level row per user+product is still enforced).
- **`src/app/api/wishlist/route.ts`** — `POST { productId, variantId? }`: optional `variantId` validated as BELONGING to the product AND active (malformed/foreign/unknown 400, inactive 400, variantId on a simple product 400). **NO silent default-variant fallback on the write path.** `variantSnapshot { sku, label }` denormalized at save. Idempotent via the unique index (duplicate → 200 `{added:false}` + E11000 backstop). `GET` rows expose `variantId` + `variantSnapshot` (null on product-level rows — matches the `WishlistItem` type). `DELETE` with `variantId` → exactly that variant row; without → ALL rows for the product.
- **`src/app/api/wishlist/ids/route.ts`** — `ids` deduped to one id per product (hearts fill when ANY row exists); `count` = TOTAL rows (matches the wishlist page total).
- **Client** — `use-wishlist.ts` variant-aware toggle (optimistic cache: variant-remove keeps the deduped product id, remove-all drops it); product-detail heart **saves the SELECTED variant** (REMOVE uses remove-all — the detail heart is a product-level toggle); wishlist page renders an **in-flow variant strip below the card** (saved label + SKU) and passes `variantId` on placeholder removal.
- **Session 38 resolver untouched** (locked decision) — its existing `row.variantId` preference is now regression-proven (saved variant B beats first in-stock A; product-level row falls back to A).

### Invariants Preserved
- Inventory authority stays in `inventory.ts`; checkout remains the only stock reservation point; atomic claims unchanged
- The Session 38 resolver is byte-for-byte unchanged (keep-in-wishlist, no reservation)
- No changes to checkout, inventory, payment, coupon, notification, or order logic

### Verification Results ✅ (19/19)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Unauthenticated POST (with variantId) → 401 | ✅ PASS |
| 2 | Supplier POST → 403 | ✅ PASS |
| 3 | Variant-level add → 201 + `added:true` + in ids | ✅ PASS |
| 4 | GET returns variantId + variantSnapshot {sku, label} | ✅ PASS |
| 5 | Duplicate (product+variant) → 200 `{added:false}` + 1 row (unique index) | ✅ PASS |
| 6 | **Coexistence** — product-level + variant rows for the SAME product | ✅ PASS |
| 7 | Invalid variantId format → 400 | ✅ PASS |
| 8 | Foreign/unknown variantId → 400; variantId on simple product → 400 | ✅ PASS |
| 9 | Inactive variant → 400 | ✅ PASS |
| 10 | GET field contract — variant row exposes snapshot; product-level row null+null | ✅ PASS |
| 11 | ids deduped (1 id per product) + count = total rows (2) | ✅ PASS |
| 12 | DELETE with variantId → removes exactly that row (product-level survives) | ✅ PASS |
| 13 | DELETE without variantId → removes ALL rows for the product | ✅ PASS |
| 14 | **Resolver regression** — saved variant B preferred over first in-stock A | ✅ PASS |
| 15 | Resolver fallback — product-level row → first active in-stock variant (A) | ✅ PASS |
| 16 | Cross-user isolation — user B cannot see/remove A's variant rows | ✅ PASS |

`npx tsc --noEmit` → **zero errors** ✅; full regression green across all **20 suites** (sequential). Code-reviewer approved (multiple rounds).

### Bugs found & fixed during verification
1. **Mongoose lean union-type TS2339** on the POST product query (`hasVariants`/`variants` on a `FlattenMaps` union) → `eslint-disable` `any` cast (codebase precedent).
2. **Wishlist-page variant badge originally an absolute overlay** (would have covered the ProductCard's add-to-cart button) → moved to an **in-flow strip below the card**.
3. **Detail-heart remove edge case** — passing the currently selected variantId could no-op when a DIFFERENT variant was saved (heart stays filled, optimistic cache flickers) → REMOVE now uses remove-all rows semantics (the detail heart is a product-level toggle); per-variant removal lives on the wishlist page.
4. **Stale model comment** — "future variant-wishlist milestone (unused today)" cleaned to reflect Session 43 usage.

### Ops note (IMPORTANT)
- **Index migration + model change ⇒ dev-server restart REQUIRED.** The old `{ user, product }` unique index would BLOCK coexistence (a variant row for a product already holding a product-level row → E11000). `scripts/migrate-wishlist-index.js` swaps the index data-first, then the dev server was force-killed (`taskkill //F //PID` on :3000) and booted fresh so Mongoose picks up the new model. Any future index/model edit needs the same restart.
- Verify scripts MUST run sequentially (shared dev DB — each suite wipes `wishlists` in its sweep).

---

## Files Modified This Session (Session 43 — Variant-Level Wishlist)

### Created Files
| File | Purpose |
|------|---------|
| `scripts/migrate-wishlist-index.js` | Re-runnable index migration: consistency checks (dup scan + invalid variant-ref scan) → drop old `{user, product}` → create `{user, product, variantId}` unique |
| `scripts/verify-variant-wishlist.js` | 19-test live suite: authz, variant add + snapshot, duplicate idempotency, coexistence, validation 400s, field contract, ids dedup, DELETE semantics, Session 38 resolver variant-preference regression, isolation |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Wishlist.js` | Unique index `{user, product}` → `{user, product, variantId}` (product-level + variant rows coexist); stale field comment cleaned |
| `src/app/api/wishlist/route.ts` | POST accepts optional `variantId` (belongs-to-product + active validation; no silent default); GET returns `variantId` + `variantSnapshot` (null on product-level rows); DELETE with variantId removes exactly that row, without removes ALL rows |
| `src/app/api/wishlist/ids/route.ts` | `ids` deduped to one id per product; `count` = total rows (variant rows included) |
| `src/hooks/use-wishlist.ts` | Variant-aware toggle (`variantId` pass-through; optimistic cache keeps product id on variant-remove, drops it on remove-all) |
| `src/app/(storefront)/products/[slug]/page.tsx` | Heart SAVES the selected variant (`variantId: activeVariant?._id`); REMOVE uses remove-all rows (product-level toggle) |
| `src/app/(storefront)/wishlist/page.tsx` | Variant rows render an in-flow strip below the card (saved label + SKU); placeholder removal passes `variantId` |
| `src/types/index.ts` | `WishlistItem.variantId?` / `variantSnapshot?` (null on product-level rows) |

### Key Accomplishments
- ✅ Product-level + variant-level wishlist rows coexist under one unique index (data-first migration, collision-safe by construction)
- ✅ Write path never silently defaults a variant — variantId must belong to the product AND be active (400 otherwise)
- ✅ Saved variant survives in GET (`variantSnapshot {sku, label}`) and wins in the Session 38 resolver (regression-proven)
- ✅ ids dedup + total-row count keeps hearts/badges correct with multi-row products
- ✅ Detail heart saves the selected variant; per-variant removal on the wishlist page; no hardened invariants touched
- ✅ 19/19 verification tests; `npx tsc --noEmit` zero errors; full regression green (20 suites, sequential)
- Bugs fixed live: lean-typing cast, badge overlay → in-flow strip, detail-heart remove-all semantics, stale comment
- **Ops:** index migration + model change ⇒ dev-server restart required (Mongoose model cache)

---

## Coupon Marketing Surface (Session 44)

### Architecture

**Decision:** a dedicated **public** read-only endpoint (`GET /api/coupons/public`) that surfaces ONLY admin-opted-in marketing coupons (`isPublic: true` + `isActive` + in-window), with a **strict projection** so internal limits are never exposed. Selected as Session 44 for highest business value-per-risk: the entire coupon money path (`validateCoupon` / `claimCouponForOrder` / `releaseCouponUsage`) was already hardened + tested (Session 39), so the milestone is **purely additive presentation** — a flag, a public page, and a checkout picker that never bypasses the existing validate → claim flow.

- **`src/models/Coupon.js`** — additive `isPublic` (Boolean, default `false`). **No migration, no index changes** — legacy coupons render as `false` (private). Private coupons stay hidden by construction; only `isPublic` coupons can ever appear publicly.
- **`src/app/api/coupons/public/route.ts`** — public GET: filter `isPublic:true` + `isActive:true` + `{ startsAt ≤ now, endsAt > now }` (same window semantics as `isCouponUsable()`), sort `createdAt` desc, paginated (Session 27 shape). **Strict projection** `.select("code type value minSubtotal maxDiscount endsAt")` — `usageLimit`/`perUserLimit`/`usedCount`/`startsAt`/`isActive`/`isPublic` NEVER exposed. **IP-keyed rate limit** (`coupons:public:<ip>`, 60/15min, x-forwarded-for fallback — register precedent). Pure read; never validates/claims/computes discounts.
- **`src/lib/coupons.ts`** — **byte-for-byte untouched** (locked decision). The checkout money path is unchanged.
- **`src/app/(storefront)/coupons/page.tsx`** — public «کدهای تخفیف» marketing page (RTL, gradient header, coupon cards with code/value/min-subtotal/expiry, copy-to-clipboard + toast, skeleton/error/empty states). No title/description marketing fields added (locked decision — renders from existing fields).
- **`src/app/(storefront)/checkout/page.tsx`** — inline `PublicCouponPicker`: lists only public coupons (hidden when `data.total === 0`), clicking pre-fills the existing coupon input + info toast; the customer still submits through the **untouched** validate → claim flow. Never a discount source of truth.
- **`src/app/admin/coupons/page.tsx`** — `isPublic` toggle switch in the create/edit form + «عمومی» success badge in the list.
- **`src/hooks/use-public-coupons.ts`** — `usePublicCoupons(page)` (staleTime 5min). Types: `PublicCoupon`, `PublicCouponsResponse`.

### Verification
- **`scripts/verify-coupons-marketing.js`** — 12 tests against the real HTTP API. **Must run LAST** in the sequential regression (wipes shared `couponusages`/`ratelimits`).
- **`scripts/run-regression.js`** — NEW sequential full-suite runner: Node `fetch` pre-flight (server up?), runs all 21 suites one at a time, per-suite PASS/SKIP/FAIL + tail summary, exit 1 on failure / 2 on skipped / 0 on all-pass. Replaces the manual shell loop.

### Key Accomplishments
- ✅ ONLY public coupons are ever exposed — private codes stay hidden; strict projection proven by a raw-JSON leak scan
- ✅ Checkout picker pre-fills codes but NEVER bypasses validate/claim; `coupons.ts` untouched
- ✅ IP rate limit on the public endpoint (register precedent); admin boolean parsing is strict (`=== true`)
- ✅ Public page + picker + nav are additive; no title/description fields added; no money-path changes
- ✅ 12/12 verification tests; `npx tsc --noEmit` zero errors; full regression green (21 suites, sequential, Skipped: 0)
- Bugs fixed live: Button has no `success` variant (Badge does) — TS2322 → conditional emerald className; public endpoint rate limit; admin PUT strict `isPublic`; regression-runner nits (skip counting, curl → Node fetch, closing brace)
- **Ops:** model change ⇒ dev-server restart required (Mongoose model cache)

### Ops note (IMPORTANT)
- **Model change ⇒ dev-server restart REQUIRED.** `src/models/Coupon.js` gained `isPublic`; the running process kept the old schema (a `$set: { isPublic: true }` would be silently stripped — Mongoose caches models by name on `mongoose.models`). Force-killed the stale server by PID (`taskkill //F //PID` on :3000) and booted fresh → 12/12 passed. Any future model edit needs the same restart.
- **Verify scripts MUST run sequentially** — they share the dev DB; `scripts/run-regression.js` enforces the order (verify-coupons-marketing last — it wipes `couponusages`/`ratelimits`).

---

## Files Modified This Session (Session 44 — Coupon Marketing Surface)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/coupons/public/route.ts` | Public GET: `isPublic`+`isActive`+in-window filter, strict projection (code/type/value/minSubtotal/maxDiscount/endsAt), createdAt desc, Session 27 pagination, IP-keyed rate limit (60/15min) |
| `src/hooks/use-public-coupons.ts` | `usePublicCoupons(page)` — staleTime 5min (marketing data changes rarely) |
| `src/app/(storefront)/coupons/page.tsx` | Public «کدهای تخفیف» page: RTL, gradient header, coupon cards (code/value/min-subtotal/expiry), copy-to-clipboard + toast + «کپی شد!» state, skeleton/error/empty states |
| `scripts/verify-coupons-marketing.js` | 12-test live suite: no-auth 200, isPublic persist, private hidden, raw-JSON leak scan, inactive/out-of-window hidden, pagination, toggle off/on, public-coupon checkout exact discount, private still valid; MUST run LAST (wipes couponusages/ratelimits) |
| `scripts/run-regression.js` | Sequential full-suite runner: Node fetch pre-flight, 21 suites one at a time, PASS/SKIP/FAIL + tail summary, exit 1/2/0 |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Coupon.js` | Additive `isPublic` (Boolean, default false) — no migration, no index changes; private coupons stay hidden |
| `src/app/api/admin/coupons/route.ts` | POST accepts `isPublic` with strict `body.isPublic === true` |
| `src/app/api/admin/coupons/[id]/route.ts` | PUT accepts `isPublic` with strict `=== true` (string "false" can never publish) |
| `src/app/admin/coupons/page.tsx` | `isPublic` toggle switch in the form + «عمومی» success badge in the list; edit-form sync |
| `src/app/(storefront)/checkout/page.tsx` | `PublicCouponPicker`: lists only public coupons (hidden when total=0), pre-fills the input; submission goes through the UNTOUCHED validate → claim flow |
| `src/app/(storefront)/layout.tsx` | «کدهای تخفیف» nav entry |
| `src/hooks/use-admin-coupons.ts` | `isPublic` in CouponFormData / payload |
| `src/types/index.ts` | `CouponDoc`/`Coupon` `isPublic`; `PublicCoupon`, `PublicCouponsResponse` |

### Key Accomplishments
- ✅ ONLY admin-opted-in (`isPublic`) coupons are ever exposed publicly — private codes stay hidden (locked decision)
- ✅ Strict projection — internal limits (usageLimit/perUserLimit/usedCount/startsAt/isActive/isPublic) proven absent by a raw-JSON deep scan
- ✅ Checkout picker pre-fills codes but NEVER bypasses validate/claim; `src/lib/coupons.ts` byte-for-byte untouched
- ✅ IP-keyed rate limit on the public endpoint (register precedent); strict boolean parsing in both admin routes
- ✅ Public page + picker + nav are additive; no title/description marketing fields added (locked decision)
- ✅ 12/12 verification tests; `npx tsc --noEmit` zero errors; full regression green (21 suites, sequential, Skipped: 0)
- Bugs fixed live: Button `variant="success"` TS2322 (Button has no success variant — Badge does) → conditional emerald className; public endpoint IP rate limit; admin PUT strict `isPublic`; regression-runner nits
- **Ops:** Coupon model change ⇒ dev-server restart required (Mongoose model cache)

---

## Post-Session 44 Bugfix — Registration DB-Outage Resilience

**Category:** bugfix (NOT a feature milestone) — no new functionality, no schema changes, no new collections.

### Root Cause (diagnosed + proven live)
1. **Environment (transient):** MongoDB (`services.irn2.chabokan.net:2255`) was unreachable right after a machine restart — `MongooseServerSelectionError: connect ETIMEDOUT 10.10.34.35:2255` (stale private IP in the driver's error). Live probe confirmed connectivity, not a wrong URI: a fresh process connects and registration succeeds.
2. **Compounding code bug:** `src/lib/dbConnect.js` cached the connect promise in `global.mongoose.promise` and never cleared it on rejection — a single failed connect poisoned every later `dbConnect()` call in the process (each re-awaited the same rejected promise and failed in 0 ms), so the outage looked "stuck" until the dev server was restarted.
3. The `/api/notifications/unread-count` 500 was a **separate symptom of the same outage** (header bell 30s polling), NOT the cause of the registration failure. Registration fundamentally requires the DB; it must 500 while the DB is down.

### Fixes (smallest safe, isolated)
| File | Change |
|------|--------|
| `src/lib/dbConnect.js` | On connect rejection, reset `cached.promise = null` so the next call retries a fresh connection (never cache a rejected promise) |
| `src/app/api/notifications/unread-count/route.ts` | DB-unavailable → return `{ count: 0 }` (200) instead of `serverError()`; unused import removed — isolated to this endpoint |

### Constraints preserved
- No changes to checkout / payment / inventory / coupon flows; `notifyOrderEvent()` remains the ONLY notification facade; RBAC/auth patterns unchanged; register route untouched.

### Verification
- `npx tsc --noEmit` → zero errors; code review approved.
- Live proof on a fresh dev server: `GET /api/products` 200, `POST /api/register` 201, duplicate 409, unauth unread-count 401. Test users cleaned up.

---

## Files Modified This Session (Session 42 — Supplier Storefront Pages)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/suppliers/route.ts` | Public `GET /api/suppliers` — active-only, paginated, rows `{_id, businessName, logo, description, productCount}` (aggregate, active+in-stock rules), strict projection whitelist |
| `src/app/api/suppliers/[id]/route.ts` | Public detail — ObjectId guard → 404, inactive → 404, whitelist key-set + productCount |
| `src/app/(storefront)/suppliers/page.tsx` | Public supplier listing: header, supplier-card grid, pagination, skeleton/error/empty states |
| `src/app/(storefront)/suppliers/[id]/page.tsx` | Public supplier detail: breadcrumb, storefront header card, supplier-filtered product grid (limit 12) + pagination |
| `src/components/storefront/supplier-card.tsx` | Supplier card (logo w/ error fallback, businessName, productCount, description) → `/suppliers/[id]` |
| `src/hooks/use-public-suppliers.ts` | `usePublicSuppliers(filters)` + `usePublicSupplier(id)` (enabled guard) |
| `scripts/verify-suppliers.js` | 20-test live suite: leak scan, whitelist key-set, inactive/malformed 404, productCount semantics, supplier filter, settings PUT (trim/cap/isolation), pagination |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Supplier.js` | Added `logo` + `description` (String, default `""`, trim, maxlength 500) — additive, no migration |
| `src/app/api/products/route.ts` | Additive `supplier=` filter (ObjectId-validated → 404); populate `_id businessName logo` |
| `src/app/api/supplier/settings/route.ts` | PUT accepts `telegramChatId`/`logo`/`description` (trim + 500 caps, empty → 400); telegramChatId unchanged; GET selects new fields |
| `src/components/storefront/product-card.tsx` | Supplier name + Store icon → `/suppliers/[id]` link |
| `src/app/(storefront)/products/[slug]/page.tsx` | Supplier badge is now a `Link` to `/suppliers/[id]` |
| `src/app/supplier/wallet/page.tsx` | «پروفایل عمومی فروشگاه» card (logo + description inputs, dirty-tracked save/cancel, `useEffect` sync); `Store` import added |
| `src/app/sitemap.ts` | Async; dynamic `/suppliers/[id]` entries (active only), fail-silent on DB errors |
| `src/hooks/use-public-products.ts` | `supplier` param in the query-string builder |
| `src/hooks/use-supplier-settings.ts` | `SupplierSettings.logo?/description?`; new `useUpdatePublicProfile` mutation |
| `src/types/index.ts` | `PublicSupplier` |

### Key Accomplishments
- ✅ Public supplier storefront (listing + detail) — marketplace-defining, read-only surface, zero migration/index changes
- ✅ **Strict projection whitelist** — only businessName/logo/description ever public; raw-JSON deep scan proves no leak
- ✅ `productCount` = storefront visibility rules (active + in-stock); `supplier=` filter additive + ObjectId-guarded
- ✅ Additive `logo`/`description` with trim + 500-char caps; `telegramChatId` behavior untouched; cross-supplier isolation
- ✅ Dynamic sitemap entries (fail-silent); storefront product cards/detail link to supplier pages
- ✅ 20/20 verification tests; `npx tsc --noEmit` zero errors; full regression green (19 suites, sequential)
- Bugs fixed live: missing `Store` import, lean-typing cast, `SupplierFilters` index signature, broken-logo fallback, verify-script shared-user fixture bug
- **Ops:** dev-server restart required (Mongoose model cache — stale schema stripped the new fields)

---

## Files Modified This Session (Session 41 — Admin Analytics & Reporting)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/admin/analytics/route.ts` | Read-only admin analytics endpoint (summary, zero-filled timeSeries, top products/categories, coupon stats, supplier stats, status funnel; range validation; 401/403) |
| `src/hooks/use-admin-analytics.ts` | `useAdminAnalytics(range)` React Query hook |
| `src/app/admin/analytics/page.tsx` | RTL analytics dashboard: range selector, stat cards, hand-rolled SVG revenue chart, ranked rows, coupon + supplier cards, status funnel |
| `scripts/verify-analytics.js` | 16-test live suite (baseline→delta design, authz, read-only, range, time-series, top lists, coupon + supplier deltas) |

### Modified Files
| File | Change |
|------|--------|
| `src/types/index.ts` | `AdminAnalytics`, `AnalyticsTimePoint`, `AnalyticsTopRow`, `AnalyticsCouponStats`, `AnalyticsSupplierStats`, `AnalyticsOrderStatusRow` |
| `src/components/layout/admin/admin-sidebar.tsx` | «گزارش‌ها» nav entry (BarChart3 icon) |

### Key Accomplishments
- ✅ Pure read-only reporting — zero writes, zero DB schema changes, zero business-logic files touched (all Session 26–40 invariants untouched)
- ✅ Zero-filled time series + UTC-consistent bucketing; cancelled orders excluded everywhere (same rule as `/admin/stats`)
- ✅ Unbounded coupon discount metrics (never capped by the display list) + shared `DISCOUNT_MATCH`
- ✅ Hand-rolled SVG charts — no chart dependency added to the project
- ✅ 16/16 verification tests (baseline→delta design, robust to shared dev DB); `npx tsc --noEmit` zero errors; full regression green
- Bugs fixed live: unbounded coupon metrics, critical Promise.all/destructure misalignment (500s), test-fixture ordering + item-name mismatch, unused import

---

## Files Modified This Session (Session 38 — Wishlist → Cart Bulk Move)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/wishlist/add-to-cart/route.ts` | `POST` customer-only resolver: auth → payload validation → rate limit (10/15min, key `wishlist-cart:<userId>`) → DB resolution. Scoped to `token.id` always; `productIds` = owned rows only (foreign ignored, no IDOR). Simple vs first-active-in-stock variant resolution; skips deleted/inactive/out_of_stock/no_available_variant; returns `{ added, addedCount, skipped, skippedCount }` with extensible `variant` metadata. NEVER reserves stock; wishlist rows unmodified. |
| `src/hooks/use-wishlist-cart.ts` | `useAddWishlistToCart` mutation (undefined → all rows) |
| `scripts/verify-wishlist-cart.js` | 18-test live suite: authz, fresh resolution, no-reservation, variant fallback, skip reasons, partial counts, productIds IDOR, rate limiter, real cart-store merge tests (transpileModule) |

### Modified Files
| File | Change |
|------|--------|
| `src/app/(storefront)/wishlist/page.tsx` | «افزودن همه به سبد» button (disabled when `isLoading || !data || data.total === 0`), maps `added` into `addItem`, toasts (all/partial/none), opens cart drawer; unreachable toast branch removed |
| `src/types/index.ts` | `WishlistCartSkippedReason`, `WishlistCartAddItem` (mirrors CartItemInput + `variant`), `WishlistCartAddResult` |

### Key Accomplishments
- ✅ API-assisted resolver — read-only (never reserves stock), fresh price/stock, checkout remains the single source of truth (its price-revalidation 409s are minimized, never bypassed)
- ✅ Keep-in-wishlist design — rows never modified; client-side idempotent `addItem` merge (quantity increment + maxQuantity cap, no duplicate composite keys)
- ✅ Variant-aware resolution (first active in-stock variant; future `variantId` preference reserved) with an extensible metadata block
- ✅ No IDOR (owned-row scoping), dedicated rate-limit key, backward-compatible additive types
- ✅ Zero changes to checkout/inventory/payment/cart-store architecture
- ✅ 18/18 verification tests; `npx tsc --noEmit` zero errors; regressions green (wishlist 14/14, reviews 20/20, notifications 18/18, supplier-replies 21/21, refund 12/12, payouts 17/17, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- Bugs fixed in the verify script: temp cart-store file moved inside the project (require('zustand') resolution), rate-limit deletes now target `_id: "rl:<key>"` per the rate-limiter storage shape

---

## Files Modified This Session (Session 37 — Supplier Review Replies)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/supplier/reviews/route.ts` | `GET` supplier-only review queue — supplier resolved from `token.id`, scoped via denormalized `Review.supplier`, populated customer/product/reply.author, status filter + pagination (Session 27 shape) |
| `src/app/api/supplier/reviews/[id]/reply/route.ts` | `POST` single atomic reply — ObjectId 400 → supplier doc 404 → text validated before rate limiter (30/15min) → sanitize → review 404 → **ownership** via `Product.findOne({ _id, supplier })` (404, no existence leak) → **approved-only** 400 → **atomic claim** `{_id, status:"approved", reply:null}` (double-reply 400) → `review_replied` notification via local `safeNotifyOrderEvent()` |
| `src/hooks/use-supplier-reviews.ts` | `useSupplierReviews(page, status)` + `useReplyToReview` (invalidates `["supplier-reviews"]`) |
| `src/app/supplier/reviews/page.tsx` | Supplier reply queue UI: status tabs, review cards, inline reply box, replied badge |
| `scripts/verify-supplier-replies.js` | 21-test live suite against the real API (authz 401/403 ×4, queue empty, create+approve via real API, reply 200, double-reply 400, pending/rejected 400, cross-supplier 404, empty/1001-char 400, sanitize in DB, public GET includes reply, review_replied notification, queue filters/pagination) |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Review.js` | Added `supplier` ref (denormalized at creation; invariant documented) + single `reply` subdocument `{author, text, at}` (`_id: false`, `default: null` — typed subdoc so the atomic `reply: null` claim matches) + index `{supplier, status, createdAt}` |
| `src/models/Notification.js` | Added `review_replied` to the `type` enum |
| `src/app/api/reviews/route.ts` | `POST` stores denormalized `supplier` (from the product fetched for the delivered-order gate); `GET` populates `reply.author` (name) — backward compatible |
| `src/components/storefront/reviews-section.tsx` | Renders «پاسخ فروشنده» (bordered block: author + date + sanitized text) under approved reviews |
| `src/components/layout/supplier/supplier-sidebar.tsx` | «پاسخ به دیدگاه‌ها» nav entry (MessageSquareText icon) |
| `src/app/admin/reviews/page.tsx` | Read-only «پاسخ فروشنده» line on review cards (no reply moderation per design) |
| `src/types/index.ts` | `ReviewReply`, `Review.reply?`, `SupplierReview`, `AdminReview.reply?` |

### Key Accomplishments
- ✅ Single reply per review (atomic `reply: null` claim — double-reply impossible); typed subdoc `default: null` keeps fresh reviews at `reply: null` (the inline-subdoc form was the original bug: auto-populated `{author:null,text:"",at:null}` never matched the claim)
- ✅ Ownership always verified server-side through `Review.product → Product.supplier` (never a client supplier id); queue scoped via the creation-time snapshot (invariant documented)
- ✅ Approved-only replies (pending/rejected → 400 «فقط به دیدگاه‌های تأییدشده»); sanitized + rate-limited (no admin reply moderation per design)
- ✅ `review_replied` notification to the review author — fail-silent via `safeNotifyOrderEvent()` (a notification failure can never turn a committed reply into a 500)
- ✅ Public API backward compatible (additive `reply` field); storefront + admin display of replies
- ✅ 21/21 verification tests; `npx tsc --noEmit` zero errors; regressions green (reviews 20/20, notifications 18/18, wishlist 14/14, refund 12/12, payouts 17/17, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- Bug found & fixed: `reply` must be a typed single-nested subdocument with `default: null` (inline subdoc auto-populated on every review → atomic claim never matched); also confirmed the root-cause trigger was a stale dev server still holding the PRE-fix schema — force-killed by PID and restarted (Windows `pkill` is unreliable)

---

## Files Modified This Session (Session 36 — Customer Notifications)

### Created Files
| File | Purpose |
|------|---------|
| `src/lib/notifications.ts` | `notifyOrderEvent()` — SINGLE facade for in-app notifications (never throws/blocks; dedupe via unique partial index; Telegram as optional fire-and-forget adapter) |
| `src/app/api/notifications/route.ts` | `GET` authenticated inbox — paginated, `unreadOnly`/`category` filters, `unreadCount` |
| `src/app/api/notifications/unread-count/route.ts` | `GET` lightweight badge count for the header bell |
| `src/app/api/notifications/read-all/route.ts` | `PUT` mark all unread read (idempotent, rate-limited 30/15min) |
| `src/app/api/notifications/[id]/read/route.ts` | `PUT` owner-scoped single read (400/404/idempotent 200) |
| `src/app/(storefront)/notifications/page.tsx` | Customer notifications page |
| `src/app/supplier/notifications/page.tsx` | Supplier notifications page (same shared list) |
| `src/components/storefront/notification-bell.tsx` | Header bell with live unread badge (30s refetch) |
| `src/components/notifications/notifications-list.tsx` | Shared inbox — category tabs, mark-all-read, deep links, unread highlight, pagination |
| `src/hooks/use-notifications.ts` | `useUnreadCount` / `useNotifications` / `useMarkRead` / `useMarkAllRead` |
| `scripts/verify-notifications.js` | 18-test live suite against the real API |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Notification.js` | Added `category`/`link`/`notificationKey`/`readAt`/`metadata` + indexes (`{recipient, createdAt:-1}`, `{recipient, isRead}`, unique partial `{recipient, notificationKey}`) |
| `src/app/api/checkout/route.ts` | Supplier `new_order` notification after order creation |
| `src/app/api/admin/orders/route.ts` | Customer `order_confirmed`/`order_shipped`/`order_delivered`/`order_cancelled` on status change |
| `src/app/api/supplier/orders/route.ts` | Supplier `order_confirmed` on self-confirm |
| `src/app/api/admin/orders/refund/route.ts` | Customer `order_refunded` + simplified `customerId` extraction (review fix b) |
| `src/app/api/payment/verify/route.ts` | `payment_paid`/`payment_failed`/`payment_cancelled` wrapped in `safeNotifyOrderEvent()` (review fix c) |
| `src/types/index.ts` | `NotificationCategory`, `NotificationItem`, `NotificationsResponse`, `UnreadCountResponse` |
| `src/app/(storefront)/layout.tsx` | Header `NotificationBell` (customer) |
| `src/components/layout/supplier/supplier-header.tsx` | Header `NotificationBell` (supplier) |

### Key Accomplishments
- ✅ Single in-app notification facade (`notifyOrderEvent`) — never throws, never blocks business flows; events dispatched AFTER the business transaction commits
- ✅ Atomic dedupe via unique partial index `{recipient, notificationKey}` — an event can never be delivered twice (E11000 → no-op)
- ✅ Event wiring across checkout, admin/supplier status changes, refund, and all payment-verify outcomes (paid/failed/cancelled)
- ✅ Role-appropriate deep links stored at event time (`/orders/<id>` vs `/supplier/orders/<id>`) — one shared inbox component serves both layouts
- ✅ Customer + supplier headers get a live unread badge (30s refetch + window focus)
- ✅ Code-review follow-ups applied: removed dead `orderNotificationKey()` helper; simplified refund `customerId` cast; hardened payment verify with `safeNotifyOrderEvent()` so notifications can never affect payment flow
- ✅ 18/18 verification tests; `npx tsc --noEmit` zero errors; regressions green (wishlist 14/14, reviews 20/20, payouts 17/17, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)

---

## Files Modified This Session (Session 35 — Customer Wishlist)

### Created Files
| File | Purpose |
|------|---------|
| `src/models/Wishlist.js` | Wishlist model — unique `{user, product}` (atomic dedupe), timestamps, optional variantId/variantSnapshot (future-proof) |
| `src/app/api/wishlist/route.ts` | `GET` customer-only paginated (two-query: deterministic productId, `product:null` for deleted, `isActive:false` surfaced); `POST`/`DELETE` idempotent + rate-limited 30/15min after validation |
| `src/app/api/wishlist/ids/route.ts` | `GET` `{ ids, count }` — count separate so the header badge survives future pagination/filtering |
| `src/app/(storefront)/wishlist/page.tsx` | Wishlist page — customer gate, paginated grid, deleted-product placeholder cards (removable via productId), empty state |
| `src/hooks/use-wishlist.ts` | `useWishlistIds` / `useWishlistItems` / `useToggleWishlist` (optimistic with rollback) |
| `scripts/verify-wishlist.js` | 14-test live suite against the real API |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/dbConnect.js` | Registered Wishlist model |
| `src/components/storefront/product-card.tsx` | Heart button top-right (filled when saved); guests → toast + /login |
| `src/app/(storefront)/products/[slug]/page.tsx` | «افزودن به علاقه‌مندی‌ها» button beside add-to-cart (guest gate) |
| `src/app/(storefront)/layout.tsx` | Header heart icon + rose count badge + «علاقه‌مندی‌ها» nav link (customer only) |
| `src/types/index.ts` | `WishlistItem` (productId + nullable product), `WishlistIdsResponse` |

### Key Accomplishments
- ✅ Product-level wishlist with atomic dedupe + idempotent add/remove (unique index + E11000 backstop)
- ✅ Deleted products kept as rows (`product:null` placeholder, still removable) — never silently dropped; inactive products surfaced with `isActive:false`
- ✅ Two-query GET fixes the lean+populate missing-ref bug (deterministic `productId`)
- ✅ Customer-only authz (401/403), cross-user isolation, rate-limited writes, no inventory/payment/checkout changes
- ✅ 14/14 verification tests; `npx tsc --noEmit` zero errors; regressions green (reviews 20/20, payouts 17/17, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)

---

## Files Modified This Session (Session 33 — Supplier Payout Approval System)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/admin/payouts/route.ts` | `GET` payout queue (status filter, supplier+bank+user populated) + `POST` approve/reject with **atomic claim** (processed exactly once; concurrent loser → 400); approve debits balance + releases reserve (rollback to pending on failure → 409); reject releases reserve + requires sanitized reason |
| `src/hooks/use-admin-payouts.ts` | `useAdminPayouts` (status filter) + `useReviewPayout` mutation |
| `src/app/admin/payouts/page.tsx` | Admin queue UI: status tabs, request cards (supplier/user/bank/amount/balance), approve + reject-with-reason modal |
| `scripts/verify-payouts.js` | 17-test live suite against the real API (reserve semantics, atomic over-reservation guard, approve/reject claims, concurrent double-approve, audit, approved-only totals) |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Transaction.js` | Added payout workflow fields: `status` (pending/approved/rejected), `reviewedBy`, `reviewedAt`, `rejectionReason` |
| `src/models/Supplier.js` | Added `pendingReserve` (Number, default 0) |
| `src/app/api/supplier/wallet/route.ts` | POST now RESERVES instead of debiting (atomic `$expr` claim `pendingReserve + amount ≤ balance` — race-safe); GET returns `availableBalance`/`pendingReserve`; `totalPaidOut` counts only approved (+ legacy `status: null`) |
| `src/app/supplier/wallet/page.tsx` | «موجودی قابل برداشت» + «در انتظار تأیید» cards, payout form caps at availableBalance, status badges + rejection reason in history |
| `src/components/layout/admin/admin-sidebar.tsx` | «تسویه فروشندگان» nav entry |
| `src/hooks/use-supplier-wallet.ts` | Updated `requestPayout` return type |
| `src/types/index.ts` | `PayoutStatus`, `WalletInfo.availableBalance/pendingReserve`, `WalletTransaction.status`, `AdminPayout` |

### Key Accomplishments
- ✅ Reserve-based payout requests (balance untouched until admin approval) — closes the un-audited self-service debit
- ✅ Atomic approve/reject claims — a payout request is processed exactly once (no double debit, no double release)
- ✅ Race-safe over-reservation guard via single-document `$expr` claim
- ✅ Audit trail (reviewedBy/reviewedAt/rejectionReason) + approved-only `totalPaidOut` (+ legacy compat)
- ✅ 17/17 verification tests; `npx tsc --noEmit` zero errors; regressions green (refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- Bug found & fixed live: wallet POST response double-counted pendingReserve (`{new:true}` already includes amount)

---

## Files Modified This Session (Session 32 — Admin Refund Flow)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/admin/orders/refund/route.ts` | `POST` — admin-only refund: atomic `payment.status: paid → refunded` claim (double-refund impossible), refund metadata (reason/refundedAt/refundedBy), immutable `refunded` statusHistory event, reason required + sanitized, stock via shared `restoreOrderStock()` |
| `scripts/verify-refund.js` | 12-test live suite against the real API (401, customer 403, supplier 403, paid refund → 200 + metadata + stock 8→10, pending 400, double-refund 400 + no double restore, variant restore + summary, simple product, history event) |

### Modified Files
| File | Change |
|------|--------|
| `src/models/Order.js` | Added `refund` subdocument `{ reason, refundedAt, refundedBy }` |
| `src/types/index.ts` | `AdminOrder.refund?` added |
| `src/app/admin/orders/[id]/page.tsx` | «بازپرداخت سفارش» button (paid only), confirmation modal (required reason), refunded badge + reason + date, `paymentLabels` gained canceled/refunded, `statusConfig` widened with `refunded` (Persian timeline label) |
| `src/hooks/use-admin-orders.ts` | `useRefundOrder` mutation (invalidates lists + detail) |

### Key Accomplishments
- ✅ Admin refund flow with atomic claim (no double refund) + shared idempotent stock restoration (no second inventory system)
- ✅ Refund audit trail (metadata + statusHistory event) — immutable
- ✅ 12/12 verification tests; `npx tsc --noEmit` zero errors; regressions green (payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- Documented crash-window tradeoff (claim before restore; do NOT swap ordering)

---

## Files Modified This Session (Session 31 — Variant Polish)

### Modified Files
| File | Change |
|------|--------|
| `src/models/Order.js` | Added immutable `image` snapshot to order item schema (variant image, falls back to product image) |
| `src/models/SupplierOrder.js` | Same immutable `image` snapshot on supplier order items |
| `src/app/api/checkout/route.ts` | Item-snapshot builder now stores `image` (variant `images?.[0]` → product `images?.[0]`) |
| `src/types/index.ts` | `AdminOrderItem` / `SupplierOrderItem` get `image?: string` |
| `src/app/admin/orders/[id]/page.tsx` | Renders product/variant thumbnail + existing variantLabel/SKU; placeholder when no image |
| `src/app/supplier/orders/[id]/page.tsx` | Same thumbnail rendering for supplier order detail |
| `src/app/(storefront)/orders/[id]/page.tsx` | Same thumbnail rendering for storefront order detail |
| `src/lib/inventory.ts` | Added `setVariantStock()` — atomic optimistic-lock quick-edit (`$elemMatch` + `stockVersion`, delta-based summary sync, never negative) |
| `src/app/supplier/products/page.tsx` | Inline `VariantStockEditor` («ویرایش سریع») — expandable variant rows, per-variant stock input + save; wrapped map rows in `Fragment` |
| `src/hooks/use-supplier-products.ts` | Added `useUpdateSupplierVariantStock` mutation + cache invalidation |

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/supplier/products/stock/route.ts` | `POST` — supplier-only variant stock quick-edit: ownership check, variant-existence check, negative/invalid stock 400, 409 on stockVersion conflict |
| `scripts/verify-variant-polish.js` | 13-test live suite (variant order snapshot incl. image, old-order compat, owned quick-edit → 200 + summary 13→33, cross-supplier 404, invalid variant 400, negative stock 400, concurrent quick-edits → 200+409, simple-product 400, simple checkout 201) |

### Key Accomplishments
- ✅ Variant-aware order display: variant image snapshot (immutable) + thumbnails in admin/supplier/storefront order pages; old orders render via placeholder
- ✅ Variant-aware status management verified: supplier orders route has zero stock logic; admin only touches stock on cancel via shared `restoreOrderStock()`; suppliers see only their own items
- ✅ Supplier variant stock quick-edit — SAME single inventory system (`setVariantStock` in `src/lib/inventory.ts`), stockVersion optimistic locking, atomic summary sync, never negative
- ✅ 13/13 verification tests; `npx tsc --noEmit` zero errors; regressions green (payment-retry 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- Bugs fixed during session: fixture variant `_id` (Mixed arrays auto-_id), JSX fragment in products page map, TEST 3 summary expectation (35→33)

---

## Files Modified This Session (Session 30 — Payment Retry & Cleanup)

### Created Files
| File | Purpose |
|------|---------|
| `src/app/api/payment/retry/route.ts` | `POST /api/payment/retry` — ownership check, retryable-status gate, no-stock-change for still-pending orders, atomic claim + re-reserve via `reserveStock()` for restored orders, rollback + 409 on insufficient stock, fresh authority + `stockRestored=false` only in final atomic update |
| `src/lib/payment-cleanup.ts` | `cleanupAbandonedPayments(maxAgeHours=24)` — atomic claim per abandoned order, `restoreOrderStock()` only for claimed, updatedAt-based cutoff |
| `src/app/api/payment/cleanup/route.ts` | `GET` trigger — admin-only (`requireRoleOrError`) + optional `CRON_SECRET` header/Bearer (Vercel Cron style); returns `{ cleaned }` |
| `scripts/verify-payment-retry.js` | 12-test live suite against the real API + Zarinpal sandbox (401, own-failed retry → 200 + new authority + stock 10→8, persistence, cross-user 404, paid/cancelled 400, pending retry stock unchanged 8, abandoned auto-cancel + restore-once, second-cleanup no-op) |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/zarinpal.ts` | Added `hasZarinpalErrors()` — fixes latent v4 bug where success `errors: []` (truthy) made `requestPayment`/`verifyPayment` always fail; applied to both |
| `src/app/(storefront)/orders/[id]/page.tsx` | `canRetryPayment()` gate + «پرداخت مجدد» button (hidden when paid/refunded) |
| `src/types/index.ts` | `OrderPaymentStatus` extended with `canceled`/`refunded` |

### Key Accomplishments
- ✅ Payment retry with correct stock semantics (no double reservation, no stock inflation crash window)
- ✅ Abandoned payment cleanup (24h) — idempotent, atomic, admin/CRON_SECRET protected
- ✅ 12/12 verification tests passing; `npx tsc --noEmit` zero errors; regressions green (pagination 24/24, variants 16/16, upload-repro 15/15)

---

### Created Files
| File | Purpose |
|------|---------|
| `scripts/verify-upload-formats.js` | 9-test live suite: PNG/WEBP/JPG uploads → 201 + real Liara URL, multi-image product create, MongoDB persistence of image URLs, edit add/remove, self-cleaning (S3 objects + File records via DELETE /api/upload + direct DB fallback) |

### Verified (no app code changed)
- `scripts/verify-upload-repro.js` **15/15** against the real HTTP API (REPRO A fails / REPRO B succeeds)
- Liara S3 public URL GET → **200** with correct content-type/bytes (`PUBLIC_URL_OK`)
- Browser UI: admin login, product form, upload drop-zone → native file chooser (no console errors)
- `npx tsc --noEmit` zero errors; pagination 24/24; variants 16/16

---

## Files Modified This Session (Session 27 — API Pagination)

### Modified Files
| File | Change |
|------|--------|
| `src/app/api/products/route.ts` | Added pagination, `?id=` guard, proper search/filter/sort with DB-level skip/limit |
| `src/app/api/orders/route.ts` | Added pagination with status filter + search |
| `src/app/api/admin/products/route.ts` | Added pagination, search with ObjectId ref resolution (Category/Brand/Tag via `$in`) |
| `src/app/api/admin/orders/route.ts` | Added pagination, search with User lookup + `$expr` id-substring match |
| `src/app/admin/dashboard/page.tsx` | Updated to consume paginated responses |
| `src/app/(storefront)/orders/page.tsx` | Updated to consume paginated responses, removed unused import |
| `src/app/(storefront)/products/page.tsx` | Updated to consume paginated responses with page-reset on filter change |
| `src/app/admin/products/page.tsx` | Updated to consume paginated responses |
| `src/app/admin/orders/page.tsx` | Updated to consume paginated responses |
| `src/lib/constants.ts` | Default page size 20 |
| `src/types/index.ts` | `PaginatedResponse<T>` shape |

### Created Files
| File | Purpose |
|------|---------|
| `src/lib/pagination.ts` | `parsePaginationParams()`, `buildPaginatedResponse()`, `escapeRegex()` |
| `src/components/ui/pagination.tsx` | `PaginationControls` UI component (RTL, Persian labels) |
| `scripts/verify-pagination.js` | 24-test pagination verification script |

### Key Accomplishments
- ✅ DB-level pagination (countDocuments + find().skip().limit) — never fetch all
- ✅ 1-based page, default 20, max 100, safe coercion of invalid values
- ✅ Exact response format: `{ data, page, limit, total, totalPages, hasNextPage, hasPreviousPage }`
- ✅ All existing filters/search/sort preserved
- ✅ `?id=` and `?slug=` single-product paths preserved
- ✅ Admin search resolves ObjectId refs (Category/Brand/Tag/User) via `distinct('_id')` + `$in`
- ✅ PaginationControls with ellipsis, first/middle/last pages
- ✅ React Query keys include pagination params
- ✅ 24/24 verification tests passing
- ✅ Zero TypeScript errors

## Files Modified This Session (Session 28 — Security Hardening)

### Modified Files
| File | Change |
|------|--------|
| `src/lib/auth-utils.ts` | Added `requireRoleOrError()` — returns 401 for unauthenticated, 403 for wrong role; updated `requireRole` to delegate |
| `src/lib/auth.js` | Added rate limiting in `authorize` callback (phone + IP, 5 attempts per 15 min) |
| `src/app/api/register/route.js` | Added IP-based rate limiting (10 attempts per 15 min) |
| `src/app/api/admin/brands/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/admin/categories/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/admin/tags/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/admin/stats/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/admin/suppliers/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/admin/products/route.ts` | Updated to `requireRoleOrError`; sanitized description |
| `src/app/api/admin/orders/route.ts` | Updated to `requireRoleOrError` |
| `src/app/api/admin/users/route.ts` | Updated to `requireRoleOrError`; sanitized user name |
| `src/app/api/supplier/stats/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/supplier/orders/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/supplier/products/route.ts` | Updated to `requireRoleOrError`; sanitized description; fixed `token!` assertions |
| `src/app/api/supplier/settings/route.ts` | Fixed `token!` assertions on GET, PUT, POST |
| `src/app/api/supplier/wallet/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/upload/route.ts` | Updated to `requireRoleOrError` for 401/403 distinction |
| `src/app/api/profile/route.ts` | Updated to use `requireAuthOrError` for 401 response |
| `src/app/api/products/route.ts` | Added `mongoose.isValidObjectId` guard for malformed `?id=` |

### Created Files
| File | Purpose |
|------|---------|
| `src/lib/rate-limiter.ts` | MongoDB-backed TTL rate limiter (atomic increment, auto-expiry) |
| `src/lib/sanitize.ts` | Input sanitizer (strip HTML tags, `javascript:` protocol, `on*=` event handlers) |

### Key Accomplishments
- ✅ Rate limiting on login (5 attempts/15min per phone+IP) and register (10 attempts/15min per IP)
- ✅ Proper 401/403 distinction in all API routes via `requireRoleOrError`
- ✅ Input sanitization applied to all user-controlled text fields (product descriptions, user names, brand/category/tag names, etc.)
- ✅ `npx tsc --noEmit` passes with zero errors
- ✅ All 24 pagination tests still pass

---

## Architecture Decisions

### 35. Rate Limiting Strategy
**Decision:** Used MongoDB-backed rate limiter with TTL index for auto-cleanup, applied in both the NextAuth `authorize` callback (login) and the register route handler.
**Reason:** No external Redis/upstash dependency. MongoDB's TTL index auto-cleans expired records, and the atomic `$inc` pattern is sufficient for rate limiting. Slight overages under extreme concurrency are acceptable.
**Pattern:** `findById` → `$inc: { count: 1 }` → check count against limit. TTL index on `expiresAt`.

### 36. 401/403 Distinction
**Decision:** Created `requireRoleOrError()` helper that returns an object with `{ token, error }` — `error` is a `NextResponse` with 401 (unauthenticated) or 403 (authenticated but wrong role).
**Reason:** Previously, `requireRole()` returned `null` for both cases, and all callers used `if (!token) return unauthorized()` — which sent 401 even for wrong-role requests. The new helper correctly distinguishes.
**Pattern:** `const { token, error } = await requireRoleOrError(req, roles); if (error) return error;`

### 37. Input Sanitization
**Decision:** Created a lightweight sanitizer that strips HTML tags, `javascript:` protocol, and `on*=` event handlers. Applied to all user-controlled text fields at the API level.
**Reason:** All UI rendering uses React JSX which auto-escapes, so stored XSS via React is not possible. Sanitization is defense-in-depth for any future non-React consumers (admin HTML rendering, API external consumers, etc.).
**Pattern:** `sanitizePlainText(value)` → strip HTML tags + protocol/event handler sanitization.

---

## Architecture Decisions

### 30. Brand Management System
**Decision:** Built a brand management system following the same pattern as categories but simpler (no nesting, fewer fields).
**Reason:** Brands are a fundamental product attribute that enables customers to filter/sort by manufacturer.
**Pattern:** Model → API → hooks → admin UI → product form integration → API population

### 31. Tag Management System
**Decision:** Built a tag management system with chip-based multi-select UI in product forms.
**Reason:** Tags provide flexible, non-hierarchical product categorization.
**Pattern:** Model → API → hooks → admin UI → chip-based multi-select in product forms → API population

### 32. Tags Managed via State, Not FormField
**Decision:** Tags are managed via `selectedTags` React state and passed through at submit time, not via `FormField`.
**Reason:** Follows the same pattern as `images` — avoids TypeScript type inference issues with `@hookform/resolvers` + Zod for arrays with defaults.

### 33. Inventory Concurrency — Optimistic Locking
**Decision:** Used `stockVersion` field with `findOneAndUpdate` atomic updates instead of MongoDB transactions.
**Reason:** MongoDB transactions require replica sets (not available in current environment). Optimistic concurrency with `stockVersion` is the standard pattern for single-document atomicity in MongoDB.
**Pattern:** Read version → atomically update with `{ stockVersion: currentVersion }` condition → if null returned, another request already modified stock → return 409 Conflict.

### 34. Stock Restoration Idempotency
**Decision:** Used `stockRestored` boolean flag with atomic `findOneAndUpdate({ stockRestored: false })` claim pattern.
**Reason:** Prevents double-stock-restoration from concurrent callback retries or duplicate webhook delivery.
**Pattern:** Atomic claim → only first caller to set `stockRestored=true` executes restoration → subsequent callers skip.

---

## Next Action

**Next Priority:** Session 53 — Homepage CMS (approved milestone order: Session 52 mobile-nav fix ✅ done → Session 53 CMS → Session 54 best-sellers rail).

Session 53 = replace the static homepage configuration with a fully admin-manageable content system: new homepage content model, graceful fallback to the current static config when empty, hero slider + campaign banners + gift collections + trust badges CRUD (desktop/mobile images via the existing S3 upload, ordering, active/inactive), designed for future block extensibility. Session 54 = **best-sellers rail** (client-side, reuses the existing shared product pool — only if still needed after the CMS work). Deferred: scoped/free-shipping coupons (touch the hardened checkout price path — higher risk; no shipping-fee model). See ROADMAP.md / NEXT_SESSION.md.

### 📋 Future Features
- SMS/OTP authentication
- Real-time notifications — WebSocket/SSE for live order updates
- Multi-language support — i18n with next-intl
- Unit/E2E tests — Vitest + Testing Library + Playwright
- Full production build — `npx next build` (blocked by Google Fonts in current env)
- Customer email/SMS order notifications

---

## Important Rules

- Import `cn()` from `@/lib/utils` — NOT from any other path
- API routes: Use `requireRole()` / `requireAuth()` from `@/lib/auth-utils` — NEVER raw `getToken()`
- Use `unauthorized()` (401), `forbidden()` (403), `serverError()` (500) helpers for error responses
- Use shadcn CSS variables for all styling (`--background`, `--foreground`, `--primary`, etc.)
- Build must pass with `npx tsc --noEmit` or `npx next build`
- Include loading, empty, and error states for all data-fetching components
- UI text in Persian (Farsi), code/comments in English
- All storefront pages use `dir="rtl"`
- File uploads go through `POST /api/upload` with auth (admin/supplier only)
- Telegram notifications are fire-and-forget (never awaited in request handlers)
- `.env.local` has real credentials — keep secure. `.env.example` has placeholders.
- Product images stored in `product.images[]` as S3 URLs
- Mongoose `.lean()` returns complex union types — use `as any` + eslint-disable where needed
- React 19: access ref via `element.props.ref`, never `element.ref`
- Seed script: `node scripts/seed-admin.js`
- Zarinpal sandbox auto-selected in development, production API in production
- Always verify payment server-side — never trust client-side confirmation
- Tags managed via React state (selectedTags), not FormField
- New Mongoose models follow pattern: `mongoose.models.Name || mongoose.model("Name", Schema)`
- Inventory: Always use `reserveStock()` for atomic stock reservation — NEVER manual read-then-write
- Stock restoration: Always use the `stockRestored` atomic claim pattern — NEVER direct `$inc` on stock
- Payment retry: NEVER re-reserve for still-pending orders (`stockRestored=false`); atomic claim + `reserveStock()` only for restored orders; flip `stockRestored` to false only in the final update together with the new authority
- Cleanup trigger: admin-only via `requireRoleOrError` (or `CRON_SECRET` bearer/header) — never open
- Variant stock edits: use `setVariantStock()` from `@/lib/inventory` — NEVER direct `$inc` on `variants.$.stock`; `$elemMatch` binds `_id`/`isActive`/`stockVersion` in the query, `$` only in the update
- Refunds: `POST /api/admin/orders/refund` — admin-only; the atomic `payment.status: "paid" → "refunded"` claim MUST run BEFORE `restoreOrderStock()` (never swap — restore-before-claim would release stock for failed claims); refunds restore via `restoreOrderStock()` only, never manual `$inc`
- Payouts: `POST /api/supplier/wallet` RESERVES (atomic `$expr` claim `pendingReserve + amount ≤ balance`) — never debit at request time; `POST /api/admin/payouts` uses the atomic `status: "pending"` claim (approve → debit+release, reject → release only); never bypass the reserve/claim pattern
- Reviews: eligibility requires a DELIVERED order (`payment.status=paid` + `status=delivered` + items contains product); one review per order-item (unique `{customer, product, order}`); only APPROVED reviews ever served publicly / used in `ratingSummary` / `aggregateRating`; moderate via the atomic `status: "pending"` claim (reason required for reject)
- Wishlist: customer-only (`requireRoleOrError(["customer"])`); never delete rows silently — deleted products map to `product:null` (placeholder) and inactive to `isActive:false`; use the two-query GET (never `.populate().lean()` for rows — missing refs stay raw ObjectIds); add requires product `isActive:true`; writes rate-limited 30/15min after payload validation
