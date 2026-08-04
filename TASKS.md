# Tasks - فروشگاه من (Online Store)

---

## ✅ Session 56 — Best-Sellers Rail (Product.soldCount)

### Model + counter (additive)
- [x] `Product.js` — `soldCount` (Number, default 0, min 0) + index `{ soldCount: -1, createdAt: -1 }`; **ops:** model change ⇒ dev-server restart required (done)
- [x] `src/lib/product-sales.ts` — `recordOrderSales` / `reverseOrderSales` (pipeline updates, `$max` floor, fail-silent, bypasses stock/stockVersion)
- [x] Exactly-once: increment after payment-verify `pending→paid`; decrement after refund `paid→refunded` AND admin cancel of a PAID order; pending cancels skipped
- [x] `soldCount` INTERNAL — `-soldCount` projection on all three public `/api/products` paths (list/detail/ranked); leak-scan verified; product write routes whitelist-only
- [x] Additive `sort=best_selling` (`{ soldCount: -1, createdAt: -1 }`)

### CMS + storefront
- [x] `best-sellers.tsx` renderer (own query `usePublicProducts({ sort: "best_selling", limit })` → ProductRail) + registry entry (lazy)
- [x] `DEFAULT_SECTIONS` best-sellers entry after `special-picks` + `HOMEPAGE_COMPONENTS`; seed upgraded to insert-missing defaults (soft-delete-aware)
- [x] «پرفروشترین» dropdown option + `useCatalogFilters` whitelist; `AdminProduct.soldCount?` type
- [x] `use-catalog-filters.ts` pre-existing lint debt fixed (render-phase adjustment + justified block-disable for the intentional URL-seed effect)

### Scripts + verification
- [x] `scripts/verify-best-sellers.js` — **13/13 PASS** (ranking + tie-break, leak scans ×2, refund reversal simple + variant, double-refund 400, legacy floor, pending never counts, admin-cancel paid/pending, cash checkout never increments, CMS block)
- [x] `scripts/backfill-sold-count.js` — OPTIONAL re-runnable backfill (paid + non-cancelled → `$set`); NOT in the regression runner
- [x] `scripts/run-regression.js` — 32 suites; full regression **32/32 PASS, 0 skipped**; tsc zero errors; lint clean; production build passes; code review approved
- [x] Known/accepted: payment-verify increment not directly HTTP-testable (sandbox verify needs the interactive page) — covered by verify-payment-retry's claim + reversal-math tests; crash-window recoverable via backfill; **variant-level sales = future scope**

---

## ✅ Session 55 — Private / Targeted Coupons (Coupon Eligibility)

### Model (additive, zero migration)
- [x] `Coupon.js` — `eligibility { mode: "public" | "assigned_users" | "user_groups", assignedUsers: [ObjectId refs], groups: [String] }`; missing/empty block = public (existing coupons unchanged)
- [x] Multikey indexes `eligibility.assignedUsers` + `eligibility.groups` — list/admin lookups only, never the claim hot path
- [x] **Ops:** model change ⇒ dev-server restart required (done)

### Enforcement (single source of truth in `src/lib/coupons.ts`)
- [x] `getCouponEligibility` — missing/invalid → public (fail-safe)
- [x] `isUserEligibleForCoupon` — pure JS membership on the fetched lean doc (zero extra DB queries on checkout)
- [x] `userGroupsOf()` — NOT implemented → returns `[]` ⇒ group coupons **fail-closed** for everyone
- [x] `parseCouponEligibility` — mode whitelist, ObjectId guards → 400, dedupe, caps (1000 users / 50 groups / 32-char slugs), lowercase group slugs, sanitize
- [x] `claimCouponForOrder` — approved flow: usage-limit pre-check → eligibility (distinct error «این کد تخفیف برای شما قابل استفاده نیست») → minSubtotal → atomic claim; all Session 39 claim/release invariants preserved
- [x] `validateCoupon(rawCode, userId?)` — eligibility-aware preview (non-eligible → eligibility error, never «invalid coupon»)

### APIs (additive, RBAC unchanged)
- [x] Admin POST `/api/admin/coupons` accepts `eligibility`; GET populates `eligibility.assignedUsers` (name/phone)
- [x] Admin PUT `/api/admin/coupons/[id]` accepts `eligibility` (whole-block replace)
- [x] `POST /api/coupons/validate` passes the authenticated user id
- [x] `GET /api/admin/users` — additive `search` param (name/phone, escapeRegex) for the picker
- [x] `GET /api/coupons/public` untouched — leak scan extended to assert eligibility fields never exposed

### Admin UI
- [x] «مخاطب کد تخفیف» mode segmented control (عمومی / کاربران منتخب / گروه کاربری)
- [x] Debounced user picker (`useCustomerSearch` → `GET /api/admin/users?role=customer&search=`), selected chips + remove, ≤50 results
- [x] Groups comma-input (lowercased) + fail-closed hint; list badges (کاربران منتخب (n) / گروه‌ها)
- [x] Client guards: assigned_users ≥1 user, user_groups ≥1 group

### Verification
- [x] `scripts/verify-coupon-eligibility.js` — **18/18 PASS** (authz, invalid payloads, single/multi assigned create, groups lowercase, populated GET, validate both directions, non-assigned checkout no-order/no-claim, assigned checkout exact discount, fail-closed groups, public backward-compat, PUT reassign, public leak scan); self-cleaning (all PREFIX'd fixtures + its couponusage rows)
- [x] `scripts/run-regression.js` — 31 suites, `verify-coupon-eligibility` after `verify-coupons-marketing`; full regression **31/31 PASS**, 0 skipped
- [x] Existing suites unchanged: `verify-coupons` 27/27, `verify-coupons-marketing` 12/12
- [x] `npx tsc --noEmit` zero errors; eslint clean on all changed files; production build passes; code review approved (all reviewer findings addressed)

---

## ✅ Session 44 — Coupon Marketing Surface

### Model + admin (additive)
- [x] `Coupon.js` — `isPublic` (Boolean, default `false`); no migration, no index changes (legacy coupons = private)
- [x] Admin POST/PUT accept `isPublic` with strict `body.isPublic === true` (string "false" can never publish)
- [x] Admin coupons page — `isPublic` toggle switch in the form + «عمومی» success badge in the list

### Public API (dedicated, read-only)
- [x] `GET /api/coupons/public` — no auth; filter `isPublic:true` + `isActive:true` + in-window (same semantics as `isCouponUsable()`); `createdAt` desc; Session 27 pagination
- [x] **STRICT projection** `.select("code type value minSubtotal maxDiscount endsAt")` — usageLimit/perUserLimit/usedCount/startsAt/isActive/isPublic never exposed
- [x] **IP-keyed rate limit** `coupons:public:<ip>` (60/15min, x-forwarded-for fallback — register precedent)
- [x] `src/lib/coupons.ts` (validate/claim/release) byte-for-byte untouched — checkout money path unchanged

### Storefront + checkout
- [x] Public «کدهای تخفیف» page — RTL, coupon cards (code/value/min-subtotal/expiry), copy-to-clipboard + toast, skeleton/error/empty states; no title/description fields added
- [x] Storefront nav «کدهای تخفیف» entry
- [x] Checkout `PublicCouponPicker` — lists only public coupons (hidden when total=0), pre-fills the input; submission goes through the UNTOUCHED validate → claim flow
- [x] `use-public-coupons.ts` (staleTime 5min) + `PublicCoupon`/`PublicCouponsResponse` types

### Verification
- [x] `scripts/verify-coupons-marketing.js` — **12/12 PASS** (no-auth 200, isPublic persist, private hidden, raw-JSON leak scan, inactive/out-of-window hidden, pagination, toggle off/on, public-coupon checkout exact 10% discount, private still valid but hidden); **must run LAST** (wipes couponusages/ratelimits)
- [x] `scripts/run-regression.js` — NEW sequential runner (fetch pre-flight, 21 suites, PASS/SKIP/FAIL, exit 1/2/0)
- [x] `npx tsc --noEmit` zero errors; full regression green across **21 suites** (sequential, Skipped: 0)
- [x] Reviewer fixes: Button success-variant TS2322 → conditional className; public endpoint IP rate limit; admin PUT strict isPublic; runner nits
- [x] **Ops:** Coupon model change ⇒ dev-server restart required (Mongoose model cache)

---

## ✅ Session 43 — Variant-Level Wishlist

### Index migration (data-first)
- [x] `scripts/migrate-wishlist-index.js` — consistency checks (duplicate `(user, product)` scan + every `variantId` references a real ACTIVE variant) → drop old unique `{user, product}` → create `{user, product, variantId}`; abort (no change) on any failure; collision-safe (all legacy rows have `variantId: null`)

### Model + API
- [x] `src/models/Wishlist.js` — unique index `{user, product}` → `{user, product, variantId}`; product-level rows (variantId null) + variant-level rows (variantId + `variantSnapshot {sku, label}`) coexist; stale comment cleaned
- [x] `POST /api/wishlist { productId, variantId? }` — variantId validated as belonging to the product AND active (malformed/foreign/unknown/inactive → 400; variantId on simple product → 400); **no silent default-variant fallback**; `variantSnapshot` denormalized; idempotent via the unique index
- [x] `GET /api/wishlist` — returns `variantId` + `variantSnapshot` (null on product-level rows; matches `WishlistItem` type)
- [x] `DELETE /api/wishlist` — with `variantId` removes exactly that variant row; without removes ALL rows for the product
- [x] `GET /api/wishlist/ids` — deduped product ids + count = TOTAL rows (variant rows included)

### Client
- [x] `use-wishlist.ts` — variant-aware toggle (variantId pass-through; optimistic cache keeps product id on variant-remove, drops on remove-all)
- [x] Product detail heart — **saves the SELECTED variant** (`variantId: activeVariant?._id`); REMOVE uses remove-all rows (product-level toggle)
- [x] Wishlist page — variant rows render an in-flow strip below the card (saved label + SKU); placeholder removal passes variantId

### Regression + verification
- [x] Session 38 resolver **untouched** (locked decision) — variant-preference regression-proven (saved variant B over first in-stock A; product-level row falls back to A)
- [x] `scripts/verify-variant-wishlist.js` — **19/19 PASS** (coexistence, validation 400s, field contract, ids dedup, DELETE semantics, resolver regression, isolation)
- [x] `npx tsc --noEmit` zero errors; full regression green across all **20 suites** (sequential)
- [x] Ops: index migration + model change ⇒ dev-server restart required (Mongoose model cache)

---

## ✅ Session 42 — Supplier Storefront Pages

### Public API (read-only, strict projection whitelist)
- [x] `GET /api/suppliers` — public, active-only, paginated; rows `{_id, businessName, logo, description, productCount}`; `productCount` via aggregate with storefront visibility rules (isActive + stock>0)
- [x] `GET /api/suppliers/[id]` — public detail; ObjectId guard → 404; inactive → 404; exact whitelist key-set
- [x] **STRICT projection whitelist** — only `_id businessName logo description` ever public; `user/contactPhone/bankAccount/telegramChatId/balance/pendingReserve` never selected
- [x] Additive `supplier=` filter on `GET /api/products` (ObjectId-validated → 404); populate `_id businessName logo`

### Model + settings (additive, backward compatible)
- [x] `Supplier.js` — `logo` + `description` (String, default "", trim, maxlength 500); no migration, no index changes
- [x] `PUT /api/supplier/settings` — accepts `telegramChatId`/`logo`/`description` (trim + 500 caps, empty body 400); telegramChatId unchanged

### Storefront + supplier UI
- [x] `/suppliers` listing page + `supplier-card` component (logo error fallback)
- [x] `/suppliers/[id]` detail page — storefront header card + supplier-filtered product grid (limit 12) + pagination
- [x] Product-card + product-detail supplier name → `/suppliers/[id]` links
- [x] Supplier wallet «پروفایل عمومی فروشگاه» card (logo + description, dirty-tracked save/cancel, useEffect sync)
- [x] `sitemap.ts` — dynamic `/suppliers/[id]` entries (fail-silent on DB errors)

### Hooks / types
- [x] `use-public-suppliers.ts` (`usePublicSuppliers`/`usePublicSupplier`) + `use-public-products.ts` supplier param
- [x] `use-supplier-settings.ts` — `useUpdatePublicProfile` mutation; `SupplierSettings.logo?/description?`
- [x] `src/types/index.ts` — `PublicSupplier`

### Verification
- [x] `scripts/verify-suppliers.js` — 20 tests against the real HTTP API (raw-JSON leak scan, whitelist key-set, inactive/malformed 404, productCount semantics, supplier filter, settings PUT trim/cap/isolation/403/empty-body, pagination)
- [x] **20/20 PASS**; `npx tsc --noEmit` zero errors; full regression green (19 suites, sequential)
- [x] Code-reviewer approved (4 rounds). Bugs fixed: missing `Store` import (tsc), lean-typing cast in `[id]` route, `SupplierFilters` index signature, broken-logo fallback, verify-script shared-user fixture bug
- [x] **Ops:** dev-server restart required after the Supplier model change (Mongoose model cache)

---

## ✅ Session 41 — Admin Analytics & Reporting

### API (read-only)
- [x] `GET /api/admin/analytics?range=7|30|90` (default 30) — admin-only via `requireRoleOrError(["admin"])` (401/403); invalid range → 400; `dynamic=force-dynamic`
- [x] **Pure read-only** — only `aggregate` + `countDocuments`, never writes; zero DB schema changes; zero business-logic files touched
- [x] `summary` — revenue/orders (cancelled excluded), avgOrderValue, couponSavings, newCustomers
- [x] `timeSeries` — per-UTC-day buckets, zero-filled via `buildSeries` (no gaps; matches `$dateToString` UTC bucketing)
- [x] `topProducts` (top 10) + `topCategories` (top 10 via Product → Category `$lookup`; deleted refs → «نامشخص»)
- [x] `couponStats` — total/active/totalUses (from `Coupon.usedCount`) + **UNBOUNDED** in-window `discountedOrders`/`totalDiscount` (shared `DISCOUNT_MATCH`; never capped by the top-5 display list) + `topCoupons` (top 5)
- [x] `supplierStats` — all-time ledger: earnings (`order_credit`), paidOut (approved), pending payouts, outstandingBalance + pendingReserve
- [x] `ordersByStatus` — status funnel (incl. cancelled) with Persian labels

### Client
- [x] `useAdminAnalytics(range)` hook (staleTime 30s; range in query key)
- [x] `/admin/analytics` page — range selector (۷/۳۰/۹۰ روز), summary stat cards, **hand-rolled SVG revenue chart** (no chart dependency), ranked top products/categories rows, coupon stats card, supplier payouts card, status funnel; skeletons/error/empty states
- [x] Admin sidebar «گزارش‌ها» nav entry (BarChart3 icon)
- [x] Types: `AdminAnalytics`, `AnalyticsTimePoint`, `AnalyticsTopRow`, `AnalyticsCouponStats`, `AnalyticsSupplierStats`, `AnalyticsOrderStatusRow`

### Verification
- [x] Created `scripts/verify-analytics.js` — 16 tests against the real HTTP API with a **baseline→seed→delta** design (robust to pre-existing shared-DB data)
- [x] **16/16 PASS** (401/403/200, invalid range 400, read-only guarantee, time-series deltas incl. cancelled exclusion + 60-day invisibility, top products/categories, coupon deltas, supplier deltas)
- [x] `npx tsc --noEmit` zero errors; full regression green across all 16 suites (sequential runs)
- [x] Code-reviewer approved (4 rounds). Bugs fixed: unbounded coupon metrics (top-5 cap), **critical Promise.all/destructure misalignment** (500s; rewritten with exactly 13/13 bindings), test-fixture fixes (users before login, item name = product name, delta assertions), unused `Badge` import removed
- [x] No model changes, no business-logic files modified, no dev-server restart needed

---

## ✅ Session 40 — Real-time Notifications (SSE)

### Server
- [x] `src/lib/notification-stream.ts` — in-memory registry on **globalThis** (`__notificationStreamRegistry`, mirrors `global.mongoose`): `subscribeToUserStream` / `publishToUserStream` (fail-silent, snapshot + prune) / `countUserConnections` / `MAX_CONNECTIONS_PER_USER=5` / `STREAM_HEARTBEAT_MS=15s`. Transport layer ONLY — `notifyOrderEvent()` stays the single facade.
- [x] `GET /api/notifications/stream` — SSE: `requireAuth` (401) → cap (429) → `ReadableStream` + `text/event-stream` + `dynamic=force-dynamic`; `: connected` flush; 15s `: ping` heartbeat; **unified idempotent `cleanup()`** on abort AND cancel (no interval/subscription leak).
- [x] `notifyOrderEvent()` publishes AFTER the Notification DB write commits (source of truth); E11000 dedupe returns early (no re-push); publish try/catch — fail-silent, never affects business flows.
- [x] `NotificationStreamEvent` type in `src/types/index.ts`.

### Client
- [x] `useNotificationStream()` — EventSource per authenticated session; invalidates `notificationKeys.all` on events; `onopen` resets failures; tracked 5s retry cleared on unmount; gives up after 10 failures → 30s polling fallback intact.
- [x] `NotificationBell` mounts the stream (storefront + supplier headers) → instant badge updates; `useUnreadCount` 30s refetch untouched.

### Verification
- [x] `scripts/verify-sse.js` — **11/11 PASS** (401, connect + `:connected`, live delivery after real notification creation, customer isolation, supplier isolation, disconnect/reconnect, heartbeat).
- [x] `npx tsc --noEmit` zero errors; regressions green (notifications 18/18, supplier-replies 21/21, coupons 27/27, wishlist-cart 18/18, payouts 17/17, reviews 20/20, wishlist 14/14, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15, variants-e2e 32/32, upload-formats 9/9, concurrency 10/10).
- [x] Code-reviewer approved (3 rounds); follow-ups applied (unified cleanup, retry cap, onopen reset).
- [x] No checkout/payment/inventory/coupon/wishlist/order files modified. No model changes → no dev-server restart needed.

---

## ✅ Session 38 — Wishlist → Cart Bulk Move

### API-assisted resolver
- [x] `POST /api/wishlist/add-to-cart` — customer-only; validation order auth → payload → rate limit (10/15min, key `wishlist-cart:<userId>`) → DB resolution
- [x] `productIds` optional — missing/empty = ALL rows; provided = owned rows only (`{ user: token.id, product: { $in } }`) → foreign ids ignored (no IDOR)
- [x] Fresh-DB resolution: deleted → `deleted`; inactive → `inactive`; simple OOS → `out_of_stock`; variant → first ACTIVE in-stock variant (prefers future row.variantId) else `no_available_variant`
- [x] Response `{ added, addedCount, skipped, skippedCount }` with extensible `variant` metadata block
- [x] Resolver NEVER reserves stock; wishlist rows NEVER modified; checkout remains the source of truth

### Client / hooks / types
- [x] `useAddWishlistToCart` hook (undefined → all rows)
- [x] Wishlist page «افزودن همه به سبد» button (disabled when `isLoading || !data || data.total === 0`), addItem merge, toasts (all/partial/none), cart drawer opens
- [x] Types: `WishlistCartSkippedReason`, `WishlistCartAddItem`, `WishlistCartAddResult`

### Verification
- [x] Created `scripts/verify-wishlist-cart.js` — 18 tests against the real HTTP API + real zustand cart store
- [x] **18/18 PASS**; `npx tsc --noEmit` zero errors; regressions green (wishlist 14/14, reviews 20/20, notifications 18/18, supplier-replies 21/21, refund 12/12, payouts 17/17, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- [x] Bugs fixed: temp cart-store file inside project (require('zustand') resolution), rate-limit deletes target `_id: "rl:<key>"`; environmental Zarinpal 502s fixed by dev-server restart

---

## ✅ Session 37 — Supplier Review Replies

### Review Model (additive)
- [x] `Review.supplier` ref — denormalized from `product.supplier` at creation (stable ownership snapshot; invariant documented in the model)
- [x] Single `reply` subdocument `{ author (User ref), text, at }` — `_id: false` + `default: null` (typed subdoc; inline would auto-populate and break the atomic claim)
- [x] Index `{ supplier, status, createdAt: -1 }` for the supplier reply queue
- [x] `Notification.type` enum gained `review_replied`

### API
- [x] `GET /api/supplier/reviews?status=&page=&limit=` — supplier-only queue: supplier from `token.id`, scoped via `Review.supplier`, populated customer/product/reply.author, paginated (Session 27 shape)
- [x] `POST /api/supplier/reviews/[id]/reply` — `{ text }`: ObjectId 400 → supplier 404 → text validated before rate limiter (30/15min) → sanitize → review 404 → ownership via `Product.findOne({ _id, supplier })` (404, no leak) → approved-only 400 → atomic claim `{_id, status:"approved", reply:null}` (double-reply 400) → `review_replied` notification via local `safeNotifyOrderEvent()`
- [x] `GET /api/reviews` populates `reply.author` (backward compatible); `POST /api/reviews` stores denormalized `supplier`

### UI / hooks / types
- [x] `src/app/supplier/reviews/page.tsx` — reply queue: status tabs, review cards, inline reply box, replied badge
- [x] `use-supplier-reviews.ts` — `useSupplierReviews(page, status)` + `useReplyToReview` (invalidates `["supplier-reviews"]`)
- [x] Supplier sidebar «پاسخ به دیدگاه‌ها» (MessageSquareText icon)
- [x] Storefront `reviews-section.tsx` renders «پاسخ فروشنده» (bordered block) under approved reviews
- [x] Admin reviews page — read-only reply line (no reply moderation per design)
- [x] Types: `ReviewReply`, `Review.reply?`, `SupplierReview`, `AdminReview.reply?`

### Verification
- [x] Created `scripts/verify-supplier-replies.js` — 21 tests against the real HTTP API
- [x] **21/21 PASS**; `npx tsc --noEmit` zero errors; regressions green (reviews 20/20, notifications 18/18, wishlist 14/14, refund 12/12, payouts 17/17, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- [x] Bugs fixed: `reply` typed-subdoc `default: null` (inline subdoc auto-populated `{author:null,text:"",at:null}` → atomic claim never matched); stale dev server holding the pre-fix schema (force-killed by PID on Windows and restarted)
- [x] Code-reviewer approved (no critical feedback); minor non-blocking notes documented (Review.supplier drift on hypothetical product reassignment; rate-limiter placement after DB queries — matches convention)

---

## ✅ Session 34 — Customer Reviews & Ratings

### Review Model
- [x] Created `src/models/Review.js` — customer/product/order refs + immutable itemSnapshot (audit) + rating 1–5 + text ≤1000 + status (pending/approved/rejected) + reviewedBy/reviewedAt/rejectionReason
- [x] Unique index `{ customer, product, order }` — one review per purchased order-item (atomic dedupe, E11000 → 409 backstop)

### Verified-Purchase Gating
- [x] Eligibility requires a DELIVERED order (`payment.status=paid` + `status=delivered` + items contains product) → 403 otherwise
- [x] Customer can review once per order-item (verified with a second delivered order for the same product)

### API
- [x] `GET /api/reviews` — public approved-only, paginated + `ratingSummary` (approved aggregate)
- [x] `POST /api/reviews` — customer-only, payload-validated BEFORE rate limiter, rate-limited 20/15min, delivered-order gate, duplicate 409, sanitizePlainText, pending status, itemSnapshot copy
- [x] `GET /api/reviews/mine` — my reviews + eligible delivered orders for the form gate
- [x] `GET /api/admin/reviews` — admin moderation queue (status filter, product+customer populated, paginated)
- [x] `POST /api/admin/reviews/[id]/moderate` — atomic claim (pending → approved/rejected exactly once; loser 400), reason required for reject, 404 vs 400, reviewedBy/reviewedAt
- [x] `GET /api/products?slug=` — response includes `ratingSummary` (approved only) for SEO + display sync

### UI
- [x] Storefront `ReviewsSection` — summary (average + stars + count), approved reviews list (paginated), gated «ثبت دیدگاه» form (star picker + textarea), my-review status badges
- [x] Product page — `<ReviewsSection>` + `ProductJsonLd` with `aggregateRating` (approved-only SEO sync)
- [x] Admin `/admin/reviews` page — status tabs, approve + reject-with-reason modal; sidebar «دیدگاه‌ها»
- [x] Hooks `use-reviews.ts` (list/mine/submit) + `use-admin-reviews.ts` (queue/moderate); types `ReviewStatus/RatingSummary/Review/AdminReview/MyReviewsResponse` + `Product.ratingSummary?`/`Product.brand?`

### Verification
- [x] Created `scripts/verify-reviews.js` — 20 tests against the real HTTP API
- [x] **20/20 PASS**; `npx tsc --noEmit` zero errors; regressions green (payouts 17/17, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- [x] Bugs fixed: rate limit 5→20/15min (too aggressive), over-1000-char text now 400 (was truncating), TS errors (ratingSummary cast, AdminReview Omit, Product.brand), dead cache key, 404 vs 400 in moderate

---

## ✅ Session 36 — Customer Notifications

### Notification Core
- [x] Created `src/lib/notifications.ts` — `notifyOrderEvent()` SINGLE facade (never throws/blocks; in-app = source of truth; Telegram optional fire-and-forget adapter → `sentToTelegram`)
- [x] Atomic dedupe — unique partial index `{ recipient, notificationKey }` (E11000 → no-op; an event can never be delivered twice)
- [x] Extended `src/models/Notification.js` — `category`/`link`/`notificationKey`/`readAt`/`metadata` + indexes (`{recipient, createdAt:-1}`, `{recipient, isRead}`, unique partial `{recipient, notificationKey}`)

### API
- [x] `GET /api/notifications` — paginated inbox, `unreadOnly`/`category` filters, `unreadCount` (self-scoped to token.id)
- [x] `GET /api/notifications/unread-count` — lightweight header badge count
- [x] `PUT /api/notifications/read-all` — idempotent mark-all-read, rate-limited 30/15min
- [x] `PUT /api/notifications/[id]/read` — owner-scoped single read (400/404/idempotent 200)

### Event Wiring (after business commit, best-effort)
- [x] Checkout → supplier `new_order`
- [x] Admin orders → customer `order_confirmed`/`order_shipped`/`order_delivered`/`order_cancelled`
- [x] Supplier orders → supplier `order_confirmed`
- [x] Admin refund → customer `order_refunded` (stock restored once)
- [x] Payment verify → customer `payment_paid`/`payment_failed`/`payment_cancelled` via `safeNotifyOrderEvent()` (hardened — never affects payment flow)

### UI / Hooks / Types
- [x] `NotificationBell` (unread badge, 30s refetch) in storefront header + supplier header
- [x] Shared `NotificationsList` (category tabs, mark-all-read, deep links, unread highlight, pagination) on `/notifications` + `/supplier/notifications`
- [x] `use-notifications.ts` — `useUnreadCount`/`useNotifications`/`useMarkRead`/`useMarkAllRead`
- [x] Types: `NotificationCategory`/`NotificationItem`/`NotificationsResponse`/`UnreadCountResponse`

### Verification
- [x] Created `scripts/verify-notifications.js` — 18 tests against the real HTTP API
- [x] **18/18 PASS**; `npx tsc --noEmit` zero errors; regressions green (wishlist 14/14, reviews 20/20, payouts 17/17, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- [x] Code-review follow-ups applied: removed dead `orderNotificationKey()` helper; simplified refund `customerId` cast; hardened payment verify with `safeNotifyOrderEvent()`

---

## ✅ Session 35 — Customer Wishlist

### Model
- [x] Created `src/models/Wishlist.js` — user/product refs + optional variantId/variantSnapshot (future-proof) + timestamps; unique `{ user, product }` + `{ user, createdAt: -1 }` indexes; registered in dbConnect

### API
- [x] `GET /api/wishlist` — customer-only, paginated; two-query approach (deterministic `productId`, `product: null` for deleted → placeholder; inactive surfaced with `isActive:false`)
- [x] `POST /api/wishlist` — idempotent add (unique index + E11000 → `{added:false}`), product must exist + active (404), rate-limited 30/15min AFTER validation
- [x] `DELETE /api/wishlist` — idempotent remove scoped to token.id, rate-limited
- [x] `GET /api/wishlist/ids` — `{ ids, count }` (count separate so header badge survives future pagination/filtering)

### Storefront UI
- [x] `/wishlist` page — customer gate, paginated ProductCard grid, deleted-product placeholder card with remove (uses productId), inactive renders with stock state, empty state, PaginationControls
- [x] Heart button on product card (guests → toast + /login)
- [x] «افزودن به علاقه‌مندی‌ها» button on product detail (same guest gate)
- [x] Header heart icon + rose count badge + nav link (customer only)
- [x] `use-wishlist.ts` hooks — ids (cached, 60s), items(page), optimistic toggle with rollback; types `WishlistItem`/`WishlistIdsResponse`

### Verification
- [x] Created `scripts/verify-wishlist.js` — 14 tests against the real HTTP API
- [x] **14/14 PASS**; `npx tsc --noEmit` zero errors; regressions green (reviews 20/20, payouts 17/17, refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- [x] Bugs fixed: lean+populate missing-ref bug (two-query fix), inactive-add test fixture, guest-gate on detail heart, rate-limit ordering, cast cleanup

---

## ✅ Completed Tasks

### Session 1 (Initial Setup)
- [x] Initialize Next.js 16 project with TypeScript
- [x] Set up Tailwind CSS v4
- [x] Configure MongoDB connection
- [x] Create all database models
- [x] Set up NextAuth v4 with Credentials Provider
- [x] Create Login and Register pages (Persian RTL)
- [x] Set up middleware for role-based route protection

### Session 2 (UI + SEO + State Management)
- [x] Install core packages (zustand, react-query, sonner, react-hook-form, zod, etc.)
- [x] Create cn() utility in `@/lib/utils`
- [x] Create shadcn-style UI components
- [x] Create Zustand stores
- [x] Create React Query provider and hooks
- [x] Create SEO utilities (JSON-LD, metadata)
- [x] Create sitemap.ts, robots.ts, manifest.ts
- [x] Create env validation, Zod schemas, loading components, ErrorBoundary
- [x] Create custom 404 and error pages
- [x] Update next.config.ts with security headers
- [x] Redesign homepage, update root layout
- [x] Successfully build project

### Session 3 (shadcn/ui Migration + Admin Panel)
- [x] Create components.json, custom Slot, rewrite all UI components
- [x] Rewrite form.tsx with official shadcn pattern
- [x] Create sonner.tsx with MutationObserver dark mode
- [x] Move cn to @/lib/utils, delete old src/utils/cn.ts
- [x] Create Admin layout, sidebar, header
- [x] Create Admin dashboard, products, orders, users, settings pages
- [x] Create Admin API routes (stats, products, orders)
- [x] Fix badge variants, API route types, duplicate className
- [x] Successfully build (19 routes)

### Session 4 (Real Data Integration)
- [x] Create React Query hooks for admin data (stats, products, orders, users)
- [x] Create admin users API route
- [x] Update dashboard stats API to fetch real MongoDB data
- [x] Replace mock data with API calls in dashboard, products, orders, users pages
- [x] Add loading, error, empty states and useMemo optimizations
- [x] Successfully build (20 routes)

### Session 5 (Product CRUD)
- [x] Create product Zod validation schema
- [x] Add POST/PUT/DELETE handlers to admin products API + single GET by id
- [x] Create categories + suppliers API routes for dropdowns
- [x] Add create/update/fetch-single hooks
- [x] Create ProductForm component with react-hook-form + zod
- [x] Create /admin/products/new and /admin/products/[id]/edit pages
- [x] Wire up table buttons with Link navigation (asChild) and delete confirmation
- [x] Successfully build (23 routes)

### Session 6 (Order Status Management)
- [x] Add PUT handler to admin orders API with status transition validation
- [x] Add single-order GET by ID
- [x] Create useAdminOrder and useUpdateOrderStatus hooks
- [x] Create /admin/orders/[id] detail page with items, timeline, status controls
- [x] Wire up orders table Eye button to detail page
- [x] Successfully build (23 routes)

### Session 7 (Accessibility Fixes + Cleanup)
- [x] Fix Label-Input ID mismatch: Input now consumes FormItemContext directly
- [x] Export FormItemContext from form.tsx
- [x] Add "use client" directive to Input component
- [x] Delete duplicate src/models/auth.js (zero references, lib/auth.js is canonical)
- [x] Successfully build (23 routes)

### Session 8 (Supplier Panel Phase 1)
- [x] Create supplier types (`SupplierStat`, `SupplierProduct`, `SupplierInfo`)
- [x] Create supplier API routes (stats, products CRUD with ownership verification)
- [x] Create supplier React Query hooks (use-supplier-stats, use-supplier-products)
- [x] Create supplier layout (green-themed sidebar + header)
- [x] Create supplier dashboard page (real stats, wallet info, product status)
- [x] Create supplier product form (`SupplierProductForm` with `supplierProductSchema`)
- [x] Create supplier products list page (search, edit, delete with confirmation)
- [x] Create supplier product create page
- [x] Create supplier product edit page (React 19 `use()`)
- [x] Create placeholder pages for orders and wallet
- [x] Fix categories API to allow supplier access
- [x] Fix supplier form validation (omit supplier field from schema)
- [x] Add `/supplier` redirect to `/supplier/dashboard`
- [x] Successfully build (31 routes)

### Session 9 (Supplier Orders Phase 2)
- [x] Create supplier orders API route (list, detail, status update with transition validation)
- [x] Create supplier orders React Query hooks
- [x] Create supplier orders list page (status filters, search, table, loading/error/empty states)
- [x] Create supplier order detail page (items, timeline, status controls, quick actions)
- [x] Fix TypeScript type issues with Mongoose lean() populated fields
- [x] Fix timeline duplicate entries
- [x] Fix quick action buttons (no setTimeout, direct call)
- [x] Successfully build (32 routes)

### Session 10 (Supplier Wallet Phase 3)
- [x] Create supplier wallet API (GET wallet info, POST payout request with validation)
- [x] Create wallet React Query hooks (30s auto-refresh)
- [x] Create wallet page (balance cards, bank info, payout form with quick amounts, transaction history)
- [x] Successfully build (33 routes)

### Session 11 (Customer Product Catalog - Milestone 9)
- [x] Create public /api/products API (search, category filter, price range, sort, slug lookup)
- [x] Create public /api/categories API (active categories only)
- [x] Create public products + categories hooks
- [x] Create storefront layout with header/footer
- [x] Create product card component
- [x] Create products catalog page (grid, search bar, filters, loading/error/empty states)
- [x] Create product detail page (breadcrumb, info, badges, all states)
- [x] Successfully build (36 routes)

### Session 12 (Shopping Cart)
- [x] Create Zustand cart store with persist middleware
- [x] Wire up add-to-cart in product card and detail page (with toast notification)
- [x] Add cart badge to storefront header
- [x] Create cart summary page with quantity controls, totals, checkout
- [x] Successfully build (37 routes)

### Session 13 (Checkout Flow)
- [x] Create /api/checkout POST (auth, validation, Order + SupplierOrder creation, stock decrement)
- [x] Create checkout page (address form, payment method, order summary, success state)
- [x] Wire up cart button to /checkout
- [x] Successfully build (39 routes)

### Session 14 (Customer Order History & Profile)
- [x] Create /api/orders route (customer orders list + detail)
- [x] Create /api/profile route (GET/PUT customer profile)
- [x] Create use-customer-orders.ts hook
- [x] Create use-customer-profile.ts hook
- [x] Create orders/page.tsx (order history list with filters)
- [x] Create orders/[id]/page.tsx (order detail with timeline)
- [x] Create profile/page.tsx (edit name/address, read-only phone)
- [x] Update storefront layout (orders/profile nav when logged in)
- [x] Successfully build (43 routes)

### Sessions 15-18 (Telegram Notifications)
- [x] Create src/lib/telegram.ts (sendTelegramMessage, sendNewOrderNotification, sendOrderStatusNotification)
- [x] Integrate Telegram notifications into checkout flow (per-supplier + admin)
- [x] Add TELEGRAM_BOT_TOKEN to env validation
- [x] Create /api/supplier/settings route (GET/PUT telegramChatId, POST test message)
- [x] Create use-supplier-settings.ts hook
- [x] Add Telegram bot connection card to supplier wallet page
- [x] Integrate Telegram notifications into supplier orders PUT handler
- [x] Integrate Telegram notifications into admin orders PUT handler
- [x] Add order_rejected type to Notification model
- [x] Add ADMIN_TELEGRAM_CHAT_ID to env validation
- [x] Update .env.example with placeholder values
- [x] Update AI_CONTEXT.md, ROADMAP.md, TASKS.md, ARCHITECTURE.md, CHANGELOG.md
- [x] Successfully build (44 routes)

### Sessions 19-20 (File Upload System & Product Images)
- [x] Create S3-compatible upload service (src/lib/upload.ts)
- [x] Create /api/upload route (POST multipart + JSON, DELETE with auth)
- [x] Create File model for uploaded file metadata
- [x] Create reusable FileUpload drag-and-drop component with previews
- [x] Integrate FileUpload into admin + supplier product forms
- [x] Add image thumbnails to product cards, cart, checkout
- [x] Create image lightbox gallery on product detail page

### Session 24 (Zarinpal Payment & Category Enhancement)
- [x] Create Zarinpal service layer (requestPayment, verifyPayment)
- [x] Integrate payment into checkout flow with authority storage
- [x] Create payment verification callback route (server-side verification)
- [x] Add stock reversion for cancelled/failed payments
- [x] Add duplicate verification prevention
- [x] Create payment result page (success/cancelled/failed states)
- [x] Enhance Category model with SEO fields, icon, description, sortOrder
- [x] Build admin category tree UI with inline CRUD form
- [x] Add safe deletion (children unlinked, not deleted)

### Session 25 Part 1 (Brand Management)
- [x] Create Brand model (name, slug, description, logo, website, isActive)
- [x] Create admin brand CRUD API + validation
- [x] Create admin brand UI page (search, inline form, delete confirmation)
- [x] Create React Query hooks (admin + dropdown)
- [x] Integrate brand into Product model + product forms + all APIs

### Session 25 Part 2 (Tag Management)
- [x] Create Tag model (name, slug, isActive)
- [x] Create admin tag CRUD API + validation
- [x] Create admin tag UI page (search, inline form, delete confirmation)
- [x] Create React Query hooks (admin + dropdown)
- [x] Integrate tags into Product model + chip-based multi-select in product forms + all APIs

### Session 26 (Inventory Concurrency Fix)
- [x] Add `stockVersion` field to Product model with auto-increment hooks
- [x] Add `stockRestored` field to Order model for idempotent restoration
- [x] Refactor checkout API: atomic stock reservation BEFORE order creation (3-phase flow)
- [x] Add atomic claim patterns to payment verification (cancel/fail/success)
- [x] Add idempotent stock restoration for cancelled/failed payments
- [x] Add stock restoration for admin order cancellation
- [x] Create verification test script (scripts/verify-concurrency.js)
- [x] Fix pre-findOneAndUpdate hook — Mongoose conflict error when stockVersion in both $set and $inc
- [x] Verify: 10/10 tests pass, concurrent overselling prevented
- [x] `npx tsc --noEmit` passes with zero errors

---

## ✅ Session 27 — API Pagination

- [x] Created `src/lib/pagination.ts` — shared pagination helper
- [x] Created `src/components/ui/pagination.tsx` — PaginationControls UI component
- [x] Updated `src/lib/constants.ts` — default page size 20
- [x] Updated `src/types/index.ts` — `PaginatedResponse<T>` shape
- [x] Added pagination to `/api/products` (public catalog, preserve search/filter/sort)
- [x] Added pagination to `/api/orders` (customer orders, preserve status filter)
- [x] Added pagination to `/api/admin/products` (admin product management, search resolves ObjectId refs)
- [x] Added pagination to `/api/admin/orders` (admin order management, search via User lookup)
- [x] Updated all consumer pages and hooks
- [x] Created `scripts/verify-pagination.js` — 24 tests
- [x] 24/24 tests passing, zero TypeScript errors

## ✅ Session 28 — Security Hardening

### Rate Limiting
- [x] Created `src/lib/rate-limiter.ts` — MongoDB-backed TTL rate limiter
- [x] Applied to NextAuth `authorize` callback (login) — 5 attempts per 15 min per phone+IP
- [x] Applied to `/api/register` — 10 attempts per 15 min per IP

### Authorization: 401 vs 403
- [x] Created `requireRoleOrError()` in `src/lib/auth-utils.ts`
- [x] Updated all admin/supplier API routes to use `requireRoleOrError`
- [x] Fixed `token!` assertions in supplier settings PUT/POST

### Input Sanitization
- [x] Created `src/lib/sanitize.ts` — strip HTML tags, `javascript:` protocol, `on*=` event handlers
- [x] Applied to product descriptions, user names, brand/category/tag names/descriptions, profile fields

### Verification
- [x] `npx tsc --noEmit` passes with zero errors
- [x] All 24 pagination tests still pass

## ✅ Session 29 — Attributes & Product Variants

### Attributes
- [x] Created `src/models/Attribute.js` (name, slug, type, values[], isActive)
- [x] Created `src/app/api/admin/attributes/route.ts` — admin CRUD with duplicate name/slug validation
- [x] Created `src/app/admin/attributes/page.tsx` — admin management UI
- [x] Created `src/hooks/use-admin-attributes.ts` + `src/hooks/use-attributes.ts` (active attributes for suppliers)
- [x] Registered Attribute model + sidebar nav entry

### Product Variants (embedded)
- [x] Extended `src/models/Product.js` — hasVariants, variants[] with per-variant stockVersion
- [x] Added global sparse unique index on `variants.sku`
- [x] Created `src/lib/product-variants.ts` — validateVariants, prepareVariantsForSave, recomputeVariantSummary
- [x] Created `src/lib/inventory.ts` — shared atomic reserveStock/restoreStock/restoreOrderStock (variant-aware, single source of truth)
- [x] Updated `src/types/index.ts` + `src/lib/validations/product.ts` (productVariantSchema, fixed ZodEffects .omit)
- [x] Updated admin + supplier product APIs for variant support (summary recompute preserved, filters/pagination intact)

### Forms / Storefront / Cart / Checkout / Orders
- [x] Created `src/components/admin/variant-builder.tsx` + integrated into admin/supplier product forms
- [x] Created `src/components/storefront/variant-selector.tsx` + integrated into product detail page
- [x] Updated `src/stores/cart-store.ts` + cart/checkout pages for variant items (composite dedupe key)
- [x] Rewrote `src/app/api/checkout/route.ts` — shared reserveStock with variantId + correct rollback via restoreReserved()
- [x] Updated payment verify + admin cancel to use shared restoreOrderStock
- [x] Added variantId/sku/variantLabel snapshots to Order + SupplierOrder items + order detail pages

### Verification
- [x] Created `scripts/verify-variants.js` — 16 tests against real MongoDB
- [x] 16/16 tests passing (including concurrent last-unit, never-negative, restore-once idempotency)
- [x] Fixed critical concurrency bug — positional `$` invalid in query filters, use `$elemMatch`
- [x] `npx tsc --noEmit` passes with zero errors

## ✅ Session 29 Follow-up — Production-Readiness E2E Verification (real HTTP API)

### E2E harness
- [x] Created `scripts/verify-variants-e2e.js` — 32 tests against the REAL running Next.js API (real NextAuth login, real routes, real MongoDB)
- [x] Verified attribute/category CRUD, variant product create/edit, SKU uniqueness (admin create/update + supplier → 409, MongoDB index → E11000)
- [x] Verified concurrent variant checkout race (stock=1, 2 parallel → exactly 1 succeeds, stock never negative)
- [x] Verified payment cancel/fail restore-once, already-paid guard, admin cancel, simple-product regression, pagination shape, 401/403 authz
- [x] **32/32 E2E tests passing**

### Bug found & fixed (browser-verified)
- [x] Storefront product detail page crashed with `Rendered more hooks than during the previous render` (hooks called after early returns) — hoisted `useCartStore`, removed dead `firstVariant` useMemo
- [x] Storefront variant selector browser-verified (renders, price updates, unavailable combos disabled)
- [x] `npx tsc --noEmit` zero errors; variants 16/16; pagination 24/24; ESLint 0 errors

## ✅ Session 30 — Payment Retry & Abandoned Payment Cleanup

### Payment Retry Flow
- [x] Created `POST /api/payment/retry` — auth + own-order ownership (404 for other users)
- [x] Retryable only for `pending_payment` + zarinpal + `payment.status ∈ {pending, failed, canceled}`; paid/refunded → 400
- [x] Stock semantics: pending+`stockRestored=false` → fresh authority with NO stock change; failed/canceled+`stockRestored=true` → atomic re-reserve via shared `reserveStock()` before new authority
- [x] Concurrency: `payment.status→pending` atomic claim serializes same-order retries (409 for concurrent); `stockRestored` flipped false only in final update → no inflation crash window
- [x] Insufficient stock → 409; gateway unreachable → 502

### Storefront UI
- [x] «پرداخت مجدد» button on customer order detail (shown only when retryable; hidden when paid/refunded)
- [x] `OrderPaymentStatus` type extended with canceled/refunded

### Abandoned Payment Cleanup
- [x] Created `src/lib/payment-cleanup.ts` — `cleanupAbandonedPayments()` (24h `updatedAt` cutoff, atomic claim, `restoreOrderStock()` only for claimed)
- [x] Created `GET /api/payment/cleanup` — admin-only + optional `CRON_SECRET` (Vercel Cron style)

### Latent Zarinpal bug fixed
- [x] `hasZarinpalErrors()` — Zarinpal v4 returns `errors: []` (truthy empty array) on success; fixed `requestPayment` + `verifyPayment`

### Verification
- [x] Created `scripts/verify-payment-retry.js` — 12 tests against the real HTTP API + sandbox
- [x] **12/12 PASS**; `npx tsc --noEmit` zero errors; regressions green (pagination 24/24, variants 16/16, upload-repro 15/15)

---

## ✅ Session 31 — Variant Polish

### Variant-aware Order Display
- [x] Immutable `image` snapshot added to Order + SupplierOrder item schemas + checkout (variant image, falls back to product image)
- [x] Admin / supplier / storefront order detail pages render product thumbnail + variantLabel + SKU; old orders render fine
- [x] `AdminOrderItem`/`SupplierOrderItem` types extended with `image?`

### Variant-aware Status Management (verified)
- [x] Supplier order status changes (confirm/reject/ship/deliver) never touch inventory (no stock logic in supplier orders route)
- [x] Admin orders only touch stock on `cancelled` via shared `restoreOrderStock()`
- [x] Suppliers only see their own `SupplierOrder.items`

### Supplier Variant Stock Quick Edit
- [x] `setVariantStock()` in `src/lib/inventory.ts` — same `$elemMatch` + `stockVersion` optimistic-lock pattern as `reserveStock`; summary stock synced atomically; never negative; null on version mismatch
- [x] `POST /api/supplier/products/stock` — supplier-only, ownership enforced, variant-existence + negative-stock validation, 409 on concurrent modification
- [x] `useUpdateSupplierVariantStock` hook + inline `VariantStockEditor` on supplier products page («ویرایش سریع» expandable)

### Verification
- [x] Created `scripts/verify-variant-polish.js` — 13 tests against the real HTTP API
- [x] **13/13 PASS**; `npx tsc --noEmit` zero errors; regressions green (payment-retry 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)
- [x] Fixed: fixture `_id` (Mixed arrays), JSX fragment in products page, TEST 3 summary expectation (33)

---

## ✅ Session 32 — Admin Refund Flow

### Refund API
- [x] Created `POST /api/admin/orders/refund` — admin-only via `requireRoleOrError(["admin"])` (401/403)
- [x] Atomic claim `payment.status: paid → refunded` (`findOneAndUpdate`) — concurrent double-refund impossible (loser → 400)
- [x] Refund metadata stored: `refund.reason` (sanitized), `refund.refundedAt`, `refund.refundedBy`
- [x] Immutable `refunded` event pushed to `statusHistory` (audit trail with reason)
- [x] Reason required + sanitized (`sanitizePlainText`)

### Inventory Restoration
- [x] Stock restored exactly once via the shared `restoreOrderStock()` (stockRestored-idempotent — no second inventory system)
- [x] Variant + simple product restoration both verified; already-restored orders don't double-restore

### Model & Types
- [x] `refund` subdocument added to `src/models/Order.js`; `AdminOrder.refund?` added to types

### Admin UI
- [x] «بازپرداخت سفارش» button shown only for paid orders
- [x] Refund confirmation modal with required reason + error display
- [x] Refunded badge + reason + date display; `paymentLabels` gained canceled/refunded
- [x] `statusConfig` widened with a `refunded` entry (Persian timeline label)
- [x] `useRefundOrder` mutation (invalidates lists + detail)

### Verification
- [x] Created `scripts/verify-refund.js` — 12 tests against the real HTTP API (401, customer 403, supplier 403, paid refund → 200 + metadata + stock 8→10, pending 400, double-refund 400 + no double restore, variant restore + summary, simple product, history event)
- [x] **12/12 PASS**; `npx tsc --noEmit` zero errors; regressions green (payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)

---

## ✅ Session 33 — Supplier Payout Approval System

### Model
- [x] `Transaction` extended — payout workflow: `status` (pending/approved/rejected), `reviewedBy`, `reviewedAt`, `rejectionReason`
- [x] `Supplier` extended — `pendingReserve` (invariant `pendingReserve <= balance`)

### Reserve Semantics (wallet)
- [x] Payout request now RESERVES the amount (atomic `$expr` claim — race-safe vs over-reservation); balance NOT debited until admin approval
- [x] Rollback of reserve if Transaction creation fails; bank-account validation before reserving
- [x] Wallet GET returns `availableBalance` (balance − pendingReserve) + `pendingReserve`; `totalPaidOut` counts only approved (+ legacy)
- [x] **Bug fixed (live):** response double-counted pendingReserve (`{new:true}` already includes amount)

### Admin Payout Queue
- [x] `GET /api/admin/payouts` (status filter, supplier+bank+user populated)
- [x] `POST /api/admin/payouts` — approve/reject with **atomic claim** (processed exactly once; concurrent loser → 400)
- [x] Approve: debit balance + release reserve atomically (rollback to pending on failure → 409); Reject: release reserve only + required sanitized reason

### Hooks / Types / UI
- [x] `use-admin-payouts.ts` (list + review mutation); `AdminPayout`/`PayoutStatus` types
- [x] Admin `/admin/payouts` page (status tabs, request cards, approve + reject modal) + sidebar «تسویه فروشندگان»
- [x] Supplier wallet: available-balance + pending-reserve cards, payout form caps at availableBalance, status badges + rejection reason in history

### Verification
- [x] Created `scripts/verify-payouts.js` — 17 tests against the real HTTP API
- [x] **17/17 PASS**; `npx tsc --noEmit` zero errors; regressions green (refund 12/12, payment-retry 13/13, variant-polish 13/13, pagination 24/24, variants 16/16, upload-repro 15/15)

---

## ✅ Session 45 — Supplier Telegram Alerts (Payouts + New Reviews)

### Server (additive, invariants preserved)
- [x] `Notification.js` — +3 `type` enum values (`payout_approved`, `payout_rejected`, `new_review`); category enum untouched (`payout`/`system` exist); no index/migration
- [x] `POST /api/admin/payouts` — notify supplier via `notifyOrderEvent()` AFTER money-state commit in both flows: approve → `payout_approved` (after `balanceAfter`, `telegramChatId` added to populate select); reject → `payout_rejected` (after reserve release, separate `Supplier` lookup); sanitized reason in message + Telegram body; dedupe keys `payout_<txn>_approved|rejected`; deep-link `/supplier/wallet`; post-commit block in local try/catch (notification-side throw can never 500 a committed payout)
- [x] `POST /api/reviews` — `new_review` (category `system`, key `new_review_<reviewId>`, link `/supplier/reviews`) to the review's supplier after `Review.create`; post-commit block in local try/catch
- [x] `telegram.ts` — additive `sendPayoutStatusNotification` + `sendNewReviewNotification` (reuse `toPersianDigits` + HTML; existing helpers untouched)

### Client
- [x] Notifications inbox `sentToTelegram` badge (Send icon + «تلگرام» label, tooltip) when the flag is true

### Verification
- [x] `scripts/verify-telegram-alerts.js` — **16/16 PASS** (real API): approve/reject notifications + dedupe, **Telegram fail-silent** (`sentToTelegram` false + payout committed), cross-user + cross-supplier isolation, review → `new_review`
- [x] Wired into `run-regression.js` — **23 suites** (verify-telegram-alerts last; verify-db-reconnect first/hermetic)
- [x] `npx tsc --noEmit` zero errors; full regression **23/23 PASS**; code review approved (2 rounds); dev-server restart required (model change)

---

## ✅ Session 46 — Customer Self-Service Order Cancellation

### API (customer-only, race-safe)
- [x] `POST /api/orders/[id]/cancel` (new route) — customer-only via `requireRoleOrError(["customer"])` (401 unauth / 403 supplier+admin); ownership-scoped `Order.exists({_id, customer})` distinguishes 404 (not found/not owned) from 409 (exists, no longer cancellable)
- [x] Atomic claim `{_id, customer, status:"pending_payment", "payment.status":"pending"}` → `status=cancelled` + `payment.status=canceled` + `statusHistory {status:"cancelled", actor:"customer", note:"customer_cancelled"}` (machine-readable — raw customer input never stored in note)
- [x] **Race-safe by construction:** cancel claim + payment-verify success claim both gate on `payment.status:"pending"` → exactly one wins; no paid order with restored stock; no double restore (verify NOK `$nin` + `stockRestored` idempotency backstop)
- [x] Post-commit block (local try/catch, strictly after the claim): `restoreOrderStock` + `releaseCouponUsage(orderId)` (exact coupons.ts export) + `notifyOrderEvent` (`order_cancelled` REUSED — no new type, key `order_<id>_order_cancelled`)
- [x] Additive `actor` on `statusHistory` subdoc (no migration); model change ⇒ dev-server restart required

### Client
- [x] Storefront order detail «لغو سفارش» button + confirm dialog (`pending_payment` only) + `useCancelOrder` mutation + `CancelOrderResponse` type
- [x] Both order-detail timelines map `customer_cancelled` → «لغو توسط مشتری» (human-entered admin notes pass through unchanged)

### Verification
- [x] `scripts/verify-order-cancel.js` — **17/17 PASS** (real API): 401/403/404 authz, cancel own → 200 + state, stock restored EXACTLY ONCE (simple + variant), audit entry, notification, re-cancel 409 + no double restore, coupon released, paid/processing 409 + no restore, **strict cancel-vs-payment-verify race** (verify-wins / cancel-wins / concurrent-success / concurrent-NOK — exactly one winner)
- [x] `run-regression.js` → **24 suites** (verify-order-cancel inserted before payment-retry group; verify-coupons-marketing near-last + verify-telegram-alerts last preserved; verify-db-reconnect first/hermetic)
- [x] `npx tsc --noEmit` zero errors (TS18047 token fix via `token!.id` — codebase convention); full sequential regression **24/24 PASS**; code review approved

---

## ✅ Session 47 — Storefront Faceted Filtering (Brand + Tag + Attribute Facets)

### Server (additive, read-only)
- [x] `GET /api/brands` + `GET /api/tags` (new public routes) — active-only, STRICT projection `_id/name/slug` (leak-scan verified), mirror `/api/categories`
- [x] Additive `brand=` + `tag=` params on `GET /api/products` — ObjectId-validated like `supplier=` (malformed → 404, valid-but-nonexistent → 200 empty); existing params + `id`/`slug` detail path unchanged

### Session 47 extension — Attribute Facets (validates the extensibility claim)
- [x] **Nested attribute filters** `attributes[<slug>]=<value>` on `GET /api/products` — parsed via `searchParams.entries()` regex, slug → `attributeId`, `variants.attributes = $all of $elemMatch` (AND across attributes); unknown slug → 200 empty; simple products (no variants) never match; detail path untouched; no behavior change when omitted
- [x] **`GET /api/attributes/facets`** (new aggregation endpoint) — public, same filter params as products (ObjectId-validated → 404 with **explicit `new mongoose.Types.ObjectId()` casting** because the aggregation `$match` doesn't auto-cast); ONE pipeline ($match product-level only → $unwind variants active-only → $unwind attributes → $group by (attributeId,value) with `$addToSet` distinct products); **sticky self-exclusion** via JS set intersections (an attribute's own selection excluded from its own counts — reviewer-caught: DB-level self-constraint made other values vanish); active-only, whitelist key-set `{slug,name,type,values[{value,count}]}`, count-desc sorted; no indexes/schema changes
- [x] `use-public-attribute-facets.ts` (new hook — reuses exported `buildQueryString`, query key strips sort/page/limit, staleTime 5min); `useCatalogFilters` gained `selectedAttributes` (slug→value) mapped to `attributes[<slug>]` keys via the `CatalogFilterValues` index signature — **zero data-flow changes, the Session 47 seam**
- [x] `FilterChipGroup` gained optional `counts?: Record<string, number>` badge prop (backward compatible); catalog page renders attribute facet groups + attribute active badges (panel + mobile); `hasActiveFilters` includes attributes
- [x] Types: `AttributeFacet`/`AttributeFacetValue`/`AttributeFacetsResponse`; `buildQueryString` + `ProductFilters` exported from `use-public-products.ts`

### Verification
- [x] `scripts/verify-facets.js` — **22/22 PASS** (facet endpoints, combinations, 404/empty semantics, inactive-ref identity, pagination/sorting preservation, detail unaffected, leak scan)
- [x] `scripts/verify-attribute-facets.js` — **24/24 PASS** (nested single/AND/combos with brand/category/search/supplier/price/tag, unknown slug 200-empty, simple-product never-match, inactive-ref identity, sticky self-exclusion both directions, facet narrowing with brand/category, sort/page stability, pagination/sorting preservation, detail unaffected, leak scan)
- [x] `run-regression.js` → **26 suites** (verify-facets after verify-variant-polish, verify-attribute-facets after verify-facets)
- [x] `npx tsc --noEmit` zero errors; full regression **26/26 PASS** (a first-run `verify-variant-polish` failure was a transient flake — passes standalone and in rerun); code review approved (3 rounds — fixes: hook returned wrapper instead of array → page TS2339; sticky self-exclusion moved from aggregation `$match` to JS intersections + dead `baseVisible` removed; explicit ObjectId casting in aggregation)
- [x] **No model/schema/index changes → no dev-server restart needed**

## ✅ Session 48 — Storefront Search Quality Upgrade

### Server (additive, default-off)
- [x] Expanded search `$or` on `GET /api/products?search=` — name, description, **variant attribute values**, plus **brand/tag/category names** via `Brand/Tag/Category.find({name: $regex}).distinct("_id")` (empty set contributes no matches); regex kept as the primitive (Persian substring `پیراه` → `پیراهن` preserved) — **no `$text`, no indexes, no schema changes**
- [x] All filter ids ObjectId-cast at build time (aggregation `$match` does not auto-cast — Session 47 lesson); category/supplier/brand/tag/attribute-id casts are find()-identical
- [x] **Ranked path** (only `search` + default `newest` sort): one aggregation `$match → $addFields score → $sort {score:-1, createdAt:-1} → $skip/$limit → $project {_id:1}` → existing populate chain re-hydrates + re-sorts to rank; **pagination at DB level, never fetch-all**; response shape unchanged, no `score` leak
- [x] Weighted additive scores: exact name 100 / prefix 60 / substring 40 / brand-tag-category 25 / attribute value 20 / description 10; attribute-value term flattens `$variants.attributes` (array-of-arrays in expression context) with `$reduce`/`$concatArrays` + `$type` guard (fixed real 500)
- [x] Explicit sorts (`price_asc`/`price_desc`/`name`/`oldest`) override relevance via the existing `find()` path; no-search behavior byte-for-byte unchanged

### Client
- [x] 300ms search debounce in `useCatalogFilters` — `searchQuery` stays the immediate input value; `debouncedSearch` commits to `queryParams` after a quiet pause (empty clears immediately; `clearFilters` resets both); useState kept — no `useSearchParams` migration

### Verification
- [x] `scripts/verify-search.js` — **17/17 PASS** (exact-first relevance order, Persian partial substring, brand/tag/category/attribute-value search, combined search+facet, explicit-sort override, pagination totals/slicing/stable ordering, name-beats-description, empty result, regex special-char escaping + literal-dot pDot/pWild, backward compat keyset/newest-first/no-`score`-leak, detail endpoints unaffected, populate preserved)
- [x] `run-regression.js` → **27 suites** (`verify-search` after `verify-attribute-facets`, before `verify-pagination`)
- [x] `npx tsc --noEmit` zero errors; full regression **27/27 PASS**; code review approved across rounds (fixes: expression-context array-of-arrays flatten for attribute-value term; contiguous-term substring fixture `"شیک "+PREFIX+"پیراهن"`; test-12 `names()` helper contract)
- [x] **No model/schema/index changes → no dev-server restart needed**; invariants untouched (inventory.ts, checkout reservation, notifyOrderEvent, coupons, payment-verify, RBAC)

## ✅ Session 50 — Homepage UX Redesign (Architecture First)

### Homepage
- [x] `src/app/page.tsx` — entry **kept** (no route-group move), rebuilt as a thin **server component** composing self-contained sections (Hero Carousel → Quick Categories → Campaign Banner → Special Picks → Newest Products → Premium Collection → Popular Brands → Gift Collections → Trust Badges → Footer)
- [x] `src/lib/homepage-config.ts` — static typed config: hero slides ×3, campaign banner, gift collections ×3 (Persian, gradient art, no backend, no fake data)
- [x] `src/components/storefront/home/hero-carousel.tsx` — fade cross-fade (RTL-safe), auto-advance + pause-on-hover, dots/arrows, responsive aspect `4/3 → 16/9 → 21/9` (no clipping)
- [x] `src/components/storefront/home/quick-categories.tsx` — reuses `usePublicCategories` (incl. `category.image`); grid desktop / horizontal scroll-snap mobile
- [x] `src/components/storefront/home/campaign-banner.tsx` + `gift-collections.tsx` — config-driven static sections
- [x] `src/components/storefront/home/special-picks.tsx` — countdown to end-of-day (`useCountdown`) + cheapest-in-stock 12 from the shared pool — **real prices only, NO fake discounts**
- [x] `src/components/storefront/home/newest-products.tsx` + `premium-collection.tsx` — newest 12 / priciest 12 from the same shared pool
- [x] `src/components/storefront/home/popular-brands.tsx` — styled initial tiles (public brands API exposes no logo)
- [x] `src/components/storefront/home/trust-badges.tsx` — original «چرا فروشگاه من؟» cards reused
- [x] Shared `section-header.tsx`, `product-rail.tsx` (native scroll-snap + **mobile-only** arrows, desktop static grid, loading/error/empty states, reuses `ProductCard` unchanged), `lazy-section.tsx` (IntersectionObserver → below-fold sections mount + fetch only near the viewport)
- [x] `src/hooks/use-countdown.ts` (hydration-safe `ready` flag) + `src/hooks/use-home-product-pool.ts` — **ONE pool query** (`sort=newest, limit 36`) feeds all three rails (React Query dedup)

### Header + footer
- [x] `src/components/storefront/storefront-header.tsx` — extracted from the layout + **additive header search** (reuses Session 49 `useSearchSuggestions` + `SearchSuggestions`; desktop inline, mobile expanding row; selection/Enter → `/products?search=<term>`; `aria-label`)
- [x] `src/components/storefront/storefront-footer.tsx` — extracted verbatim
- [x] `src/app/(storefront)/layout.tsx` — now a thin server component composing the shared header/footer
- [x] `src/hooks/use-catalog-filters.ts` — additive one-time URL seed (`category`/`brand`/`tag`/`search`/`sort`; sort whitelisted; no params → unchanged; useState stays the source of truth)
- [x] `src/app/globals.css` — `scrollbar-none` Tailwind v4 utility

### Verification
- [x] `npx tsc --noEmit` — **zero errors**
- [x] Full sequential regression — **28/28 PASS** (no suites added — no API surface changed)
- [x] Browser QA desktop + mobile (sections in order, no console errors, header search suggestions, category tile → filtered products, mobile search icon + horizontal scroll, countdown live, campaign banner single-padded, hero not clipping)
- [x] Code review approved — fixes applied (double-container removed, rail arrows mobile-only, unused import removed, countdown `ready` flag, hero aspect raised, uniform `pt-10` rhythm, search `aria-label`)
- [x] **Zero API/model/schema/index changes; zero new dependencies; no dev-server restart needed**

## ✅ Session 49 — Search Suggestions / Autocomplete (Phase 2 of Session 48)

### Server (additive, read-only, no auth, IP rate-limited)
- [x] `src/app/api/search/suggest/route.ts` — `GET /api/search/suggest?q=<prefix>`: returns up to 10 matching product names + brand names (active only, prefix match, case-insensitive, sorted alphabetically, product names before brand names, duplicates deduped; min 2 chars required → empty array); IP rate-limited `search-suggest:<ip>` (30/15min, x-forwarded-for fallback); no auth; **no schema/model/index changes**

### Client
- [x] `src/hooks/use-search-suggestions.ts` — `useSearchSuggestions(q)` React Query hook (enabled when `q.length >= 2`, staleTime 5min, gcTime 10min)
- [x] `src/components/storefront/search-suggestions.tsx` — `<SearchSuggestions>` dropdown: positioned absolute below search input, matching names with Search icon, click-away-to-close, `onMouseDown` for reliable selection before blur, loading skeleton/error/empty states
- [x] `src/app/(storefront)/products/page.tsx` — `suggestionsOpen` state; `onChange`/`onFocus` opens, `Escape` closes, clear button closes, `clearFilters` closes, `<SearchSuggestions>` rendered inside the input wrapper

### Verification
- [x] `scripts/verify-search-suggest.js` — **10/10 PASS** (public 200, short/empty → empty, prefix match, inactive excluded, brand names, product-before-brand order, dedup, max 10 cap, response shape, special chars)
- [x] `scripts/run-regression.js` — +1 suite → **28 suites** (`verify-search-suggest` after `verify-search`, before `verify-pagination`)
- [x] `npx tsc --noEmit` zero errors; full regression **28/28 PASS**; code review approved (cleanup: unused import, dead keyboard nav, unused type)
- [x] **No model/schema/index changes → no dev-server restart needed**

## ✅ Session 51 — Bulk Product CSV Import/Export (Admin + Supplier)

### Server
- [x] `src/lib/product-csv.ts` — server-authoritative `parseProductCsv` (`csv-parse/sync`: columns/BOM/trim/relax; row validation — slug regex, price/supplierPrice > 0, stock non-negative int, name ≤200 / description ≤2000, category required, `isActive` 1/0 empty→true, Persian+Arabic digit normalization; malformed/empty → 400) + `serializeProductsCsv` (`csv-stringify/sync`, header from `PRODUCT_CSV_HEADERS`, **formula-injection escaping** `= + - @ \t \r`, **UTF-8 BOM**)
- [x] `src/lib/product-csv-constants.ts` — 12-column header order, `MAX_IMPORT_ROWS = 1000`, `MAX_CSV_BYTES = 500_000` (dependency-free for client import)
- [x] `src/lib/product-import.ts` — `executeProductImport(csv, supplierId?)`: byte-length cap (`Buffer.byteLength`), row cap, **name-based ref resolution** (category/brand/tag/supplier, active-only, single queries — no N+1), **existing-slug pre-scan** (one `distinct`), **sequential per-row `Product.create`** on the hardened sanitize+Mongoose-validator path (no `prepareVariantsForSave` — no-op for simple products, intent documented). **Create-only v1:** duplicate in-file (`seenInFile` marked only on SUCCESS) or in-DB (`existingSlugs` + E11000) → skipped + Persian reason; never overwritten; per-row atomicity; supplier mode auto-sets ownership and ignores the `supplier` column
- [x] `src/app/api/admin/products/import/route.ts` + `src/app/api/supplier/products/import/route.ts` — `POST`; RBAC via `requireRoleOrError`; **payload validated (empty 400 / byte cap 413 / row cap 400) BEFORE the rate limiter** `product-import:<userId>` 20/15min → 429 (project convention: invalid payloads don't burn quota)
- [x] `src/app/api/admin/products/export/route.ts` + `src/app/api/supplier/products/export/route.ts` — `GET` CSV download (attachment, `text/csv; charset=utf-8`); supplier **ownership-scoped** via `Supplier.findOne({ user: token.id })` → 404 without profile; simple products only (`hasVariants: false`)

### Client
- [x] `src/hooks/use-product-import-export.ts` — `useAdminProductImport`/`useSupplierProductImport` mutations (invalidate the **key factories** `adminProductKeys.lists()` / `supplierProductKeys.lists()`)
- [x] `src/components/admin/product-csv-import.tsx` — shared UI: file pick (client reads text; server is the parser), **«دانلود قالب»** template (BOM + header), column-guide chips (required `*`; supplier hidden in supplier mode), per-row report table + created/skipped/failed badges + Persian toasts
- [x] `src/app/admin/products/import/page.tsx` + `src/app/supplier/products/import/page.tsx` — thin pages (supplier passes `supplierMode`)
- [x] Admin + supplier sidebars — «ورود انبوه» nav entries (FileUp); both products pages — «ورود انبوه» + «خروجی CSV» action buttons
- [x] `src/types/index.ts` — `ProductImportRowStatus`, `ProductImportRowResult`, `ProductImportReport`

### Invariants
- [x] **Zero existing-API/schema/model/index/migration changes** — the import path never calls the existing product POST/PUT; new deps `csv-parse` + `csv-stringify` only; `inventory.ts`, checkout, `notifyOrderEvent()`, `coupons.ts`, payment, RBAC untouched

### Verification
- [x] `scripts/verify-product-import-export.js` — **22/22 PASS** (unauth 401, supplier 403 on admin routes & reverse, template round-trip, admin import happy path, duplicate in-file + in-DB skipped, per-row failure isolation, invalid slug/price/stock → row failures, unknown refs → row failures, Persian digits normalized, supplier auto-ownership, supplier export ownership-scoped, export→import round-trip, formula-injection escaping, sanitization, byte-cap 413, row-cap 400, rate-limit 429, sweep/cleanup)
- [x] `scripts/run-regression.js` — +1 suite → **29 suites** (`verify-product-import-export` after the variant group, before `verify-coupons-marketing`)
- [x] `npx tsc --noEmit` zero errors; full regression **29/29 PASS**; code review approved (2 rounds) — fixes: rate-limit ordering, `seenInFile` only-on-success, dead `prepareVariantsForSave` call removed, key-factory invalidation, `Buffer.byteLength` cap
- [x] **No model/schema/index changes → no dev-server restart needed**

## ✅ Session 52 — Mobile Dashboard Navigation Fix + Regression Runner Hermeticity

### Mobile navigation fix (both dashboards)
- [x] **Root cause:** `Menu` button (`lg:hidden`) calls `toggleSidebar()` on the zustand `useAppStore`, but **no component consumes `isSidebarOpen`** — sidebars are `hidden lg:flex` (desktop-only) and no drawer/sheet component exists anywhere → zero visual effect on mobile
- [x] `src/components/layout/mobile-drawer.tsx` — reusable store-driven drawer (fixed overlay + slide-in panel, `lg:hidden`, closes on overlay/close-button/Escape, body-scroll lock, `aria-modal` + labelled; **plain `ReactNode` children** — a render-prop broke the RSC→client boundary, caught by browser QA)
- [x] `admin-sidebar.tsx` + `supplier-sidebar.tsx` — additive `variant` (`desktop`|`mobile`); mobile nav clicks close the drawer via the store (`setSidebarOpen(false)`); desktop output byte-identical
- [x] `src/app/admin/layout.tsx` + `src/app/supplier/layout.tsx` — render `<MobileDrawer><Sidebar variant="mobile" /></MobileDrawer>`

### Regression runner hermeticity
- [x] **Root cause:** shared login rate-limiter keys (`login:<phone>` 10/15min, `login_ip:<ip>` 30/15min) accumulate across the 29 sequential suites (all log in against the same localhost IP) → mid-run 401s despite standalone green; expected security behavior + shared test-state
- [x] `scripts/run-regression.js` — clears `_id: /^rl:(login|login_ip):/` on `ratelimits` before EACH suite (same env/dbName convention as verify suites; fail-safe warn when DB down; disconnect on all paths; **production limiter untouched**)

### Verification
- [x] `npx tsc --noEmit` zero errors; `node --check` clean; code review approved (runner change)
- [x] **Full sequential regression → 29/29 PASS** (previously intermittent 401-cascade failures); previously-affected suites confirmed standalone (upload-repro 15/15, upload-formats 9/9, variants-e2e 32/32, variant-polish 13/13, payment-retry 13/13)
- [x] **Browser QA (390px):** drawer opens/closes/navigates, no console errors; **caught + fixed the render-prop RSC-boundary crash** («Functions are not valid as a child of Client Components») → plain children + store-driven close
- [x] **Zero API/schema/model/index changes → no dev-server restart needed**

## ✅ Session 53 — Homepage CMS

### Architecture (approved v3, no redesign)
- [x] `HomepageSection` (Tier 1 composition: immutable `slug` + `component`, `title`/`subtitle` overrides, `enabled`, `sortOrder`, grouped `presentation {appearance: themeColor/background/spacing/borderRadius, behavior: autoplay/autoplayInterval/showArrows/showDots/countdownEnabled/countdownTarget/countdownEndsAt/maxItems/layoutVariant}`, soft-delete `deletedAt`)
- [x] Four Tier-2 content models (`HomepageHeroSlide`/`HomepageCampaignBanner`/`HomepageGiftCollection`/`HomepageTrustBadge`) bound by `sectionSlug` — `sortOrder`/`isActive`/`status` (draft|published)/`publishedAt`/`publishAt` (reserved)/soft-delete
- [x] **Block registry** `src/lib/homepage-sections/registry.ts` — `component` → renderer + content resolver adapter (no raw model access); fail-safe `getHomepageBlock()`; future block = one entry
- [x] `src/lib/homepage-content.ts` — `DEFAULT_SECTIONS` seed + fallback, idempotent migration from `homepage-config.ts`, `getHomepageComposition()` public reader (strict projection, unknown skipped, static fallback when DB empty)

### Admin API (RBAC, additive)
- [x] `GET/POST/PUT/DELETE /api/admin/homepage/sections` — idempotent seed on first GET; slug/component immutable (400); grouped presentation validation
- [x] `createContentRouteHandlers(type, model)` factory + 4 thin routes (`hero-slides`/`campaign-banners`/`gift-collections`/`trust-badges`) — GET/POST/PUT/DELETE, admin-only, `validateContentRow` + `normalizeContentCommon`, soft-delete, `publishedAt` stamping
- [x] `GET /api/homepage` — public composition (no auth, strict projection, s-maxage=60 cache header)

### Storefront + admin UI
- [x] `src/app/page.tsx` — thin async server component rendering through the registry; all 9 renderers take `HomepageSectionRendererProps`
- [x] `/admin/homepage` — tabs + `SectionsEditor` + `ContentEditor` (section-scope picker) + `ImageField` (existing `/api/upload` S3 flow); sidebar «صفحه اصلی» entry
- [x] `use-admin-homepage.ts` React Query hooks; `src/types/index.ts` homepage types

### Verification
- [x] `scripts/verify-homepage-cms.js` — **13/13 PASS** (real API + real DB: authz, bootstrap seed, public composition + leak scan, unknown-component fail-safe, shared-renderer isolation, slug/component immutability, visibility/draft/soft-delete rules, publishedAt stamping, per-type CRUD + validation, malformed ObjectId → 400)
- [x] `npx tsc --noEmit` zero errors; build passes; lint clean on new files; code review approved (fixes: `isValidObjectId` guards → 400, E11000-race-tolerant seed, unused-code cleanup); regression runner → **30 suites** (`verify-homepage-cms` after `verify-coupons-marketing`)
- [x] **Ops:** model changes ⇒ dev-server restart required — performed (fresh boot after system restart; `/api/homepage` confirmed live)

## 🔄 Next Task (Session 54 — Best-Sellers Rail)

**Approved milestone order (user decision):** Session 52 = mobile dashboard nav fix ✅; **Session 53 = Homepage CMS ✅ (completed)**; **Session 54 = best-sellers rail** (client-side, reuses the existing shared product pool — only if still needed after the CMS work). Deferred: scoped/free-shipping coupons (touch the hardened checkout price path; no shipping-fee model).

## 📋 Backlog (Future)

### UI / Components
- [ ] Add Dialog, DropdownMenu, Select, Table, Tabs, Avatar, Tooltip shadcn components
- [ ] Create reusable DataTable with sorting/pagination

### Payment
- [ ] Payment receipt/PDF download

### Authentication
- [ ] SMS/OTP verification
- [ ] Forgot password flow
- [ ] Social login (optional)

### Product
- [ ] Advanced inventory (warehouse, low-stock alerts)
- [ ] Dynamic storefront filters

### Reporting
- [ ] Sales reports
- [ ] Supplier performance reports
- [ ] Export to CSV/Excel

### Testing & DevOps
- [ ] Vitest + Testing Library + Playwright
- [ ] GitHub Actions CI, Docker, production deployment
- [ ] Sentry error monitoring
- [ ] Performance optimization (Core Web Vitals)

### Features
- [ ] Real-time notifications (WebSocket/SSE)
- [ ] Multi-language support (i18n with next-intl)
- [ ] Review and rating system
- [ ] Discounts, coupons, promo codes
- [ ] Customer support (ticket system)
- [ ] A/B testing with Edge Middleware
- [ ] Analytics integration
