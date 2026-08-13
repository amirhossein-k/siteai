# Changelog

## Session 81 (August 2026) — Accounting-Ready Reports & Excel Exports

### The approved scope — a server-backed, accounting-aware reporting subsystem (expanding `/admin/analytics`)
- **9 reporting services** in `src/lib/reports.ts` (admin-only, MongoDB aggregation, no browser-side computation): `getDashboardReport` (summary cards + inventory value + payables), `getSalesReport`, `getOrdersReport`, `getPaymentsReport`, `getRefundsReport`, `getCouponReport`, `getCustomerSalesReport`, `getInventoryReport`, `getProfitLossReport` — each with a bounded date range, shared filters, and server-side pagination. Pure helpers split into `src/lib/report-utils.ts` (date-preset resolution incl. custom range, `roundToman`, percent helpers, availability guards) — 25 hermetic unit tests.
- **Historical financial accuracy (no current-price leakage for sales/profit):** sales, COGS and gross profit derive from **immutable Order/OrderItem snapshots**, never the current Product price. `items[].price` (actual paid unit price), `originalPrice` (pre-product-discount) and `discountAmount` (Session 77) are used as-is; `items[].supplierPrice` is the **historical COGS** — a fixed per-sale cost snapshot captured at purchase (NOT FIFO/weighted-average purchase costing; no procurement ledger exists), so later price changes never distort historical profit. **Inventory value is the documented exception:** `current stock × current supplierPrice` — a current-cost approximation, not an accounting-grade valuation (cost layers are not recorded). Where a legacy order lacks `originalPrice`, the delta is attributed to an unallocated discount bucket instead of being fabricated.
- **Reconciliation invariant:** order-level coupon discounts are allocated **proportionally by line net** so every sales report reconciles exactly: Σ line net sales + Σ allocated coupon discounts = Σ `order.totalAmount`. Coupon discounts (order-level) and product discounts (line-level, from snapshots) are **never double-counted**.
- **2 additive admin APIs:** `GET /api/admin/reports/[report]` (typed filter validation, unknown report → 404, admin-only via `requireRoleOrError`) and `GET /api/admin/reports/[report]/export` (admin-only + new `REPORT_EXPORT_LIMIT` 10/actor/15min) returning a real `.xlsx` binary (no CSV fallback). Query shapes: `from/to` ISO dates (bounded, invalid → 400), `page`, `limit` (capped 500), plus report-specific filters (`productId`, `categoryId`, `q`, `orderStatus`, `paymentStatus`, `paymentMethod`, `couponId`, `sort`/`dir` on a whitelist).
- **Professional Excel export via `exceljs`** (new dep — the only .xlsx-capable library; project had only `csv-stringify`): multi-sheet workbooks (`Summary` + report-specific sheets), Persian sheet names, styled header row + **freeze panes + auto-filter + column widths + number/date/percent formats**, totals row, explicit «نامشخص»/«در دسترس نیست» placeholders for genuinely unsupported metrics (taxes/shipping cost/net profit) — **no fake zeros**. Dashboard workbook: Summary + Sales + Orders + Payments + Inventory; per-report workbook: Summary + the report's own sheet.
- **Honest accounting boundaries:** taxes and shipping cost are **not stored** (omitted from reports / labeled N/A — never shown as zero), no purchase/procurement ledger (only `supplierPrice` cost snapshots → opening-stock value reconstructed; inventory value is a **current-cost approximation** and is documented as such in the inventory report UI), refunds are **whole-order** (`payment.status: refunded` + `refund.*`; no per-item quantities — the returns report shows order-level refund rows), no expenses ledger → **net profit beyond gross profit is labeled «در دسترس نیست»**. Low-stock classification uses a documented `MIN_STOCK_THRESHOLD` constant (no `minStock` field exists). Nothing is fabricated to fill a report.
- **UI:** sidebar «گزارشها» → `/admin/reports` (dashboard with 8 summary cards + report navigation grid) and `/admin/reports/[report]` detail pages (shared `report-filters` date presets + custom range, `report-table` with pagination, `summary-cards`, `export-button` with busy state, `report-nav`, `pnl-view` for the P&L). All client pages reusing the existing React Query + plain-table conventions; zero new UI library. `use-admin-reports.ts` hook (7/30/90-day analytics untouched).
- **No schema/model changes** — the subsystem is read-only aggregation over existing collections; **no migration**; backward compatible with zero impact on checkout/cart/payment/orders/coupons/discounts/SEO.

### Tests & verification
- **`tests/unit/report-utils.test.ts`** — **25 hermetic tests** (date-preset boundaries, custom range parsing, rounding/percent helpers, availability guards). Vitest **497/497** (472 + 25).
- **`scripts/verify-reports.js`** — **21/21 real-API** (self-cleaning, PREFIX'd seeded orders across two dates for a bounded custom range): 401/403 authz matrix, unknown-report 404, invalid `from`/`to` 400, dashboard shapes, **historical-price proof (line price from the order snapshot, not the current product price)**, sales-line aggregation + line-scoped product/category/q filters, coupon attribution, refund rows, inventory value from `supplierPrice` snapshots, P&L availability flags, export: non-admin 403, rate-limit 429, real `.xlsx` buffer with correct sheet names + a parsed `Σ net sales` cell matching the API value.
- **`tests/e2e/admin-reports.spec.ts`** (Journey, desktop) — dashboard renders summary cards, sales report shows seeded historical lines, P&L shows «در دسترس نیست» for net profit, Excel export downloads a valid `.xlsx`. Fixture helpers `createCategory`/`createProduct` made **idempotent** (reuse on 409) so re-run `beforeAll` cannot collide.
- **`scripts/run-regression.js`** — `verify-reports` added after `verify-admin-notifications` → **42 suites**; `regression.yml` renamed to **42-suite**.
- **Bugs found & fixed during implementation:** (1) sales-report line filters matched at the **order** level (a matching order dragged all its lines in) → refactored to a line-scoped pipeline with `$match` after `$unwind` on `items.product`/`items.name` (root-caused with a standalone aggregation probe); (2) E2E 409 slug collisions on `beforeAll` re-runs → idempotent fixtures; (3) P&L label/export-filename assertions aligned to the real rendered UI.
- **Verified:** tsc 0 · `npm run check` exit 0 (4 pre-existing warnings) · eslint on all new files clean · Vitest **497/497** · `verify-reports` **21/21** · targeted E2E **4/4** · Playwright **100/101** (the single failure — rich-description editor image — is a **confirmed pre-existing** external-host `loading="lazy"` flake, reproduced identically at clean HEAD `97ed3cf`) · full regression **42/42 PASS** (42 suites, real-sandbox server).

## Session 68 (August 2026) — Customer Communication / Order Support

### The approved scope (design-first Session 68 — order-linked conversations, split by SupplierOrder)
- **New `CustomerConversation` model** (additive; zero changes to `User`/`Order`/`SupplierOrder`/`Supplier`/`Product`): `customer` (ref) · `order` (ref) · `supplierOrder` (ref) · `supplier` (ref — **derived from the SupplierOrder, never the request body**) · `product` (optional ref, must belong to the supplier-order's items) · `category` (`general|delivery|product|refund|other`) · `subject` (1–120, sanitized) · `status` (`open|pending|resolved|closed`, default `open`) · `customerUnread` + `staffUnread` · `lastMessageAt` + `lastMessagePreview` + `lastMessageFrom` · `messages[]` (`sender` ref + `senderRole` customer|admin|supplier + `text` ≤2000 sanitized + `createdAt`) · `resolvedAt`/`closedAt`. **Unique partial index** `{ supplierOrder: 1 } where status ∈ (open, pending, resolved)` → one active conversation per (customer × supplier-order) — the approved multi-supplier decision: checkout already splits one `SupplierOrder` per supplier, so conversations are split the same way → cross-supplier leakage is structurally impossible. Queue index `{ supplier: 1, status: 1, lastMessageAt: -1 }` + `{ customer: 1, lastMessageAt: -1 }`. **Model change ⇒ dev-server restart required** (done).
- **Status machine (pure, unit-tested):** `open → pending` (staff message) · `pending → open` (customer message) · `open/pending → resolved` (customer or admin) · `→ closed` (customer closes own, or admin) · `→ open` reopen (customer or admin); **any message on `closed` → 400**; a message on `resolved` auto-reopens to `open` (approved decision). `canTransit(role, from, to)` encodes the transition table.
- **11 additive endpoints**, all behind `requireRoleOrError` with server-side ownership + **same-404 for not-found/not-owned** (no existence leak): customer — `POST /api/conversations` (create for OWN paid order: `Order.findOne({_id, customer: token.id})` + `isEligibleOrderPayment` (paid|refunded) + SupplierOrder-belonging + optional product-in-items; rate-limited 5/user/15min; E11000 → 409), `GET /api/conversations` (own list, status filter, paginated), `GET /api/conversations/eligible-orders` (own paid orders + grouped supplier-orders), `GET /api/conversations/[id]` (detail, **marks `customerUnread=false`**), `POST /api/conversations/[id]/messages` (15/actor/15min), `PATCH /api/conversations/[id]/status`. admin — `GET /api/admin/conversations` (all, status filter + subject/customer/order `search`), `GET/POST /api/admin/conversations/[id]` + `messages`, `PATCH .../status` (admin full access; detail marks `staffUnread=false`). supplier — `GET /api/supplier/conversations` + detail + messages (own `supplier` ref only; `Supplier.findOne({user: token.id})` → **same-404 for any other supplier's thread**; detail marks `staffUnread=false`). Malformed ObjectId → 400 everywhere (never a CastError 500); validation BEFORE the rate limiter.
- **Notifications via the existing `notifyOrderEvent` facade** (no second mechanism): new `support` category + `support_message` type; dedupe key `conversation_<id>_<messageId>` (per-message, unique partial index — exactly one per recipient); **templated Persian message, no message content in the payload**; customer messages notify the conversation's `supplier.user` only (admins monitor via the `/admin/support` queue + `staffUnread`, no per-message admin spam — approved decision); staff messages notify the customer. SSE bell + inbox `support` tab are automatic.
- **Rate limiting:** `CONVERSATION_CREATE_LIMIT` (5/user/15min) + `CONVERSATION_MESSAGE_LIMIT` (15/actor/15min); the regression runner's pre-suite rate-limit sweep now also clears `conversation-create`/`conversation-msg` keys (the verify suite is also self-cleaning).
- **Real-time (v1):** SSE bell + detail-page `refetchInterval` (~15s) + focus refetch; **no WebSockets** (per the approved design).
- **UI:** customer `/support` (list + create form prefilled from `?order=`) + `/support/[id]` (thread, composer, status actions) — account-menu item «ارتباط با مشتری», profile quick-link card, order-detail «ارتباط با مشتری» button (purchased orders only) · admin `/admin/support` + `/admin/support/[id]` (sidebar «پشتیبانی», status filters + search, reply, resolve/close/reopen) · supplier `/supplier/support` + `/supplier/support/[id]` (sidebar «ارتباط با مشتری», own threads only, reply-only — status owned by customer + admin, approved decision). Shared components under `src/components/support/` (`conversation-thread`, `conversation-list-item`, `conversation-status-badge`, `conversation-category`). New `src/components/ui/textarea.tsx`. Three React Query hooks + types.
- **Out of scope (v1, per the approved design):** text-only (no attachments/images/voice), no WhatsApp/Telegram external integration, no AI chatbot, no public anonymous chat, supplier reply-only, one conversation per supplier-order.

### Tests & verification
- **`scripts/verify-customer-support.js`** — **23/23 real-API** (self-cleaning, PREFIX'd): 401/403 matrix, create for own paid order 201 + supplier notified, duplicate active 409, foreign order 404, unpaid 400, eligible-orders shape, detail read clears `customerUnread`, cross-customer 404, customer message → open + `staffUnread` + notified, admin list filters + search, admin reply → pending + `customerUnread` + customer notified, unread/read flips, supplier S1 own-thread access (list + detail), unrelated supplier S2 detail/reply **404** + S2 list clean, supplier reply → customer notified, invalid transition 400, resolve/auto-reopen/close/closed-message-400/reopen, malformed ids → 400 (never CastError), message spam → 429, per-message notification dedupe.
- **`tests/unit/conversations.test.ts`** — **28 hermetic tests** over the pure `src/lib/conversations.ts` helpers (validation, eligibility, transition table incl. auto-reopen, preview formatting, notification templating + dedupe key). Vitest **254/254** total (226 + 28).
- **`tests/e2e/supplier-communication.spec.ts`** (Journey 17, desktop) — customer starts a conversation from a purchased order through the real `/support` UI, sends a follow-up; admin replies from `/admin/support`; the order's supplier replies from `/supplier/support`; the customer sees both replies. Paid Order + SupplierOrder seeded directly in DB (cleanup via the extended `tests/e2e/helpers/db.ts`). Teardown extended for conversations.
- **`scripts/run-regression.js`** — `verify-customer-support` added after `verify-supplier-applications` → **39 suites**. `regression.yml` renamed to **39-suite**.
- **Verified:** tsc 0 · `npm run check` exit 0 (4 pre-existing warnings) · Vitest **254/254** · `verify-customer-support` **23/23** · Playwright **52/52 PASS** (chromium 40 incl. **Journey 17** + mobile 12) · full regression **39/39 PASS** (39 suites, final hardened run).

## Session 67 (August 2026) — Public Supplier Application + Admin Approval Queue

### The approved scope (design-first Session 67 — the Session 66 audit's explicitly out-of-scope item)
- **Public application path (new).** The ONLY supplier-creation path was admin-only (`/admin/suppliers`); there was no way for a customer to apply. Session 67 adds an additive public flow while the applicant **stays `role: "customer"`** until an admin approves — self-role-assignment is impossible by construction.
- **New `SupplierApplication` model** (additive; zero changes to `User`/`Supplier`): `user` (ref) · `businessName` (2–80, trimmed) · `description` (≤500, capped to `Supplier.description`) · `contactPhone` (defaults to the user's phone at submit) · `status` (`pending|approved|rejected`, default `pending`) · `adminNote` (≤500, set on decision) · `decidedBy`/`decidedAt`. **Unique partial index** `{ user: 1, status: 1 } where status: "pending"` → one open application per user (E11000 → 409 «درخواست قبلی در انتظار بررسی است»); rejected applicants may re-apply. Admin queue index `{ status: 1, createdAt: -1 }`.
- **Public endpoint `POST /api/supplier-applications`** (customer-only, 403 for other roles): rate-limited `SUPPLIER_APPLICATION_LIMIT` 2/user/15min + `SUPPLIER_APPLICATION_IP_LIMIT` 5/IP/15min; validations (businessName 2–80, description ≤500, contactPhone defaulted); pending-dedup 409; creates the row and notifies **all admins** (`supplier_application`). **Never touches role or the Supplier collection.**
- **`GET /api/supplier-applications/me`** (customer-only) — the applicant's latest application + status (drives the public page state).
- **Admin queue endpoints** `GET + PATCH /api/admin/supplier-applications` (admin-only, `SUPPLIER_APPLICATION_DECISION_LIMIT` 30/actor/15min): `GET` returns pending-first with populated applicant; `PATCH { action: "approve" | "reject" }` is **atomic** — a single request decides + (on approve) provisions the Supplier doc seeded **from the application** (`businessName`/`description`, unlike the change-role default of `user.name`), flips the applicant's role to supplier, **bumps `tokenVersion` + evicts the cache** (old customer sessions revoked immediately — Session 64/66 invariant), sets `decidedBy`/`decidedAt`, and notifies the applicant (`supplier_approved`/`supplier_rejected`). Only `pending` rows are decidable (400 otherwise); malformed ObjectId → 400, unknown → 404.
- **Behavior-preserving refactor:** `src/lib/supplier-provision.ts` (new) extracts `ensureSupplierForUser(user, { businessName, description })`; the Session 66 `PATCH /api/admin/users` change-role path now calls it (same default semantics: businessName = user.name), so there is exactly ONE provisioning implementation. No duplicate supplier-creation API was added.
- **Notification enums:** `Notification.type` gains `supplier_application` / `supplier_approved` / `supplier_rejected` (category `system`); the `notifyOrderEvent` facade is reused (never-throws, SSE + Telegram adapters). **Model change ⇒ dev-server restart required** (done).
- **Public UI:** new `/become-supplier` page (anonymous → sign-in prompt; logged-in customer → «فروشنده شوید» form with business name + description, submits via the API, shows the «در انتظار بررسی» state; already-approved/rejected → status view with the admin note; supplier/admin roles → redirect/notice). Entry points: footer link («فروشنده شوید»), account-menu item, and a CTA on the `/suppliers` listing page. Zero changes to `auth.js`/OTP/password login/middleware/RBAC role logic/Supplier ownership.
- **Admin UI:** «درخواستهای فروشندگی» tab on `/admin/suppliers` — `SupplierApplicationsPanel`: pending cards (applicant info, business profile, optional note, atomic approve/reject), decided history below (status badge + admin note). The panel renders history even when the queue is empty (an early-return bug that hid the history after the last pending item was decided was caught by Journey 16 and fixed).
- **Out of scope (unchanged):** no anonymous applications (must be an existing logged-in customer), no edits/withdrawals, no application deadlines, no new packages.

### Tests & verification
- **`scripts/verify-supplier-applications.js`** — **16/16 real-API**: unauth 401, customer 403, non-customer submit 403, submit validation (400 short businessName), pending-dedup 409, submit creates pending row + applicant stays customer, `me` status, admin queue GET (pending-first, populated), approve → Supplier seeded from application + role flipped + **old customer session 401** + applicant notified, approve non-pending → 400, reject → role untouched + notified, re-apply after rejection works, decided history, admin authz.
- **`tests/unit/supplier-application.test.ts`** — **15 hermetic tests** over the pure `src/lib/supplier-application.ts` helpers (validation, transition rules, decision payload parsing, dedup error mapping). Vitest **226/226** total (211 + 15).
- **`tests/e2e/supplier-application.spec.ts`** (Journey 16, desktop) — customer applies through the `/become-supplier` UI → admin approves via the queue tab → old session revoked (401) → management list contains the auto-provisioned supplier → fresh login reaches the supplier panel. Dedicated per-run applicant (never the shared seeded customer, whose tokenVersion must not be bumped). Teardown cleanup extended in `tests/e2e/helpers/db.ts` (applications + rate-limit keys).
- **`scripts/run-regression.js`** — `verify-supplier-applications` added → **38 suites**. `regression.yml` updated (38-suite comment/name).
- **Verified:** tsc 0 · `npm run check` exit 0 · Vitest **226/226** · `verify-supplier-applications` **16/16** · Playwright **51/51 PASS** (chromium 39 incl. Journeys 15 + 16 + mobile 12) · full regression **38/38 PASS**.

## Session 66 (August 2026) — Supplier Onboarding v1: Admin Supplier Management + Deactivation Enforcement

### The approved scope (architect-recommended Session 66 — design-first audit approved)
- **Dedicated `/admin/suppliers` page** (new) — the discoverable home for Supplier onboarding: list (management shape, active + inactive), create via the shared `CreateUserModal` (role defaults to supplier), promote an existing customer via a searchable modal, deactivate/reactivate per row, and a «تسویه» link into `/admin/payouts`. Sidebar gains «فروشندگان».
- **No duplicate supplier-creation API.** Creation and promotion reuse the EXISTING `POST /api/admin/users` (role=supplier) and `PATCH /api/admin/users` (change-role) flows — the auto-provisioning of the Supplier document (businessName=name, contactPhone=phone, user back-link) is preserved byte-for-byte.
- **`GET /api/admin/suppliers?all=true`** — additive management branch (wallet figures + populated user + isActive). The default no-param response stays the active-only dropdown shape used by product forms (`useSuppliers`) — unchanged.
- **Deactivation enforcement (the audit gap):** `PATCH toggle-active` on a supplier now ALSO flips the linked `Supplier.isActive` (previously only `User.isActive` flipped, so the storefront kept showing deactivated suppliers) **and** bumps `tokenVersion` + evicts the cache → the supplier's live sessions die immediately. Reactivation restores both flags (public storefront reappears).
- **Role-change session revocation:** any `change-role` bumps `tokenVersion` + evicts the cache → the user's old-role sessions are revoked instantly (they must log in again to obtain the new role claim).
- **Shared component:** the «ایجاد کاربر جدید» modal was extracted from `/admin/users` into `src/components/admin/create-user-modal.tsx` and reused by both pages (identical UI/flow; the users page is byte-equivalent behaviorally).
- **Out of scope (per the approved audit):** NO public Supplier registration, NO application/approval queue. Supplier accounts remain admin-created only (RBAC design preserved). Zero changes to auth.js / OTP / password login / middleware / Supplier ownership rules / payout logic.
- **Types/hooks:** `AdminSupplier` type + `use-admin-suppliers.ts` (`useAdminSuppliers`, `useToggleSupplierActive`, `usePromoteToSupplier` — the mutations wrap the existing users PATCH, no new endpoints).

### Tests & verification
- **`scripts/verify-suppliers-onboarding.js`** — **14/14 real-API**: unauth 401, customer 403, admin creates supplier (201 + auto-provisioned Supplier doc + back-link + defaults), management-shape GET, dropdown-shape unchanged, customer→supplier promotion (Supplier auto-created + old customer session 401), promoted supplier login + panel access, deactivation (User + Supplier isActive=false), public-surface hiding (list exclusion + detail 404), deactivation session revocation (401), reactivation (flags restored + public visibility back).
- **`tests/e2e/admin-suppliers.spec.ts`** (Journey 15, desktop) — 2 tests: admin sees the seeded supplier and creates one through the UI modal (row appears + management API confirms the provisioned user); admin deactivates (UI toggle + public list hiding) then reactivates (public visibility restored).
- **`scripts/run-regression.js`** — `verify-suppliers-onboarding` added after `verify-suppliers` → **37 suites**.
- **Verified:** tsc 0 · `npm run check` exit 0 · Vitest **211/211** (unchanged — no pure-lib change) · `verify-suppliers-onboarding` **14/14** · Playwright **50/50 PASS** (chromium 38 incl. Journey 15 + mobile 12) · full regression **37/37 PASS**.

## Session 64 (August 2026) — Session Security: tokenVersion Enforcement + Password Change + Logout All + Admin Revoke

### The approved scope (architect-recommended Session 64)
- **`src/lib/token-version.ts`** (new) — pure, injectable `createTokenVersionChecker` factory (no mongoose imports): per-user cache (default 60s TTL), **asymmetric cache semantics** (equal → valid; cached NEWER than token → revoked; cached OLDER than token → stale-cache refetch so a fresh sign-in is never falsely revoked), deleted-user → revoked, checker error → **fail-open with a logged error** (a DB blip must never break authentication). Unit-tested hermetically with injected deps — 16 tests.
- **`src/lib/auth-utils.ts`** — `getServerToken` (the shared gate behind `requireAuth`/`requireRoleOrError`) now enforces revocation: after extracting the JWT it compares `token.tokenVersion` (Session 62) against the User's current version via the checker, returning null (→ 401) for revoked sessions. Cache lives on `globalThis` (HMR-safe, notification-stream pattern). **`invalidateTokenVersionCache(userId)`** exported for the in-process bumping routes so revocation is immediate in the same server. **Every protected API route inherits the gate — zero per-route changes.**
- **`POST /api/auth/change-password`** (new) — authenticated, rate-limited 5/15min (user-keyed): password users must supply a correct `currentPassword` (bcrypt compare → 400 «رمز عبور فعلی صحیح نیست»); **passwordless OTP-registered users set their FIRST password without `currentPassword`** (the missing hash means nothing to verify); newPassword 6–100 chars; on success `passwordHash` updated AND `tokenVersion` bumped + cache evicted → **every session (incl. the current one) revoked**. The profile UI signs out and sends the user to re-login with the new password.
- **`POST /api/auth/logout-all`** (new) — authenticated, rate-limited 10/15min: bumps the caller's `tokenVersion` (+ cache evict) → **every device's session revoked**; the client then calls `signOut()` to clear the local cookie.
- **`POST /api/admin/users/[id]/revoke-session`** (new) — admin-only (RBAC 403 for non-admins), rate-limited 30/15min (actor-keyed): bumps the TARGET user's `tokenVersion` (+ cache evict) → that user's sessions die within the enforcement window; admin's own session unaffected. Malformed ObjectId → 400 (Session 53 convention, never a CastError 500); unknown user → 404.
- **`GET /api/profile`** — additive `hasPassword: boolean` (hash never serialized) so the UI renders the right flow (current-password field vs first-password set).
- **Profile page** — new **«امنیت حساب»** card (Session 63's page): current/new/confirm password fields (proper `htmlFor`/`id` — the missing label association was caught by Journey 14's `getByLabel`), «تغییر رمز عبور» / «ثبت رمز عبور» button (success → toast + `signOut({ callbackUrl: "/login" })`), and **«خروج از همه دستگاه‌ها»** button (+ explanatory hint).
- **Invariants held:** zero changes to `auth.js` password/loginToken branches, `middleware.js`, RBAC role logic, OTP flow, checkout/payment/orders/coupons/inventory, models (no schema change — `tokenVersion` already existed), and zero new packages. Model untouched → **no dev-server restart strictly required** (but one was performed to load the new gate).

### Tests & verification
- **`tests/unit/session-security.test.ts`** — 16 hermetic tests (cache hit/miss/TTL, per-user isolation, asymmetric stale-cache refetch, newer-cache revoke, eviction helper, deleted user, fail-open + re-enforcement).
- **`tests/e2e/session-security.spec.ts`** (Journey 14, desktop chromium only) — 4 tests: change-password via the UI (wrong current 400 + session survives; correct change → old cookie 401 on a second context + redirect to login; old password fails, new logs in), logout-all (second device's pre-bump cookie 401 + local session cleared), admin revoke (customer browser session 401, found via the admin users API), and anonymous 401s on all three endpoints. **One shared customer for the whole journey** — a single `/api/register` call, keeping the journey under the shared per-IP register limiter (5/15min) that global-setup + the OTP journey also consume.
- **`scripts/verify-session-security.js`** — **11/11 real-API**: unauth 401, wrong-current 400, correct change (tokenVersion bump + hash swap DB-asserted + pre-change cookie revoked = enforcement-window proof), old/new password, passwordless-first-password via OTP-registered user, logout-all (both sessions revoked, fresh login works), admin revoke (customer 401, admin unaffected), malformed → 400, unknown → 404, non-admin → 403.
- **`scripts/run-regression.js`** — `verify-session-security` added after `verify-logout` → **36 suites**; `.github/workflows/regression.yml` 35 → 36.
- **Verified:** tsc 0 · `npm run check` exit 0 (same 4 pre-existing warnings) · Vitest **199/199** (183 + **16 new** session-security unit tests) · Playwright **48/48 PASS** (chromium 36 incl. Journey 14 + mobile 12, exit 0) · `verify-session-security` **11/11** · full regression **36/36 PASS**.

## Session 63.1 (August 2026) — Wishlist & Coupons Header Entry-Point Gating (Targeted Fix)

- **Root cause (traced + reproduced):** the wishlist **page** (`!session || role !== "customer"` → sign-in prompt) and **API** (403 for non-customers) are customer-only, but Session 63's header (desktop nav link + heart icon) and account-menu item were surfaced to **all** authenticated roles — an authenticated **admin** landed on the «برای دیدن علاقه‌مندی‌های خود وارد حساب شوید» prompt. Live API probes proved customers (password + OTP registration) see their wishlist correctly; the regression only hit non-customer roles.
- **Fix (UI-only, additive):** `storefront-header.tsx` — the wishlist nav link + heart icon now render only for `role === "customer"`; the «کدهای تخفیف» nav link now renders only when a session exists (hidden for anonymous visitors). `account-menu.tsx` — the علاقه‌مندی‌ها item is customer-only. `useWishlistIds` verified already role-gated (`enabled: authenticated && customer`) — no spurious 401/403 requests for other roles.
- **Tests:** Journey 13 grew to **7 tests** — new test: an authenticated admin browsing the storefront sees **no** wishlist entry (nav link + heart + account-menu item) and still sees the coupons link; customer + anonymous journeys assert the session-gated coupons entry. The positive coupons assertion is desktop-viewport-gated (`width >= 1024` — the `hidden lg:flex` nav is absent from the mobile a11y tree); all negative `toHaveCount(0)` assertions hold on both projects.
- **Verified:** tsc zero errors · `npm run check` exit 0 (same 4 pre-existing warnings) · Vitest **183/183** (unchanged) · Playwright **44/44 PASS** (chromium 32 incl. Journey 13 + mobile 12, exit 0) · `verify-logout.js` **6/6** · zero auth/API/model/middleware/RBAC/OTP/password changes · no dev-server restart.

## Session 63 (August 2026) — Logout / Sign-out for Authenticated Users (Additive UI)

### Scope (approved design — pure additive UI + tests; zero auth/API/model changes)
- **Storefront account menu** `src/components/storefront/account-menu.tsx` (new) — replaces the header's plain profile `<Link>` when signed in. Desktop + mobile (tap-driven), RTL-anchored (`left-0` against the icons cluster at the RTL end). A11y (Session 61 discipline): trigger `aria-haspopup="menu"` + `aria-expanded`, panel `role="menu"` + `role="menuitem"`, Escape closes + returns focus to the trigger, outside pointer-down + route-change close, focus moves into the panel on open. Items: پروفایل / سفارشات / علاقه‌مندی‌ها / اعلان‌ها + separator + **خروج** (`signOut({ callbackUrl: "/" })` — immediate, no confirmation, matching the admin/supplier sidebar).
- **Profile page** `src/app/(storefront)/profile/page.tsx` — «خروج از حساب» button (outline + destructive) in the Account Info card.
- **Admin/supplier dashboards** — UNCHANGED (their sidebar logout already works on desktop + the mobile drawer; verified by tests).
- **Logout mechanics:** rides the built-in NextAuth `POST /api/auth/signout` — the JWT cookie (`next-auth.session-token`) is cleared client-side and the user is redirected to `/` for all roles. **Zero changes to `src/lib/auth.js`, `middleware.js`, `auth-utils`, models, RBAC, OTP, password login, or any API route** — the `/admin` + `/supplier` middleware guards are exercised as the post-logout re-entry check. No new packages (hand-rolled dropdown). No dev-server restart needed (no model change).
- **Tests:** Journey 13 `tests/e2e/logout.spec.ts` (customer header-menu logout + session-cookie-gone assertion, customer profile-page logout, post-logout profile prompt, admin + supplier sidebar logout with post-logout `/admin`+`/supplier` → `/login` middleware guards — responsive: opens the mobile drawer < lg — and the anonymous negative case); the mobile project's `testMatch` now includes the logout spec; the existing `customer-login` journey's profile-link assertion was updated to the new account-menu trigger (UI change only). **`scripts/verify-logout.js`** (6/6 real-API: unauth GET signout 200 + no session, admin login → signout → session null → re-login works, customer signout) wired into `run-regression.js` (**35 suites**) + `regression.yml` 34 → 35.
- Verified: `tsc` zero errors, scoped eslint clean (gate scope), Vitest **183/183** (unchanged), Playwright **42/42 PASS** (chromium 31 incl. Journey 13 + mobile 11, exit 0), `verify-logout.js` **6/6**, full regression **35/35 PASS**. Code review approved. See AUTHENTICATION.md.

---

## Session 62 (August 2026) — SMS/OTP Authentication (Adapter-First, Backward Compatible)

### Scope (approved design — additive auth layer; zero changes to existing password auth)
- **Model:** `OtpCode` (new) — SHA-256 `codeHash` only (plaintext never stored in production), `attempts`, `codeConsumedAt` (code single-use) + `consumedAt` (login-token single-use — kept separate so verify and exchange are each single-use), `loginTokenHash`/`loginTokenExpiresAt` (TTL-aligned with the row), `devPlaintextCode` (mock-only), TTL index (2-min lifetime). `User` — `passwordHash` now **optional** (`default: null` — OTP-registered customers are passwordless) + additive **`tokenVersion`** (Number, default 0; stored in the JWT at sign-in — the session-revocation foundation; enforcement is future work). **Model change ⇒ dev-server restart required** (done).
- **OTP layer** `src/lib/otp.ts` — `crypto.randomInt` 6-digit codes, SHA-256 hashing for codes + login tokens, phone normalization (+98/0098 → 09), constants (2-min TTL, 60s cooldown, 5-attempt lock, 2-min token TTL).
- **SMS abstraction** `src/lib/sms.ts` — **adapter-first**: mock (`NODE_ENV=development` AND `SMS_MOCK=1` — code logged + stored as `devPlaintextCode`), **sms.ir** production provider (disabled until BOTH `SMS_IR_API_KEY` + `SMS_IR_TEMPLATE_ID` are configured; `POST /api/sms.ir/v1/send/verify` with `x-api-key`, `{ mobile, templateId, parameters:[{name:"Code",value}] }`), or **none** → controlled `SMS_NOT_CONFIGURED` → request API returns 503; local dev/CI never need an sms.ir account. `.env.example` documents the future vars only.
- **API routes** (all under `/api/auth/otp/`): `request` (validation **before** the rate limiter; per-phone 5/15min + per-IP 15/15min; 60s resend cooldown → 429 + Retry-After; register purpose 409 on existing phone; **login purpose anti-enumeration** — unknown phones get the same `200 {sent:true}` and nothing is created/sent) · `verify` (per-phone 5/15min brute-force guard; wrong code → attempts++ with 5-attempt lock; correct code → creates the passwordless customer for register / requires the account for login; issues a one-time `loginToken` — hash stored, TTL ≤ remaining row life) · `dev-last` (mock-only code reader for E2E/verify suites; 404 everywhere else — no plaintext exists).
- **NextAuth `CredentialsProvider`** — additive `loginToken` branch in `authorize()`: rate-limited exactly like password login, then the one-time token is claimed **atomically** (`updateOne({ _id, consumedAt: null })`) so replay is impossible; password branch byte-for-byte unchanged. `jwt`/`session` callbacks now carry `tokenVersion` **and** `phone` (completing the long-declared `session.user.phone` contract — additive). `src/types/next-auth.d.ts` augmented (`phone`, `tokenVersion` on Session/JWT).
- **UI** — login/register pages gained a method toggle («ورود با رمز عبور» / «ورود با کد یک‌بارمصرف»; «ثبت‌نام با رمز عبور» / «ثبت‌نام با کد یک‌بارمصرف»), **password stays the default tab** and is untouched. Shared `OtpPanel` (request → verify → `signIn(loginToken)`) + `OtpCodeInput` (labelled, `inputMode=numeric`, `autocomplete=one-time-code`). Toggle inactive-tab text uses zinc-600/zinc-400 (the muted-on-muted combo measured 4.39:1 — axe `color-contrast`).
- **Tests:** unit `otp.test.ts` (normalization/generation/hashing/expiry/constants) + `sms.test.ts` (provider resolution + sms.ir adapter with injected fetch — mock never touches the network; controlled errors never throw) · **Journey 12** `tests/e2e/otp-login.spec.ts` (OTP registration, OTP login for an existing password user, wrong-code rejection — reads the code via the dev-last seam exactly like an SMS inbox) · **`scripts/verify-otp.js`** (11/11 real-API: mock seam, request/cooldown/anti-enumeration, wrong+correct code, token exchange + replay rejection, OTP-for-password-user, passwordless-can't-password-login + password user still can, per-IP cap 429) — wired into `run-regression.js` (**34 suites**) whose pre-suite rate-limit sweep now also clears the OTP keys. `playwright.config.ts` CI webServer env gains `SMS_MOCK=1`; the E2E teardown + runner clear `otp_request/otp_request_ip/otp_verify` keys.

### Invariants
- **Zero changes to the password auth path** (rate limits, bcrypt, redirects — untouched); RBAC architecture, middleware, auth-utils contracts, checkout/payment/order/coupon/inventory — untouched. `session.user.phone` completion + `tokenVersion` are additive. No new npm dependencies (`crypto` is builtin).

### Verification
- `npx tsc --noEmit` **zero errors**; `npm run check` passes (scoped ESLint 0 errors, 4 pre-existing warnings).
- Vitest **183/183** (158 pre-existing + **25 new** OTP/SMS unit tests).
- Playwright **30/30 PASS** (chromium 25 — prior 22 incl. the 6 axe scans + 3 new OTP journeys — + mobile 5, exit 0); the login/register axe scans stay clean (toggle contrast fixed) and the existing `customer-login` spec was updated with `exact: true` on its «ورود» locator (the new tab labels contain «ورود» as a substring — behavior identical).
- **`scripts/verify-otp.js` 11/11 PASS**; full sequential regression **34/34 PASS** (all prior suites green — password auth fully compatible).

### Review fixes / found during validation
- **Single-use split bug (caught by E2E):** verify originally consumed the row (`consumedAt`) when issuing the login token — which `authorize()` also required to be null → the token could never be exchanged. Fixed by splitting `codeConsumedAt` (code) from `consumedAt` (token); both are single-use, independently.
- `sms.test.ts` env literals typed as `SmsEnv` (`Record<string, string | undefined>`) — `NodeJS.ProcessEnv` demands a literal `NODE_ENV` key.
- `verify-otp` `uniquePhone()` was 12 digits (09+8+2) — corrected to 11; the mock-seam check now issues a real request first (dev-last alone 404s when no code exists).

## Session 61 (August 2026) — Performance & Accessibility: next/image Migration + axe-core E2E Gate

### Scope (approved design — additive front-end + test infra; zero business-logic changes)
- **Storefront `next/image` migration** — all **12 storefront image components / 17 `<Image>` instances** (product card, quick-categories, product detail gallery + thumbnails, image lightbox, cart, checkout, order invoice, hero carousel, campaign banner, gift collections, supplier card + detail logo) converted from native `<img>` to `next/image` with `fill` + `relative` aspect containers (no layout shift), explicit `sizes`, and `loading="eager"` only where above-the-fold (the rest inherit lazy). All `onError` placeholder fallbacks preserved — behavior unchanged. **Zero business-logic changes, no model/schema/index/database changes, no money-flow or API behavior changes.**
- **`next.config.ts` `images.remotePatterns`** — additive allowlist derived from env at config-load time (never from user input): `LIARA_ENDPOINT` hostname (fallback to the project's known Liara host `c589564.parspack.net` so env-less builds still work), `NEXT_PUBLIC_APP_URL` when set, and `localhost` (http+https) for dev. Optimizer stays enabled (AVIF/WebP + responsive srcset).
- **Migration-completion hardening (found during E2E validation, not in the original plan):** `next/image` throws a RENDER-TIME error on unconfigured hosts — where native `<img>` just degraded to a broken image/placeholder. A shared client-side guard **`isAllowedImageSrc`** (`src/lib/utils.ts`, mirroring the remotePatterns allowlist incl. same-origin relative paths) is applied across all 12 storefront image components, so any admin-entered/hotlinked URL outside the allowlist falls back to the existing placeholder instead of crashing a section. (The dev DB carried leftover `example.com` placeholder image URLs that crashed the homepage + catalog under the migration — the guard restores the old degrade-to-placeholder behavior.) Two further audit findings fixed: **`hero-carousel`** hidden slides gained `inert` (axe `aria-hidden-focus` — focusable CTA links inside `aria-hidden` slides) and the shared **`Badge`** success/warning variants moved from white-on-500 (2.2–2.5:1) to the -700 shades (≥4.5:1, WCAG AA) after the product-detail scan flagged `color-contrast`.
- **Accessibility fixes from the audit** (in-scope files only): `search-suggestions.tsx` — `aria-selected={false}` on listbox options (WAI-ARIA contract; keyboard nav explicitly out of scope — no behavior change); `image-lightbox.tsx` — backdrop is now a labelled `<button>` (`aria-label="بستن"`, `tabIndex={-1}`, same tab order as the old click-only div) and the zoom container is a labelled `<button>`; `storefront-header.tsx` — Persian `aria-label`s on the icon-only wishlist/cart/profile links. `hero-carousel` + `mobile-drawer` were audit-verified already-compliant (no changes needed).
- **`@axe-core/playwright` devDep** + **`tests/e2e/accessibility.spec.ts`** (Journey 11) — axe-core (wcag2a/2aa/21a/21aa) scans homepage, catalog, product detail, supplier detail, login, register (desktop chromium project only) and asserts **zero serious/critical violations**; all-impact violations are logged for debuggability; `OUT_OF_SCOPE_RULE_IDS` documents any future out-of-scope findings (empty when the scanned pages are clean). Runs as part of `npm run e2e` → automatically inside the Session 60 `ci.yml` e2e gate — no new CI wiring.
- **`PERFORMANCE.md` (new)** — documents the image pipeline, remotePatterns allowlist, loading strategy, the remaining admin/supplier native `<img>` debt (deliberately NOT converted — out of approved scope), and the axe gate.

### Files
- **Converted (12):** `src/components/storefront/product-card.tsx` · `src/components/storefront/supplier-card.tsx` · `src/components/storefront/image-lightbox.tsx` · `src/components/storefront/home/{hero-carousel,campaign-banner,gift-collections,quick-categories}.tsx` · `src/app/(storefront)/products/[slug]/page.tsx` · `src/app/(storefront)/cart/page.tsx` · `src/app/(storefront)/checkout/page.tsx` · `src/app/(storefront)/suppliers/[id]/page.tsx` · `src/components/orders/order-invoice.tsx`
- **Config/deps:** `next.config.ts` (remotePatterns) · `package.json` + `package-lock.json` (`@axe-core/playwright` ^4.12.1)
- **Accessibility:** `src/components/storefront/search-suggestions.tsx` · `src/components/storefront/storefront-header.tsx` · `src/components/storefront/image-lightbox.tsx` (also in the conversion list — backdrop/zoom buttons) · `src/components/storefront/home/hero-carousel.tsx` (inert on hidden slides) · `src/components/ui/badge.tsx` (success/warning contrast → WCAG AA)
- **Guard + tests:** `src/lib/utils.ts` (`isAllowedImageSrc`) · `tests/unit/utils.test.ts` (+5 tests) · **Test:** `tests/e2e/accessibility.spec.ts` (new, Journey 11) · **Docs:** `PERFORMANCE.md` (new) + `CHANGELOG.md`/`NEXT_SESSION.md`/`PROJECT_STATE.md`/`ROADMAP.md`/`TASKS.md`

### Verification
- `npx tsc --noEmit` zero errors; scoped ESLint 0 errors (4 pre-existing warnings — unchanged from Session 60); `npm run check` passes.
- Vitest **158/158** (152 pre-existing + **6 new** `isAllowedImageSrc` unit tests; the money-critical helpers are byte-for-byte untouched).
- Playwright **27/27 PASS** (chromium 22 incl. the 6 new axe scans + chromium-mobile 5, exit 0) — the axe spec scanned the live homepage/catalog/product-detail/supplier-detail/login/register pages and asserted **zero serious/critical violations** (the `color-contrast` finding on the shared success/warning Badge and the `aria-hidden-focus` finding on hero slides were both fixed; the register-page locator was corrected to the actual «ساخت حساب کاربری» heading).
- Full regression (33 suites) unchanged by definition — zero API/server/model code touched; no dev-server restart needed.

### Review fixes
- All code-reviewer findings addressed (see NEXT_SESSION.md for the audit + spec-review details).

## Session 60 (August 2026) — Production Readiness: CI/CD Pipeline (GitHub Actions)

### Scope (approved design — infra-only, zero application-code changes)
- **CI/CD** on top of the existing stack (Next.js 16 App Router + MongoDB `marlooai` + Vitest 152 + Playwright 21 + 33-suite real-API regression). The two test layers built in Sessions 58/59 finally get automated enforcement — the explicit remaining Production-Readiness gap. **Zero `src/` business-logic changes; no model/schema/database/index changes; no runtime behavior changes; no architectural refactors.** The only code-adjacent change is the deletion of the verified-dead `src/hooks/useOrders (1).js` (zero imports anywhere — a stray browser download artifact).
- **Lint-gate decision (documented):** the merge-gating static job runs `npx eslint src/lib tests/unit tests/e2e` — the surface the project actually keeps lint-clean (money-critical helpers + both test layers; verified **0 errors**, 4 pre-existing warnings). Project-wide `npm run lint` currently reports **174 PRE-EXISTING errors** (the whole-repo ESLint debt — `no-require-imports` across `scripts/*`, `no-explicit-any`, `set-state-in-effect`, `react-hooks/purity`, etc.); the repo convention has always been "ESLint clean on changed files", never whole-project, so a whole-project lint gate would be permanently red and was deliberately excluded. `next build` is also NOT a gate (Turbopack fails when Google Fonts are unreachable — the documented network constraint).

### Files
- **`.github/workflows/ci.yml`** (new) — three independent merge-gating jobs on push/PR with a concurrency group (superseded runs cancelled): `static` (npm ci → `npx tsc --noEmit` → scoped eslint) · `unit` (`npm test` — hermetic, no DB/network) · `e2e` (MongoDB **service container** `mongo:7` → `MONGODB_URI` env → `npx playwright install --with-deps chromium` + browser cache → `npm run e2e` → Playwright report/test-results artifacts uploaded **on failure only**, 7-day retention). **The E2E job needs ZERO secrets:** on a fresh CI database `global-setup` auto-seeds the admin (idempotent) + creates per-run supplier/customer through the real APIs; `playwright.config.ts` already carries the CI switches (fresh `npm run dev` webServer with `ZARINPAL_MOCK=1`, `retries: 2`, `reuseExistingServer: !CI`); CI-only `NEXTAUTH_SECRET`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` are inlined in the job env.
- **`.github/workflows/regression.yml`** (new, optional/non-gating) — the full **33-suite real-API regression** (`node scripts/run-regression.js`) on `schedule` (nightly 03:00 UTC) + `workflow_dispatch`. Needs the real sandbox/S3/Telegram values → mapped from **GitHub Secrets**; a runtime `Check secrets configured` step skips the run when `ZARINPAL_MERCHANT_ID` is unset (GitHub secrets cannot be referenced in `if:` directly — documented pattern). **Fresh-DB admin seed (reviewer fix):** the 33 suites hardcode the seeded admin (`09120000000`/`admin123456`) and assume it exists in the shared dev DB — on the empty service container the workflow runs `node scripts/seed-admin.js` (idempotent, env defaults match the suites' constants) BEFORE the server starts; without it every suite's first login would 401. ZARINPAL_MOCK is intentionally NOT set (the sandbox journey is what this workflow verifies). Dev-server boot via nohup + curl wait-loop; dev-server log uploaded on failure.
- **`package.json`** — added `check` script (`tsc --noEmit && eslint src/lib tests/unit tests/e2e`) — a green local equivalent of the CI static job (the original `&& eslint` variant was caught by validation: project-wide lint is red, so the scoped form is what actually passes).
- **`.env.example`** (gitignored, local-only) — added a CI/CD section documenting which secrets `regression.yml` needs.
- **`src/hooks/useOrders (1).js`** — **DELETED** (verified dead: zero imports/references across the repo; git history shows it was never wired in).

### Verification
- **YAML:** both workflows parse cleanly (js-yaml: `name/on/concurrency/jobs` key-set for each).
- **`npx tsc --noEmit`** — zero errors (unchanged).
- **Scoped ESLint** `npx eslint src/lib tests/unit tests/e2e` — **0 errors** (4 pre-existing warnings, exit 0); the `npm run check` script passes.
- **Vitest — 152/152 PASS** (9 files, unchanged).
- **Playwright — 21/21 PASS** (chromium 16 + chromium-mobile 5, exit 0; server run with `ZARINPAL_MOCK=1` — the Session 59 hermetic procedure).
- **No model/schema/index changes → no app restart; no runtime behavior change** (the dev server was restarted only as part of the E2E validation and left running as found).

### Review fixes (code-reviewer findings all addressed)
- Project-wide lint would fail CI — the static job and `check` script now use the scoped gate that actually passes, with the 174-error whole-repo debt documented (workflow header + CHANGELOG).
- **Fresh-DB admin gap (MEDIUM-HIGH):** `regression.yml` boots an empty `mongo:7` container but every verify suite logs in as the seeded admin that only exists on the persistent local DB → added an idempotent `node scripts/seed-admin.js` step (env defaults match the suites' `09120000000`/`admin123456` constants) before the server starts.
- **Ineffective Playwright browser cache (LOW):** the `actions/cache` step sat AFTER `npx playwright install` so it could never restore before the download — moved above the install step (+ comment).
- E2E job timeout raised 20 → 30 min for cold-runner headroom (LOW).
- `.env.example` CI section marks `ZARINPAL_CALLBACK_URL` as optional-only (NIT).
- Duplicate top-level `name` key in `regression.yml` caught and removed during authoring (YAML re-validated).
- Secrets-in-`if:` limitation handled via the runtime check step instead of a job-level `if` on a secret.

## Session 59 (August 2026) — Production Readiness: Playwright E2E (Tranche 1)

### Architecture (approved design — implemented as designed, no redesign)
- **Playwright E2E** on top of the existing stack (Next.js 16 App Router + MongoDB `marlooai` + NextAuth JWT). One bundled Chromium engine, two projects: `chromium` (full 10-journey suite) + `chromium-mobile` (Pixel 5 RTL smoke — the two highest-traffic customer journeys). `workers: 1`, `fullyParallel: false` — deterministic sequential execution against the shared dev DB (mirrors the 33-suite regression runner); per-run PREFIX isolation (`e2e_<ts>_`) makes scaling workers a config-only change later.
- **Auth strategy:** real credentials login via `GET /api/auth/csrf` → `POST /api/auth/callback/credentials` in `global-setup`; per-role `storageState` files (`tests/e2e/.auth/{admin,supplier,customer}.json`) consumed by the journeys; `customer-login` ALSO drives the real UI form (no storageState) proving the browser flow incl. wrong-password rejection.
- **Test data strategy:** per-run supplier (admin users API — auto Supplier doc) + customer (`/api/register`) with per-run phones; catalog fixtures (categories/products/variant-products/coupons) through the admin APIs; per-run PREFIX on phones/slugs/names + `E2E_<ts>_` coupon codes. `global-teardown` removes exactly the run's rows (id sets resolved from string fields → `_id: { $in }` deletes; referential rows through customer/supplier/coupon ids; slug-prefixed catalogs by anchored regex) + clears the login/register rate-limiter keys (Session 52 convention).
- **ZARINPAL_MOCK seam** — the session's ONLY `src/` change: `src/lib/zarinpal.ts` gains a fail-safe dev-only branch (`NODE_ENV=development` AND `ZARINPAL_MOCK=1`) replacing the interactive Zarinpal sandbox with a same-origin stub (`/api/payment/verify?Status=OK…`) so the payment journey is hermetic. Zero production behavior change (any other env → real sandbox; the regression suites run against the real sandbox with the env unset).
- **Flake prevention:** strict-mode-safe locators (`.first()` where badges + timelines repeat text), per-project unique slugs for the dual-project cart spec (beforeAll re-runs per project), orderId derived from the payment-result URL (the checkout response body is consumed by the page's own navigation), coupon codes derived from the run prefix (teardown match), `retries: 2` on CI.
- **Artifacts:** screenshot `only-on-failure`, video `retain-on-failure`, trace `on-first-retry`; `test-results/`, `playwright-report/`, `tests/e2e/.auth/` gitignored.

### Files
- **Config/scripts:** `playwright.config.ts` (new); `package.json` — `@playwright/test` devDep + `e2e` / `e2e:headed` / `e2e:install` scripts; `.gitignore` (artifact dirs); `.env.example` (`ZARINPAL_MOCK` documented — local-only; the file is gitignored by the pre-existing `.env*` rule).
- **Infra:** `tests/e2e/global-setup.ts` (rate-limit reset, idempotent admin seed, per-run supplier + customer + 3 storageStates + state.json), `tests/e2e/global-teardown.ts` (prefix cleanup + rl-key reset), `tests/e2e/helpers/{auth,db,fixtures,money}.ts` (API login, PREFIX cleanup, API-seeded fixtures incl. `createVariantProduct`/`createCoupon`/`placeOrder`, money/coupon math mirrors).
- **Journeys (10):** `customer-login`, `product-search`, `product-detail` (simple + 2-variant), `cart` (also mobile smoke), `checkout`, `coupon` (10% percent, UI + server math), `payment` (mock success + NOK cancel), `order-tracking`, `admin-order-workflow` (lifecycle + shipping metadata), `supplier-workflow` (confirm → ship).

### Review fixes (code-reviewer findings all addressed)
- **Coupon hermeticity (HIGH):** the coupon code is derived from the run prefix (`E2E_<ts>_COUPON`) so teardown's `^e2e_<ts>_` (case-insensitive) matcher removes it — the previous `E2E_<Date.now()>` leaked coupon rows permanently.
- **Supplier detail link (MEDIUM):** anchored `a[href^="/supplier/orders/"]` — the old `*=` also matched the bare `/supplier/orders` nav link.
- **Dead code (LOW):** unused `registerCustomer` + `productKey` helpers removed from `fixtures.ts`.
- Resolved during bring-up: the checkout/coupon/payment specs were filling the **postal-code** field instead of the **phone** field (empty phone → disabled submit → waitForResponse timeouts); strict-mode violations on repeated status texts; the dual-project cart slug collision; the response-body-unavailable-after-navigation issue on the payment success path.

### Verification
- **Playwright — 21/21 PASS** (chromium 16 + chromium-mobile 5; exit 0; dev server run with `ZARINPAL_MOCK=1`).
- `npx tsc --noEmit` — **zero errors**; ESLint — **clean on all changed files**.
- **Vitest — 152/152 PASS** (9 files, unchanged).
- Full sequential regression — **33/33 PASS, 0 skipped** (server run WITHOUT the mock — real sandbox behavior preserved; the seam is opt-in dev-only).
- **No model/schema/index changes** — no app restart required; the payment journey needs the dev server (re)started with `ZARINPAL_MOCK=1` (documented in the config + seam comment).

## Session 58 (August 2026) — Vitest Unit-Test Foundation

### Scope (approved design — no app changes, no redesign)
- **Zero-application-change invariant:** NO `src/` code was modified — no behavior changed, and no pure-function extraction was needed. This session adds test infrastructure + **152 hermetic unit tests** over the existing `src/lib` helpers. New devDeps only: `vitest` + `@vitest/coverage-v8` (precedent: `csv-parse`/`csv-stringify` in Session 51).

### Infrastructure
- **`vitest.config.ts`** (new) — node environment; explicit `@/` → `./src` alias (Vite does not read tsconfig paths); Windows-safe `forks` pool; tests in `tests/unit/*.test.ts`; **report-only** v8 coverage scoped to `src/lib/**/*.ts` (no fail threshold — coverage is a report, not a gate).
- **`package.json`** — scripts `test` (`vitest run`), `test:watch` (`vitest`), `test:coverage` (`vitest run --coverage`). tsconfig untouched — `**/*.ts` already includes `tests/**` and `vitest.config.ts`, so `npx tsc --noEmit` strict-type-checks the tests too.

### Test suite (9 files / 152 tests — all hermetic: no DB, no network; Mongoose models mocked via `vi.mock` + `vi.hoisted`)
- **sanitize** — HTML tag stripping, `javascript:` URLs, `on*` handlers, trimming, `sanitizeOptional` semantics (asserts the *actual* behavior: empty string passes through).
- **utils** — `cn` conflict resolution, Persian `formatPrice`, **Jalali** `formatDate`, `slugify` (incl. leading/trailing-dash behavior), `truncate`, env-driven `getBaseUrl`.
- **pagination** — param coercion + caps, `buildPaginatedResponse` boundaries, `escapeRegex`.
- **product-variants** — `recomputeVariantSummary` (min price / summed stock / inactive exclusion / zero-priced), the full `validateVariants` matrix (SKU, attribute id/value/preset, duplicate combos order-insensitive, price/stock rules, `MAX_VARIANTS`, active-required), `prepareVariantsForSave` with mocked `Attribute`/`Product` (simple-product shortcut, normalization + denormalization, SKU-conflict 409, `excludeProductId` passthrough).
- **product-csv** — Persian/Arabic digit normalization, per-row validation errors, all `isActive` representations, formula-injection escaping, BOM + header + row serialization.
- **coupons** — code normalization/regex, usability windows, discount math (percent floor / `maxDiscount` cap / fixed clamp / never-negative), eligibility (public default, `assigned_users`, fail-closed groups), admin `parseCouponEligibility` (mode/ids/groups validation + caps + dedupe), `validateCoupon` error taxonomy (eligibility-vs-invalid), `claimCouponForOrder` (atomic global + per-user claims, usage-limit guard, minSubtotal, E11000 retry + rollback), `releaseCouponUsage` (idempotent no-ops, single-release claim, per-user decrement).
- **inventory** — `reserveStock` simple + variant (`$elemMatch` optimistic lock, inactive/insufficient), `setVariantStock` (invalid input, top-level delta sync), `restoreStock`, `restoreOrderStock` (claim no-op, variant routing, fail-silent).
- **product-sales** — increment/decrement pipeline shape (`$ifNull` add / `$max` floor at 0), skipped items, fail-silent paths.
- **payment-cleanup** — cutoff math (default 24h + custom), claim-based cancellation, Persian note, double-run skip.

### Review fixes (code-reviewer findings all addressed)
- Two product-csv fixtures normalized to full 12-column rows (the off-by-one column placement was inconsistent — the errors fired for the right reason but the fixtures were malformed).
- Expected fail-silent `console.error`/`console.log` output silenced in the DB-mocked suites (scoped `vi.spyOn`).
- Coverage gaps closed: `prepareVariantsForSave` non-array payload → 400; `recomputeVariantSummary` zero-priced variants.

### Verification
- `npm test` — **152/152 PASS** (9 files).
- `npm run test:coverage` — report generated (report-only). Target libs: sanitize / pagination / payment-cleanup / product-csv-constants / product-csv / product-sales **100% lines**; inventory **100% lines**; product-variants ~97.7%; coupons ~94.7%; utils 100% lines. (The ~37% "All files" figure includes untested infrastructure libs — env/telegram/zarinpal/upload/rate-limiter/etc. — outside the session's scope.)
- `npx tsc --noEmit` — **zero errors** (tests + config are strict-clean).
- ESLint — **clean on all changed files** (config + tests, zero warnings).
- Full sequential regression — **33/33 PASS, 0 skipped** (unchanged — zero `src/` impact).
- **No model/schema/index/env changes → no dev-server restart needed.**

## Session 57 (August 2026) — Order Management v2 (Claim-Based Transitions + Shipping Metadata + Shared Components)

### Approved Rev 2 design (implemented as designed — no redesign)
- **No packed status / payment domain separation** — the six order statuses (`pending_payment` … `cancelled`) remain pure order-domain states; payment states (`pending/paid/failed/canceled/refunded`) live **ONLY** in `payment.status`. `refunded` appears only as a statusHistory/display entry (`ORDER_STATUS_CONFIG`), never as a settable `order.status` (verify tests 9 + 17 assert this).
- **`SupplierOrder` untouched** — zero changes to the supplier-side order model/flow.
- **No CSV export, no reorder feature** — both explicitly out of scope and absent.

### Model (additive, backward compatible)
- **`src/models/Order.js`** — `shipping` subdocument `{ provider, trackingCode, shippedAt, deliveredAt, note }` (all defaulted — old orders render without tracking) + non-unique index `{ status: 1, createdAt: -1 }` for the status-filtered admin list (newest-first). **Model change ⇒ dev-server restart required** (done).
- **`src/types/index.ts`** — `OrderShipping` + `AdminOrder.shipping?`.

### Server — atomic claim + shipping + sort
- **`src/app/api/admin/orders/route.ts`** — the PUT handler replaced the read-modify-write (`findById → mutate → save`) with an **atomic claim** `findOneAndUpdate({ _id, status: order.status })`: two concurrent admin requests can no longer both win a transition or double-append statusHistory (loser → 400 «وضعیت سفارش همزمان تغییر کرده است»). **Reviewer-driven hardening (M1):** for CANCELS the claim ALSO gates on `payment.status: "pending"` (the Session 46 race-safe pattern) so an admin cancel and a concurrent payment-verify SUCCESS claim are mutually exclusive even on an advanced order (`processing` + still-pending payment) — the stale-read fingerprint (a cancel that had read `payment=pending` stamping `payment.status: "failed"` onto a concurrently-paid order and skipping the sale reversal) is impossible.
- **Cancelling an unpaid order now records `payment.status: "canceled"`** (was `"failed"`) — aligned with the Session 46 customer-cancel and the payment-NOK state for the same business event (reviewer finding L5); the payment domain still never leaks into `order.status`.
- **Shipping metadata** accepted ONLY on `shipped`/`delivered` (400 otherwise): `shipped` sets `shipping.shippedAt` + optional sanitized `provider`/`trackingCode`/`note` (100/100/500 caps); `delivered` sets `shipping.deliveredAt` (tracking preserved). **`trackingCode` is optional by design** (verify test 7).
- **GET list** — additive `sort=newest|oldest` (default newest → `createdAt: -1`).
- All Session 56/46 side-effects preserved: cancel → `restoreOrderStock` (idempotent) + `releaseCouponUsage` + `reverseOrderSales` (paid orders only); customer notifications + Telegram unchanged.

### Shared components (one source of truth for every order surface)
- **`src/components/orders/order-status-badge.tsx`** (new) — `ORDER_STATUS_CONFIG` (6 order statuses + `refunded` display entry), `OrderStatusBadge`, `PaymentStatusBadge` (payment domain), `statusNoteLabel` (Session 46 `customer_cancelled` → «لغو توسط مشتری»).
- **`src/components/orders/order-timeline.tsx`** (new) — `OrderEventTimeline` (admin: every history entry + actor chips مدیر/مشتری/سیستم) / `OrderProgressTimeline` (customer: lifecycle steps up to the current status, timestamps picked from statusHistory).
- **`src/components/orders/order-invoice.tsx`** (new) — items table + subtotal/discount/total footer, shared by admin + customer detail pages.
- **`src/app/admin/orders/page.tsx`** — newest/oldest sort toggle (ArrowDownWideNarrow/ArrowUpNarrowWide) + shared badges; dead client-side `filteredOrders` alias removed (reviewer L3).
- **`src/app/admin/orders/[id]/page.tsx`** — optional shipping provider/tracking inputs on the `shipped` transition + «اطلاعات ارسال» card; render-phase form reset preserved.
- **`src/app/(storefront)/orders/[id]/page.tsx`** — «پیگیری ارسال» card (provider/trackingCode/shippedAt/deliveredAt); Session 46 self-cancel + Session 30 retry-payment intact.
- **`src/hooks/use-admin-orders.ts`** — `sort` filter + `shipping` payload in the update mutation.

### Verification
- **`scripts/verify-order-management.js` — 17/17 PASS** (real HTTP API + real DB): happy path checkout→paid→confirmed→shipped(+tracking)→delivered; stock never restored on the paid path; statusHistory `actor: "admin"`; forbidden transitions → 400; **atomic hardening** (concurrent confirmed claims → exactly one 200 + one 400 + single history entry); shipping rejected on non-shipped → 400; **trackingCode optional**; admin cancel of PAID order reverses soldCount (Session 56 invariant); refund → `payment.status=refunded` + `order.status` stays in the ORDER domain + double-refund 400; payment NOK → stock restored once + coupon released; admin PUT authz (401/403); list `sort=newest|oldest` + search-by-id + status filter + pagination; customer self-cancel pre-payment (actor=customer) + post-payment 409; delivered orders retain tracking; **test 17: admin cancel vs payment-verify at `processing` — no stale-read payment corruption** (never `payment.status: "failed"`; every race outcome is a consistent state). Self-cleaning (PREFIX'd fixtures + its own coupon codes).
- **`scripts/run-regression.js`** — 33 suites (`verify-order-management` after `verify-best-sellers`). Full sequential regression **33/33 PASS, 0 skipped** (a single transient `verify-coupons` failure on the first post-fix run passed standalone 27/27 and on the sequential re-run — the documented shared-DB flake pattern).
- `npx tsc --noEmit` **zero errors**; **lint clean on all changed TS/TSX files** (the `no-require-imports` findings in `scripts/*.js` are the pre-existing whole-directory pattern shared by every verify suite — unchanged convention).
- Code review approved — reviewer findings all addressed: M1 (cancel claim payment-state guard, closed + regression-tested as test 17), L1 (dead `waitFor`/`prodTerminal` removed), L2 (dead `filteredOrders` alias removed), L3 (test 9 strengthened to the order-domain set), L4 (`failed`→`canceled` aligned + documented).
- **Ops note:** Order model change ⇒ dev-server restart required (done — fresh boot confirmed the `shipping` subdocument + new index are live).

## Session 56 (August 2026) — Best-Sellers Rail (Product.soldCount)

### Architecture (approved design — denormalized counter + additive sort + CMS block; no redesign)
- **`Product.soldCount`** (Number, default 0, min 0) — total units PAID and not later refunded/cancelled. **INTERNAL**: excluded from every public response via `-soldCount` projection (list, detail, and ranked-search re-hydration) — it exists ONLY to power the `sort=best_selling` ranking, never shown to customers. Non-unique index `{ soldCount: -1, createdAt: -1 }` (best-sellers ranking, newest tie-break). **Model change ⇒ dev-server restart required** (done).
- **`src/lib/product-sales.ts`** — single source of truth: `recordOrderSales(orderId)` / `reverseOrderSales(orderId)` read the order's items and `Product.bulkWrite` MongoDB **pipeline updates** (`$add` on `$ifNull` for increments; `$max` floor at 0 for decrements — a legacy 0-count product can never go negative). `bulkWrite` bypasses Mongoose middleware (never touches stock/stockVersion). **Fail-silent** by design — a ranking-counter failure can never fail a committed payment/refund.
- **Exactly-once by construction:** every mutation runs inside an existing atomic claim — payment verify `pending→paid` (increment), admin refund `paid→refunded` (decrement), **admin cancel of a PAID order** `processing/confirmed/shipped→cancelled` (decrement, reviewer finding fixed) — duplicate callbacks / double refunds / repeat cancels all hit early-return or 400 paths and can never double-count. Pending/cancelled-pending orders never touch the counter.
- **`GET /api/products`** — additive `sort=best_selling` → `{ soldCount: -1, createdAt: -1 }`. Ranked-search path unaffected (explicit sort already overrides relevance). Public responses exclude `soldCount`; product write routes use explicit whitelists so clients can never set it (reviewer-confirmed).

### CMS integration (Session 53 seam, one registry entry)
- **`best-sellers` homepage block** — data-driven (`hasContent: false`, `lazy`, minHeight 320): `src/components/storefront/home/best-sellers.tsx` calls `usePublicProducts({ sort: "best_selling", limit: maxItems })` into the existing `ProductRail`; registered in the block registry + `HOMEPAGE_COMPONENTS`; new `DEFAULT_SECTIONS` entry placed after `special-picks` (sortOrder 4).
- **Seed upgraded to insert-missing** (not just on empty collection): `seedHomepageContent` checks section slugs across ALL docs (soft-deleted included) so additive defaults like `best-sellers` appear on already-seeded DBs WITHOUT disturbing admin edits and WITHOUT resurrecting soft-deleted sections. `DEFAULT_SECTIONS` now carries explicit `sortOrder` (array index) so fresh seeds match the intended order exactly.
- **Storefront catalog** — «پرفروشترین» sort option added to the sort dropdown + `useCatalogFilters` whitelist; `AdminProduct.soldCount?` type.

### Client lint debt fixed (pre-existing, surfaced while touching the file)
- `use-catalog-filters.ts` — the `setPage(1)`-in-effect and debounce-empty synchronous setState were converted to the React-documented **"adjust state during render"** pattern (guarded, SSR-safe, behavior-preserving); the intentional one-time post-hydration URL seed effect keeps an effect but is block-disabled with a justification comment (any render-time alternative would cause hydration mismatches).

### Verification
- **`scripts/verify-best-sellers.js` — 14/14 PASS** (real API + real DB): sort ranking + newest tie-break, **leak scans** (list + detail — soldCount never appears), refund reversal by exact item quantities (simple + variant product-level sum), double-refund → 400 no double decrement, legacy 0 floor never negative, pending order can't refund + never counted, **admin cancel of a PAID order reverses soldCount / pending cancel untouched** (reviewer-fix test), cash checkout → pending order never increments (paid-only rule; the payment-verify increment is gated by the same atomic claim verify-payment-retry already exercises — sandbox verify requires the interactive payment page and can't be driven headlessly, documented), CMS block seeded + present in public composition positioned at/after special-picks. Self-cleaning (PREFIX'd fixtures incl. orders/supplierorders).
- **`scripts/backfill-sold-count.js`** — OPTIONAL one-time re-runnable backfill: aggregates paid + non-cancelled orders → `$set soldCount` (authoritative recompute, safe to re-run). Not part of the regression runner.
- Regression runner now **32 suites** (`verify-best-sellers` after `verify-coupon-eligibility`). Full regression **32/32 PASS, 0 skipped**; `npx tsc --noEmit` zero errors; lint clean on all changed files; production build passes; code review approved (Medium-High admin-cancel reversal gap fixed + test added; product-write whitelist confirmed; backfill zero-sale + crash-window documented below).
- **Known/accepted:** (1) crash-window between the `paid` claim and the counter write undercounts a paid order — recoverable via the optional backfill; (2) **variant-level sales aggregation is future scope** — `soldCount` is the product-level sum across all variants.

## Session 55 (August 2026) — Private / Targeted Coupons (Coupon Eligibility / Audience)

### Architecture (approved design — Option C embedded discriminated `eligibility`; no redesign)
- **Audience embedded on the coupon doc** (`src/models/Coupon.js`): `eligibility { mode: "public" | "assigned_users" | "user_groups", assignedUsers: ObjectId[], groups: String[] }`. `public` is the default and a MISSING eligibility block means public → **zero migration for existing coupons** (Session 44 `isPublic` precedent). Two multikey indexes (`eligibility.assignedUsers`, `eligibility.groups`) exist ONLY for future list/admin lookups — never on the claim hot path.
- **Eligibility checker in `src/lib/coupons.ts`** — the SINGLE enforcement point, reused by both preview and checkout: `getCouponEligibility` (missing/invalid → public, fail-safe), `isUserEligibleForCoupon` (pure JS membership over the already-fetched lean doc — **zero extra DB round-trips** on the money path), `userGroupsOf()` (NOT implemented yet → returns `[]` so group coupons are ineligible for EVERYONE — **fail-closed, never a silent grant**), `parseCouponEligibility` (admin input validation: mode whitelist, ObjectId guards → 400, dedupe, caps 1000 users / 50 groups / 32-char slugs, lowercase group slugs, sanitize).
- **Validation flow** (approved order): exists → active/window → **usage-limit pre-check** (pure JS, so an exhausted coupon never leaks its audience) → **eligibility** (distinct Persian error «این کد تخفیف برای شما قابل استفاده نیست» — never «invalid coupon») → minSubtotal → atomic global claim → per-user claim → apply. Sub-second audience races accepted (mirrors the documented window race); the atomic claim remains the authoritative usage enforcement.

### APIs (additive, RBAC unchanged)
- **`POST/GET /api/admin/coupons`** — POST accepts `eligibility` (validated); GET **populates** `eligibility.assignedUsers` (name/phone) — one extra query for the whole list, no N+1.
- **`PUT /api/admin/coupons/[id]`** — accepts `eligibility` (whole-block replace; additive partial-update semantics preserved for every other field).
- **`POST /api/coupons/validate`** — now passes `token.id` into `validateCoupon(rawCode, userId)` so the preview is eligibility-aware (a valid-but-not-for-you coupon returns the eligibility error, not the rules).
- **`GET /api/admin/users`** — additive `search` param (name/phone regex, `escapeRegex`) for the admin user picker.
- **`GET /api/coupons/public` UNCHANGED** — strict projection already excludes eligibility; the marketing leak scan extended to assert `eligibility`/`assignedUsers`/`groups`/`targetingRules` never appear.

### Admin UI
- `/admin/coupons` — «مخاطب کد تخفیف» audience section in the create/edit form: mode segmented control (عمومی / کاربران منتخب / گروه کاربری), **debounced user picker** (searches `GET /api/admin/users?role=customer&search=…`, selected chips with remove, results capped at 50), groups comma-input (lowercased), audience badges in the list (کاربران منتخب (n) / گروهها). Client guards: assigned_users needs ≥1 user, user_groups needs ≥1 group.

### Verification
- **`scripts/verify-coupon-eligibility.js` — 18/18 PASS** (admin authz 401/403; invalid eligibility → 400; assigned_users single + multi create + persisted shape; user_groups lowercase storage; admin GET populated names/phones; validate eligibility-aware both directions; **non-assigned checkout → 400 + NO order + NO claim (usedCount untouched, no couponusage row)**; assigned checkout → 201 + exact discount; user_groups fail-closed on both validate + checkout; public coupon default backward-compatible; PUT reassign [A]→[B] flips eligibility; public-list leak scan). Cleans its own PREFIX'd fixtures incl. all its couponusage rows (no orphans).
- Regression runner now **31 suites** (`verify-coupon-eligibility` after `verify-coupons-marketing`). Full regression **31/31 PASS** (incl. existing `verify-coupons` 27/27 and `verify-coupons-marketing` 12/12 unchanged — public coupons are a no-op through the new eligibility step). `npx tsc --noEmit` zero errors; lint clean on all changed files; production build passes; code review approved (reviewer findings M1–M3/L1–L3 all addressed).
- **Ops note:** Coupon model change ⇒ dev-server restart required (done).

## Session 53 (August 2026) — Homepage CMS (Admin-Manageable Composition + Content)

### Architecture (v3, per approved design — no redesign)
- **Two-tier model:** `HomepageSection` (Tier 1 — composition: `slug` identity + `component` renderer id + `enabled` + `sortOrder` + grouped `presentation { appearance, behavior }`; `slug`/`component` are **immutable** after creation) and four Tier-2 per-type content models (`HomepageHeroSlide` / `HomepageCampaignBanner` / `HomepageGiftCollection` / `HomepageTrustBadge`) bound to a section by `sectionSlug`, each with `sortOrder` / `isActive` / `status` (draft|published) / `publishedAt` / soft-delete `deletedAt`. **Model change ⇒ dev-server restart was required** (Mongoose model cache).
- **Block registry** `src/lib/homepage-sections/registry.ts` — server-only registry mapping a `component` id to its storefront renderer + an optional content RESOLVER ADAPTER. The registry never stores raw Mongoose models (DB access isolated behind adapters in `homepage-content.ts`). Adding a future block = one registry entry (+ content model + admin editor). `getHomepageBlock()` is fail-safe (unknown component → skipped, homepage never crashes).

### Seed + graceful static fallback
- **`src/lib/homepage-content.ts`** — `DEFAULT_SECTIONS` (the 9 Session 50 sections in order) seeds the DB when empty and doubles as the fallback order; `seedHomepageContent()` is the idempotent migration from `homepage-config.ts` (sections + per-type static rows inserted only when that section has no content yet); `getHomepageComposition()` — the PUBLIC reader (enabled + non-deleted sections in `sortOrder`, published + active + non-deleted content rows under a **strict projection** that excludes status/publishedAt/isActive/deletedAt, unknown components skipped). When the CMS has never been bootstrapped the storefront falls back to the Session 50 static config byte-for-byte, so an empty DB can never break the homepage.

### Admin API (RBAC, additive)
- **`GET /api/admin/homepage/sections`** (seeds on first call) + POST (create section, slug/component immutable), PUT (presentation/title/subtitle/enabled/sortOrder with grouped validation), DELETE (soft delete).
- **`src/lib/homepage-admin-api.ts`** — `createContentRouteHandlers(type, model)` factory shared by the four thin routes `src/app/api/admin/homepage/{hero-slides,campaign-banners,gift-collections,trust-badges}/route.ts` (GET/POST/PUT/DELETE): admin-only via `requireRoleOrError(["admin"])`, per-type field validation via `validateContentRow` (title required, http(s)-or-internal-path hrefs only, whitelisted trust-badge icons, sanitize), common fields via `normalizeContentCommon`, soft-delete, `publishedAt` stamping (draft → null; publish → now).
- **`GET /api/homepage`** — PUBLIC composition endpoint (no auth) returning the same strict-projection shape used server-side by the storefront page.

### Storefront + admin UI
- **`src/app/page.tsx`** — thin async server component: `getHomepageComposition()` once, then renders every section through the block registry (below-fold sections still lazy-mount via `LazySection`).
- **All 9 Session 50 renderers** now take `HomepageSectionRendererProps` (`{ section }`): content-bearing ones render from `section.content` (hero-carousel, campaign-banner, gift-collections, trust-badges — themeColor/hex backgrounds, responsive desktop/mobile images, CTA only when both label+href present); data-driven ones read `section.presentation.behavior` (maxItems, countdown settings, autoplay/arrows/dots, layout variant) and `section.title`/`subtitle` overrides. Renders nothing when a content section has no published rows.
- **`src/app/admin/homepage/page.tsx`** — tabbed admin UI (بخش‌ها / اسلایدر / بنر کمپین / کالکشن هدیه / نشان‌های اعتماد) with `SectionsEditor` (order/visibility/presentation) + `ContentEditor` (per-type CRUD, section-scope picker) + `ImageField` (existing `/api/upload` S3 flow).
- **Admin sidebar** — «صفحه اصلی» entry (LayoutTemplate icon).
- **`src/hooks/use-admin-homepage.ts`** — React Query hooks (sections + per-type content CRUD with key-factory invalidation); **types** added in `src/types/index.ts` (`HomepagePresentation`, `PublicHomepageSection`, `PublicHomepageContent`, `HomepageSectionRendererProps`, `AdminHomepageSection`).

### Verification
- **`scripts/verify-homepage-cms.js` — 14/14 PASS** (admin authz 401/403; idempotent sections bootstrap + static-config seed; public composition ordering + projection leak scan; unknown component skipped and `GET /` still 200; multiple sections sharing one renderer keep their own content; slug/component immutability → 400; `enabled=false` hides publicly; soft-deleted content hidden; draft content hidden; `publishedAt` stamping draft→null→now; per-type CRUD + validation errors; **malformed ObjectId → 400 on content + section PUT/DELETE — never a CastError 500**).
- Code-review fixes applied: `mongoose.isValidObjectId` guards (→ 400) added to the content factory + sections PUT/DELETE (project convention); seed made E11000-race-tolerant (concurrent first boot no longer 500s); unused `str()` length arg + unused constants/imports removed (lint clean on all new files).
- Regression runner now **30 suites** (`verify-homepage-cms` after `verify-coupons-marketing`). `npx tsc --noEmit` zero errors; production build passes; code review approved.
- **Ops note:** model changes ⇒ dev-server restart required (done — booted fresh after the system restart; `/api/homepage` confirmed returning live DB content).

## Session 52 (August 2026) — Mobile Dashboard Navigation Fix + Regression Runner Hermeticity

### Mobile navigation fix (Admin + Supplier dashboards)
- **Root cause:** the header `Menu` button (lucide, `lg:hidden`) called `toggleSidebar()` on the zustand `useAppStore`, but **nothing consumed `isSidebarOpen`** — both sidebars were `hidden ... lg:flex` (desktop-only) and **no mobile drawer/sheet existed anywhere** in the codebase. On mobile the toggle therefore had zero visual effect, leaving admins/suppliers unable to reach any dashboard section on a phone.
- **Created** `src/components/layout/mobile-drawer.tsx` — a single reusable `MobileDrawer` (overlay + slide-in panel) driven by the existing `isSidebarOpen` store flag: renders `lg:hidden` (desktop behavior byte-identical), closes on overlay click / close button / `Escape`, locks body scroll while open, `aria-modal` + labelled. Takes **plain `ReactNode` children** (NOT a render-prop — the layouts are Server Components, and a function as children throws «Functions are not valid as a child of Client Components»; caught by browser QA and fixed).
- **Modified** `src/components/layout/admin/admin-sidebar.tsx` + `src/components/layout/supplier/supplier-sidebar.tsx` — added additive `variant` (`desktop` | `mobile`) so the SAME nav content renders in the drawer; in `mobile` variant a nav-link click closes the drawer via the store directly (`setSidebarOpen(false)` — the sidebars are client components, so no callback needs to cross the RSC→client boundary). Desktop output unchanged (default `variant="desktop"`).
- **Modified** `src/app/admin/layout.tsx` + `src/app/supplier/layout.tsx` — render `<MobileDrawer><Sidebar variant="mobile" /></MobileDrawer>` beside the desktop sidebar.
- **Zero API/schema/model/index changes** — pure client-side UI; desktop behavior preserved; no dev-server restart needed.

### Regression runner hermeticity (this verification step)
- **Root cause of intermittent full-regression failures:** the shared login rate-limiter keys (`login:<phone>` max 10/15min and `login_ip:<ip>` max 30/15min, stored in the shared `ratelimits` collection as `_id: "rl:<key>"`) accumulate across suites — every suite performs real NextAuth logins against the same localhost IP, so after ~30 cumulative logins within a 15-minute window the `login_ip` limiter rejects all later logins (401s) even though each suite passes standalone. This is **expected security behavior** (brute-force protection) colliding with shared test-state accumulation — not an app bug and not a runner logic bug.
- **Modified** `scripts/run-regression.js` — before EACH suite it now clears the shared login keys (`deleteMany({ _id: { $regex: "^rl:(login|login_ip):" } })`) using the same `.env.local`-parsing + `dbName: "marlooai"` convention as the verify suites. Fail-safe: if the DB is unreachable it only warns — the hermetic `verify-db-reconnect` suite still runs and the HTTP suites report their own connectivity errors. **Production limiter logic untouched** — this only resets test state between isolated runs.
- **Verification:** `npx tsc --noEmit` zero errors; `node --check` clean; code review approved; **full sequential regression → 29/29 PASS** (previously 24/29 with 401-cascade failures). Standalone suites confirmed unaffected (verify-upload-repro 15/15, verify-upload-formats 9/9, verify-variants-e2e 32/32, verify-variant-polish 14/14, verify-payment-retry 14/14).
- **Browser QA (desktop + mobile viewport 390px):** admin dashboard renders without error, hamburger opens the drawer, nav link closes it + navigates; console errors only the pre-existing favicon 404s. Browser QA caught a real bug that static checks missed — the first MobileDrawer used a **render-prop** `children: (close) => …`; the admin/supplier layouts are Server Components, so a function crossed the RSC→client boundary and the page crashed with «Functions are not valid as a child of Client Components». Fixed to plain `ReactNode` children + store-driven close (sidebars close themselves via `setSidebarOpen(false)`). Re-verified: tsc clean + browser QA green.
- **Ops note updated:** the historical Session 36 note («clear the `ratelimits` collection if logins start 401ing») is now automated — the runner clears the login keys itself before every suite; a manual clear is only needed for standalone suite runs that 401.

## Session 51 (August 2026) — Bulk Product CSV Import / Export (Admin + Supplier)

### Shared CSV library (server-authoritative parser + serializer)
- **Created** `src/lib/product-csv.ts` — parse/serialize/validate using `csv-parse`/`csv-stringify` (**new dependencies, the only ones this session**): `parseProductCsv` returns validated rows (slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, price/supplierPrice positive finite, stock non-negative integer, name ≤200 / description ≤2000, category required, `isActive` 1/0 with empty → default true, **Persian + Arabic digit normalization** `toLatinDigits`); a globally malformed CSV → 400 «فرمت CSV نامعتبر است»; empty file → 400. `serializeProductsCsv` — export serializer with **CSV formula-injection escaping** (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`) and a **UTF-8 BOM** so Excel renders Persian correctly.
- **Created** `src/lib/product-csv-constants.ts` — `PRODUCT_CSV_HEADERS` (12-column order: name, slug, description, price, supplierPrice, stock, category, brand, tags, images, isActive, supplier), `MAX_IMPORT_ROWS = 1000`, `MAX_CSV_BYTES = 500_000`. Dependency-free so client components import it without bundling the CSV parser.
- **Created** `src/lib/product-import.ts` — shared import executor (server-only) used by both routes: **name-based reference resolution** (category/brand/tag/supplier by lowercased name, active-only, single queries — no N+1), **pre-scan of existing slugs** (one `distinct` query), then **sequential per-row `Product.create`** through the same hardened write rules as the existing product APIs (`sanitizePlainText` + Mongoose validators). **Create-only v1:** duplicate slug in-file (`seenInFile`, only marked on a SUCCESSFUL create so a failed row never reserves its slug) or in-DB (`existingSlugs` pre-scan + E11000 backstop) → row **skipped** + Persian reason; never overwritten. Per-row atomicity (no partial products). Supplier mode (`supplierId` passed) ignores the `supplier` column and auto-assigns ownership.

### API routes (additive, RBAC, rate-limited)
- **Created** `src/app/api/admin/products/import/route.ts` — `POST`, admin-only via `requireRoleOrError(["admin"])`. **Payload validated BEFORE the rate limiter** (project convention — invalid payloads don't burn quota): empty CSV → 400, **byte-length cap via `Buffer.byteLength`** (not char count — Persian UTF-8 can't smuggle a larger payload) → 413, row cap → 400. Rate limit `product-import:<userId>` 20/15min → 429. Delegates to `executeProductImport`; returns the full per-row report.
- **Created** `src/app/api/supplier/products/import/route.ts` — `POST`, supplier-only; same flow with the supplier's own `_id` passed as `supplierId` (ownership auto-set, `supplier` column ignored).
- **Created** `src/app/api/admin/products/export/route.ts` + `src/app/api/supplier/products/export/route.ts` — `GET` CSV download (`Content-Disposition: attachment; filename="products.csv"`, `text/csv; charset=utf-8`), admin: whole catalog; supplier: **ownership-scoped** (`Supplier.findOne({ user: token.id })` → 404 if no profile). Exports **simple products only** (`hasVariants: false` — variant products stay in the existing form; documented limitation), names resolved via populate, `isActive` as 1/0.

### Client — hooks, shared import UI, pages, navigation
- **Created** `src/hooks/use-product-import-export.ts` — `useAdminProductImport` / `useSupplierProductImport` mutations (invalidate the **key-factory** `adminProductKeys.lists()` / `supplierProductKeys.lists()` — established convention, not raw literals).
- **Created** `src/components/admin/product-csv-import.tsx` — shared import UI: file pick (client reads text only — the **server is the authoritative parser**), **«دانلود قالب» template download** (header row + BOM), column-guide chips (required marked with `*`; supplier column hidden in supplier mode with an explainer), per-row **report table** (ردیف / نام / وضعیت / دلیل) with created/skipped/failed badges + Persian toasts. Loading state, error handling, empty-file guard.
- **Created** `src/app/admin/products/import/page.tsx` + `src/app/supplier/products/import/page.tsx` — thin pages mounting the shared component (supplier page passes `supplierMode`).
- **Modified** `src/components/layout/admin/admin-sidebar.tsx` + `src/components/layout/supplier/supplier-sidebar.tsx` — «ورود انبوه» nav entries (FileUp icon, under محصولات/محصولات من).
- **Modified** `src/app/admin/products/page.tsx` + `src/app/supplier/products/page.tsx` — header action row gains «ورود انبوه» (→ import page) + «خروجی CSV» (→ export endpoint, browser download) buttons beside «افزودن محصول جدید».
- **Modified** `src/types/index.ts` — `ProductImportRowStatus` (`created | skipped | failed`), `ProductImportRowResult` (rowNumber, name?, status, Persian reason?), `ProductImportReport` (total, created, skipped, failed, results).

### Invariants preserved
- **Zero changes to existing APIs, zero schema/model/index/migration changes.** New import routes never call the existing POST/PUT product endpoints — every row goes through the same validation rules but on an isolated path; failures are per-row, never partial. `inventory.ts`, checkout reservation, `notifyOrderEvent()`, `coupons.ts`, payment flow, RBAC, wishlist — untouched. **New dependencies:** `csv-parse` + `csv-stringify` (only this session's additions).

### Verification
- **Created** `scripts/verify-product-import-export.js` — **22/22 PASS** against the real HTTP API (real NextAuth login, real routes, real MongoDB): unauth 401 + supplier 403 on admin routes (and reverse), template round-trip, **admin import happy path** (rows created with correct category/brand/tags/supplier refs), **duplicate slug in-file skipped**, **duplicate slug in-DB skipped (no overwrite)**, **per-row failure isolation** (one bad row doesn't block good rows), invalid slug/price/stock → row-level failures, unknown category/brand/tag/supplier refs → row-level failures, Persian digits normalized, **supplier import auto-ownership** (products land on the caller's supplier; supplier column ignored), **supplier export ownership-scoped** (never another supplier's products), export→import round-trip (exported CSV re-imports cleanly, with `created === 0` on shared-DB products that legitimately fail — the invariant is no re-creation, not zero skips), formula-injection escaping (`=SUM(...)` neutralized), sanitization (no angle brackets survive), byte-cap 413, row-cap 400, rate-limit 429, idempotency sweep + cleanup.
- **Updated** `scripts/run-regression.js` — +1 suite → **29 suites** (`verify-product-import-export` inserted after `verify-product-variants`/before `verify-coupons-marketing`, keeping the shared-DB ordering rules).
- `npx tsc --noEmit` → **zero errors**; full sequential regression → **29/29 PASS**.
- Code review approved (2 rounds). Reviewer-driven fixes: (1) rate-limit ordering — payload/size validated BEFORE the limiter so invalid payloads don't burn quota (project convention); (2) `seenInFile` only marked on successful create — a failed row must not reserve its slug; (3) dead per-row `prepareVariantsForSave` call removed (true no-op for simple products, intent documented in a comment); (4) hook invalidation switched from raw literals to the established key factories; (5) `MAX_CSV_BYTES` measured via `Buffer.byteLength` (byte-accurate name). All fixes re-verified (tsc + 22/22 + 29/29).
- Browser QA: import pages render (title, file picker, template download, column guide); console errors observed are **pre-existing** (missing `favicon.ico`/`icon-192.png` — unrelated). Full click-through was blocked by the browser agent's tooling; functionality is fully covered by the 22-test real-API suite.
- **No model/schema/index changes → no dev-server restart needed.** Invariants untouched.

### Ops notes
- `csv-parse` + `csv-stringify` added to `package.json` (npm install was run; `package-lock.json` updated).
- The import rate-limit key `product-import:<userId>` persists 15min; the verify suite clears its own keys in the idempotency sweep so re-runs are hermetic.

## Session 50 (August 2026) — Homepage UX Redesign (Architecture First)

### Homepage — rebuilt as a thin composition of reusable sections
- **Rewrote** `src/app/page.tsx` — kept as the homepage entry (**no route-group move**, per approved routing rules) but reduced to a small **server component** that composes self-contained sections: Hero Carousel → Quick Categories → Campaign Banner → Special Picks (today's value picks + countdown) → Newest Products → Premium Collection → Popular Brands → Gift Collections → Trust Badges → shared Footer. All copy/art lives in config; the page itself is ~50 lines.
- **Created** `src/lib/homepage-config.ts` — static config for hero slides (3), campaign banner, and gift collections (typed, Persian, gradient art — **no external images, no backend**).
- **Created** `src/components/storefront/home/*` (12 new components): `hero-carousel` (fade cross-fade, RTL-safe, auto-advance + pause-on-hover, dots/arrows, responsive aspect), `quick-categories` (grid on desktop / horizontal scroll-snap on mobile, reuses `usePublicCategories`), `campaign-banner`, `special-picks` (countdown to end-of-day + cheapest-in-stock rail from the shared pool — **real prices only, NO fake discounts**), `newest-products`, `premium-collection` (priciest from the same pool), `popular-brands` (initial tiles — the public brands API exposes no logo), `gift-collections`, `trust-badges` (original feature cards reused), plus shared `section-header`, `product-rail` (native scroll-snap + mobile arrows, **no carousel dependency**), `lazy-section` (IntersectionObserver → defers below-fold mounting AND data fetching).
- **Created** `src/hooks/use-countdown.ts` (`useCountdown` + end-of-day + `formatCountdown`, hydration-safe `ready` flag) and `src/hooks/use-home-product-pool.ts` — **ONE shared pool query** (`sort=newest, limit 36`) feeds all three product rails (React Query key dedup — no duplicate requests).

### Header + footer — extracted and shared (behavior preserved)
- **Created** `src/components/storefront/storefront-header.tsx` — the storefront header extracted verbatim from the layout, plus an **additive header search box** wired to the existing Session 49 `/api/search/suggest` + `SearchSuggestions` (desktop: inline input; mobile: search icon expands a search row). Selecting a suggestion → `/products?search=<term>`.
- **Created** `src/components/storefront/storefront-footer.tsx` — footer extracted verbatim (no behavior change).
- **Refactored** `src/app/(storefront)/layout.tsx` — now a thin **server component** composing the shared header/footer; storefront pages behavior unchanged (verified by the full regression).
- **Modified** `src/hooks/use-catalog-filters.ts` — **additive one-time URL param seed** (category/brand/tag/search/sort read from `window.location.search` once on mount). Homepage category/brand tiles and header search now pre-filter the catalog; with no params present behavior is byte-for-byte unchanged. `useState` remains the source of truth (no `useSearchParams` migration).
- **Modified** `src/app/globals.css` — added a `scrollbar-none` Tailwind v4 utility for horizontal rails.

### Architecture rules preserved
- **No API changes** (all existing endpoints reused — `/api/products`, `/api/categories`, `/api/brands`, `/api/search/suggest`). **No schema/model/index/migration changes. No new dependencies.** `inventory.ts`, checkout reservation, `notifyOrderEvent()`, `coupons.ts`, payment flow, RBAC, `ProductCard` — all untouched. Homepage only (plus the additive header-search + URL seed that power it).

### Verification
- `npx tsc --noEmit` → **zero errors**; full sequential regression → **28/28 PASS** (no suites added — no API surface changed).
- **Browser QA (browser_use, desktop + mobile):** page loads with no console errors; all sections render in order; desktop header search shows live suggestions; quick-category tile → `/products?category=<id>` with the filter applied; mobile viewport switches to search-icon header + horizontally scrollable category/rails; mobile search icon expands the search row; campaign banner no longer double-padded; hero does not clip on small screens (aspect `4/3 → 16/9 → 21/9`).
- **Code review approved** (reviewer-driven fixes applied: CampaignBanner double-container removed, product-rail arrows flipped to mobile-only `md:hidden` — desktop is a static grid, unused `HOME_POOL_SIZE` import removed, countdown `ready` flag to kill the «اتمام امروز» first-paint flicker, hero aspect ratios raised to prevent clipping, consistent self-contained section containers with a uniform `pt-10` rhythm, `aria-label` added to the header search input).
- **No model/schema/index changes → no dev-server restart needed.** Invariants untouched.

## Session 49 (August 2026) — Search Suggestions / Autocomplete (Phase 2 of Session 48)

### Server — additive, read-only, no auth, rate-limited
- **Created** `src/app/api/search/suggest/route.ts` — `GET /api/search/suggest?q=<prefix>`: returns up to 10 matching product names + brand names (active only, prefix match, case-insensitive). Product names appear first, then brand names; duplicates are deduped. Min 2 character prefix required → empty array returned for shorter queries. **IP-keyed rate limit** `search-suggest:<ip>` (30/15min). No auth required (public catalog already exposes search without login). **No schema changes, no model changes, no indexes.**

### Client — React Query hook + dropdown component
- **Created** `src/hooks/use-search-suggestions.ts` — `useSearchSuggestions(q)` hook (React Query, enabled when `q.length >= 2`, staleTime 5min since product/brand names change rarely).
- **Created** `src/components/storefront/search-suggestions.tsx` — `<SearchSuggestions>` dropdown component: renders below the catalog search input, shows matching names with a Search icon, click-away-to-close, loading skeleton / error / empty states. Uses `onMouseDown` (not `onClick`) so the selection fires before the input's blur handler.
- **Modified** `src/app/(storefront)/products/page.tsx` — search input now manages `suggestionsOpen` state; `onChange` opens the dropdown, `onFocus` opens it, `Escape` closes it, clear-button closes it, and the `<SearchSuggestions>` component is rendered inside the search wrapper. Clicking a suggestion fills the search input and closes the dropdown.

### Verification
- **Created** `scripts/verify-search-suggest.js` — **10/10 PASS** against the real API: public endpoint 200, short/empty query → empty, prefix match returns product names, inactive products excluded, brand names included, product names ordered before brand names, duplicate name deduped, max 10 suggestion cap, response shape `{suggestions: string[]}`, special characters don't cause a 500.
- **Updated** `scripts/run-regression.js` — +1 suite → **28 suites** (`verify-search-suggest` after `verify-search`, before `verify-pagination`).
- Validated: `npx tsc --noEmit` zero errors; `verify-search-suggest.js` **10/10**; full sequential regression **28/28 PASS**; code review approved (fixes: removed unused import, simplified keyboard nav, removed unused type).
- **No schema changes, no migrations, no index creation → no dev-server restart needed.** Invariants untouched: `inventory.ts`, checkout, `notifyOrderEvent()`, `coupons.ts`, payment verification, RBAC.

## Session 48 (August 2026) — Storefront Search Quality Upgrade

### Server — expanded search coverage + weighted relevance ranking (additive, default-off)
- **`src/app/api/products/route.ts`** — search is still regex-based (Persian substring behavior preserved, **no `$text`, no text indexes, no schema changes**), but the `$or` now covers **product name, description, variant attribute values, plus brand/tag/category names** resolved through their reference collections (`Brand/Tag/Category.find({name: $regex}).distinct("_id")` — empty set contributes no matches). All filter ids are now **explicitly ObjectId-cast at build time** (find()/countDocuments auto-cast, but the aggregation `$match` does not — Session 47 lesson).
- **Ranked search path** — used ONLY when `search` is present AND `sort === "newest"` (the default): ONE aggregation `$match filter → $addFields score → $sort {score:-1, createdAt:-1} → $skip/$limit → $project {_id:1}`, then the **existing populate chain** re-hydrates the page ids and re-sorts to ranked order. **Pagination happens inside the aggregation — never fetch-all. Response shape unchanged, no `score` field leaks.** Weighted additive scores: exact name 100 / name prefix 60 / name substring 40 / brand-tag-category 25 each / attribute value 20 / description 10.
  - Attribute-value scoring flattens `$variants.attributes` (an **array-of-arrays in aggregation expression context** — empirically confirmed `[["قرمز"]]`; query context flattens, expression context does not) with `$reduce`/`$concatArrays` + a `$type === "string"` guard before `$regexMatch` — fixes a real 500 (`$regexMatch needs 'input' to be of type string`).
  - Explicit sorts (`price_asc`, `price_desc`, `name`, `oldest`) **deliberately override relevance** — those requests fall through to the existing `find()` path with the expanded filter. No-search behavior byte-for-byte unchanged.

### Client — 300ms search debounce
- **`src/hooks/use-catalog-filters.ts`** — `searchQuery` stays the immediate input value; a new `debouncedSearch` state commits to `queryParams` after a 300ms quiet pause (empty clears immediately; `clearFilters` resets both). **useState architecture kept — no `useSearchParams` migration**; React Query flow unchanged; page-reset behavior preserved.

### Verification
- **`scripts/verify-search.js`** (new) — **17/17 PASS** against the real API: exact-name-first relevance order (200>100>40>10), Persian partial substring (`پیراه` → `پیراهن`), brand/tag/category/attribute-value name search, combined search+facet (brand/tag/category/attribute), explicit-sort override, pagination (totals/slicing/stable ordering), name-beats-description, empty result 200 total 0, regex special-char escaping (literal dot matches only `pDot`, not `pWild`; metachar-only search → 200 no 500), backward compat (pagination keyset + newest-first + no `score` leak), detail endpoints unaffected, populate preserved on the ranked path.
- **`scripts/run-regression.js`** — +1 suite → **27 suites** (`verify-search` after `verify-attribute-facets`, before `verify-pagination`).
- Validated: `npx tsc --noEmit` zero errors; `verify-search.js` **17/17**; full sequential regression **27/27 PASS**; code review approved across rounds (fixes: aggregation expression-context array-of-arrays flatten for the attribute-value term; contiguous-term substring fixture `"شیک "+PREFIX+"پیراهن"` since the search term carries the ASCII PREFIX; test-12 `names()` helper contract).
- **No schema changes, no migrations, no index creation → no dev-server restart needed.** Invariants untouched: `inventory.ts` sole stock authority, checkout only reservation point, `notifyOrderEvent()` only facade, `coupons.ts`, payment verification, RBAC.

## Session 47 (August 2026) — Storefront Faceted Filtering (Brand + Tag)

### Public facet endpoints (read-only, mirror /api/categories)
- **Created** `src/app/api/brands/route.ts` + `src/app/api/tags/route.ts` — public `GET`, **active-only**, **STRICT projection** `.select("name slug").sort({name:1}).lean()` (exact key-set `_id/name/slug` — never description/logo/website/isActive/timestamps). No auth, no rate limit (public categories precedent). Pure read — never mutates.

### Catalog API (additive, default-off)
- **Modified** `src/app/api/products/route.ts` — additive `brand=` + `tag=` optional params: **ObjectId-validated exactly like `supplier=`** (malformed → 404; valid-but-nonexistent → 200 empty result). `filter.brand` / `filter.tags` set only when present; `id`/`slug` detail path untouched; all existing params (category/supplier/search/minPrice/maxPrice/sort/page/limit) behave **identically** when the new params are absent. No behavior change otherwise.

### Client
- **Created** `src/hooks/use-public-brands.ts` + `src/hooks/use-public-tags.ts` — React Query, staleTime 5min (consistent with `use-public-categories`).
- **Created** `src/hooks/use-catalog-filters.ts` — shared filter state hook (useState, NOT useSearchParams — locked design): filter state, page reset on any filter change, active filter count, filters→query-params mapping, clearFilters. Future facets = one state field + one queryParams entry + one chip group — no flow rewrite.
- **Created** `src/components/filter-chip-group.tsx` — ONE reusable presentational component («همه» + toggle chips + skeleton loading); used immediately for category, brand and tag. No filter-registry / no facet-DSL / no hierarchy (rejected per locked design).
- **Modified** `src/hooks/use-public-products.ts` — `buildQueryString()` **generalized**: iterate `Object.entries(filters)`, skip `undefined`/`null`/empty-string (identical output for all existing params — behavior preserved); `ProductFilters` gained `brand?`/`tag?`.
- **Modified** `src/app/(storefront)/products/page.tsx` — rewritten to use `useCatalogFilters` + `FilterChipGroup` (دستهبندی/برند/برچسب) + the new public hooks; search/sort/pagination/empty/error/mobile-chip states preserved (reviewer fix: mobile chips gate restored to `activeFilterCount > 0` so a sort-only selection still surfaces the chip row; unused `Loader2` import removed).
- **Modified** `src/types/index.ts` — additive `PublicBrand` + `PublicTag` (`{_id, name, slug}`).

### Invariants preserved
- `inventory.ts` sole stock authority, checkout only reservation point, `notifyOrderEvent()` only facade, `coupons.ts` byte-for-byte, payment-verify untouched, RBAC unchanged. **No schema changes, no migrations, no index creation, no model edits, no notification/payment/checkout changes.** No dev-server restart needed.

### Verification
- **Created** `scripts/verify-facets.js` — **22/22 PASS** against the real HTTP API: brands/tags 200 + active-only + exact whitelist key-set + **projection leak scan**; brand-only / tag-only / brand+tag / brand+category / brand+search / brand+supplier / brand+price / tag+search / tag+category; empty result (valid ref, no products) → 200 total 0; malformed brand/tag → 404; valid-but-nonexistent → 200 empty; inactive brand/tag refs still filter by identity (on the product ref); pagination + sorting preserved under filters; `?id=`/`?slug=` detail unaffected by filter params; idempotency sweep + cleanup. Header aligned to the real 22-test flow (reviewer fix).
- **Updated** `scripts/run-regression.js` — `verify-facets` added (**25 suites**, inserted after verify-variant-polish; verify-db-reconnect first/hermetic, verify-coupons-marketing near-last, verify-telegram-alerts last).
- `npx tsc --noEmit` → **zero errors**; code review approved (2 rounds; fixes applied: verify-suite stale header 24→22, mobile chips gate regression).
- Full sequential regression → **25/25 PASS**.

---

## Session 47 Extension (August 2026) — Attribute Facets (validates the Session 47 extensibility claim)

### Catalog API (additive, default-off)
- **Modified** `src/app/api/products/route.ts` — additive nested attribute filters `attributes[<slug>]=<value>`: parsed via `searchParams.entries()` regex, slug → `attributeId` resolved, filter `variants.attributes = $all of $elemMatch` (AND across attributes). Unknown slug → 200 empty (valid-but-nonexistent rule); simple products (no variants) never match; `id`/`slug` detail path untouched; **no behavior change when omitted**.

### Facet counts API (new, aggregation, read-only)
- **Created** `src/app/api/attributes/facets/route.ts` — public `GET`, accepts the same filters as `/api/products` (category/supplier/brand/tag/search/minPrice/maxPrice, ObjectId-validated → 404; **explicit `new mongoose.Types.ObjectId()` casting because the aggregation `$match` does not auto-cast like `find()`** — reviewer-caught) + nested `attributes[<slug>]` selections. ONE pipeline: `$match` (product-level filters only) → `$unwind` variants (active-only) → `$unwind` attributes → `$group` by `(attributeId, value)` with `$addToSet` product ids (distinct-product counting). **Sticky-facet self-exclusion**: attribute selections are applied purely as JS set intersections per-attribute (an attribute's own selection excluded from its own counts, so picking red keeps blue visible with accurate counts) — the aggregation `$match` intentionally carries NO attribute selections (reviewer-caught: DB-level self-constraint made other values vanish). Response `{ facets: [{ slug, name, type, values: [{ value, count }] }] }`, active attributes only, count-desc sorted, whitelist key-set leak-scan verified. No indexes, no schema changes.

### Client (zero data-flow changes — the Session 47 seam)
- **Modified** `src/hooks/use-catalog-filters.ts` — `selectedAttributes` (slug → value) state + `setAttribute`; `queryParams` gains `attributes[<slug>]` keys via the `CatalogFilterValues` index signature; page-reset / active-count / clearFilters updated.
- **Created** `src/hooks/use-public-attribute-facets.ts` — React Query, reuses the exported generic `buildQueryString` + `ProductFilters`; query key strips sort/page/limit (facet counts don't depend on them — no refetch churn); staleTime 5min.
- **Modified** `src/components/filter-chip-group.tsx` — additive optional `counts?: Record<string, number>` prop (count badge per chip); existing call sites unchanged (backward compatible).
- **Modified** `src/app/(storefront)/products/page.tsx` — renders attribute facet groups via the SAME `FilterChipGroup` (options = values, counts = counts), attribute active badges (panel + mobile chips), `hasActiveFilters` includes attributes.
- **Modified** `src/types/index.ts` — additive `AttributeFacetValue` / `AttributeFacet` / `AttributeFacetsResponse`.
- **Modified** `src/hooks/use-public-products.ts` — exported `buildQueryString` + `ProductFilters` (additive; no behavior change).

### Invariants preserved
- `inventory.ts` sole stock authority, checkout only reservation point, `notifyOrderEvent()` only facade, `coupons.ts` byte-for-byte, payment-verify untouched, RBAC unchanged, brand/tag/category filtering behavior unchanged. **No schema changes, no migrations, no index creation, no model edits.** No dev-server restart needed.

### Verification
- **Created** `scripts/verify-attribute-facets.js` — **24/24 PASS** against the real HTTP API: facets endpoint (public, active-only, whitelist key-set, leak scan, distinct-product counting, inactive attribute hidden); products nested filters (single / two-attribute AND / +brand / +category / +search / +supplier / +price / +tag); unknown slug → 200 empty; simple-product never-matches; inactive-ref still filters; **sticky self-exclusion** (color=red keeps size counts; size=M keeps color counts — no self-exclusion); facet counts narrow with brand/category filters; sort/page params don't change counts; pagination + sorting preserved; `?id=`/`?slug=` detail unaffected.
- **Updated** `scripts/run-regression.js` — `verify-attribute-facets` added (**26 suites**, inserted after verify-facets; ordering rules preserved).
- `npx tsc --noEmit` → **zero errors**; code review approved (3 rounds; fixes: hook returned the response wrapper instead of the array → page TS2339; sticky-facet self-exclusion moved out of the aggregation `$match` into JS intersections + dead `baseVisible` removed; explicit ObjectId casting for id filters in the aggregation).
- Full sequential regression → **26/26 PASS** (a transient `verify-variant-polish` failure in the first run was a flake — it passes standalone and in the rerun).

---

## Session 46 (August 2026) — Customer Self-Service Order Cancellation

### Server
- **Created** `src/app/api/orders/[id]/cancel/route.ts` — `POST` (customer-only via `requireRoleOrError(["customer"])` → 401 unauth / 403 supplier+admin). Ownership-scoped: `Order.exists({_id, customer})` distinguishes **404** (not found / not owned — no IDOR) from **409** (exists, no longer cancellable). **Atomic claim** `findOneAndUpdate({_id, customer, status:"pending_payment", "payment.status":"pending"})` → `$set {status:"cancelled", "payment.status":"canceled"}` + `$push statusHistory {status:"cancelled", actor:"customer", note:"customer_cancelled"}`. **Race-safe by construction:** the cancel claim and the payment-verify SUCCESS claim both gate on `payment.status === "pending"` → MongoDB per-document write serialization means **exactly ONE wins** (no paid order with restored stock); after a cancel, verify's NOK branch (`$nin: ["paid","canceled","refunded"]`) also fails → **no double restoration** (`stockRestored` idempotency backstop). **Post-commit** (strictly after the claim; local try/catch so a side-effect failure can never 500 a committed cancel): `restoreOrderStock(id)` (inventory.ts authority) + `releaseCouponUsage(id)` (exact `coupons.ts` export — the same helper admin-cancel/payment-verify/24h-cleanup use) + `notifyOrderEvent` with **REUSED** `order_cancelled` type (**no enum change**; key `order_<id>_order_cancelled`, category `order`, link `/orders/<id>`). Returns `{orderId, status:"cancelled", cancelled:true}`.
- **Modified** `src/models/Order.js` — additive `actor: String` on the `statusHistory` subdoc (**no migration, no index change**; old entries render absent). **Model change ⇒ dev-server restart was required** (Mongoose model cache).
- **Audit is machine-readable:** `{status:"cancelled", actor:"customer", note:"customer_cancelled"}` — raw customer input is NEVER stored in the note field (a future optional customer message would go in a separate sanitized `customerNote`).

### Client
- **Modified** `src/app/(storefront)/orders/[id]/page.tsx` — «لغو سفارش» button + confirm dialog (visible only when `status === "pending_payment"`); calls `useCancelOrder`; success/error toasts + refetch/invalidate. Timeline renders the machine-readable note through a `statusNoteLabels` mapping (`customer_cancelled` → «لغو توسط مشتری»); human-entered admin notes pass through unchanged.
- **Modified** `src/app/admin/orders/[id]/page.tsx` — timeline uses the same `statusNoteLabel()` passthrough (admin-cancel notes — Persian/empty — render unchanged).
- **Modified** `src/hooks/use-customer-orders.ts` — new `useCancelOrder` mutation (POST `/api/orders/<id>/cancel`; invalidates customer-order list/detail keys).
- **Modified** `src/types/index.ts` — `CancelOrderResponse { orderId, status: "cancelled", cancelled: boolean }`; `AdminOrder.statusHistory` entries gain optional `actor?: string`.

### Invariants preserved
- `inventory.ts` stays the ONLY stock authority (route calls `restoreOrderStock`; never hand-rolls `$inc`)
- Checkout stays the only reservation point (this endpoint only RELEASES already-reserved stock)
- `notifyOrderEvent()` stays the only notification facade; Telegram stays fail-silent
- `src/lib/coupons.ts` byte-for-byte untouched (release idempotent by existing design)
- Payment-verify atomic claims untouched; **no refund path** (pre-payment only — admin refund Session 32 untouched)

### Verification
- **Created** `scripts/verify-order-cancel.js` — **17/17 PASS** against the real HTTP API (real NextAuth login, real routes, real MongoDB): seed logins; unauth 401; supplier 403; admin 403; cross-user cancel → 404 (ownership); cancel own `pending_payment` → 200 + `status=cancelled` + `payment.status=canceled`; **stock restored EXACTLY ONCE** (simple 10+2=12 and variant 5+1=6); statusHistory audit `{status:"cancelled", actor:"customer", note:"customer_cancelled"}`; `order_cancelled` notification (key `order_<id>_order_cancelled`, count stays 1); re-cancel → 409 + no double stock restore + notification count stays 1; variant order cancel → variant stock restored exactly once; coupon released after cancel (usedCount 0, usage count 0, `discount.released`); paid/processing cancel → 409 + stock NOT restored; **strict cancel-vs-payment-verify race tests**: verify-wins (cancel 409, stock untouched — never restored for a paid order), cancel-wins (verify-success claim null — no paid+restored), concurrent cancel-vs-verify-success (exactly ONE wins; never paid+restored), concurrent cancel-vs-verify-NOK (exactly one restores; no double restore).
- **Updated** `scripts/run-regression.js` — `verify-order-cancel` added (**24 suites**; inserted before the payment-retry/variant group — `verify-coupons-marketing` stays near-last, `verify-telegram-alerts` stays last, `verify-db-reconnect` stays first/hermetic).
- `npx tsc --noEmit` → **zero errors** (2 × TS18047 `token` possibly-null fixed with `token!.id` — the established convention after `requireRoleOrError`); code review approved (reviewer-driven fixes: `requireAuth` → `requireRoleOrError(["customer"])` for 403 semantics, machine-readable note rendered via Persian label mapping at both timeline sites, verify-suite fixture ordering + plain-JS syntax, stale 20-test header → real 17-test flow).
- Full sequential regression → **24/24 PASS**.

---

## Session 45 (August 2026) — Supplier Telegram Alerts (Payouts + New Reviews)

### Server
- **Extended** `src/models/Notification.js` — +3 additive `type` enum values: `payout_approved`, `payout_rejected`, `new_review`. Category enum untouched (`payout` + `system` already exist); **no index/migration**. Model change ⇒ dev-server restart was required (Mongoose model cache).
- **Modified** `src/app/api/admin/payouts/route.ts` — supplier notified via `notifyOrderEvent()` **AFTER** the money-state commit in BOTH flows (Session 33 ordering preserved — never before the claim): approve → `payout_approved` after the `balanceAfter` update (`telegramChatId` added to the `finalTx` supplier populate select); reject → `payout_rejected` after the reserve release (separate `Supplier.findById(...).select("user telegramChatId")` lookup — neither `request` nor `claimed` is populated). Sanitized reason flows into the stored `rejectionReason`, the in-app message, and the Telegram body. Dedupe keys `payout_<txn>_approved|rejected`, category `payout`, deep-link `/supplier/wallet`. The post-commit notify block is wrapped in a local try/catch — a notification-side throw can never convert an already-committed payout into a 500.
- **Modified** `src/app/api/reviews/route.ts` — after `Review.create`, the review's supplier (Session 37 denormalized `product.supplier`) is notified with `new_review` (category `system`, dedupe key `new_review_<reviewId>`, deep-link `/supplier/reviews`) via a `Supplier.findById(...).select("user telegramChatId")` lookup; post-commit block wrapped in try/catch (same fail-silent rationale).
- **Extended** `src/lib/telegram.ts` — additive `sendPayoutStatusNotification(chatId, amount, status, reason?)` + `sendNewReviewNotification(chatId, productName, rating)` (reuse `toPersianDigits` + HTML formatting; existing helpers untouched).
- **Modified** `src/components/notifications/notifications-list.tsx` — small Telegram badge (`Send` icon + «تلگرام» label, tooltip) shown when `item.sentToTelegram` is true (already stored on every notification).

### Invariants preserved
- `notifyOrderEvent()` stays the ONLY notification facade; Telegram remains an optional fire-and-forget `telegram()` callback — a push can NEVER fail the payout claim/release or the review write (proven live: bogus chatId + callback failure → payout still committed, `sentToTelegram` false).
- No inventory/checkout/payment/coupon/auth changes. `src/types/index.ts` needed NO changes (`NotificationItem.type` is a plain `string`; categories already include `payout`/`system`).

### Verification
- **Created** `scripts/verify-telegram-alerts.js` — **16/16 PASS** against the real HTTP API (real NextAuth login, real routes, real MongoDB): unauth approve 401, supplier 403, request → reserve, approve → supplier `payout_approved` (category `payout`, link `/supplier/wallet`, dedupe key), re-approve 400 + count stays 1, reject-without-reason 400, reject-with-reason → `payout_rejected` (message includes sanitized reason), **Telegram fail-silent** (`sentToTelegram` false + payout committed despite callback failure), cross-user isolation (customer sees no payout), customer review → supplier `new_review` (category `system`, link `/supplier/reviews`, message mentions product), duplicate review 409 + count stays 1, cross-supplier isolation.
- **Updated** `scripts/run-regression.js` — `verify-telegram-alerts` added as the final suite (**23 suites**; `verify-coupons-marketing` now second-to-last — verify-telegram-alerts is last; `verify-db-reconnect` stays first/hermetic).
- `npx tsc --noEmit` → **zero errors**; code review approved (2 rounds; follow-ups applied: recipient-scoped notification cleanup in the suite, sanitized reject reason, post-commit try/catch wraps in both routes).
- Full sequential regression → **23/23 PASS** (verify-payment-retry flaked once mid-run but passed standalone 14/14 and on the re-run — unrelated to Session 45, which touches no payment flow).

---

## Post-Session 44 Bugfix (August 2026) — Registration DB-Outage Resilience

### Symptom & Root Cause
- **Symptom:** after a machine restart, `POST /api/register` failed with `MongooseServerSelectionError: connect ETIMEDOUT 10.10.34.35:2255` (500) and the header bell's `GET /api/notifications/unread-count` also 500'd — users could not register.
- **Root cause (two parts):**
  1. **Environment (transient):** the Chabokan MongoDB (`services.irn2.chabokan.net:2255`) was unreachable at request time right after boot — the driver's error named a stale private IP `10.10.34.35:2255`. Live probe proved this was connectivity, not a wrong URI: a fresh process connects fine and registration works.
  2. **Compounding code bug:** `src/lib/dbConnect.js` cached the connect promise in `global.mongoose.promise` and **never cleared it on rejection** — once the first request after boot failed, every later `dbConnect()` call re-awaited the same rejected promise and failed instantly, even after the DB recovered, until the dev server was restarted. Proven with an isolated repro: attempt 2 against the healthy URI rejected in **0 ms** (rejected promise reused, no reconnect attempted).
- **Not** caused by the notification API — the unread-count 500 was a separate symptom of the same outage. Registration requires the DB and correctly fails while it is down (no code fix can make it succeed offline).

### Fixes (smallest safe, isolated)
- **Modified** `src/lib/dbConnect.js` — on connect rejection, reset `cached.promise = null` so the next call retries a fresh connection instead of poisoning every later `dbConnect()` call in the process.
- **Modified** `src/app/api/notifications/unread-count/route.ts` — on DB-unavailable failure return `{ count: 0 }` (200) instead of `serverError()`; unused `serverError` import removed. Isolated to this endpoint only — the `notifyOrderEvent()` facade and inbox routes are untouched.

### Constraints respected
- No changes to checkout/payment/inventory/coupon flows or the notification facade; RBAC/auth patterns unchanged; the register route itself is untouched (no new features — pure bugfix).

### Verification
- **Created** `scripts/verify-db-reconnect.js` — **9/9 PASS** hermetic regression suite (no dev server / no DB needed): loads the REAL `dbConnect.js` + REAL unread-count route via `ts.transpileModule` (verify-wishlist-cart precedent) with stubbed deps. Proves: first connect rejects + `cached.promise` reset to null, second call RETRIES and succeeds (poisoned-promise regression), happy path, **discriminator** (fix-removed copy cannot recover), unread-count `{count:0}` 200 when DB down + authed, real count when up, 401 unauth in both cases, **route discriminator** (reverted `serverError()` → 500). Added `.db-reconnect-tmp-*.js` + `.cart-store-s38-tmp.js` to `.gitignore`.
- **Updated** `scripts/run-regression.js` — `verify-db-reconnect` is now the **first suite** (hermetic, no server/DB). Pre-flight restructured: a down dev server no longer aborts before anything runs — the hermetic suite still executes, the 21 HTTP suites are SKIPped, and the runner exits 1 with a clear note (server-up path + exit 0/1/2 semantics unchanged; `verify-coupons-marketing` stays last).
- `npx tsc --noEmit` → **zero errors**; code review approved.
- Live proof on a fresh dev server: `GET /api/products` → 200, `POST /api/register` → **201**, duplicate → 409 (persisted), unauth `unread-count` → 401. Verification test users deleted; temp scripts removed.

---

## Session 44 (August 2026) — Coupon Marketing Surface

### Model + admin (additive, backward compatible)
- **Extended** `src/models/Coupon.js` — `isPublic` (Boolean, default `false`). **No migration, no index changes** — existing coupons render as `false` (private). Private coupons stay hidden; ONLY `isPublic` coupons are ever exposed publicly.
- **Extended** `src/app/api/admin/coupons/route.ts` (POST) + `[id]/route.ts` (PUT) — accept `isPublic` with a **strict `body.isPublic === true`** check (a string `"false"` can never coerce to true and silently publish a coupon — reviewer fix). Admin GET returns full docs (isPublic included) — old coupons default `false`.

### Public API (dedicated, read-only)
- **Created** `src/app/api/coupons/public/route.ts` — `GET /api/coupons/public?page=&limit=` (no auth): filter `isPublic: true` + `isActive: true` + **in-window** (startsAt ≤ now, endsAt > now — the same window semantics as `isCouponUsable()`), sorted `createdAt` desc, paginated (Session 27 shape). **STRICT projection** `.select("code type value minSubtotal maxDiscount endsAt")` — internal fields (`usageLimit`/`perUserLimit`/`usedCount`/`startsAt`/`isActive`/`isPublic`) are NEVER exposed. **IP-keyed rate limit** `coupons:public:<ip>` (60/15min, x-forwarded-for fallback — register precedent) so an unauthenticated endpoint can't be scraped (reviewer fix). Pure read — never validates, claims, or computes discounts.
- `validateCoupon` / `claimCouponForOrder` / `releaseCouponUsage` in `src/lib/coupons.ts` are **byte-for-byte untouched** — the checkout money path is unchanged.

### Storefront + checkout
- **Created** `src/app/(storefront)/coupons/page.tsx` — public «کدهای تخفیف» marketing page: RTL Persian, gradient header, coupon cards (code + percent/fixed value + min-subtotal + expiry, `fa-IR` dates), **copy-to-clipboard** with toast + inline «کپی شد!» state, skeleton/error/empty states. No `title`/`description` marketing fields added (locked decision — renders from existing fields).
- **Created** `src/hooks/use-public-coupons.ts` — `usePublicCoupons(page)` (staleTime 5min; marketing data changes rarely).
- **Modified** `src/app/(storefront)/layout.tsx` — «کدهای تخفیف» nav entry (products / coupons active-state highlighting).
- **Modified** `src/app/(storefront)/checkout/page.tsx` — inline `PublicCouponPicker` in the summary card: lists only public coupons (hidden when `data.total === 0`), clicking **pre-fills the existing coupon input** + info toast; the customer still submits through the **UNTOUCHED** `/api/coupons/validate` → `/api/checkout` claim flow — the picker is a convenience, never a discount source of truth.
- **Modified** `src/app/admin/coupons/page.tsx` — `isPublic` toggle switch in the create/edit form + «عمومی» success badge in the list; edit-form sync.
- **Updated** `src/types/index.ts` — `CouponDoc`/`Coupon` `isPublic`; `PublicCoupon`, `PublicCouponsResponse`.

### Verification
- **Created** `scripts/verify-coupons-marketing.js` — **12 tests against the real HTTP API**: public endpoint 200 without auth, admin create with `isPublic:true` → 201 + persisted, **private coupons NEVER appear in the public list**, **raw-JSON LEAK SCAN** (deep recursive key-set scan — `usageLimit`/`perUserLimit`/`usedCount`/`startsAt`/`isActive`/`isPublic`/`updatedAt` must not appear anywhere in the paginated response), inactive + not-started + expired public coupons hidden, pagination shape, admin toggles `isPublic` off/on → reflected live, **checkout with a public coupon → 201 + exact discount (10% of 100,000 = 10,000)**, **private coupon still valid in checkout but never listed**. Wipes the shared `couponusages`/`ratelimits` collections → **must stay the FINAL suite** in the regression runner.
- **Created** `scripts/run-regression.js` — sequential full-suite runner (shared-DB discipline): Node `fetch` pre-flight against `/api/auth/csrf`, runs all 21 verify suites one at a time, per-suite PASS/SKIP/FAIL + tail summary, exit 1 on failure / 2 on skipped / 0 on all-pass. Replaces the manual shell loop.
- **12/12 PASS**; `npx tsc --noEmit` zero errors (fixes: Button has no `success` variant — Badge does — so the copy button uses a conditional emerald className instead); full regression green (**21 suites, sequential** — all PASS, Skipped: 0).
- Code-reviewer approved (multiple rounds). Reviewer-driven fixes: (1) Button `variant="success"` TS2322 → conditional className; (2) public endpoint IP rate limiting added; (3) admin PUT `!!isPublic` → strict `=== true`; (4) regression-runner nits (skip counting, curl → Node fetch pre-flight, closing brace, header comment).

### Ops notes
- **Model change ⇒ dev-server restart REQUIRED.** `src/models/Coupon.js` gained `isPublic`, and the running process kept the old Mongoose schema (a `$set: { isPublic: true }` would have been silently stripped). Force-killed the stale server by PID (`taskkill //F //PID` on :3000) and booted fresh — the suite then passed 12/12. Any future model edit needs the same restart.
- **Verify scripts MUST run sequentially** — they share the dev DB. `scripts/run-regression.js` enforces the order (verify-coupons-marketing last, since it wipes `couponusages`/`ratelimits`).

---

## Session 43 (August 2026) — Variant-Level Wishlist

### Index migration (data-first, reviewer-confirmed safe)
- **Created** `scripts/migrate-wishlist-index.js` — one-off, re-runnable. **Before touching indexes**: (a) scans for duplicate `(user, product)` rows (abort on any), (b) scans every row with a `variantId` set and verifies it references a REAL, ACTIVE variant of that product (abort on invalid refs), then drops the old unique `{ user, product }` index and creates the new unique `{ user, product, variantId }`. **Collision-safe by construction:** pre-migration all rows have `variantId: null` and `{ user, product }` was already unique → at most one `(user, product, null)` row → the new index cannot collide on existing data (MongoDB treats `null` as a value, so one product-level row per user+product is still enforced).

### Model + API (additive, backward compatible)
- **Modified** `src/models/Wishlist.js` — unique index `{ user, product }` → `{ user, product, variantId }` (same `{ user, createdAt: -1 }` page index unchanged). **Coexistence semantics:** product-level rows (`variantId: null`) and variant-level rows (`variantId` + denormalized `variantSnapshot { sku, label }`) for the SAME product now both fit under one unique index. Old comment cleaned (was "future milestone, unused today").
- **Modified** `src/app/api/wishlist/route.ts`:
  - `POST { productId, variantId? }` — optional `variantId` **validated as BELONGING to the product AND active** (malformed 400, foreign/unknown variant 400 «تنوع محصول یافت نشد», inactive variant 400 «این تنوع محصول فعال نیست», variantId on a simple product 400). **NO silent default-variant fallback on the write path** — if a variantId is supplied it must be valid. `variantSnapshot { sku, label }` denormalized at save time from the variant's attributes. Idempotent via the new unique index (duplicate → 200 `{ added: false }`, E11000 backstop unchanged). Product-level row when `variantId` absent.
  - `GET` — rows now expose `variantId` (null on product-level rows) + `variantSnapshot` (null on product-level rows — contract matches the updated `WishlistItem` type). Deleted-product placeholder (`product: null`) behavior unchanged.
  - `DELETE { productId, variantId? }` — `variantId` present → removes **exactly that variant row** (product-level row for the same product survives); absent → removes **ALL rows** for the product (product-card heart semantics).
- **Modified** `src/app/api/wishlist/ids/route.ts` — `ids` **deduped to one id per product** (a heart fills whenever ANY row for that product exists, so product-level + variant rows don't double-fill) while `count` = **TOTAL rows** (matches the wishlist page total; kept separate from `ids.length` per the Session 35 design).

### Client (hooks / pages)
- **Modified** `src/hooks/use-wishlist.ts` — variant-aware toggle: `addToWishlist`/`removeFromWishlist` accept optional `variantId`; `useToggleWishlist` takes `{ productId, inList, variantId? }`. Optimistic cache: a variant-remove keeps the deduped product id in `ids` (other rows may still exist — self-corrects on settle), a remove-all drops it; count ±1 optimistically, invalidated on settle.
- **Modified** `src/app/(storefront)/products/[slug]/page.tsx` — the detail heart **saves the SELECTED variant** (`variantId: activeVariant?._id` when a variant is selected; `undefined` for simple products) — never silently picks a default. REMOVE uses `variantId: undefined` (remove-all rows) because the detail heart is a product-level toggle — removing a specific variantId could no-op when a different variant was saved, leaving the heart filled and the optimistic cache flickering until refetch (per-variant removal happens on the wishlist page).
- **Modified** `src/app/(storefront)/wishlist/page.tsx` — variant-level rows render an **in-flow strip below the card** (saved label + SKU, RTL with LTR-isolated SKU) so the customer sees WHICH variant was wishlisted; NOT an absolute overlay (would cover the card's add-to-cart button). Deleted variant rows keep the snapshot label; the placeholder remove passes `variantId` to remove exactly that row.

### Session 38 resolver — unchanged (locked decision), regression-proven
- `src/app/api/wishlist/add-to-cart/route.ts` is **byte-for-byte untouched**. The new suite proves the resolver's existing `row.variantId` preference: a variant-level wishlist row resolves to the SAVED variant (B) even though variant A is the first active in-stock; a product-level row falls back to the first active in-stock variant (A).

### Verification
- **Created** `scripts/verify-variant-wishlist.js` — **19 tests against the real HTTP API**: unauth POST 401, supplier 403, variant add 201 + in ids, GET variantId + variantSnapshot (sku/label), duplicate (product+variant) 200 `{added:false}` + 1 row, **product-level + variant rows COEXIST for one product** (new index semantics), invalid variantId 400, foreign/unknown variant 400, variantId on simple product 400, inactive variant 400, GET field contract (variant row exposes snapshot; product-level row null+null), **ids deduped (1 id) + count = total rows (2)**, DELETE with variantId removes exactly that row (product-level survives), DELETE without variantId removes ALL rows, **resolver prefers saved variant B over first in-stock A (Session 38 regression)**, resolver fallback product-level → A, cross-user isolation.
- **19/19 PASS**; `npx tsc --noEmit` zero errors; full regression green (**20 suites, run sequentially** — all PASS, including the pre-existing wishlist/wishlist-cart suites, whose product-level-only fixtures keep `ids.length === count`).
- Code-reviewer approved (multiple rounds). Reviewer-driven fixes: (1) Mongoose lean union-type TS2339 on the POST product query → `eslint-disable` `any` cast (codebase precedent); (2) wishlist-page variant badge moved from an absolute overlay (covered the add-to-cart button) to an in-flow strip; (3) detail-heart remove semantics → remove-all (no-op-removal edge case); (4) stale "future milestone" comment in the model cleaned.

### Ops notes
- **Index migration + model change ⇒ dev-server restart REQUIRED.** The old `{ user, product }` unique index would BLOCK coexistence (a variant row for a product already holding a product-level row → E11000); `scripts/migrate-wishlist-index.js` runs the consistency checks then swaps the index, and the dev server was force-killed (`taskkill //F //PID` on :3000) and booted fresh so Mongoose picks up the new model. Any future index/model edit needs the same restart.
- **Verify scripts MUST run sequentially** — they share the dev DB (each suite wipes the `wishlists` collection in its sweep). The full 20-suite sequential regression passed 100%.

---

## Session 42 (August 2026) — Supplier Storefront Pages

### Public Supplier API (read-only, strict projection whitelist)
- **Created** `src/app/api/suppliers/route.ts` — public `GET /api/suppliers` (no auth): active-only, paginated (Session 27 shape via `parsePaginationParams` + `buildPaginatedResponse`), rows `{ _id, businessName, logo, description, productCount }` with `productCount` from a single `Product.aggregate` using the **same visibility rules as the storefront catalog** (`isActive: true, stock: { $gt: 0 }`). **STRICT projection whitelist** `_id businessName logo description` — `user`, `contactPhone`, `bankAccount`, `telegramChatId`, `balance`, `pendingReserve` are NEVER selected.
- **Created** `src/app/api/suppliers/[id]/route.ts` — public `GET` detail: `mongoose.isValidObjectId` guard → 404 (no CastError 500), inactive/missing → 404, same whitelist + `productCount` via `countDocuments`. Response key-set is exactly `{ _id, businessName, logo, description, productCount }`.
- **Modified** `src/app/api/products/route.ts` — additive `supplier=` query filter (ObjectId-validated → 404 on malformed, no CastError), applied to the existing active+in-stock filter. List + detail populate changed to `.populate("supplier", "_id businessName logo")` (additive — `logo` is a public field; the existing `businessName` remains).

### Supplier model + settings (additive, backward compatible)
- **Extended** `src/models/Supplier.js` — `logo` (String, default `""`, trim, maxlength 500) + `description` (String, default `""`, trim, maxlength 500). **No migration, no index changes, no new collections** — existing docs render as absent (`|| ""`).
- **Extended** `src/app/api/supplier/settings/route.ts` — `PUT` now accepts any of `telegramChatId` / `logo` / `description` (all trimmed, 500-char caps); empty body → 400. **`telegramChatId` behavior unchanged.** `GET` select gains `logo description`.

### Storefront + supplier UI
- **Created** `src/app/(storefront)/suppliers/page.tsx` — public listing: header (Store badge + count), supplier-card grid, pagination, skeleton/error/empty states.
- **Created** `src/app/(storefront)/suppliers/[id]/page.tsx` — public detail: breadcrumb, storefront header card (logo / businessName / productCount / description), `usePublicProducts({ supplier: id, limit: 12 })` product grid, pagination, skeleton/error/404 states.
- **Created** `src/components/storefront/supplier-card.tsx` — logo (falls back to Store icon on error via `logoError` state) / businessName / productCount / description, links to `/suppliers/[id]`.
- **Modified** `src/components/storefront/product-card.tsx` — supplier name + Store icon links to `/suppliers/[id]` (truncated, hover highlight).
- **Modified** `src/app/(storefront)/products/[slug]/page.tsx` — the supplier badge is now a `Link` to `/suppliers/[id]`.
- **Modified** `src/app/supplier/wallet/page.tsx` — «پروفایل عمومی فروشگاه» card: logo URL + description (≤500) inputs, dirty-tracking + save/cancel, synced from settings via `useEffect`. All hooks before the early error return.
- **Modified** `src/app/sitemap.ts` — now async; dynamic `/suppliers/[id]` entries from active suppliers, **fail-silent** on DB errors (static pages always returned).

### Hooks / types
- **Created** `src/hooks/use-public-suppliers.ts` — `usePublicSuppliers(filters)` + `usePublicSupplier(id)` (enabled guard).
- **Modified** `src/hooks/use-public-products.ts` — `supplier` filter param in the query-string builder.
- **Modified** `src/hooks/use-supplier-settings.ts` — `SupplierSettings` gains `logo?`/`description?`; new `useUpdatePublicProfile` mutation (invalidates `supplierSettingsKeys.all`).
- **Updated** `src/types/index.ts` — `PublicSupplier`.

### Verification
- **Created** `scripts/verify-suppliers.js` — **20 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB): public list 200 + paginated + active-only, public detail 200 with **exact whitelist key-set**, **PROJECTION LEAK SCAN** (deep recursive scan asserting none of `user`/`contactPhone`/`bankAccount`/`telegramChatId`/`balance`/`pendingReserve` appear in list, detail, or the product-populate response), inactive supplier excluded + detail 404, malformed id 404, **productCount counts only active + in-stock**, `supplier=` filter returns only that supplier's products (zero-stock/inactive/cross-supplier excluded) + malformed 404, settings PUT (trim + 500 cap, `telegramChatId` unchanged, customer 403, **cross-supplier isolation** — C's profile edit never touches A, empty body 400), pagination shape.
- **20/20 PASS**; `npx tsc --noEmit` zero errors; full regression green (19 suites, run **sequentially** — see ops note on the one transient failure).
- Code-reviewer approved (4 rounds). Bugs found & fixed during verification: (1) missing `Store` lucide import in the wallet page (tsc TS2552); (2) `[id]` route Mongoose `FlattenMaps` lean-typing → `eslint-disable` `any` cast (matches the products-route precedent); (3) `SupplierFilters` needed an index signature (TS2345); (4) supplier-card broken-logo `onError` left an empty square → `logoError` state fallback to the Store icon; (5) **verify-script fixture bug:** supplier B and C shared one user, so `Supplier.findOne({ user })` in the settings PUT resolved to B → C's logo update landed on B and the isolation test failed → B got its own dedicated user.

### Ops notes
- **Model change ⇒ dev-server restart REQUIRED.** `src/models/Supplier.js` gained fields, but Mongoose caches models by name on `mongoose.models`, so the running process kept the OLD schema — `$set` silently stripped `logo`/`description` and `select` returned `undefined` (3 verify failures: logo not trimmed, profile not updated, isolation "changed"). Force-killed the stale server by PID (`taskkill //F //PID`) and booted fresh — all 20 passed. Any future model edit needs the same restart (this is why Session 41, with no schema changes, needed none).
- **Verify scripts MUST run sequentially** — they share the dev DB. The full sequential regression had one transient failure: `verify-payment-retry` 11/13 with `502 "درگاه پرداخت موقتاً در دسترس نیست"` (Zarinpal sandbox gateway briefly unreachable right after the dev-server restart); the isolated re-run passed **14/14** — environmental, no Session 42 code involved.

---

## Session 41 (August 2026) — Admin Analytics & Reporting

### API: read-only admin analytics endpoint
- **Created** `src/app/api/admin/analytics/route.ts` — `GET /api/admin/analytics?range=7|30|90` (default 30), admin-only via `requireRoleOrError(["admin"])` (401 unauth / 403 wrong role), invalid range → 400. **PURE READ-ONLY** — only `aggregate` + `countDocuments`, never writes; zero business-logic files touched. Returns:
  - `summary` — revenue (cancelled excluded, same rule as `/admin/stats`), orders, avgOrderValue, couponSavings, newCustomers
  - `timeSeries` — per-UTC-day `{date, orders, revenue}`, **zero-filled with no gaps** (`buildSeries` matches the `$dateToString` UTC bucketing exactly)
  - `topProducts` (top 10 by item revenue) + `topCategories` (top 10 via `Order.items.product → Product → Category` lookup; deleted products/categories fall back to «نامشخص»)
  - `couponStats` — total/active/totalUses (from `Coupon.usedCount`), plus `discountedOrders` + `totalDiscount` from an **UNBOUNDED** in-window aggregation (never capped by the top-5 display list — code-review fix), `topCoupons` (top 5 display list, shared `DISCOUNT_MATCH`)
  - `supplierStats` — all-time ledger: earnings (`order_credit`), paidOut (approved payouts), pending payouts, outstanding balance + pendingReserve (includes inactive suppliers' balances — documented decision: money owed to a deactivated supplier is still owed)
  - `ordersByStatus` — status funnel (all statuses incl. cancelled) with Persian labels
- **No DB schema changes, no new collections, no indexes required.** Checkout/payment/inventory/coupon/wishlist/order untouched.
- **Known limitation (documented in the route):** UTC day bucketing — a 23:30 local order lands in the next UTC day for a UTC+3:30 storefront (acceptable v1).

### Client: admin analytics page
- **Created** `src/hooks/use-admin-analytics.ts` — `useAdminAnalytics(range)` (staleTime 30s; query key includes range so switching 7/30/90 refetches)
- **Created** `src/app/admin/analytics/page.tsx` — RTL Persian page: range selector (۷/۳۰/۹۰ روز), summary stat cards (revenue / avg order value / coupon savings / new customers), **hand-rolled SVG `RevenueChart`** (no chart dependency — revenue bars + thin order bars, gridlines, per-bar tooltips, legend, LTR-isolated wrapper), top products/categories ranked rows with relative-weight bars, coupon stats card (mini-stats + top coupon codes), supplier payouts card, order-status funnel bars. Loading skeletons, error card with retry, empty states.
- **Modified** `src/components/layout/admin/admin-sidebar.tsx` — «گزارش‌ها» nav entry (BarChart3 icon) between dashboard and products.
- **Updated** `src/types/index.ts` — `AnalyticsTimePoint`, `AnalyticsTopRow`, `AnalyticsCouponStats`, `AnalyticsSupplierStats`, `AnalyticsOrderStatusRow`, `AdminAnalytics`.

### Verification
- **Created** `scripts/verify-analytics.js` — **16 tests against the real HTTP API** with a **baseline → seed → delta** design (robust to any pre-existing shared-DB data): unauth 401, customer 403, supplier 403, admin 200 + full shape, invalid range 400, valid range=7 accepted, **read-only guarantee** (collection counts unchanged across repeated calls), time-series deltas (today +1 order/+100M cancelled-excluded, day-5 +1/+36M, 60-day-old order invisible in the 30-day window, zero-fill length 30), top products/categories exact aggregates (deliberately dominant seeded revenue so rows stay in top-10), coupon deltas (+2 coupons, +4 usedCount, +1 discounted order, +4M in-window discount, top-coupon row), supplier deltas (earnings +800K, paidOut +300K count 1, pending +100K count 1, balance +500K, reserve +100K).
- **16/16 PASS**; `npx tsc --noEmit` zero errors; full regression green (all 16 suites, run sequentially — see ops note).
- Code-reviewer approved (4 rounds). Bugs found & fixed during verification: (1) coupon `discountedOrders`/`totalDiscount` were derived from the top-5 list → now a separate unbounded aggregation; (2) **critical** Promise.all/destructure misalignment (a duplicate `discountSummary` in the array vs one name in the destructure) 500'd every request — route rewritten with exactly 14/14 aligned bindings; (3) test-fixture bugs: users created *after* login attempts, item snapshot name ≠ product name (topProducts lookup missed), absolute global aggregates → delta design; unused `Badge` import removed from the page.

### Ops notes
- **Read-only by construction:** no model changes, no dev-server restart needed.
- **Verify scripts MUST run sequentially** — they share the dev DB; one parallel batch flaked (supplier-replies 3/21, refund 1/12, sse 7/11, wishlist-cart 16/18, variant-polish 8/13) and **every one passed 100% when re-run alone** (21/21, 12/12, 11/11, 18/18, 14/14).

---

## Session 40 (August 2026) — Real-time Notifications (SSE)

### Server: SSE endpoint + in-memory stream registry
- **Created** `src/lib/notification-stream.ts` — in-memory subscriber registry keyed by userId (`Map<userId, Set<subscriber>>`) stored on **globalThis** (mirrors the `global.mongoose` pattern in `dbConnect.js` — in Next dev the route-handler bundle and the lib bundle can each hold a separate module copy, which would silently split subscribe() from publish(); the first verify-sse run hit exactly that and the globalThis singleton fixed it). API surface: `subscribeToUserStream()` (idempotent unsubscribe, prunes the user key when the set empties), `publishToUserStream()` (snapshot iteration, dead-subscriber pruning, **fail-silent — never throws**), `countUserConnections()` + `MAX_CONNECTIONS_PER_USER = 5` + `STREAM_HEARTBEAT_MS = 15_000`. This is a **transport layer only** — `notifyOrderEvent()` remains the ONLY notification facade.
- **Created** `src/app/api/notifications/stream/route.ts` — `GET` SSE endpoint: `requireAuth` (401) → connection cap (429) → `ReadableStream` body with `Content-Type: text/event-stream` + `Cache-Control: no-cache, no-transform` + `Connection: keep-alive` + `X-Accel-Buffering: no`; `dynamic = "force-dynamic"`. Initial `: connected` comment flushes headers; heartbeat `: ping` every 15s keeps proxies alive; **unified idempotent `cleanup()`** (clear interval + unregister) is called from BOTH the client-abort signal AND the stream `cancel()` callback — no interval/subscription leak (code-review fix: the first draft only cleared the interval in the abort path).
- **Modified** `src/lib/notifications.ts` — `notifyOrderEvent()` publishes the created notification to the user's live streams **after** the MongoDB write commits (DB stays the source of truth; the push is a delivery hint). The E11000 dedupe path returns early, so deduped events are never re-pushed. The publish is wrapped in its own try/catch — fail-silent, can never affect the business flow or the facade's return value.
- **Modified** `src/types/index.ts` — `NotificationStreamEvent` (`id`, `type`, `category`, `message`, `link?`, `relatedOrder?`, `isRead`, `createdAt`).

### Client: live updates with polling fallback intact
- **Modified** `src/hooks/use-notifications.ts` — added `useNotificationStream()`: one EventSource per authenticated session, invalidates `notificationKeys.all` on every pushed event (the refetch reads authoritative MongoDB data — never the event payload). Retry hygiene: `onopen` resets the failure counter (SSE comment frames don't fire `onmessage`, so messages alone can't prove health), 5s reconnect timer is tracked + cleared on unmount, gives up after 10 consecutive failures and lets the **untouched 30s polling** (`useUnreadCount` `refetchInterval`) take over.
- **Modified** `src/components/storefront/notification-bell.tsx` — mounts `useNotificationStream()` so the badge updates instantly in both the storefront header and the supplier header; the 30s `useUnreadCount` refetch remains as the authoritative fallback.
- **No toast was added (deliberate):** the approved design listed a toast as *optional* — polling + instant query invalidation were deemed sufficient without risking UX noise (e.g. during checkout). Revisit if product feedback asks for one.

### Verification
- **Created** `scripts/verify-sse.js` — **11 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB): unauth stream → 401; authenticated connect → 200 + `text/event-stream` + `: connected`; **live delivery after real notification creation** (admin confirm → `order_confirmed` event with matching `relatedOrder`/`link` on A's stream); **customer isolation** (B's open stream receives nothing while A's is delivered); **supplier isolation** (real checkout → supplier stream gets `new_order`, B's stream gets nothing); **disconnect/reconnect** (closing unregisters; a fresh connection keeps receiving events); **heartbeat** (`: ping` within HEARTBEAT + slack). SSE parsed in-process via `fetch` + `getReader()` + frame splitting.
- **11/11 PASS**; `npx tsc --noEmit` zero errors; regressions green: notifications 18/18, supplier-replies 21/21, coupons 27/27, wishlist-cart 18/18, payouts 17/17, reviews 20/20, wishlist 14/14, refund 12/12, payment-retry 14/14, variant-polish 14/14, pagination 24/24, variants 16/16, upload-repro 15/15, variants-e2e 32/32, upload-formats 9/9, concurrency 10/10.
- Code-reviewer approved (3 rounds). Follow-ups applied: unified `cleanup()` to fix the heartbeat-interval leak on `cancel()`; tracked reconnect timer + 10-failure cap; `onopen` failure-counter reset; removed the now-redundant `onmessage` counter reset.

### Ops notes
- **Multi-instance caveat:** the in-memory registry is single-process only. Scaling to multiple instances requires swapping `notification-stream.ts` for a Redis/Upstash pub/sub adapter — the subscribe/publish API surface stays identical, so the route and the facade don't change. The polling fallback keeps the UI correct even without SSE.
- **Dev-mode module duplication (root cause of the first failing run):** Next dev can bundle the route handler and the shared lib separately, each with its own module-level Map — subscribers never see publishes. Fixed via the `globalThis` singleton; if this ever regresses, check that `__notificationStreamRegistry` is shared.
- **Session 39 note:** the Session 39 (Discounts & Coupons) changelog entry was not written at the time (only PROJECT_STATE.md was updated) — Session 39's 27/27 suite is recorded there. Session 40's changelog covers the SSE work only.

---

## Session 38 (August 2026) — Wishlist → Cart Bulk Move

### API-assisted resolver (read-only, no stock reservation)
- **Created** `src/app/api/wishlist/add-to-cart/route.ts` — `POST` customer-only (`requireRoleOrError(["customer"])`): **auth → payload validation → rate limit → DB resolution** (approved order). Payload: optional `{ productIds?: string[] }` — missing/empty = process ALL of the customer's wishlist rows; provided = only rows whose product is in the list. Rows are ALWAYS scoped to `token.id` (`{ user, product: { $in } }`), so foreign ids can't match — **no IDOR** (verified by test). Dedicated rate-limit key `wishlist-cart:<userId>` (10/15min — independent of the wishlist 30/15min key).
- **Resolution (fresh DB state):** deleted product → skip `deleted`; `isActive:false` → skip `inactive`; simple product with `stock <= 0` → skip `out_of_stock`; variant product → prefer the (future) wishlist row `variantId` if present, else **first active variant with stock > 0** (matches VariantSelector auto-select semantics) → skip `no_available_variant` when none. Returns ready-to-add cart payloads `{ added: [{ id, variantId?, sku?, variantLabel?, slug, name, price, maxQuantity, image?, variant? }], addedCount, skipped: [{ productId, reason }], skippedCount }` — the `variant` block is **extensible for future variant metadata**.
- **Consistency guarantees:** the resolver NEVER calls `reserveStock()`/`restoreStock()` (checkout keeps exclusive inventory authority); it returns FRESH prices/stock so checkout's existing price-revalidation 409s are minimized; wishlist rows are NEVER modified (keep-in-wishlist design). **Zero changes** to checkout, inventory, payment, or the Zustand cart-store architecture.

### Client-side cart mutation
- **Created** `src/hooks/use-wishlist-cart.ts` — `useAddWishlistToCart` (mutation sends `undefined` → resolver processes all rows; no cache invalidation needed — wishlist rows untouched, cart is client state).
- **Updated** `src/app/(storefront)/wishlist/page.tsx` — «افزودن همه به سبد» button (disabled when `isLoading || !data || data.total === 0` — matches the resolver's ALL-pages scope, not just the current page), maps each returned item into `addItem` (idempotent merge — quantity increments capped at `maxQuantity`, no duplicate keys), toasts for all-added / partial (`X اضافه شد؛ Y مورد در دسترس نیست`) / nothing-available, then opens the cart drawer (`setCartOpen(true)`). Unreachable «سبد خرید خالی است» branch removed.

### Types
- **Updated** `src/types/index.ts` — `WishlistCartSkippedReason`, `WishlistCartAddItem` (mirrors the Zustand `CartItemInput` contract + extensible `variant`), `WishlistCartAddResult`.

### Verification
- **Created** `scripts/verify-wishlist-cart.js` — **18 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB): unauth 401, supplier 403, empty wishlist → 0, simple product resolves with FRESH price/stock/maxQuantity, **resolver never decrements stock**, variant → first ACTIVE variant (A) with sku/label/price, disabling A → falls back to B, inactive → `inactive`, deleted → `deleted`, OOS simple → `out_of_stock`, OOS variant → `no_available_variant`, mixed → partial `{ addedCount: 2, skippedCount: 4 }`, **productIds subset — foreign ids ignored (no IDOR)**, dedicated rate limiter → 429 after threshold, plus **REAL zustand cart-store merge tests** (the store is transpiled to CommonJS in-process via `typescript.transpileModule` and loaded from an in-project temp file so `require("zustand")` resolves): existing cart item + wishlist add → merged to quantity 2 with no duplicate key, quantity increment + **maxQuantity cap** (4 adds capped at 2), simple vs variant composite keys stay distinct (`id`, `id:variantId`) with variant quantity incremented.
- **18/18 PASS**; `npx tsc --noEmit` zero errors; regressions green: wishlist 14/14, reviews 20/20, notifications 18/18, supplier-replies 21/21, refund 12/12, payouts 17/17, payment-retry 14/14, variant-polish 14/14, pagination 24/24, variants 16/16, upload-repro 15/15.
- Code-reviewer approved (no critical feedback). Follow-ups applied from review: removed a dead resolver call in TEST 10 (keeps customer1 at 9/10 rate-limit calls), removed the unreachable toast branch, loaded the real cart store ONCE before the merge tests with clean assert guards.

### Bugs found & fixed during verification
1. **Verify-script bug:** the transpiled cart-store temp file was written to `os.tmpdir()` — `require("zustand")` can't resolve from outside the project → 3 merge tests failed with `Cannot find module 'zustand'`. Fixed by writing the temp file inside the project root (`.cart-store-s38-tmp.js`, unlinked in `finally` + swept at suite start).
2. **Verify-script bug:** rate-limit cleanup/reset used `{ key: ... }` but `src/lib/rate-limiter.ts` stores docs as `{ _id: "rl:<key>" }` — the deletes were silent no-ops. Fixed to target `_id: /^rl:wishlist-cart:/` and exact `_id: "rl:wishlist-cart:<id>"`.

### Ops notes
- The payment-retry suite initially showed 4 gateway 502 failures — the documented stale-dev-server network issue (connect-timeouts to `sandbox.zarinpal.com` after long sessions), unrelated to Session 38. Force-killed the dev server by PID and booted fresh («Ready in 502ms») → payment-retry 14/14.

---

## Session 37 (August 2026) — Supplier Review Replies

### Review Model (additive)
- **Extended** `src/models/Review.js` — `supplier` ref (denormalized from `product.supplier` at creation — stable ownership snapshot; **invariant documented**: the ONLY review-creation write path is `POST /api/reviews`, and the reply route re-verifies live ownership via `Review.product → Product.supplier`, never trusting the snapshot) + single `reply` subdocument `{ author (User ref), text, at }` with `_id: false` + new index `{ supplier, status, createdAt: -1 }` for the supplier reply queue
- **Extended** `src/models/Notification.js` — `review_replied` added to the `type` enum
- **Bug found & fixed during verification:** `reply` MUST be a typed single-nested subdocument with `default: null` — an inline subdoc definition would make Mongoose auto-populate `{ author: null, text: "", at: null }` on EVERY review, so the atomic claim `{ reply: null }` could never match and every reply failed with «قبلاً به این دیدگاه پاسخ داده شده است». The root cause of the 5 failing tests was environmental on top of the model shape: the dev server was still holding the PRE-fix Mongoose schema in memory (`pkill` on Windows doesn't reliably kill `next dev`), so the old inline-subdoc behavior persisted until the stale process (PID on :3000) was force-killed and a fresh server booted

### API
- **Created** `src/app/api/supplier/reviews/route.ts` — `GET ?status=&page=&limit=` supplier-only review queue: supplier resolved from `token.id` (never client-supplied), scoped via denormalized `Review.supplier`, populated customer (name) + product (name/slug/images) + `reply.author`, paginated (Session 27 shape)
- **Created** `src/app/api/supplier/reviews/[id]/reply/route.ts` — `POST { text }` supplier-only: ObjectId 400 → supplier doc 404 → text validated (empty / >1000 chars 400) **before** the 30/15min rate limiter → sanitize → review 404 → **ownership** `Product.findOne({ _id, supplier })` (404 — same message for not-found/not-owned, no existence leak) → **approved-only** pre-check (pending/rejected → 400 «فقط به دیدگاه‌های تأییدشده») → **atomic claim** `findOneAndUpdate({ _id, status: "approved", reply: null }, { $set: { reply } })` (double-reply impossible — loser → 400) → notify author with `review_replied` via local `safeNotifyOrderEvent()` (structurally fail-silent — a notification failure can never turn a committed reply into a 500)
- **Updated** `src/app/api/reviews/route.ts` — `POST` now stores the denormalized `supplier` (from the product already fetched for the delivered-order gate); `GET` populates `reply.author` (name) — **backward compatible** (additive optional field)

### UI / hooks / types
- **Created** `src/app/supplier/reviews/page.tsx` — reply queue: status tabs (همه / در انتظار / تأیید شده / رد شده), review cards (customer + product + stars + text + date), inline reply box, replied badge
- **Created** `src/hooks/use-supplier-reviews.ts` — `useSupplierReviews(page, status)` + `useReplyToReview` (invalidates `["supplier-reviews"]`)
- **Updated** `src/components/layout/supplier/supplier-sidebar.tsx` — «پاسخ به دیدگاه‌ها» nav entry (MessageSquareText icon)
- **Updated** `src/components/storefront/reviews-section.tsx` — renders «پاسخ فروشنده» (distinct bordered block: author + date + sanitized text) under each approved review
- **Updated** `src/app/admin/reviews/page.tsx` — read-only «پاسخ فروشنده» line on review cards (no reply moderation per approved design)
- **Updated** `src/types/index.ts` — `ReviewReply` (`{ author: { _id, name }, text, at }`), `Review.reply?`, `SupplierReview`, `AdminReview.reply?`

### Verification
- **Created** `scripts/verify-supplier-replies.js` — **21 tests against the real HTTP API**: unauth 401, customer 403, admin 403, fresh queue empty, create + admin-approve via real API, reply → 200 + saved, **double-reply blocked 400 (atomic claim)**, pending/rejected → 400, **cross-supplier 404**, customer reply 403, empty / >1000-char 400, **HTML/script sanitized in DB**, public GET includes reply, `review_replied` notification to the author, queue status filter + pagination shape
- **21/21 PASS**; `npx tsc --noEmit` zero errors; regressions green: reviews 20/20, notifications 18/18, wishlist 14/14, refund 12/12, payouts 17/17, payment-retry 14/14, variant-polish 14/14, pagination 24/24, variants 16/16, upload-repro 15/15
- Code-reviewer approved (no critical feedback); minor non-blocking notes: denormalized `Review.supplier` drift if a product is ever reassigned to another supplier (documented invariant covers creation-time; queue + reply-route use different scoping so the old supplier sees it but can't reply — acceptable today), rate limiter fires after the review-load + ownership queries (matches the established convention)

### Ops notes
- Dev server had to be force-killed by PID (`taskkill //F //PID` + checking `netstat -ano | grep :3000`) and restarted after the Review model change — `pkill -f 'next dev'` is unreliable on Windows (the old process keeps serving with the stale Mongoose schema; a fresh boot log «Ready in Xms» after the kill confirms the new model is live)

---

## Session 36 (August 2026) — Customer Notifications

### In-App Notification Core
- **Created** `src/lib/notifications.ts` — `notifyOrderEvent()` is the SINGLE facade for creating in-app notifications. In-app is the source of truth; Telegram is an optional adapter. It NEVER throws and NEVER blocks the caller (all failures logged + swallowed).
- **Dedupe** — each event carries a `notificationKey` ("order_<id>_<event>"); the unique partial index `{ recipient, notificationKey }` on Notification rejects a second insert with E11000 → treated as "already notified" → no-op
- **Telegram adapter** — optional `telegram()` callback dispatched fire-and-forget; its boolean result is stored in `sentToTelegram` (never awaited by callers)
- **Extended** `src/models/Notification.js` — `category` (order/payment/payout/system), `link` (deep-link target), `notificationKey`, `readAt`, `metadata`; new indexes: `{ recipient, createdAt: -1 }`, `{ recipient, isRead: 1 }`, unique partial `{ recipient, notificationKey }`

### API
- **Created** `src/app/api/notifications/route.ts` — `GET` authenticated inbox (customer/supplier/admin, self-scoped to `token.id`): paginated (Session 27 shape), `unreadOnly=1` + `category=` filters, returns `unreadCount` alongside
- **Created** `src/app/api/notifications/unread-count/route.ts` — `GET` lightweight badge count for the header bell (single indexed query)
- **Created** `src/app/api/notifications/read-all/route.ts` — `PUT` mark ALL of the caller's unread notifications read (idempotent; rate-limited 30/15min)
- **Created** `src/app/api/notifications/[id]/read/route.ts` — `PUT` mark ONE notification read — OWNER-SCOPED to `recipient: token.id` (invalid id 400, not-found/not-owned 404, already-read idempotent 200 with `readAt` preserved)

### Event Wiring (best-effort, after business commit)
- **Checkout** → supplier `new_order`
- **Admin orders** → customer `order_confirmed` / `order_shipped` / `order_delivered` / `order_cancelled`
- **Supplier orders** → supplier `order_confirmed` (self-confirm)
- **Admin refund** → customer `order_refunded` (+ `restoreOrderStock()`)
- **Payment verify** → customer `payment_paid` / `payment_failed` / `payment_cancelled` — dispatches wrapped in `safeNotifyOrderEvent()` so a notification failure can NEVER affect the payment redirect outcome (review fix c)

### Storefront / Supplier UI + hooks / types
- **Created** `src/components/storefront/notification-bell.tsx` — header bell with live unread badge (30s refetch + window focus), used in storefront header + supplier header
- **Created** `src/components/notifications/notifications-list.tsx` — SHARED inbox: category tabs (همه/سفارش/پرداخت/کیف پول), mark-all-read button, per-item deep-links (role-appropriate `link` stored at event time), unread highlight, PaginationControls
- **Created** `src/app/(storefront)/notifications/page.tsx` + `src/app/supplier/notifications/page.tsx`
- **Created** `src/hooks/use-notifications.ts` — `useUnreadCount` (30s), `useNotifications(page, {unreadOnly, category})`, `useMarkRead`, `useMarkAllRead` (invalidate `["notifications"]`)
- **Updated** `src/types/index.ts` — `NotificationCategory`, `NotificationItem`, `NotificationsResponse` (extends `PaginatedResponse` + `unreadCount`), `UnreadCountResponse`
- **Updated** `src/app/(storefront)/layout.tsx` + `src/components/layout/supplier/supplier-header.tsx` — `NotificationBell` wired

### Verification
- **Created** `scripts/verify-notifications.js` — **18 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB): unauth 401 ×3 (inbox/unread-count/read-all), fresh inbox empty, admin confirm → customer `order_confirmed` (link + key + unread), **dedupe** (pre-seeded key blocks duplicate, count stays 1), single read → `readAt` + idempotent repeat, read-all → unread 0 + idempotent, **cross-user isolation** (other customer / supplier → 404), pagination + category + unreadOnly filters, real checkout → supplier in-app `new_order` (no telegram chat id needed — in-app is source of truth), supplier confirm → supplier `order_confirmed`, admin refund → `order_refunded` + stock restored once, payment NOK → `payment_cancelled` + stock restored once
- **18/18 PASS**; `npx tsc --noEmit` zero errors; regressions green: wishlist 14/14, reviews 20/20, payouts 17/17, refund 12/12, payment-retry 14/14, variant-polish 14/14, pagination 24/24, variants 16/16, upload-repro 15/15

### Code-review follow-ups (applied)
1. **Removed** the unused exported `orderNotificationKey()` helper from `src/lib/notifications.ts` (callers already inline the key strings).
2. **Simplified** the `customerId` extraction in the admin refund route — replaced the nested triple-cast with a single typed optional access.
3. **Hardened** `src/app/api/payment/verify/route.ts` — added a local `safeNotifyOrderEvent()` (try/catch) used at ALL three dispatch sites (cancel/failed/success), so even a future `notifyOrderEvent` throw can never flip a successful payment into a failed redirect.

### Ops notes
- Dev server restarted after the Notification model indexes (stale Mongoose model would miss the new partial unique index)
- The `login_ip` rate limiter can accumulate across repeated test runs on localhost (`::1`, max 30/15min) and start rejecting logins — clear the `ratelimits` collection between long test sessions

---

## Session 35 (August 2026) — Customer Wishlist

### Wishlist Model
- **Created** `src/models/Wishlist.js` — `user` (User ref), `product` (Product ref), optional `variantId`/`variantSnapshot` (reserved for a future variant-wishlist milestone, unused today), timestamps
- **Unique index** `{ user, product }` — atomic duplicate prevention; `{ user, createdAt: -1 }` for the page query
- **Registered** in `src/lib/dbConnect.js` (centralized model registration)

### API
- **Created** `src/app/api/wishlist/route.ts`:
  - `GET ?page=&limit=` — customer-only, paginated (newest first). **Two-query approach** (`Wishlist.find().select('product createdAt')` then `Product.find({ _id: { $in } })`) instead of `.populate().lean()` because lean+populate leaves a missing ref as a raw ObjectId — which broke the deleted-product placeholder. Returns rows `{ _id, productId (raw ref), product (doc or null), createdAt }`; deleted products → `product: null` (never silently dropped), inactive products → `isActive: false` surfaced
  - `POST { productId }` — customer-only, payload validated BEFORE the 30/15min rate limiter (Session 34 convention), product must exist + `isActive` (404 otherwise), **idempotent add** (unique index + E11000 backstop → 200 `{ added: false }`)
  - `DELETE { productId }` — customer-only, rate-limited, **idempotent remove** scoped to `token.id` (`{ removed: true/false }`)
- **Created** `src/app/api/wishlist/ids/route.ts` — `{ ids, count }`; `count` computed separately (not from `ids.length`) so the header badge stays correct if pagination/filtering changes the ids payload

### Storefront UI
- **Created** `src/app/(storefront)/wishlist/page.tsx` — customer gate, paginated `ProductCard` grid, **deleted-product placeholder card** (`product: null`) with a remove button using `productId`, inactive products render with their stock state, empty state, `PaginationControls`
- **Updated** `src/components/storefront/product-card.tsx` — heart button top-right (filled when saved); guests → toast + redirect to `/login`
- **Updated** `src/app/(storefront)/products/[slug]/page.tsx` — «افزودن به علاقه‌مندی‌ها» button beside add-to-cart with the same guest gate
- **Updated** `src/app/(storefront)/layout.tsx` — heart icon + rose count badge in the header + «علاقه‌مندی‌ها» nav link (customer only)

### Hooks / Types
- **Created** `src/hooks/use-wishlist.ts` — `useWishlistIds` (enabled only for customers, 60s staleTime, powers every heart), `useWishlistItems(page)`, `useToggleWishlist` (optimistic ids/count update with rollback on error; invalidates `["wishlist"]` prefix)
- **Updated** `src/types/index.ts` — `WishlistItem` (`productId` + nullable `product`), `WishlistIdsResponse`

### Bugs found & fixed during verification
1. **Deleted-product placeholder bug (live):** `.populate().lean()` leaves a missing ref as a raw ObjectId (not `null`), so `productId` computed as `""` — the row couldn't be found/removed. Fixed with the two-query approach (deterministic `productId` always).
2. **Test-fixture flaw:** TEST 13 tried to *add an inactive product* (route correctly 404s — you can't add inactive). Rewrote to add-while-active then deactivate → row stays listed with `isActive: false` (the real requirement).
3. **Code-review follow-ups:** missing guest gate on the product-detail heart (silent 401 for guests) → added toast + `/login` redirect; rate-limit ordering moved after payload validation; inline double-cast cleaned to a single typed cast.

### Verification
- **Created** `scripts/verify-wishlist.js` — **14 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB): unauth 401, supplier 403, add → 201 + `added:true` + in ids, **duplicate add → 200 `{added:false}` + DB count stays 1**, invalid id 400 / nonexistent 404, remove → `removed:true` + gone / remove-not-present `removed:false`, **cross-user isolation** (B can't see/remove A's), pagination shape + populated fields, **deleted product → kept as `product:null` placeholder with productId**, **inactive product stays listed with `isActive:false`**, ids `{ ids, count }` matches DB
- **14/14 PASS**; `npx tsc --noEmit` zero errors; regressions green: reviews **20/20**, payouts **17/17**, refund **12/12**, payment-retry **14/14**, variant-polish **14/14**, pagination **24/24**, variants **16/16**, upload-repro **15/15**
- **Ops note:** dev server restarted after the new Wishlist model (stale Mongoose model would have failed on the new collection)

---

## Session 34 (August 2026) — Customer Reviews & Ratings

### Review Model
- **Created** `src/models/Review.js` — `customer` (User ref), `product` (Product ref), `order` (Order ref = verified-purchase proof + per-order-item anchor), immutable `itemSnapshot` (name/sku/variantId/variantLabel/image/price/quantity copied at creation for audit), `rating` (1–5), `text` (≤1000, sanitized), `status` enum `[pending, approved, rejected]` (default `pending`), `reviewedBy`/`reviewedAt`/`rejectionReason` moderation audit
- **Unique index** `{ customer, product, order }` — **one review per purchased order-item** (atomic duplicate prevention; E11000 → 409 backstop). Plus `{ product, status, createdAt }` (storefront) and `{ status, createdAt }` (admin queue)

### Verified-Purchase Gating (design per user decision)
- **Eligibility requires a DELIVERED order** (not merely paid): `Order.findOne({ _id, customer, "payment.status": "paid", status: "delivered", items: { $elemMatch: { product } } })` → otherwise 403 «فقط خریداران این محصول (پس از تحویل سفارش) می‌توانند دیدگاه ثبت کنند»
- A customer with TWO delivered orders for the same product can review **once per order-item** (both verified by tests)

### API
- **Created** `src/app/api/reviews/route.ts`:
  - `GET ?product=&page=&limit=` — public, **approved only**, paginated; returns `ratingSummary { average, count }` aggregated from approved reviews; customer name populated (no phone/contact leak)
  - `POST` — customer-only (`requireRoleOrError(["customer"])`), payload validated BEFORE the rate limiter (invalid submissions don't burn quota), then **rate-limited 20/15min per customer**, product must exist+active, order gate, duplicate pre-check + E11000 backstop → 409, `sanitizePlainText` on text, `status: "pending"`, itemSnapshot copied from the order item
- **Created** `src/app/api/reviews/mine/route.ts` — `GET ?product=` (customer-only): my reviews (any status) + `eligibleOrders` (delivered+paid orders containing the product with NO review yet) — powers the storefront form gate
- **Created** `src/app/api/admin/reviews/route.ts` — `GET ?status=&page=&limit=` (admin-only): moderation queue with product (name/slug/images/isActive) + customer (name/phone) + reviewedBy populated
- **Created** `src/app/api/admin/reviews/[id]/moderate/route.ts` — `POST { action: "approve"|"reject", reason? }` (admin-only): **atomic claim** `findOneAndUpdate({ _id, status: "pending" })` → processed exactly once (loser → 400); reason REQUIRED for reject (sanitized); `Review.exists()` distinguishes 404 from 400; `reviewedBy`/`reviewedAt` recorded
- **Updated** `src/app/api/products/route.ts` — single-product response now includes `ratingSummary` (approved-only aggregation) for SEO + storefront sync

### Storefront UI
- **Created** `src/components/storefront/reviews-section.tsx` — rating summary (average + star row + count), approved reviews list (paginated, reviewer name + date + stars + sanitized text), star-picker + textarea «ثبت دیدگاه» form shown ONLY when the logged-in customer has an eligible delivered order not yet reviewed; shows my-review status badges (در انتظار تأیید / تأیید شده / رد شده + rejection reason); not-logged-in prompt
- **Updated** `src/app/(storefront)/products/[slug]/page.tsx` — renders `<ReviewsSection>` + **`ProductJsonLd` with `aggregateRating`** from `ratingSummary` (approved-only, keeps SEO structured data in lockstep with moderation)

### Admin UI / Hooks / Types
- **Created** `src/app/admin/reviews/page.tsx` — moderation queue: status tabs (همه / در انتظار / تأیید شده / رد شده), review cards (customer + phone + product link + stars + text + date), approve button + reject-with-reason modal (reason required)
- **Updated** `src/components/layout/admin/admin-sidebar.tsx` — «دیدگاه‌ها» nav entry (Star icon)
- **Created** `src/hooks/use-reviews.ts` (`useProductReviews`, `useMyReviews`, `useSubmitReview` — invalidates the `["reviews"]` prefix) + `src/hooks/use-admin-reviews.ts` (`useAdminReviews`, `useModerateReview`)
- **Updated** `src/types/index.ts` — `ReviewStatus`, `RatingSummary`, `ReviewItemSnapshot`, `Review`, `ReviewsResponse`, `AdminReview` (`Omit<Review, "customer"|"product">`), `MyReviewsResponse`, `Product.ratingSummary?`, `Product.brand?`

### Bugs found & fixed during verification
1. **Over-aggressive rate limit:** 5 reviews/15min blocked a legit customer reviewing several delivered products at once (and the test suite) → raised to **20/15min** (still real spam protection).
2. **Text truncation vs rejection:** over-1000-char text was silently truncated instead of rejected → now returns 400 (root cause of two test failures).
3. **TS errors:** `product.ratingSummary` on the `.lean()` union type needed a cast; `AdminReview extends Review` had an incompatible `product` property → `Omit`; `Product.brand` was missing from the type.
4. **Dead cache-invalidation key** (`reviewKeys.product`) → invalidate `reviewKeys.all` instead (code-review follow-up).
5. **Moderate route 404 vs 400** — nonexistent id now 404 (code-review follow-up).

### Verification
- **Created** `scripts/verify-reviews.js` — **20 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB): 401 unauth, supplier 403, paid-but-not-delivered 403, delivered order → 201 + pending + itemSnapshot, duplicate (same order-item) 409 + count stays 1, rating 0/6 → 400, empty/1001-char text → 400, HTML/script sanitized in DB, pending invisible publicly, admin approve → public + ratingSummary updated, approve-again 400 (atomic claim), reject-no-reason 400 / reject-with-reason → rejected + reason + not public, customer moderate 403, products `ratingSummary` (approved only), different product review works, **second delivered order for the same product → review again (per order-item)**, `/api/reviews/mine` eligible orders + my reviews
- **20/20 PASS**; `npx tsc --noEmit` zero errors; regressions green: payouts **17/17**, refund **12/12**, payment-retry **14/14**, variant-polish **14/14**, pagination **24/24**, variants **16/16**, upload-repro **15/15**
- **Ops note:** dev server restarted after the new Review model (stale Mongoose model would have failed on the new collection)

---

## Session 33 (August 2026) — Supplier Payout Approval System

### Wallet / Transaction Model
- **Extended** `src/models/Transaction.js` — payout request workflow fields: `status` enum `[pending, approved, rejected]` (default `pending`), `reviewedBy` (User ref), `reviewedAt`, `rejectionReason`
- **Extended** `src/models/Supplier.js` — `pendingReserve` (Number, default 0); invariant `pendingReserve <= balance`

### Reserve Semantics (supplier wallet)
- **Rewrote** `src/app/api/supplier/wallet/route.ts` POST — requesting a payout now **reserves** the amount instead of debiting it:
  - Atomic reserve claim `Supplier.findOneAndUpdate({ _id, $expr: { $lte: [{ $add: ["$pendingReserve", amount] }, "$balance"] } }, { $inc: { pendingReserve: amount } })` — race-safe, two concurrent requests can never over-reserve
  - Creates a `pending` payout Transaction (balance NOT debited); rolls back the reserve if Transaction creation fails
  - Bank-account validation before reserving
  - **Bug found & fixed (live):** the response double-counted `pendingReserve` (`{new:true}` already includes `amount`; old code added it again → 80000 instead of 40000). Fixed to return `claimed.pendingReserve` + `availableBalance = balance - reserve`.
- **Updated** GET — returns `availableBalance` (= balance − pendingReserve) and `pendingReserve`; `totalPaidOut` now counts only **approved** payouts (+ legacy docs with no status via `status: { $in: ["approved", null] }`)

### Admin Payout Queue
- **Created** `src/app/api/admin/payouts/route.ts`:
  - `GET ?status=` — list payout requests (newest first) with supplier + bank account + user populated
  - `POST` — `{ transactionId, action: "approve" | "reject", reason? }`:
    - **Atomic claim** `findOneAndUpdate({ _id, type: "payout", status: "pending" }, { $set: { status: ... } })` → a request is processed exactly once (concurrent approve/reject loser → 400)
    - **Approve:** claim → atomic `Supplier.findOneAndUpdate({ _id, pendingReserve: { $gte: amount } }, { $inc: { balance: -amount, pendingReserve: -amount } })` → rollback claim to pending (409) if reserve missing → record `balanceAfter`
    - **Reject:** claim → release reserve only (balance untouched) + `rejectionReason` (required, sanitized)

### Hooks / Types / UI
- **Created** `src/hooks/use-admin-payouts.ts` — `useAdminPayouts` (status filter) + `useReviewPayout`
- **Created** `src/app/admin/payouts/page.tsx` — admin queue: status filter tabs, request cards (supplier, user, bank account, amount, balance), approve button + reject-with-reason modal
- **Updated** admin sidebar — «تسویه فروشندگان» nav entry (Wallet icon)
- **Updated** `src/app/supplier/wallet/page.tsx` — «موجودی قابل برداشت» (availableBalance) + «در انتظار تأیید» (pendingReserve) cards; payout form caps at availableBalance; transaction history shows payout status badges (در انتظار تأیید / تأیید شده / رد شده) + rejection reason
- **Updated** `src/types/index.ts` — `PayoutStatus`, `WalletInfo` (+`availableBalance`/`pendingReserve`), `WalletTransaction.status`, `AdminPayout`; `src/hooks/use-supplier-wallet.ts` return type

### Verification
- **Created** `scripts/verify-payouts.js` — **17 tests against the real HTTP API** (two independent suppliers): request reserves (balance unchanged), over-available 400, **concurrent over-reservation prevented (atomic $expr)**, customer 403, unauth 401, supplier cannot approve 403, admin lists pending, approve → balance debited + reserve released + approved + reviewedAt, re-approve 400, **concurrent double-approve → exactly one 200 + one 400 (no double debit)**, reject-without-reason 400, reject → rejected + reason + balance untouched, wallet GET totals (approved-only paidOut + availableBalance)
- **17/17 PASS**; `npx tsc --noEmit` zero errors; regressions re-run green: refund **12/12**, payment-retry **14/14**, variant-polish **14/14**, pagination **24/24**, variants **16/16**, upload-repro **15/15**
- **Ops note:** dev server restarted after the Transaction/Supplier model changes (stale Mongoose model would strip the new fields)

---

## Session 32 (August 2026) — Admin Refund Flow

### Refund API
- **Created** `src/app/api/admin/orders/refund/route.ts` — `POST /api/admin/orders/refund`:
  - Admin-only via `requireRoleOrError(["admin"])` (401 unauth / 403 wrong role)
  - **Atomic claim:** `findOneAndUpdate({ _id, "payment.status": "paid" }, { $set: { "payment.status": "refunded", refund: {...} }, $push: statusHistory })` — only the first concurrent request can flip `paid → refunded`; a second caller gets null → 400 (or 404 if the order doesn't exist). A refunded order can never be refunded twice.
  - Stores refund metadata: `refund.reason` (sanitized), `refund.refundedAt`, `refund.refundedBy` (admin user id)
  - Pushes an immutable `refunded` event onto `statusHistory` (audit trail: reason in the note)
  - Reason required (trimmed, max 500 chars) → 400 if empty; reason sanitized via `sanitizePlainText()`

### Inventory Restoration
- **Stock restored exactly once via the shared `restoreOrderStock()`** — no duplicated inventory logic; the `stockRestored` atomic claim makes it idempotent, so a refund never increases stock twice (even if stock was already restored)
- Variant items restore through their `variantId`; simple products through top-level stock — both verified
- **Ordering note:** the claim (`paid → refunded`) runs BEFORE `restoreOrderStock()` — swapping the order would restore stock for orders whose claim then fails (e.g. a pending order would lose its reservation). The narrow crash window between claim and restore matches the documented retry/cleanup tradeoff (order refunded, stock still held, no inflation risk).

### Order Model & Types
- **Extended** `src/models/Order.js` — new `refund` subdocument `{ reason, refundedAt, refundedBy }`
- **Extended** `src/types/index.ts` — `AdminOrder.refund?`

### Admin UI
- **Refund button «بازپرداخت سفارش»** on the admin order detail Payment card — shown **only** when `payment.status === "paid"` (hidden for refunded/canceled/failed/pending)
- **Refund confirmation modal** — reason required (disabled confirm until non-empty) + error display; overlay closes on backdrop click unless pending
- **Refunded display** — refunded badge + refund date + refund reason on the Payment card
- **Payment status labels** — `paymentLabels` gained `canceled` (لغو شده) and `refunded` (بازپرداخت شده)
- **Timeline** — `statusConfig` widened to `OrderStatusV2 | "refunded"` + a `refunded` entry so the refunded history event renders «بازپرداخت شده» in Persian (with Undo2 icon) instead of raw English
- **Added** `useRefundOrder` mutation to `src/hooks/use-admin-orders.ts` (invalidates lists + detail)

### Verification
- **Created** `scripts/verify-refund.js` — **12 tests against the real HTTP API** (real NextAuth login for admin/customer/supplier, real routes, real MongoDB): 401 unauthenticated, customer 403, supplier 403, admin refunds paid order → 200 + `payment.status=refunded` + metadata, stock restored once (8→10), pending order 400, refunded order cannot refund twice 400 + stock stays 10, variant refund restores variant stock + summary (red 8→10, blue 5, summary 15), simple product refund (6→10), refund event in statusHistory with reason
- **12/12 PASS**; `npx tsc --noEmit` zero errors; regressions re-run green: payment-retry **14/14**, variant-polish **14/14**, pagination **24/24**, variants **16/16**, upload-repro **15/15**
- **Ops note:** dev server restarted after the Order-model change (stale Mongoose model would have stripped the new `refund` field in `findOneAndUpdate`)

---

## Session 31 (August 2026) — Variant Polish

### Variant-aware Order Display
- **Added** immutable `image` snapshot to `Order` + `SupplierOrder` item schemas (variant image, falling back to product image) — captured at checkout, never depends on live product state
- **Updated** `src/app/api/checkout/route.ts` — order + supplier-order items now snapshot `image`
- **Updated** admin order detail, supplier order detail, and storefront order detail pages — render product thumbnail (or placeholder) + existing variantLabel + SKU
- **Updated** `src/types/index.ts` — `AdminOrderItem`/`SupplierOrderItem` get `image?: string`
- Old orders (no variant snapshot / no image) still render correctly — verified

### Variant-aware Status Management (verified)
- Supplier orders route has **zero** stock logic — confirm/reject/ship/deliver only mutate `SupplierOrder.status` + timestamps, never inventory
- Admin orders route only touches stock on `cancelled` (via shared `restoreOrderStock()`)
- Suppliers only ever see their own `SupplierOrder.items` (per-supplier sub-documents)
- Inventory changes continue through the existing shared helpers only

### Supplier Variant Stock Quick Edit
- **Added** `setVariantStock(productId, variantId, newStock)` to `src/lib/inventory.ts` — **reuses the single inventory system** (same `$elemMatch` + `stockVersion` optimistic-lock pattern as `reserveStock`), atomically $set the variant stock, keeps top-level summary stock in sync via delta `$inc`, never negative, null on version mismatch
- **Created** `POST /api/supplier/products/stock` — supplier-only (`requireRoleOrError`), ownership enforced (`Product.findOne({ _id, supplier })`), variant-existence + negative/invalid-stock validation (400), 409 on concurrent modification
- **Added** `useUpdateSupplierVariantStock` hook + inline `VariantStockEditor` on the supplier products page (expandable «ویرایش سریع» per variant product) — no full product form needed

### Verification
- **Created** `scripts/verify-variant-polish.js` — **13 tests against the real HTTP API**: variant order snapshot (variantLabel + SKU + image), old-order compat, quick-edit own variant → 200 + summary synced (13→33), cross-supplier 404, invalid variant 400, negative stock 400, **concurrent quick-edits → exactly one 200 + one 409 (stockVersion)**, simple-product quick-edit rejected 400, simple-product checkout still works
- **14/14 PASS**; `npx tsc --noEmit` zero errors; regressions re-run green: payment-retry **14/14**, pagination **24/24**, variants **16/16**, upload-repro **15/15**

### Bugs found & fixed during Session 31
- **Fixture `_id` bug (test):** `[mongoose.Schema.Types.Mixed]` variants don't auto-generate `_id` → `String(v._id)` = `"undefined"` broke `isValidObjectId`. Fixed by setting explicit `_id` in fixtures.
- **JSX fragment bug (UI):** supplier products page returned two adjacent `<tr>` siblings without a fragment → compile error. Wrapped in `<Fragment key={product._id}>`.
- **Test expectation bug:** TEST 3 summary expected 35 but checkout (TEST 1) already decremented the summary → correct value 33.

---

## Session 30 (August 2026) — Payment Retry & Abandoned Payment Cleanup

### Payment Retry Flow
- **Created** `src/app/api/payment/retry/route.ts` — `POST /api/payment/retry`:
  - Auth via `requireAuth` + **ownership check** (retry only your own order → 404 otherwise)
  - Retryable only when `order.status = pending_payment` + `payment.method = zarinpal` + `payment.status ∈ {pending, failed, canceled}`; paid/refunded/completed → 400
  - **Stock semantics (critical):** `pending` + `stockRestored=false` (reservation still held) → issues a fresh Zarinpal authority **without touching stock**; `failed`/`canceled` + `stockRestored=true` (verify callback already restored stock) → **atomically re-reserves** every item via the shared `reserveStock()` before creating a new authority
  - **Concurrency + crash safety:** the `payment.status failed/canceled → pending` transition is the atomic claim that serializes concurrent retries of the *same* order (reserveStock's optimistic lock only guards other buyers) → second retry gets 409; `stockRestored` is flipped to `false` **only in the final atomic update** together with the new authority, so the invariant `stockRestored=false ⟺ stock reserved` holds at every point → a crash can never cause stock inflation; any failure rolls back re-reserved items and restores the previous `payment.status`
  - Insufficient stock → 409 (no authority created); gateway unreachable → 502

### Storefront UI
- **Updated** `src/app/(storefront)/orders/[id]/page.tsx` — `canRetryPayment()` gate + «پرداخت مجدد» button on the Payment card; hidden when paid/refunded; click → calls retry API → redirects to gateway
- **Updated** `src/types/index.ts` — `OrderPaymentStatus` includes `canceled`/`refunded` (already supported by the model)

### Abandoned Payment Cleanup
- **Created** `src/lib/payment-cleanup.ts` — `cleanupAbandonedPayments(maxAgeHours=24)` single source of truth:
  - Finds `pending_payment` orders with `updatedAt < now-24h` (**updatedAt**, not createdAt, so a freshly-retried order gets a new 24h window)
  - Atomically claims each (`status → cancelled`, `payment.status → canceled` + statusHistory note) so concurrent/duplicate runs never double-process
  - Restores stock via the shared `restoreOrderStock()` (idempotent `stockRestored` claim) — no duplicated inventory logic
- **Created** `src/app/api/payment/cleanup/route.ts` — `GET` trigger: **admin-only** via `requireRoleOrError` + optional `CRON_SECRET` (header or Bearer) for Vercel Cron-style automated runs; returns `{ cleaned }`

### Latent Zarinpal Bug Fixed (found during Session 30 verification)
- **Fixed** `src/lib/zarinpal.ts` — added `hasZarinpalErrors()`: Zarinpal v4 returns `errors: []` (an **empty array — truthy in JS**) on *success*, and a non-empty object on failure, so the old `if (result.errors)` check treated every success as failure (→ 502 „درگاه پرداخت موقتاً در دسترس نیست“). The helper distinguishes empty array vs non-empty object and is used by both `requestPayment` and `verifyPayment`. This was a latent bug affecting checkout and the verify callback too.

### Verification
- **Created** `scripts/verify-payment-retry.js` — **12 tests against the real HTTP API** (real NextAuth login, real routes, real MongoDB, real Zarinpal sandbox): 401 unauthenticated, retry-own-failed → 200 + new sandbox authority + stock re-reserved 10→8, new authority persisted (differs from old, `payment.status=pending`, `stockRestored=false`), cross-user 404, paid 400, cancelled 400, pending retry → stock unchanged 8 (no double reservation), abandoned >24h auto-cancelled + stock restored 7→10 exactly once, second cleanup run no-op
- **12/12 PASS**; `npx tsc --noEmit` **zero errors**; regressions re-run green: pagination **24/24**, variants **16/16**, upload-repro **15/15**
- **Ops note:** the long-running dev server developed stale network state (connect-timeout to `sandbox.zarinpal.com`) while fresh Node probes succeeded — fixed by **restarting the dev server** (no code change). If gateway calls start timing out after long sessions, restart the dev server.

---

## Session 29 Follow-up (August 2026) — Upload Bug Fix Verified LIVE

### Live verification (dev server :3000 + real DB + real Liara S3)
- **`scripts/verify-upload-repro.js` — 15/15 PASS** against the real HTTP API (real NextAuth login, real routes):
  - REPRO A (manual `Content-Type: multipart/form-data` without boundary) → **fails as expected** (500 parse error) — proves the old bug
  - REPRO B (fixed path, browser-generated boundary) → **201 + real S3 URL** — file received
  - 401/403 authz, type/size/empty validation, product create/edit with image, supplier upload
- **Created `scripts/verify-upload-formats.js` — 9/9 PASS** (complements the repro):
  - PNG / WEBP / JPG uploads → 201 + real Liara URL with correct mimeType
  - Multi-image product create (3 images), **MongoDB persistence** of all URLs in `product.images[]`
  - Edit: add 4th image, then remove one
  - Self-cleaning: deletes test S3 objects + File records (DELETE /api/upload + direct DB fallback)
- **Liara S3 public URL reachable:** direct GET on a stored object → **200**, content-type `image/png`, exact byte count (`PUBLIC_URL_OK`)
- **Browser (Chrome) UI check:** admin login OK → `/admin/products/new` renders → upload drop-zone opens native file chooser → no console errors. (Native file-dialog selection can't be automated by browser tooling; the file-select path is verified at the API level.)
- **Regression suites re-run green:** `npx tsc --noEmit` zero errors, `scripts/verify-pagination.js` **24/24**, `scripts/verify-variants.js` **16/16**

### Root cause recap (already fixed pre-shutdown)
1. `src/components/ui/file-upload.tsx` manually set `Content-Type: multipart/form-data` without `boundary` → server `req.formData()` couldn't parse → file never arrived. Fixed by removing the manual header.
2. `src/app/api/upload/route.ts` used `instanceof File`, which fails in Next.js route handlers → every well-formed upload rejected. Fixed with a duck-typed File check.

### Files changed this follow-up
- **Created** `scripts/verify-upload-formats.js` (verification only — no app code changed)
- `NEXT_SESSION.md` / `PROJECT_STATE.md` updated to record the verification

---

## Session 29 (August 2026) — Attributes & Product Variants

### Attributes
- **Created** `src/models/Attribute.js` — name, slug, type (text/color/size/number), values[], isActive
- **Created** `src/app/api/admin/attributes/route.ts` — admin CRUD (GET list, POST, PUT, DELETE) with duplicate name/slug validation
- **Created** `src/app/admin/attributes/page.tsx` — admin management UI (mirrors brand/tag patterns: search, inline form, delete confirmation)
- **Created** `src/hooks/use-admin-attributes.ts` + `src/hooks/use-attributes.ts` — admin CRUD hooks + shared active-attributes dropdown hook (suppliers can read active attributes)
- **Registered** Attribute model in `src/lib/dbConnect.js`; added sidebar nav entry

### Product Variants (Embedded)
- **Extended** `src/models/Product.js` — `hasVariants`, `variants[]` (sku, attributes[{attributeId,name,value}], price, supplierPrice, stock, stockVersion, images, isActive), per-variant `stockVersion`, **global sparse unique index on `variants.sku`**
- **Created** `src/lib/product-variants.ts` — `validateVariants()` (SKU uniqueness, duplicate combos, max 200, ≥1 active, price/stock/attribute validation incl. preset values), `prepareVariantsForSave()` (single-query attribute fetch + name denormalization + summary recompute), `recomputeVariantSummary()` (price = min active, stock = sum active)
- **Created** `src/lib/inventory.ts` — **single source of truth**: `reserveStock(productId, qty, variantId?)`, `restoreStock()`, `restoreOrderStock()` (stockRestored-idempotent), all variant-aware

### Validation & Types
- **Updated** `src/types/index.ts` — ProductVariant / ProductVariantAttribute / Attribute types
- **Updated** `src/lib/validations/product.ts` — `productVariantSchema`, `MAX_VARIANTS`; fixed `.omit()` on ZodEffects by restructuring into `productBaseSchema` + shared `refineVariants()`

### APIs
- **Updated** `src/app/api/admin/products/route.ts` + `src/app/api/supplier/products/route.ts` — POST/PUT/GET support `hasVariants`/`variants` via `prepareVariantsForSave` (summary price/stock recomputed server-side; pagination/search/filter/ownership preserved)

### Forms (Variant Builder)
- **Created** `src/components/admin/variant-builder.tsx` — reusable builder: enable/disable variants, select attributes + values, generate combinations, edit SKU/price/supplierPrice/stock, variant image upload, add/remove, duplicate SKU/combination detection
- **Integrated** into `src/components/admin/product-form.tsx` + `src/components/supplier/supplier-product-form.tsx` + new/edit pages (passes existing variants on edit)

### Storefront
- **Created** `src/components/storefront/variant-selector.tsx` — attribute-value selection, automatic variant resolution, unavailable-combination disabling, variant price/stock/images/SKU display
- **Updated** `src/app/(storefront)/products/[slug]/page.tsx` — variant selector with price/stock/images fallback to product

### Cart & Checkout
- **Updated** `src/stores/cart-store.ts` — cart items carry `variantId`/`sku`/`variantLabel`/variant price/image; dedupe key distinguishes product-only vs product+variant
- **Updated** `src/app/(storefront)/cart/page.tsx` + `checkout/page.tsx` — send `variantId`, display variant labels
- **Rewrote** `src/app/api/checkout/route.ts` — Phase 1 uses shared `reserveStock` with `variantId`; validates variant price + isActive; snapshot variant info into order items; **fixed rollback** via `restoreReserved()` so every reserved item restores with its correct variantId

### Payment & Orders
- **Updated** `src/app/api/payment/verify/route.ts` + `src/app/api/admin/orders/route.ts` — delegate to shared `restoreOrderStock()` (variant-aware, idempotent)
- **Updated** `src/models/Order.js` + `src/models/SupplierOrder.js` — immutable `variantId`/`sku`/`variantLabel` snapshots on items
- **Updated** storefront/admin/supplier order detail pages — render variant label + SKU from the snapshot

### Verification
- **Created** `scripts/verify-variants.js` — 16 tests against real MongoDB
- **16/16 tests passing** (simple + variant checkout, price override, wrong-price rejection, stock enforcement, concurrent last-unit, never-negative, restore-once idempotency, admin cancel, summary correctness, backward compatibility, pagination, search/sort)
- **Critical bug found & fixed:** MongoDB does not allow the positional `$` operator in a **query filter** — `"variants.$.stock"` never matches. Fixed with `$elemMatch` in the query + `$` in the update (identical optimistic-lock semantics)
- ✅ `npx tsc --noEmit` passes with zero errors

### Session 29 Follow-up — Production-Readiness E2E Verification (real HTTP API)
- **Created** `scripts/verify-variants-e2e.js` — **32 tests against the REAL running Next.js API** (real NextAuth CSRF + credentials login with cookie jar, real routes, real MongoDB): attribute/category CRUD via admin API, variant product create/edit, SKU uniqueness via admin create/update + supplier API (all 409) + MongoDB unique-index E11000, **concurrent variant checkout race** (stock=1, 2 parallel `/api/checkout` → exactly 1 succeeds, stock never negative), simple-product regression, payment cancel (NOK) + failed-payment restore-once, already-paid guard, admin cancel, pagination shape, 401/403 authz on real routes
- **32/32 E2E tests passing**
- **Bug found & fixed (browser-verified):** `src/app/(storefront)/products/[slug]/page.tsx` crashed with `Rendered more hooks than during the previous render` — `useCartStore` (and a dead `firstVariant` useMemo) were called **after** the `isLoading`/`isError`/`!product` early returns. Hoisted the hook above the returns, removed the dead `useMemo` + unused import
- Browser-verified: storefront variant selector renders, قرمز+M shows ۱۵۰٬۰۰۰, unavailable combos disabled
- ✅ `npx tsc --noEmit` zero errors; `scripts/verify-variants.js` 16/16; `scripts/verify-pagination.js` 24/24; ESLint 0 errors

### Storefront Variant Auto-Selection (UX polish)
- **Updated** `src/components/storefront/variant-selector.tsx` — `selection` now initializes lazily from the **first available variant** (first in-stock active variant, falling back to any active variant)
- Customers immediately see the resolved price/stock/images/SKU and an enabled add-to-cart button instead of the blank "انتخاب تنوع" state; toggle/deselect still works
- ✅ `npx tsc --noEmit` zero errors; ESLint clean

### File Upload Bug Fix ("فایلی ارسال نشده است")

**Root cause (two bugs):**
1. `src/components/ui/file-upload.tsx` manually set `Content-Type: multipart/form-data` on the axios POST — without a `boundary=...` parameter, the server's `req.formData()` cannot split the multipart body (server log: `missing boundary in content-type header`).
2. `src/app/api/upload/route.ts` checked `fileField instanceof File` — in Next.js route handlers the File class produced by the body parser is NOT the same class as the module's global `File`, so **every well-formed upload** was rejected with `فایلی ارسال نشده است`.

**Fixes:**
- `file-upload.tsx` — removed the manual Content-Type header (the browser now generates `multipart/form-data; boundary=...` from the FormData body); error handler now surfaces the real server error message.
- `api/upload/route.ts` — replaced `instanceof File` with a robust duck-typed File check (`arrayBuffer` function + `size` number).
- **Created** `scripts/verify-upload-repro.js` — 15-test E2E suite against the real API: repro A (manual header → fails 400/500) vs repro B (fixed path → 201 + real S3 URL), 401/403 authz, type/size/empty validation, product create/edit with images (add + remove), supplier upload.
- **15/15 passing**; `npx tsc --noEmit` zero errors; variants 16/16; pagination 24/24.

---

## Session 28 (July 2026) — Security Hardening

### Rate Limiting

- **Created** `src/lib/rate-limiter.ts` — MongoDB-backed TTL rate limiter with atomic `$inc` pattern
- **Updated** `src/lib/auth.js` — Added rate limiting in NextAuth `authorize` callback (5 attempts per 15 min per phone+IP combination)
- **Updated** `src/app/api/register/route.js` — Added IP-based rate limiting (10 attempts per 15 min)

### Authorization: 401 vs 403 Distinction

- **Created** `requireRoleOrError()` in `src/lib/auth-utils.ts` — returns `{ token, error }` where `error` is a NextResponse with 401 (unauthenticated) or 403 (authenticated but wrong role)
- **Updated all admin/supplier API routes** to use `requireRoleOrError` instead of the old `requireRole + if (!token) return unauthorized()` pattern
- **Affected routes:** brands, categories, tags, stats, suppliers, products, orders, users, upload, wallet, settings, profile

### Input Sanitization

- **Created** `src/lib/sanitize.ts` — Lightweight sanitizer that strips HTML tags, `javascript:` protocol, and `on*=` event handlers
- **Applied sanitization** to all user-controlled text fields: product descriptions (admin + supplier), user names, brand/category/tag names/descriptions, profile fields

### Bug Fixes

- **Fixed** `token!` TypeScript assertions in `src/app/api/supplier/settings/route.ts` (GET, PUT, POST handlers)
- **Added** `mongoose.isValidObjectId` guard in `/api/products` for malformed `?id=` values (returns 404 instead of 500)

### Project Build
- ✅ `npx tsc --noEmit` passes with zero errors
- ✅ All 24 pagination verification tests still pass

---

## Session 27 (July 2026) — API Pagination

### Implemented Features

- **Added** `src/lib/pagination.ts` — `parsePaginationParams()` (1-based page, default 20, max 100, safe coercion), `buildPaginatedResponse()`, `escapeRegex()`
- **Added** `src/components/ui/pagination.tsx` — `PaginationControls` UI component (RTL, Persian labels, ellipsis, first/middle/last pages)
- **Updated** `src/lib/constants.ts` — Default page size 20
- **Updated** `src/types/index.ts` — `PaginatedResponse<T>` with exact spec shape

#### Paginated APIs
- `/api/products` — public catalog with search, category filter, price range, sort
- `/api/orders` — customer orders with status filter + search
- `/api/admin/products` — admin product management with search resolving ObjectId refs
- `/api/admin/orders` — admin order management with search via User lookup + `$expr`

#### All pagination at DB level (countDocuments + find().skip().limit)

#### Updated Consumers
- Admin dashboard → consumes paginated responses
- Storefront products page → page reset on filter change, real pagination controls
- Customer orders page → paginated with status filter
- Admin products page → paginated
- Admin orders page → paginated

#### Verification
- **Created** `scripts/verify-pagination.js` — 24 tests against real MongoDB
- **24/24 tests passing** including page 1, middle, last, beyond-last, invalid values, search, filters, sort, single-product paths, admin ref resolution
- ✅ Zero TypeScript errors

---

### Root Cause

The checkout API used a vulnerable read-then-write pattern:
1. `Product.findById()` reads current stock
2. If stock is sufficient, creates Order + SupplierOrders
3. Then `Product.findByIdAndUpdate()` with `$inc: { stock: -quantity }`

Two concurrent requests could both pass the stock check in step 1 before either reaches step 3, causing stock to go negative.

### Solution: Optimistic Concurrency with stockVersion

#### Product Model (`src/models/Product.js`)
- **Added** `stockVersion` field (Number, default: 0) — optimistic lock token
- **Added** `pre("save")` hook — auto-increments stockVersion when stock changes via `.save()`
- **Added** `pre("findOneAndUpdate")` hook — auto-increments stockVersion when stock changes via `findByIdAndUpdate` (admin/supplier edits)
  - Bug found during verification: hook unconditionally added `$inc: { stockVersion: 1 }` even when update already explicitly managed stockVersion, causing Mongoose conflict error
  - Fix: added `versionAlreadyInc` and `versionAlreadySet` guard conditions

#### Order Model (`src/models/Order.js`)
- **Added** `stockRestored` field (Boolean, default: false) — guards against double stock restoration

#### Checkout API (`src/app/api/checkout/route.ts`)
- **Added** `reserveStock()` function — reads current stockVersion, then atomically reserves via `findOneAndUpdate` with `{ stock: { $gte: qty }, stockVersion: currentVersion }`
- **Added** `restoreReservedStock()` — rolls back a reservation
- **Restructured** POST into 3 phases:
  - **Phase 1**: Atomically reserve stock for ALL items BEFORE creating order
  - **Phase 2**: Build order items from reserved stock
  - **Phase 3**: Create Order + SupplierOrders
- **Full rollback** on any failure at any phase (stock restored, order deleted if needed)

#### Payment Verification (`src/app/api/payment/verify/route.ts`)
- **Atomic claim patterns** for all transitions:
  - Cancel: `findOneAndUpdate({ payment.status: { $nin: terminalStates } })`
  - Failed: `findOneAndUpdate({ payment.status: { $nin: allTerminal } })`
  - Success: `findOneAndUpdate({ payment.status: "pending" })`
- **Idempotent stock restoration**: Uses `stockRestored` flag with atomic `findOneAndUpdate({ stockRestored: false }, { $set: { stockRestored: true } })`

#### Admin Orders (`src/app/api/admin/orders/route.ts`)
- **Added** stock restoration when admin cancels an order, using same idempotent pattern

### Verification Test Script
- **Created** `scripts/verify-concurrency.js` — Self-contained MongoDB test script
- **10/10 tests passing:**
  1. stockVersion auto-increments on stock change ✅
  2. Atomic reservation succeeds when stock sufficient ✅
  3. Atomic reservation fails when stock insufficient ✅
  4. Concurrent checkout: stock=1, 10 req → exactly 1 success ✅
  5. Stock never negative: 20 req for stock=5 → no overselling ✅
  6. Rollback restores all reserved stock ✅
  7. stockRestored makes restoration idempotent ✅
  8. Duplicate payment verification prevented (5 concurrent → 1 wins) ✅
  9. Admin cancellation restores stock ✅
  10. Pre-findOneAndUpdate hook increments stockVersion on $set ✅

### Project Build
- ✅ `npx tsc --noEmit` passes with zero errors

---

## Session 21 (July 2026) — Runtime Warning Fixes & Route Cleanup

### Duplicate Route Cleanup
- **Deleted** `src/app/(storefront)/login/page.js` — Old plain-JS duplicate of the `.tsx` version
- **Deleted** `src/app/(storefront)/register/page.js` — Old plain-JS duplicate of the `.tsx` version
- **Root cause:** Leftover `.js` files from before the TypeScript migration

### React 19 `element.ref` Fix
- **Updated** `src/components/ui/slot.tsx` — Changed `(children as any).ref` to `(children.props as any).ref`
- **Root cause:** React 19 removed the top-level `element.ref` property

### NextAuth Environment Variables
- **Created** `.env.local` with required env vars

### Project Build
- 47 routes, zero TypeScript errors

---

## Sessions 19–20 (July 2026) — File Upload System, Product Images & Lightbox Gallery

### S3-Compatible File Upload System
- **Added** `src/lib/upload.ts` — Unified upload service with S3 client, file validation, multipart + URL-based upload, delete
- **Added** `src/app/api/upload/route.ts` — POST (multipart + JSON) + DELETE with auth (admin/supplier)
- **Added** `src/models/File.js` — Mongoose schema for uploaded file metadata
- **Added** `src/components/ui/file-upload.tsx` — Reusable drag-and-drop upload component with previews, progress, and remove
- **Added** Liara S3 env vars to validation

### Product Form Image Upload Integration
- **Updated** admin and supplier product forms with FileUpload for images
- **Updated** `src/lib/validations/product.ts` — Added images type to SupplierProductFormData

### Storefront Product Images & Lightbox
- **Added** `src/components/storefront/image-lightbox.tsx` — Full-screen lightbox with keyboard nav, scroll lock, zoom, thumbnail strip
- **Updated** product card, detail page, cart, checkout with image thumbnails

### Project Build
- 44 routes, zero TypeScript errors

---

## Sessions 14–18 (July 2026) — Customer Order History, Profile & Telegram Notifications

### Customer Order History Pages
- **Added** `src/app/api/orders/route.ts` — Customer orders API
- **Added** `src/hooks/use-customer-orders.ts` — React Query hooks
- **Added** order history list + detail pages with status filters, timeline

### Customer Profile Page
- **Added** `src/app/api/profile/route.ts` — GET/PUT profile
- **Added** `src/hooks/use-customer-profile.ts`
- **Added** profile page with editable name/address

### Telegram Notifications
- **Added** `src/lib/telegram.ts` — Telegram Bot API service
- **Added** supplier + admin notifications for new orders and status changes
- **Added** Telegram settings UI on supplier wallet page (connect/disconnect, test message)
- **Added** in-app Notification records with sentToTelegram flag
- **Added** `.env.example` with all required/optional env vars

### Project Build
- 44 routes, zero TypeScript errors

---

## Session 13 (July 2026) — Checkout Flow

### New: Order Placement API
- **Added** `src/app/api/checkout/route.ts` — POST endpoint (auth, validation, Order + SupplierOrder creation, stock decrement)

### New: Checkout Page
- **Added** `src/app/(storefront)/checkout/page.tsx` — Address form, payment method, order summary, success state

### Project Build
- 39 routes, zero TypeScript errors

---

## Session 12 (July 2026) — Shopping Cart

### New: Cart Store & Page
- **Added** `src/stores/cart-store.ts` — Zustand store with persist middleware
- **Added** `src/app/(storefront)/cart/page.tsx` — Items list, quantity controls, order summary
- **Wired** add-to-cart in product card and detail page

### Project Build
- 37 routes, zero TypeScript errors

---

## Session 11 (July 2026) — Customer Product Catalog

### New: Public API Routes & Pages
- **Added** `/api/products` (search, filter, sort), `/api/categories` (active only)
- **Added** storefront layout, product catalog, product detail, product card component
- **Added** public products + categories hooks

### Project Build
- 36 routes, zero TS errors

---

## Session 10 (July 2026) — Supplier Wallet

### New: Wallet API + Page
- **Added** `src/app/api/supplier/wallet/route.ts` — Balance, transactions, payout request
- **Added** `src/app/supplier/wallet/page.tsx` — Balance cards, payout form, transaction history

### Project Build
- 33 routes, zero TS errors

---

## Session 9 (July 2026) — Supplier Orders

### New: Supplier Orders API + Pages
- **Added** supplier orders API (list, detail, status transitions)
- **Added** orders list + detail pages with status filters, timeline, quick actions

### Project Build
- 32 routes, zero TS errors

---

## Session 8 (July 2026) — Supplier Panel Phase 1

### New: Supplier API & Pages
- **Added** supplier stats + products CRUD APIs (with ownership verification)
- **Added** supplier layout (green-themed), dashboard, products CRUD

### Project Build
- 31 routes, zero TS errors

---

## Session 7 (July 2026) — Accessibility Fix + Cleanup

### Fixes
- Input now consumes FormItemContext for correct label-input ID matching
- Deleted duplicate `src/models/auth.js`

### Project Build
- 23 routes, zero TS errors

---

## Session 6 (July 2026) — Order Status Management

### Added
- Admin order detail page with timeline, status change controls
- PUT handler with transition validation

### Project Build
- 23 routes, zero errors

---

## Session 5 (July 2026) — Product CRUD

### Added
- Product Zod validation schema
- POST/PUT/DELETE on admin products API
- ProductForm component, new/edit pages

### Project Build
- 23 routes, zero errors

---

## Session 4 (July 2026) — Real Data Integration

### Added
- React Query hooks for admin data
- Admin users API
- Real MongoDB aggregations for dashboard stats
- Loading/error/empty states

### Project Build
- 20 routes, zero errors

---

## Session 3 (July 2026) — shadcn/ui Migration + Admin Panel

### Added
- shadcn/ui components (custom Slot)
- Admin layout + all pages (dashboard, products, orders, users, settings)
- Admin API routes (stats, products, orders)

### Project Build
- 19 routes, zero errors
