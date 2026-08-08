# Roadmap - فروشگاه من (Online Store)

## ✅ Completed Milestones

### Supplier Onboarding v1 — Admin Supplier Management + Deactivation Enforcement (Session 66)
- [x] **Dedicated `/admin/suppliers` page** — the discoverable home for Supplier onboarding: management list (active + inactive, wallet + populated user), «ایجاد فروشنده جدید» (shared CreateUserModal, role defaults to supplier), «ارتقای کاربر به فروشنده» (searchable customer picker → change-role), per-row deactivate/reactivate, «تسویه» link to `/admin/payouts`; sidebar «فروشندگان»
- [x] **Zero duplicate supplier API** — creation/promotion reuse the existing `POST`/`PATCH /api/admin/users` (auto Supplier doc provisioning preserved); `GET /api/admin/suppliers?all=true` is the only additive endpoint change (default dropdown shape untouched)
- [x] **Deactivation enforcement** — `toggle-active` on a supplier now flips the linked `Supplier.isActive` (public storefront surfaces hide them) **and** bumps `tokenVersion` + evicts cache → sessions revoked immediately; reactivation restores both
- [x] **Role-change session revocation** — any `change-role` bumps `tokenVersion` + evicts cache → old-role sessions die instantly
- [x] **Shared CreateUserModal** extracted to `src/components/admin/create-user-modal.tsx` (users + suppliers pages)
- [x] **No public registration / no application queue** (out of scope by design — admin-only onboarding preserved)
- [x] `scripts/verify-suppliers-onboarding.js` **14/14 real-API** (401/403, create+auto-provision, promote+session-revoke, deactivate/reactivate, public hiding, dropdown-shape regression guard) wired into `run-regression.js` (**37 suites**); Journey 15 E2E (2 tests)
- [x] **Verified** — tsc 0 · check exit 0 · Vitest **211/211** · Playwright **50/50** · `verify-suppliers-onboarding` **14/14** · full regression **37/37 PASS**

### Session Security — tokenVersion enforcement + password change + logout all + admin revoke (Session 64)
- [x] **`tokenVersion` now ENFORCED** — `src/lib/token-version.ts` (pure checker factory: per-user 60s cache, **asymmetric semantics** — equal → valid, cached-newer → revoked, cached-older → stale-cache refetch, deleted user → revoked, error → fail-open) wired into `auth-utils.getServerToken` → every protected API route 401s revoked JWTs with zero per-route changes; `invalidateTokenVersionCache()` makes bumps immediate in-process
- [x] **`POST /api/auth/change-password`** — bcrypt current-password verification for password users (400 on mismatch); **passwordless OTP users set their first password** (no currentPassword needed); bumps `tokenVersion` → all sessions (incl. current) revoked; rate-limited 5/15min
- [x] **`POST /api/auth/logout-all`** — bumps the caller's `tokenVersion` → every device signed out (client then clears the local cookie); 10/15min
- [x] **`POST /api/admin/users/[id]/revoke-session`** — admin-only, target's `tokenVersion` bumped → their sessions die; malformed id → 400, unknown → 404; 30/15min actor-keyed
- [x] **Profile UI** — «امنیت حساب» card: change/set password (proper `htmlFor`/`id` label association) + «خروج از همه دستگاه‌ها»; `GET /api/profile` exposes additive `hasPassword`
- [x] **Invariants** — zero `auth.js` branch / middleware / RBAC / OTP / model / business-logic changes; zero new packages; no schema change
- [x] **Verified** — tsc 0 · check exit 0 · Vitest **199/199** (183 + 16 new) · Playwright **48/48** (chromium 36 incl. **Journey 14** + mobile 12) · `verify-session-security.js` **11/11** · full regression **36/36 PASS** (36 suites)

### Wishlist & Coupons header entry-point gating (Session 63.1)
- [x] **Root cause fixed** — the wishlist **page** (`!session || role !== "customer"` → sign-in prompt) and **API** (403 for non-customers) are customer-only, but Session 63's header (desktop nav link + heart icon) and account-menu item were surfaced to **all** authenticated roles → an authenticated admin landed on the «وارد حساب شوید» prompt. Live probes proved customers (password + OTP) see their wishlist correctly; the regression only hit non-customer roles
- [x] **Header/account-menu now role-aware** — `storefront-header.tsx` renders wishlist entries (nav link + heart icon) only for `role === "customer"`; `account-menu.tsx` omits علاقه‌مندی‌ها for other roles; `useWishlistIds` already role-gated → no spurious requests
- [x] **Coupons nav entry session-gated** — «کدهای تخفیف» header link hidden for anonymous visitors, shown only when a session exists (kept layout/responsive behavior)
- [x] **Tests** — Journey 13 grew to **7 tests** (new: authenticated admin sees NO wishlist entry but still sees the coupons link); customer + anonymous journeys assert the session-gated coupons entry; positive coupons assertion desktop-viewport-gated (`width >= 1024` — the `hidden lg:flex` nav is absent from the mobile a11y tree)
- [x] **Verified** — tsc zero errors · `npm run check` exit 0 · Vitest **183/183** (unchanged) · Playwright **44/44 PASS** (chromium 32 incl. Journey 13 + mobile 12, exit 0) · `verify-logout` **6/6** · zero auth/API/model/middleware/RBAC/OTP/password changes · no dev-server restart

### Logout / Sign-out for authenticated users (Session 63)
- [x] **Storefront account menu** `src/components/storefront/account-menu.tsx` — replaces the header's profile `<Link>` when signed in: پروفایل / سفارشات / علاقه‌مندی‌ها / اعلان‌ها + separator + «خروج» (`signOut({ callbackUrl: "/" })`, immediate — no confirmation, matching the dashboards). A11y: `aria-haspopup`/`aria-expanded` trigger, `role="menu"`/`menuitem`, Escape + outside-click + route-change close, focus return; desktop + mobile tap; RTL `left-0` anchoring
- [x] **Profile-page logout** — «خروج از حساب» button (outline + destructive) in the Account Info card; **admin/supplier dashboards unchanged** (existing sidebar logout verified working on desktop + mobile drawer)
- [x] **Session termination** — built-in NextAuth `POST /api/auth/signout` clears the JWT cookie and redirects to `/` for all roles; **zero auth/API/model/middleware/RBAC/OTP/password changes**; no new packages
- [x] **Tests** — Journey 13 E2E `tests/e2e/logout.spec.ts` (6 tests × desktop + mobile: customer menu/profile logout + cookie-gone, post-logout profile prompt, admin + supplier logout → `/admin`+`/supplier` guarded, anonymous negative) · `scripts/verify-logout.js` **6/6** real-API wired into `run-regression.js` (**35 suites**) · `customer-login` profile-link assertion updated to the menu trigger
- [x] **Verified** — tsc zero errors, check exit 0, Vitest **183/183**, Playwright **42/42** (chromium 31 + mobile 11), `verify-logout` **6/6**, full regression **35/35 PASS**

### SMS/OTP Authentication — adapter-first, backward compatible (Session 62)
- [x] **`OtpCode` model** — SHA-256 `codeHash` only (plaintext never stored in production), `codeConsumedAt` + `consumedAt` split (code and login-token each single-use), `loginTokenHash`/`loginTokenExpiresAt` (TTL-aligned), TTL index; **`User.passwordHash` optional** (OTP accounts are passwordless) + **`tokenVersion`** (session-revocation foundation; enforcement future)
- [x] **Adapter-first SMS layer** `src/lib/sms.ts` — mock (`SMS_MOCK=1`, dev/CI hermetic) · **sms.ir** production provider (disabled until `SMS_IR_API_KEY` + `SMS_IR_TEMPLATE_ID` are both configured — `.env.example` only) · none → controlled 503; **no sms.ir account/plan/credentials needed for development**
- [x] **`/api/auth/otp/{request,verify,dev-last}`** — validation-before-limiter, per-phone 5/15min + per-IP 15/15min, 60s resend cooldown, 5-attempt code lock, **login anti-enumeration** (unknown phones → same 200, nothing created/sent), one-time `loginToken` issuance, dev-only code reader
- [x] **Replay-proof NextAuth integration** — `loginToken` branch in `authorize` (atomic single-use claim); password branch byte-for-byte unchanged; `tokenVersion` + `phone` carried in the JWT/session (declared contract now real)
- [x] **UI** — login/register method toggles (password default), shared `OtpPanel` + `OtpCodeInput`, axe-clean toggle contrast
- [x] **Tests** — 25 new unit tests (otp/sms) · Journey 12 E2E (3 tests) · `scripts/verify-otp.js` **11/11** (incl. replay rejection, anti-enumeration, per-IP cap, password compat) wired into `run-regression.js` (**34 suites**) · `playwright.config.ts` CI env gains `SMS_MOCK=1`
- [x] **Verified** — tsc zero errors, `npm run check` passes, Vitest **183/183**, Playwright **30/30** (login/register axe scans stay clean), regression **34/34 PASS**; model change ⇒ dev-server restart done

### Performance & Accessibility — next/image + axe-core (Session 61)
- [x] **Storefront `next/image` migration** — 12 image components / 17 `<Image>` instances (product card, quick-categories, product detail gallery + thumbs, lightbox, cart, checkout, order invoice, hero-carousel, campaign-banner, gift-collections, supplier card + detail logo); `fill` aspect containers, explicit `sizes`, critical-only `eager` loading; all `onError` fallbacks preserved — zero behavior change
- [x] **`next.config.ts` `images.remotePatterns`** — additive allowlist from env at config-load (Liara endpoint host w/ known fallback, app URL, localhost dev); optimizer stays enabled (AVIF/WebP)
- [x] **Accessibility audit fixes (in-scope)** — `search-suggestions` `aria-selected`, `image-lightbox` labelled backdrop/zoom buttons, `storefront-header` icon-link `aria-label`s, `hero-carousel` `inert` on hidden slides (axe `aria-hidden-focus`), `ui/badge` success/warning contrast → WCAG AA (-700 shades); `mobile-drawer` verified already-compliant
- [x] **axe-core E2E gate** — `@axe-core/playwright` + `tests/e2e/accessibility.spec.ts` (Journey 11): wcag2a/2aa/21a/21aa scans of homepage/catalog/product-detail/supplier-detail/login/register, zero serious/critical asserted; runs inside `npm run e2e` → inside the Session 60 `ci.yml` e2e gate
- [x] **`PERFORMANCE.md`** — pipeline/allowlist/loading-strategy docs + the out-of-scope admin/supplier native `<img>` debt backlog
- [x] **Fail-safe image guard** — `isAllowedImageSrc` (`src/lib/utils.ts`, +5 unit tests) applied across all 12 image components: next/image throws at render on unconfigured hosts (native `<img>` degraded to a broken image), so unconfigured URLs now fall back to placeholders instead of crashing a section
- [x] **Invariants** — zero `src/` business-logic changes, no model/schema/index/DB changes, no money-flow/API behavior changes; validated: tsc zero errors, `npm run check` passes (scoped eslint 0 errors, 4 pre-existing warnings), Vitest **158/158** (152 + 6 new), Playwright **27/27** (chromium 22 incl. 6 axe scans + mobile 5, zero serious/critical on all six scanned pages); no dev-server restart needed

### Playwright E2E — Production Readiness, Tranche 1 (Session 59)
- [x] `@playwright/test` + bundled Chromium; `playwright.config.ts` — `chromium` full suite + `chromium-mobile` Pixel 5 smoke; `workers: 1` deterministic sequential against the shared dev DB; artifacts only-on-failure; `e2e` / `e2e:headed` / `e2e:install` scripts
- [x] **Auth:** real credentials API logins in `global-setup` → per-role `storageState` (admin/supplier/customer) + one real UI login journey (valid + wrong-password)
- [x] **Test data:** per-run PREFIX (`e2e_<ts>_`) supplier/customer/catalog seeded through the real APIs; `global-teardown` removes exactly the run's rows (id sets + anchored slug regex) + resets login/register rate-limiter keys
- [x] **ZARINPAL_MOCK seam** (only `src/` change, fail-safe dev-gated) — hermetic payment journey; regression suites still run against the real sandbox
- [x] **10 journeys:** customer-login, product-search, product-detail (incl. variants), cart (incl. mobile smoke), checkout, coupon, payment (success + NOK), order-tracking, admin-order-workflow (lifecycle + shipping metadata), supplier-workflow
- [x] **Playwright 21/21 PASS** (chromium 16 + mobile 5); `tsc` zero errors; ESLint clean; Vitest 152/152 unchanged; full regression **33/33 PASS**; code review approved (coupon hermeticity HIGH + supplier-locator MEDIUM fixes applied); no model/schema/index changes

### CI/CD Pipeline — GitHub Actions (Session 60)
- [x] **`.github/workflows/ci.yml`** — three merge-gating jobs on push/PR with a concurrency group (cancel superseded): `static` (`npm ci` → `npx tsc --noEmit` → **scoped eslint** `src/lib tests/unit tests/e2e` — 0 errors; the project-wide `npm run lint` reports **174 PRE-EXISTING errors** (whole-repo debt, Milestone 15) and is deliberately NOT a gate, matching the repo's "lint clean on changed files" convention; `next build` also not a gate — Google Fonts network constraint) · `unit` (Vitest **152/152**, hermetic) · `e2e` (fresh **`mongo:7` service container** → `npm run e2e` with `ZARINPAL_MOCK=1` → **zero CI secrets required** — `global-setup` auto-seeds the admin + per-run supplier/customer; `playwright.config.ts` CI switches already present (retries 2, webServer, `reuseExistingServer: !CI`); Playwright report/test-results artifacts on failure only)
- [x] **`.github/workflows/regression.yml`** (optional, non-gating) — nightly 03:00 UTC + `workflow_dispatch`: the full **33-suite real-sandbox regression** (`node scripts/run-regression.js`), secrets-driven (Zarinpal sandbox merchant id, Liara S3, Telegram), self-skipping until `ZARINPAL_MERCHANT_ID` is configured (runtime check — secrets can't be used in `if:`); **idempotent `seed-admin.js` step on the fresh DB** (reviewer fix — the suites hardcode the seeded admin that only exists on the persistent dev DB); dev-server log artifact on failure
- [x] `package.json` `check` script (`tsc --noEmit && eslint src/lib tests/unit tests/e2e`); `.env.example` CI-secrets section (gitignored); verified-dead `src/hooks/useOrders (1).js` deleted
- [x] **Zero `src/` business-logic changes, no model/schema/index changes, no runtime behavior change**; validated: workflows YAML-parse clean, `tsc` zero errors, scoped eslint 0 errors, Vitest 152/152, **Playwright 21/21** (exit 0, `ZARINPAL_MOCK=1`); code review approved (lint-gate scope, regression.yml duplicate-key, fresh-DB admin seed + browser-cache ordering fixes)

### Vitest Unit-Test Foundation (Session 58)
- [x] **Zero-application-change invariant** — no `src/` code modified, no behavior changed, no pure-function extraction needed; new devDeps `vitest` + `@vitest/coverage-v8` only
- [x] `vitest.config.ts` — node env, explicit `@/` → `./src` alias, Windows-safe `forks` pool, report-only v8 coverage over `src/lib/**/*.ts`
- [x] `package.json` — `test` / `test:watch` / `test:coverage` scripts
- [x] **9 hermetic suites / 152 tests** — sanitize, utils, pagination, product-variants, product-csv, coupons (claim/release/E11000-retry/eligibility), inventory (optimistic-lock reserve/set/restore), product-sales (pipeline shape), payment-cleanup; Mongoose models mocked (`vi.mock` + `vi.hoisted`), no DB/network
- [x] `npm test` **152/152**; coverage report generated (target libs ≥92% lines, report-only); `tsc` zero errors; ESLint clean; full regression **33/33 PASS** (unchanged); no dev-server restart needed

### Order Management v2 — Claim-Based Transitions + Shipping Metadata + Shared Components (Session 57)
- [x] **No packed status / payment-domain separation** — six order statuses only; payment states (`pending/paid/failed/canceled/refunded`) live ONLY in `payment.status` (`refunded` is a history/display entry, never a settable `order.status` — verify tests 9 + 17); `SupplierOrder` untouched; no CSV export; no reorder feature
- [x] **Atomic admin status transition** — `PUT /api/admin/orders` claims via `findOneAndUpdate({_id, status: order.status})` (concurrent loser → 400, single history entry); **cancel claims also gate on `payment.status: "pending"`** (Session 46 race-safe pattern) → mutually exclusive with the payment-verify SUCCESS claim on advanced orders; unpaid cancels record `payment.status: "canceled"` (was `"failed"`)
- [x] **Shipping subdocument** on `Order` (`provider`/`trackingCode`/`shippedAt`/`deliveredAt`/`note`) — set on `shipped`/`delivered` only, **optional trackingCode**, sanitized + capped (100/100/500); additive + defaulted (old orders render without tracking); index `{status: 1, createdAt: -1}`
- [x] **Admin newest/oldest sorting** — additive `sort=newest|oldest` on the list API + UI toggle button
- [x] **Shared components** — `OrderStatusBadge`/`PaymentStatusBadge`/`ORDER_STATUS_CONFIG` + `OrderEventTimeline`/`OrderProgressTimeline` + `OrderInvoice` replace the duplicated maps/tables in the admin + customer detail pages; admin detail gains shipping inputs; customer detail gains «پیگیری ارسال»
- [x] `scripts/verify-order-management.js` — **17/17 PASS** (incl. atomicity, shipping validation, optional tracking, refund domain separation, paid-cancel soldCount reversal, list sort, cancel-vs-verify race); regression runner → **33 suites**, full **33/33 PASS**; `tsc` zero errors; lint clean on changed TS/TSX files; code review approved; dev-server restart required (Order model change) and done

### Best-Sellers Rail — Product.soldCount (Session 56)
- [x] `Product.soldCount` (Number, default 0, min 0) — units **paid and not later refunded/cancelled**; **INTERNAL** (excluded from every public `/api/products` response via `-soldCount` projection — leak-scan verified); non-unique index `{ soldCount: -1, createdAt: -1 }`
- [x] `src/lib/product-sales.ts` — `recordOrderSales`/`reverseOrderSales` (pipeline updates, `$max` floor at 0, fail-silent, bypasses stock/stockVersion); exactly-once inside the payment-verify `pending→paid`, refund `paid→refunded`, and admin-cancel-of-PAID-order atomic claims; pending cancels skipped
- [x] Additive `sort=best_selling` on `GET /api/products` (`{ soldCount:-1, createdAt:-1 }`); product write routes whitelist-only (clients can never set soldCount)
- [x] CMS block `best-sellers` (registry + renderer into ProductRail + `DEFAULT_SECTIONS` after `special-picks`); **seed upgraded to insert-missing defaults** (soft-delete-aware, never resurrects, doesn't disturb admin edits)
- [x] «پرفروشترین» catalog sort option + `useCatalogFilters` whitelist; `AdminProduct.soldCount?` type; pre-existing `set-state-in-effect` lint debt fixed via render-phase adjustment
- [x] `scripts/verify-best-sellers.js` — **14/14 PASS** (ranking + tie-break, list/detail leak scans, refund + admin-cancel reversals, legacy 0 floor, double-refund 400, pending-never-counts, cash checkout never increments, CMS block); `scripts/backfill-sold-count.js` OPTIONAL re-runnable backfill; regression runner now **32 suites**, full **32/32 PASS**; tsc/lint/build green; code review approved (admin-cancel reversal gap fixed); dev-server restart required (model change)
- [x] **Variant-level sales aggregation = FUTURE SCOPE** — the counter is the product-level sum across all variants

### Private / Targeted Coupons — Coupon Eligibility (Session 55)
- [x] Embedded `eligibility` on the Coupon model: `{ mode: "public" | "assigned_users" | "user_groups", assignedUsers: ObjectId[], groups: String[] }` — missing block = public, **zero migration** for existing coupons; multikey indexes only for future list/admin lookups (never the claim path)
- [x] Single enforcement point in `src/lib/coupons.ts`: `getCouponEligibility` (fail-safe → public), `isUserEligibleForCoupon` (pure JS on the fetched doc — **no extra DB query on checkout**), `userGroupsOf()` (returns `[]` → **fail-closed** until groups exist), `parseCouponEligibility` (mode whitelist, ObjectId → 400, caps 1000 users / 50 groups / 32-char slugs, dedupe, lowercase + sanitize)
- [x] Approved validation flow: exists → active/window → usage-limit pre-check → **eligibility** (distinct Persian error, never «invalid coupon») → minSubtotal → atomic claim/release (all Session 39 invariants preserved)
- [x] Additive APIs: admin POST/PUT accept `eligibility`; admin GET populates `assignedUsers` (name/phone); `POST /api/coupons/validate` eligibility-aware via the authenticated user; `GET /api/admin/users` `search` param (user picker); public endpoint untouched + leak scan extended
- [x] Admin UI: «مخاطب کد تخفیف» mode selector + debounced user picker + groups input + list badges
- [x] `scripts/verify-coupon-eligibility.js` — **18/18 PASS**; regression runner now **31 suites** (full 31/31 PASS); tsc/lint/build green; code review approved; dev-server restart required (model change)
- [x] Future extensibility sealed: first-purchase / spending / order-count / birthday / segments / affiliate are future `eligibility.mode` values or `targetingRules` — **no redesign needed** (the checker + parser + admin editor are mode-driven)

### Storefront Search Quality Upgrade (Session 48)
- [x] Expanded search coverage on `GET /api/products?search=` — name, description, **variant attribute values**, plus **brand/tag/category names** resolved through reference collections (`Brand/Tag/Category.find({name: $regex}).distinct("_id")`); regex stays the primitive (Persian substring `پیراه` → `پیراهن` preserved) — **no `$text`, no indexes, no schema changes**
- [x] Weighted relevance ranking — one aggregation (only when `search` + default `newest` sort): exact name 100 / name prefix 60 / name substring 40 / brand-tag-category 25 each / attribute value 20 / description 10 (additive); `$sort {score:-1, createdAt:-1}`; **pagination inside the aggregation** (skip/limit, never fetch-all); existing populate chain re-hydrates the page and re-sorts to ranked order; response shape unchanged with NO `score` leak
- [x] Explicit sorts (`price_asc`/`price_desc`/`name`/`oldest`) **override relevance** via the existing `find()` path; no-search behavior byte-for-byte unchanged; all filter ids ObjectId-cast at build time (aggregation `$match` does not auto-cast — Session 47 lesson)
- [x] Attribute-value score term flattens `$variants.attributes` (array-of-arrays in aggregation expression context) with `$reduce`/`$concatArrays` + `$type` string guard — fixed a real 500
- [x] **300ms search debounce** in `useCatalogFilters` — `searchQuery` stays the immediate input value, `debouncedSearch` commits to `queryParams` (empty clears immediately; `clearFilters` resets both); **useState kept — no `useSearchParams` migration**
- [x] `scripts/verify-search.js` — **17/17 PASS**; regression runner **27 suites** (`verify-search` after `verify-attribute-facets`); `npx tsc --noEmit` zero errors; full regression **27/27 PASS**

### Storefront Faceted Filtering — Brand + Tag + Attribute Facets (Session 47 + extension)
- [x] Public `GET /api/brands` + `GET /api/tags` — active-only, STRICT projection (`_id/name/slug` only; leak-scan verified), mirror `/api/categories`
- [x] Additive `brand=` + `tag=` params on `GET /api/products` — ObjectId-validated like `supplier=` (malformed → 404, valid-but-nonexistent → 200 empty); existing params + `id`/`slug` detail path unchanged when absent
- [x] **Extension — nested attribute filters** `attributes[<slug>]=<value>` on `GET /api/products` — slug→attributeId, `$all`/`$elemMatch` AND semantics, unknown slug → 200 empty, simple products never match; validated the Session 47 extensibility seam (index-signature + generic `buildQueryString` absorbed the new params with zero data-flow changes)
- [x] **Extension — aggregation facet counts** `GET /api/attributes/facets` — public, same filter params, **sticky self-exclusion** (attribute selections applied as JS set intersections; aggregation `$match` carries product-level filters only + explicit ObjectId casts), distinct-product counting via `$addToSet`, active-only, whitelist key-set
- [x] `usePublicBrands`/`usePublicTags`/`usePublicAttributeFacets` (React Query, 5min staleTime) + shared `useCatalogFilters` hook (state, page reset, active count, params mapping; useState — not useSearchParams; `selectedAttributes` for the extension)
- [x] ONE reusable `FilterChipGroup` component used for category/brand/tag/attribute values (no registry/DSL/hierarchy — rejected) + optional `counts` badge prop (backward compatible)
- [x] `buildQueryString()` generalized + exported (iterates filters, skips undefined/null/empty — behavior preserved); `PublicBrand`/`PublicTag`/`AttributeFacet` types
- [x] `scripts/verify-facets.js` — **22/22 tests** + `scripts/verify-attribute-facets.js` — **24/24 tests** (facet endpoints, combinations, 404/empty semantics, inactive-ref identity, sticky self-exclusion, pagination/sorting preservation, detail unaffected, leak scans); runner → **26 suites**
- [x] 22/22 + 24/24 passing; zero TypeScript errors; full regression green (26 suites, sequential); no dev-server restart needed (no model changes)

### Customer Self-Service Order Cancellation (Session 46)
- [x] `POST /api/orders/[id]/cancel` (customer-only via `requireRoleOrError(["customer"])` → 401/403) — ownership-scoped atomic claim `{_id, customer, status:"pending_payment", "payment.status":"pending"}` → `status=cancelled` + `payment.status=canceled`; post-commit `restoreOrderStock` + `releaseCouponUsage(orderId)` (exact coupons.ts export) + `notifyOrderEvent` (`order_cancelled` REUSED — no new type) in local try/catch
- [x] **Race-safe by construction:** cancel claim and payment-verify success claim both gate on `payment.status:"pending"` → exactly one wins; no paid order with restored stock; no double restoration (verify NOK `$nin` branch + `stockRestored` idempotency backstop)
- [x] Additive `actor` on the `statusHistory` subdoc (no migration); machine-readable audit `{status:"cancelled", actor:"customer", note:"customer_cancelled"}` (raw input never stored); model change ⇒ dev-server restart required
- [x] Order detail «لغو سفارش» button + confirm dialog (`pending_payment` only) + `useCancelOrder` mutation + `CancelOrderResponse` type; both order-detail timelines map the machine-readable note → «لغو توسط مشتری»
- [x] `scripts/verify-order-cancel.js` — **17/17 tests** (real API incl. strict cancel-vs-payment-verify race ×3); runner → **24 suites**
- [x] 17/17 passing; zero TypeScript errors; full regression green (24 suites, sequential); dev-server restart required (Order model change)

### Supplier Telegram Alerts (Session 45)
- [x] `POST /api/admin/payouts` (approve **and** reject) → supplier notified via `notifyOrderEvent()` **AFTER** money-state commit (approve after `balanceAfter`, reject after reserve release — Session 33 ordering untouched): `payout_approved`/`payout_rejected` (category `payout`, dedupe keys `payout_<txn>_approved|rejected`, deep-link `/supplier/wallet`); sanitized reason in message + Telegram body
- [x] `POST /api/reviews` → review's supplier notified after `Review.create`: `new_review` (category `system`, dedupe key `new_review_<reviewId>`, deep-link `/supplier/reviews`)
- [x] `sentToTelegram` badge in the notifications inbox (icon + «تلگرام» label when the flag is true)
- [x] Additive `telegram.ts` helpers `sendPayoutStatusNotification` + `sendNewReviewNotification`; +3 additive `Notification` type enums (no index/migration)
- [x] `scripts/verify-telegram-alerts.js` — **16/16 tests** (real API): approve/reject notifications, dedupe, cross-user + cross-supplier isolation, **Telegram fail-silent** (`sentToTelegram` false + payout committed despite failed callback)
- [x] 16/16 passing; zero TypeScript errors; full regression green (23 suites, sequential); dev-server restart required (Notification model change)

### Admin Analytics & Reporting (Session 41)
- [x] `GET /api/admin/analytics?range=7|30|90` — admin-only, **pure read-only** aggregation (summary, zero-filled timeSeries, top products/categories, coupon stats, supplier stats, status funnel)
- [x] No DB schema changes, no new collections, no business-logic files touched
- [x] `/admin/analytics` page — range selector, stat cards, hand-rolled SVG revenue chart (no chart dependency), ranked lists, coupon + supplier cards
- [x] Admin sidebar «گزارش‌ها» entry
- [x] `scripts/verify-analytics.js` — 16/16 tests (baseline→delta design, read-only guarantee, authz, range validation, coupon + supplier deltas)
- [x] 16/16 passing; zero TypeScript errors; full regression green (all 16 suites, sequential)

### Coupon Marketing Surface (Session 44)
- [x] Additive `isPublic` (default false) on the Coupon model — **no migration, no index changes**; private coupons stay hidden; only `isPublic` coupons are ever exposed
- [x] `GET /api/coupons/public` (no auth) — `isPublic` + `isActive` + in-window filter, **strict projection** (code/type/value/minSubtotal/maxDiscount/endsAt only — internal limits never exposed), `createdAt` desc, Session 27 pagination, **IP-keyed rate limit** (60/15min)
- [x] `src/lib/coupons.ts` validate/claim/release **byte-for-byte untouched** — checkout money path unchanged
- [x] Public «کدهای تخفیف» page (copy-to-clipboard cards) + storefront nav entry; checkout `PublicCouponPicker` pre-fills the input, submission goes through the UNTOUCHED validate → claim flow
- [x] Admin coupons form `isPublic` toggle + «عمومی» badge; strict `=== true` boolean parsing on both create and update
- [x] `scripts/verify-coupons-marketing.js` — **12/12 tests** (no-auth 200, private hidden, raw-JSON leak scan, in-window/inactive filtering, toggle live, public-coupon checkout exact discount, private still valid); `scripts/run-regression.js` — NEW sequential 21-suite runner
- [x] 12/12 passing; zero TypeScript errors; full regression green (21 suites, sequential); dev-server restart required (Coupon model change)

### Variant-Level Wishlist (Session 43)
- [x] Data-first index migration `{user, product}` → `{user, product, variantId}` (`scripts/migrate-wishlist-index.js` — dup scan + invalid variant-ref scan before the swap; collision-safe: all legacy rows have `variantId: null`)
- [x] `POST /api/wishlist` accepts optional `variantId` — validated as belonging to the product AND active (400 otherwise), **no silent default-variant fallback**; `variantSnapshot {sku, label}` denormalized
- [x] `GET /api/wishlist` returns `variantId` + `variantSnapshot` (null on product-level rows); `DELETE` variant-row vs remove-all semantics; `ids` deduped + count = total rows
- [x] Product-level + variant-level rows **coexist** under one unique index; detail heart saves the SELECTED variant; wishlist page renders an in-flow variant strip (label + SKU)
- [x] Session 38 resolver untouched (locked decision) — variant-preference regression-proven
- [x] `scripts/verify-variant-wishlist.js` — **19/19 tests**; zero TS errors; full regression green (20 suites, sequential); dev-server restart required (index migration + model change)

### Supplier Storefront Pages (Session 42)
- [x] Public `GET /api/suppliers` + `GET /api/suppliers/[id]` — **strict projection whitelist** (`_id businessName logo description`; NEVER user/contactPhone/bankAccount/telegramChatId/balance/pendingReserve); active-only; malformed/inactive → 404; `productCount` = storefront visibility rules (active + in-stock)
- [x] Additive `logo`/`description` on the Supplier model (no migration, no index changes) + settings PUT accepts them (trim + 500 caps; telegramChatId unchanged)
- [x] Additive `supplier=` filter on `GET /api/products` (ObjectId-validated → 404)
- [x] `/suppliers` listing + `/suppliers/[id]` detail pages; supplier-card; product-card/detail supplier links; wallet «پروفایل عمومی فروشگاه» editing; dynamic sitemap entries (fail-silent)
- [x] `scripts/verify-suppliers.js` — 20/20 tests (raw-JSON projection leak scan, whitelist key-set, inactive/malformed 404, productCount semantics, supplier filter, settings trim/cap/isolation/403, pagination)
- [x] 20/20 passing; zero TypeScript errors; full regression green (19 suites, sequential); dev-server restart required (Mongoose model cache)

### Real-time Notifications — SSE (Session 40)
- [x] `GET /api/notifications/stream` — SSE endpoint (auth 401 / cap 429 / heartbeat / unified cleanup)
- [x] `src/lib/notification-stream.ts` — globalThis in-memory registry (single-instance; Redis adapter path documented)
- [x] `notifyOrderEvent()` publishes after the DB write (fail-silent; dedupe never re-pushes; facade unchanged)
- [x] Client `useNotificationStream()` + bell wiring (storefront + supplier headers); 30s polling fallback intact
- [x] `scripts/verify-sse.js` — 11/11 tests (delivery, isolation ×2, reconnect, heartbeat)
- [x] 11/11 passing; zero TypeScript errors; zero DB schema changes

### Foundation (Session 1)
- [x] Next.js 16 project setup with TypeScript + Tailwind v4
- [x] MongoDB connection with Mongoose (singleton pattern, `dbName: "marlooai"`)
- [x] All database models (User, Product, Order, Category, Supplier, SupplierOrder, Notification, Transaction)
- [x] NextAuth v4 with phone-based Credentials Provider
- [x] Login/Register pages (Persian RTL)
- [x] Role-based middleware (`/admin`, `/supplier` protection)

### UI + Developer Experience (Session 2)
- [x] shadcn/ui components (Button, Input, Card, Badge, Form, Sonner, Slot, etc.)
- [x] Custom Slot component (alternative to @radix-ui/react-slot)
- [x] Zustand stores (app-store, auth-store, cart-store with persist)
- [x] React Query provider + hooks
- [x] Tailwind v4 CSS variables for theming
- [x] Prettier + ESLint configuration
- [x] Custom 404 and error pages
- [x] Form validation with react-hook-form + zod

### SEO + Security (Session 2)
- [x] SEO metadata with template titles
- [x] JSON-LD structured data (Organization, Website, Product, FAQ, Article, BreadcrumbList, LocalBusiness)
- [x] Dynamic sitemap.xml + robots.txt
- [x] PWA manifest
- [x] Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- [x] Environment variable validation

### Homepage + Admin Panel (Session 3)
- [x] Homepage redesign (Hero, Features section, CTA, Footer)
- [x] Admin layout with sidebar navigation + header
- [x] Admin dashboard with stat cards, alerts, recent orders
- [x] Admin products/orders/users/settings pages
- [x] Admin API routes (stats, products, orders) with auth

### Real Data Integration (Session 4)
- [x] Connect admin pages to real API data (replace mock data)
- [x] Create React Query hooks for admin data
- [x] Create admin users API route
- [x] Update stats API to aggregate real MongoDB data
- [x] Add loading, error, and empty states to all admin pages

### Product CRUD (Session 5)
- [x] Product Zod validation schema
- [x] POST/PUT/DELETE handlers on admin products API
- [x] Categories + suppliers API routes for dropdowns
- [x] ProductForm component with react-hook-form + zod
- [x] /admin/products/new and /admin/products/[id]/edit pages

### Order Status Management (Session 6)
- [x] PUT handler on admin orders API with status transition validation
- [x] Single-order GET by ID
- [x] /admin/orders/[id] detail page with timeline
- [x] Status change controls (select + note + save)

### Accessibility Fixes (Session 7)
- [x] Fix Label-Input ID mismatch (FormItemContext)
- [x] Delete duplicate src/models/auth.js

### Supplier Panel (Sessions 8-10)
- [x] Supplier layout (green-themed) and dashboard
- [x] Product management with ownership verification
- [x] Order confirmation/rejection flow (SupplierOrder)
- [x] Wallet: balance, payouts, transaction history
- [x] 33 routes, zero TypeScript errors

### Customer Features (Sessions 11-14)
- [x] Product catalog with search and filters
- [x] Product detail page with image gallery
- [x] Shopping cart (Zustand with localStorage persistence)
- [x] Checkout and order placement (address form, payment method)
- [x] Order history with status tracking
- [x] User profile and address management

### Telegram Notifications (Sessions 15-18)
- [x] Telegram Bot notification service
- [x] Supplier notification on new order (checkout flow)
- [x] Supplier notification on order status change
- [x] Supplier Telegram settings UI (connect/disconnect, test message)
- [x] Admin notification on new order
- [x] Admin notification on order status changes
- [x] In-app Notification records with sentToTelegram flag
- [x] .env.example with all required/optional env vars

### Zarinpal Payment Integration (Session 24)
- [x] Zarinpal REST API v4 service layer
- [x] Sandbox mode in development, production in production
- [x] Payment authority stored on order (callback cross-check)
- [x] Server-side payment verification (never trust client)
- [x] Duplicate verification prevention
- [x] Stock reversion for cancelled/failed payments
- [x] Card PAN storage on successful payment
- [x] Payment result page (success/cancelled/failed)
- [x] Checkout UI with Zarinpal payment method option

### Category Management Enhancement (Session 24)
- [x] SEO fields (metaTitle, metaDescription), icon, description, sortOrder
- [x] Nested parent/child with safe deletion
- [x] Admin UI with interactive tree view, expand/collapse, search/filter
- [x] Inline CRUD form with all fields

### File Upload System (Sessions 19-20)
- [x] S3-compatible storage (Liara)
- [x] Multipart/form-data and URL-based upload
- [x] File size validation (50MB max) + MIME type validation
- [x] Reusable FileUpload drag-and-drop component with previews
- [x] Integrated into admin + supplier product forms
- [x] Image thumbnails in cart, checkout, product cards
- [x] Image lightbox gallery on product detail page

### Brand Management (Session 25 Part 1)
- [x] Brand model: name, slug, description, logo, website, isActive
- [x] Admin CRUD API + UI page + sidebar navigation
- [x] React Query hooks (admin + dropdown)
- [x] Integrated into Product model + product forms

### Tag Management (Session 25 Part 2)
- [x] Tag model: name, slug, isActive
- [x] Admin CRUD API + UI page + sidebar navigation
- [x] React Query hooks (admin + dropdown)
- [x] Chip-based multi-select in product forms
- [x] Integrated into Product model + all APIs

### Inventory Concurrency Protection (Session 26)
- [x] `stockVersion` field on Product model (optimistic lock token)
- [x] Auto-increment hooks (pre-save + pre-findOneAndUpdate)
- [x] `stockRestored` field on Order model (idempotent restoration guard)
- [x] Atomic stock reservation in checkout (Phase 1 before order creation)
- [x] Full rollback on any failure (stock + order)
- [x] Atomic claim patterns in payment verification
- [x] Idempotent stock restoration for cancelled/failed payments
- [x] Admin cancellation restoration (same pattern)
- [x] Verified: 10/10 tests pass, concurrent overselling prevented

### API Pagination (Session 27)
- [x] `/api/products` — public catalog with search/filter/sort
- [x] `/api/orders` — customer orders with status filter
- [x] `/api/admin/products` — admin product management with search resolving refs
- [x] `/api/admin/orders` — admin order management with search via User lookup
- [x] All pagination at DB level (countDocuments + find().skip().limit)
- [x] PaginationControls UI component (RTL, Persian labels, ellipsis)
- [x] 24/24 verification tests passing

### Security Hardening (Session 28)
- [x] Rate limiting on login (5 attempts/15min) and register (10 attempts/15min)
- [x] MongoDB-backed TTL rate limiter
- [x] Proper 401/403 distinction in all API routes via `requireRoleOrError`
- [x] Input sanitization for all user-controlled text fields
- [x] `npx tsc --noEmit` passes with zero errors

### Payment Retry & Cleanup (Session 30)
- [x] `POST /api/payment/retry` — retry own failed/cancelled Zarinpal payments (ownership check, retryable status gate, fresh authority, no stock change for still-pending orders, atomic re-reserve for restored orders)
- [x] «پرداخت مجدد» button on customer order detail (hidden when paid/refunded)
- [x] `src/lib/payment-cleanup.ts` — abandoned `pending_payment` (>24h `updatedAt`) → auto-cancel + `restoreOrderStock()` exactly once
- [x] `GET /api/payment/cleanup` trigger — admin-only + optional `CRON_SECRET` (Vercel Cron style)
- [x] Fixed latent Zarinpal v4 bug — `errors: []` (truthy empty array) on success made `requestPayment`/`verifyPayment` always fail
- [x] 14/14 verification tests passing (incl. concurrent-retry serialization); zero TypeScript errors; all regressions green

### Variant Polish (Session 31)
- [x] Variant-aware order display — immutable `image` snapshot on Order/SupplierOrder items + thumbnails on admin/supplier/storefront order pages (old orders render fine)
- [x] Status management verified variant-safe — supplier status changes never touch inventory; admin only restores on cancel via shared helper
- [x] Supplier variant stock quick-edit — `setVariantStock()` in shared `src/lib/inventory.ts` (atomic, stockVersion lock, summary sync, never negative) + `POST /api/supplier/products/stock` (ownership + validation) + inline «ویرایش سریع» editor on supplier products page
- [x] 14/14 verification tests passing; zero TypeScript errors; all regressions green

### Admin Refund Flow (Session 32)
- [x] `POST /api/admin/orders/refund` — admin-only; atomic claim `payment.status: paid → refunded` (double-refund impossible); refund metadata (reason/refundedAt/refundedBy); immutable `refunded` statusHistory event; reason required + sanitized
- [x] Stock restored exactly once via shared idempotent `restoreOrderStock()` (variant + simple product verified; already-restored orders don't double-restore)
- [x] `refund` subdocument on Order model + `AdminOrder.refund` type
- [x] Admin UI: «بازپرداخت سفارش» button (paid only), confirmation modal with required reason, refunded badge + reason + date, payment labels canceled/refunded, Persian timeline label
- [x] 12/12 verification tests passing; zero TypeScript errors; all regressions green

### Supplier Payout Approval System (Session 33)
- [x] Payout requests now RESERVE the amount (atomic `$expr` claim — race-safe vs over-reservation) instead of immediately debiting balance
- [x] `GET/POST /api/admin/payouts` — admin queue with atomic approve/reject claims (processed exactly once; concurrent loser → 400); approve debits balance + releases reserve; reject releases reserve + requires sanitized reason
- [x] `Transaction.status` (pending/approved/rejected) + `reviewedBy`/`reviewedAt`/`rejectionReason` audit; `Supplier.pendingReserve`
- [x] Wallet GET exposes `availableBalance`/`pendingReserve`; `totalPaidOut` counts approved only (+ legacy)
- [x] Admin /admin/payouts page + sidebar; supplier wallet shows available balance + request status badges
- [x] 17/17 verification tests passing (incl. concurrent over-reserve + concurrent double-approve); zero TypeScript errors; all regressions green

### Customer Reviews & Ratings (Session 34)
- [x] `Review` model — one review per purchased ORDER-ITEM (unique `{customer, product, order}`), immutable itemSnapshot audit, moderation fields (reviewedBy/reviewedAt/rejectionReason)
- [x] Verified-purchase gate — DELIVERED order required (not merely paid) → 403 otherwise
- [x] `GET /api/reviews` (public approved-only + ratingSummary), `POST /api/reviews` (customer, rate-limited, sanitized), `GET /api/reviews/mine` (eligible orders + my reviews)
- [x] `GET /api/admin/reviews` queue + `POST /api/admin/reviews/[id]/moderate` (atomic claim, reason required for reject)
- [x] Storefront ReviewsSection (summary + approved list + gated form) + `ProductJsonLd` aggregateRating (approved-only SEO sync); `ratingSummary` on `GET /api/products?slug=`
- [x] Admin /admin/reviews moderation page + sidebar «دیدگاه‌ها»
- [x] 20/20 verification tests passing; zero TypeScript errors; all regressions green

### Customer Wishlist (Session 35)
- [x] `Wishlist` model — unique `{user, product}` (atomic dedupe), timestamps, optional `variantId`/`variantSnapshot` (future-proof)
- [x] `GET /api/wishlist` (customer-only, paginated; two-query approach — deleted products kept as `product: null` placeholders, inactive surfaced with `isActive: false`), `POST`/`DELETE` idempotent + rate-limited, `GET /api/wishlist/ids` → `{ ids, count }`
- [x] Storefront: heart on product cards + detail page (guest → login), `/wishlist` page with pagination + unavailable placeholders + empty state, header heart badge
- [x] 14/14 verification tests passing; zero TypeScript errors; all regressions green

### Supplier Review Replies (Session 37)
- [x] `Review.supplier` (denormalized at creation; invariant documented) + single `reply` subdocument `{author, text, at}` (`_id: false`, `default: null` — typed subdoc so the atomic `reply: null` claim works) + index `{supplier, status, createdAt}`; `Notification.type` gained `review_replied`
- [x] `GET /api/supplier/reviews` — supplier-only queue (supplier from token, scoped via `Review.supplier`, populated customer/product/reply.author, status filter + pagination)
- [x] `POST /api/supplier/reviews/[id]/reply` — ownership via `Review.product → Product.supplier` (404 no-leak), approved-only 400, atomic single-reply claim (double-reply 400), sanitize + rate-limit, `review_replied` notification via fail-silent `safeNotifyOrderEvent()`
- [x] Supplier reply-queue page + sidebar «پاسخ به دیدگاه‌ها»; storefront renders «پاسخ فروشنده» under approved reviews; admin reviews show a read-only reply line
- [x] Public `GET /api/reviews` backward compatible (additive `reply` field); 21/21 verification tests passing; zero TypeScript errors; all regressions green

### Real-time Notifications — SSE (Session 40)
- [x] `GET /api/notifications/stream` — SSE endpoint (authenticated + owner-scoped, connection cap → 429, `: connected` flush, 15s `: ping` heartbeat, unified cleanup on abort + cancel)
- [x] `src/lib/notification-stream.ts` — in-memory subscriber registry on **globalThis** (mirrors `dbConnect.js` singleton; fixes Next dev module duplication that split subscribe from publish)
- [x] `notifyOrderEvent()` publishes AFTER the DB write commits — fail-silent, dedupe never re-pushes; `notifyOrderEvent()` remains the ONLY notification facade
- [x] `useNotificationStream()` in the bell (storefront + supplier headers) invalidates React Query notification keys; 30s polling fallback untouched
- [x] 11/11 verification tests (401, connect, live delivery, customer isolation, supplier isolation, disconnect/reconnect, heartbeat); zero TS errors; full regression green; no business-logic or model changes

### Wishlist → Cart Bulk Move (Session 38)
- [x] `POST /api/wishlist/add-to-cart` — customer-only resolver (auth → payload validation → rate limit → DB resolution): optional `productIds` (missing/empty = ALL rows; provided = only owned matching rows — foreign ids silently ignored, **no IDOR**); dedicated `wishlist-cart` rate-limiter key (10/15min)
- [x] Fresh DB resolution with NO stock reservation — checkout keeps exclusive inventory authority; fresh prices minimize (never bypass) checkout's price-revalidation 409s; skipped reasons: `deleted` / `inactive` / `out_of_stock` / `no_available_variant`
- [x] Variant products resolve to the first ACTIVE in-stock variant (prefers future row `variantId`); response carries extensible `variant` metadata
- [x] Keep-in-wishlist design — resolver never modifies wishlist rows; client `addItem` merge is idempotent (composite-key dedupe, qty clamped to `maxQuantity`)
- [x] Storefront «افزودن همه به سبد» button (disabled when list empty), all/partial/nothing toasts, opens the cart drawer; `useAddWishlistToCart` hook; `WishlistCartAddItem`/`WishlistCartAddResult`/`WishlistCartSkippedReason` types
- [x] 18/18 verification tests passing (incl. real-store cart-merge tests: existing item merge, qty increment, maxQuantity cap, no duplicate composite keys); zero TypeScript errors; all regressions green; zero changes to checkout/inventory/payment/cart-store

### Attributes & Product Variants (Session 29)
- [x] Attribute model + admin CRUD API + admin UI + hooks
- [x] Embedded `variants[]` in Product with per-variant stockVersion
- [x] Global sparse unique index on `variants.sku`
- [x] Shared `src/lib/inventory.ts` — variant-aware atomic reserve/restore (single source of truth)
- [x] `validateVariants` / `prepareVariantsForSave` / `recomputeVariantSummary` helpers
- [x] Admin + supplier product APIs + VariantBuilder form component
- [x] Storefront variant selector (price/stock/images/SKU, unavailable-combo disabling)
- [x] Cart + checkout with variantId (composite dedupe, atomic reservation, correct rollback)
- [x] Payment verify + admin cancel use shared restoreOrderStock
- [x] Immutable variantId/sku/variantLabel snapshots in Order + SupplierOrder
- [x] 16/16 verification tests passing, zero TypeScript errors
- [x] **E2E verified against the real HTTP API** — `scripts/verify-variants-e2e.js` (32/32 passing: real login, SKU 409/E11000, concurrent checkout race, restore-once, authz)
- [x] **Fixed storefront crash** — `Rendered more hooks than during the previous render` in product detail page (hooks after early returns) + browser-verified variant selector

---

## ✅ Completed Milestones

### Search Suggestions / Autocomplete (Session 49)
- [x] `GET /api/search/suggest?q=<prefix>` — public endpoint, IP rate-limited (30/15min), returns up to 10 matching product names + brand names (active only, prefix match, case-insensitive, product names before brand names, deduped, min 2 chars)
- [x] `useSearchSuggestions` React Query hook (enabled at 2+ chars, 5min staleTime)
- [x] `<SearchSuggestions>` dropdown component (click-away-to-close, loading/error/empty states, `onMouseDown` for reliable selection before blur)
- [x] Wired into the products catalog search input (`onChange`/`onFocus` opens, `Escape`/clear/select closes)
- [x] `scripts/verify-search-suggest.js` — **10/10 PASS**; `npx tsc --noEmit` zero errors; full regression **28/28 PASS**
- [x] **No model/schema/index changes → no dev-server restart needed**

### Homepage UX Redesign (Session 50)
- [x] Homepage entry `src/app/page.tsx` **kept** (no route-group move) but rebuilt as a thin **server component** composing self-contained sections — Hero Carousel → Quick Categories → Campaign Banner → Special Picks → Newest Products → Premium Collection → Popular Brands → Gift Collections → Trust Badges → shared Footer
- [x] `src/lib/homepage-config.ts` — static typed config (hero slides ×3, campaign banner, gift collections ×3; gradient art, no backend, no fake data)
- [x] `src/components/storefront/home/*` — 12 new components (hero-carousel fade/RTL-safe/auto-advance, quick-categories grid↔scroll-snap, campaign-banner, special-picks **countdown + value rail — real prices only**, newest-products, premium-collection, popular-brands initial tiles, gift-collections, trust-badges, section-header, product-rail native scroll-snap + mobile arrows, lazy-section IntersectionObserver)
- [x] **One shared product-pool query** (`sort=newest, limit 36`) feeds all three product rails (React Query key dedup — no duplicate requests); `useCountdown` hydration-safe
- [x] Header/footer extracted to shared `StorefrontHeader` (+ **additive header search reusing Session 49 suggestions**) and `StorefrontFooter`; storefront layout now a server component
- [x] Additive one-time URL seed in `useCatalogFilters` — homepage category/brand tiles + header search pre-filter `/products`; no params → behavior unchanged
- [x] Zero API/model/schema/index changes, zero new dependencies; `npx tsc --noEmit` zero errors; full regression **28/28 PASS**; browser QA desktop + mobile clean; code review approved; **no dev-server restart needed**

### Bulk Product CSV Import/Export (Session 51)
- [x] **4 additive endpoints** — `POST /api/admin/products/import` + `POST /api/supplier/products/import` (RBAC, payload-validated-BEFORE rate limit `product-import:<userId>` 20/15min, byte cap 500KB, row cap 1000) and `GET /api/admin/products/export` + `GET /api/supplier/products/export` (CSV download, supplier ownership-scoped)
- [x] `src/lib/product-csv.ts` — server-authoritative parse (`csv-parse`) + serialize (`csv-stringify`), Persian/Arabic digit normalization, formula-injection escaping, UTF-8 BOM; `src/lib/product-csv-constants.ts` (12-column header, limits); `src/lib/product-import.ts` — name-based ref resolution, existing-slug pre-scan, **sequential per-row `Product.create` on the hardened sanitize+validator path**
- [x] **Create-only v1** — duplicate slug in-file or in-DB → skipped + reported (never overwritten); per-row atomicity; supplier ownership auto-set on the supplier route
- [x] Import UI (`ProductCsvImport`: file pick, «دانلود قالب» template, column guide, per-row report) on `/admin/products/import` + `/supplier/products/import`; «ورود انبوه»/«خروجی CSV» buttons on both products pages; sidebar entries; `use-product-import-export.ts` (key-factory invalidation); types `ProductImportReport`/`ProductImportRowResult`/`ProductImportRowStatus`
- [x] **Zero existing-API/schema/model/index/migration changes** — the import path never calls the existing product POST/PUT; new deps `csv-parse` + `csv-stringify` only; `npx tsc --noEmit` zero errors; `verify-product-import-export.js` **22/22**; full regression **29/29 PASS**; code review approved (2 rounds); **no dev-server restart needed**

## ✅ Session 52 — Mobile Dashboard Navigation Fix + Regression Runner Hermeticity

- [x] **Mobile nav bug (both dashboards):** the `Menu` button toggled `isSidebarOpen` but no component consumed it (sidebars `hidden lg:flex`, zero drawer components anywhere) → no visual effect on mobile; admins/suppliers couldn't reach dashboard sections.
- [x] `src/components/layout/mobile-drawer.tsx` — one reusable store-driven drawer (overlay + slide-in panel, `lg:hidden`, closes on overlay/close-button/Escape, body-scroll lock, `aria-modal`; **plain `ReactNode` children** — render-prop broke the RSC→client boundary, caught by browser QA) wired into **both** admin + supplier layouts; sidebars gained additive `variant` (`desktop`|`mobile`) and close the drawer via the store on nav click (desktop byte-identical).
- [x] **Regression runner hermeticity:** the shared login rate-limiter keys (`login:<phone>` 10/15min, `login_ip:<ip>` 30/15min) accumulate across the 29 sequential suites and caused mid-run 401s — `scripts/run-regression.js` now clears those keys before EACH suite (same env/dbName convention; fail-safe warn; **production limiter untouched**).
- [x] Zero API/schema/model/index changes; `npx tsc --noEmit` zero errors; `node --check` clean; code review approved; **full regression 29/29 PASS**; browser QA mobile drawer green (opened/closed/navigated, no console errors); **no dev-server restart needed**.

## ✅ Homepage CMS (Session 53)
- [x] **Two-tier model:** `HomepageSection` (Tier 1 composition — immutable `slug`/`component`, `enabled`, `sortOrder`, grouped `presentation {appearance, behavior}`; soft-delete) + four Tier-2 content models (`HomepageHeroSlide`/`HomepageCampaignBanner`/`HomepageGiftCollection`/`HomepageTrustBadge`) bound by `sectionSlug` with `sortOrder`/`isActive`/`status` (draft|published)/`publishedAt`/soft-delete — **model change ⇒ dev-server restart required**
- [x] **Block registry** `src/lib/homepage-sections/registry.ts` — server-only `component` → renderer + content resolver adapter (DB isolated behind adapters); unknown component skipped fail-safe; adding a block = one entry
- [x] **Seed + graceful static fallback** `src/lib/homepage-content.ts` — `DEFAULT_SECTIONS` (9 sections) seeds empty DB + idempotent migration from `homepage-config.ts`; public reader `getHomepageComposition()` (enabled + non-deleted in `sortOrder`, published+active+non-deleted rows, **strict projection**, unknown skipped) falls back to the static config when the CMS is un-bootstrapped
- [x] **Admin API** — sections route (GET seeds/list, POST/PUT/DELETE, slug/component immutable) + `createContentRouteHandlers` factory behind 4 thin content routes (admin-only RBAC, per-type validation, soft-delete, `publishedAt` stamping); **public** `GET /api/homepage` (no auth, same strict-projection shape)
- [x] **Storefront** — `src/app/page.tsx` thin async server component rendering through the registry; all 9 Session 50 renderers take `HomepageSectionRendererProps` (content-bearing read `section.content`, data-driven read `presentation.behavior`); lazy-mount preserved
- [x] **Admin UI** `/admin/homepage` — tabs (sections + 4 content editors), section-scope picker, S3 image upload via existing `/api/upload`, «صفحه اصلی» sidebar entry; hooks `use-admin-homepage.ts` + types
- [x] **Invariants** — zero existing-API/schema/index changes, zero new dependencies, `homepage-config.ts` retained as seed/fallback source
- [x] `scripts/verify-homepage-cms.js` — **14/14 PASS** (real API + real DB; incl. malformed ObjectId → 400); `npx tsc --noEmit` zero errors; build passes; code review approved; regression runner → **30 suites**; dev server restarted (fresh boot, `/api/homepage` live)

## 🚀 Next Milestone

### Best-Sellers Rail ✅ (completed as Session 56)

**Approved milestone order (user decision):** Session 52 = mobile dashboard nav fix ✅; **Session 53 = Homepage CMS ✅**; **Session 55 = Private / Targeted Coupons ✅**; **Session 56 = best-sellers rail ✅** — the ROADMAP's original plan ("client-side, reuse the newest pool") was rejected because the pool carried **no sales data** (would have been a fake ranking, violating the Session 50 no-fake-data invariant); the approved denormalized `Product.soldCount` approach delivers a real, paid-only ranking. Deferred: scoped/free-shipping coupons (touch the hardened checkout price path; no shipping-fee model).

### Session 60 ✅ — CI/CD Pipeline (GitHub Actions)
> **Completed.** Merge-gating `ci.yml` (static + unit + hermetic-secretless e2e) + optional non-gating nightly `regression.yml` (33 real-API suites, secrets-driven, self-skipping). Zero `src/` changes. See the completed milestone above + CHANGELOG.

### Session 61 ✅ — Performance & Accessibility (next/image + axe-core)
> **Completed.** Storefront fully on `next/image` (12 components / 17 images + env-derived `images.remotePatterns`), accessibility audit fixes, and an axe-core E2E gate (Journey 11) running inside the existing CI e2e job. Zero business-logic changes. See the completed milestone above + CHANGELOG.

### Session 62 — Candidate (pick one)
> **Session 61 closed the perf/a11y tranche's front-end half.** Candidates for the next session:
- **Production Readiness (next tranche):** Core Web Vitals + Lighthouse CI gate, Playwright journey expansion (admin product CRUD, supplier products, SSE/notifications — uploads stay API-level: browser file choosers aren't automatable), Deployment (Vercel/Docker), Monitoring (Sentry).
- **Growth features:** SMS/OTP authentication (replaces the password login — touches NextAuth/middleware/RBAC + the E2E login journeys), admin real charts (recharts), customer email/SMS order notifications, customer segments → first-purchase / birthday / spending coupons via the Session 55 `eligibility` seam.

---

## 🚀 Future Milestones

### Milestone 15: Production Readiness
- [x] Performance optimization — storefront `next/image` migration + env-derived remotePatterns (Session 61); **Core Web Vitals tuning + Lighthouse CI gate remain**
- [x] Accessibility audit and fixes — axe-core E2E gate over the 6 highest-traffic public pages (Session 61); admin-area native `<img>` conversion + the keyboard-nav listbox upgrade remain (see PERFORMANCE.md)
- [x] Unit tests (Vitest — 152 hermetic tests, Session 58; Testing Library component tests remaining)
- [x] E2E tests (Playwright — 22 tests / 11 journeys incl. the axe accessibility journey, Session 59 + 61)
- [x] CI/CD pipeline (GitHub Actions — `ci.yml` merge gates, Session 60; optional nightly `regression.yml` needs the real-sandbox secrets)
- [ ] Deployment to production (Vercel, Docker)
- [ ] Monitoring and error tracking (Sentry)

### Milestone 15: Growth Features
- [ ] SMS/OTP authentication
- [ ] Real-time notifications (WebSocket/SSE)
- [ ] Multi-language support (i18n with next-intl)
- [ ] Admin dashboard with real charts (recharts)
- [ ] Marketing features (discounts, coupons, promo codes)
- [ ] Customer support (ticket system)
- [ ] Mobile app (PWA or React Native)
- [ ] SEO and social media integration
