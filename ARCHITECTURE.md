# Architecture Document - فروشگاه من (Online Store)

---

## 1. System Architecture Overview

The application follows **Next.js 16 App Router** conventions with a **monolithic** structure (frontend + API routes in the same project). Data is served from **MongoDB** via **Mongoose ODM**. Authentication is handled by **NextAuth.js v4** with JWT strategy.

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js 16 App
│  ┌─────────────────────────────────────────────────────────┐
│  │              Server Components                          │
│  │  Root layout, Admin layout, SEO, JSON-LD, sitemap       │
│  └─────────────────────────────────────────────────────────┘
│  ┌─────────────────────────────────────────────────────────┐
│  │              Client Components                          │
│  │  Storefront (catalog, cart, checkout, orders, profile)  │
│  │  Admin (dashboard, products, orders, users, settings)   │
│  │  Supplier (dashboard, products, orders, wallet)         │
│  │  Forms (react-hook-form), UI (shadcn), Hooks            │
│  │  State (Zustand + React Query), Toast (Sonner)          │
│  └─────────────────────────────────────────────────────────┘
│  ┌─────────────────────────────────────────────────────────┐
│  │              API Routes (REST)                          │
│  │  Customer: /api/products, /api/categories               │
│  │           /api/checkout, /api/orders, /api/profile      │
│  │  Auth:     /api/auth/*, /api/register                   │
│  │  Admin:    /api/admin/* (12+ routes)                    │
│  │  Supplier: /api/supplier/* (5 routes)                   │
│  └─────────────────────────────────────────────────────────┘
│  ┌─────────────────────────────────────────────────────────┐
│  │              Proxy + Telegram Service                   │
│  │  Role-based route protection (admin/supplier)           │
│  │  Fire-and-forget Telegram notifications to suppliers    │
│  └─────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │     MongoDB      │
              │   DB: trackbot   │
              │   8 collections  │
              └─────────────────┘
```

---

## 2. Auth Flow

```
User → Login Page → signIn("credentials") → NextAuth authorize()
  → dbConnect() → User.findOne(phone) → bcrypt.compare(password)
  → JWT Token { id, name, phone, role }
  → Session callback adds role/id to session.user
  → Proxy checks token.role for route access (/admin, /supplier)
```

### JWT Token Fields
| Field  | Source            | Description                  |
|--------|-------------------|------------------------------|
| `id`   | User._id          | MongoDB user ID              |
| `name` | User.name         | Display name                 |
| `phone`| User.phone        | Phone number (login ID)      |
| `role` | User.role         | customer / supplier / admin  |

---

## 3. Data Flow

```
Page → React Query Hook → API Route
  → getToken() verify auth → dbConnect() → Mongoose Model
  → Query/Mutation → JSON Response → Cache invalidation

Telegram (fire-and-forget):
  API Route → sendTelegramMessage(chatId, text)
  → fetch POST to api.telegram.org/bot{TOKEN}/sendMessage
  → Never awaited — errors logged but don't block response
```

---

## 4. API Routes

### Customer / Public API Routes (no auth required)
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/health` | GET | none | **Liveness / readiness probe (Session 89)** — public, unauthenticated, `force-dynamic` + `Cache-Control: no-store`, non-mutating (its only query is the Mongo `ping` command) and **bounded to 4 s** so a dead database answers instead of hanging. **200** `{status:"ok",db:"up",uptimeSeconds,latencyMs,timestamp}` when the app + database are ready; **503** `{status:"degraded",db:"down",…}` otherwise — never a false 200. The payload is a closed field set carrying no connection string, host, database name, credential or error detail. Safe to point a load balancer / uptime monitor at. Contract in `src/lib/health.ts` |
| `/api/products` | GET | none | Public catalog: search, category filter, price range, sort, slug lookup |
| `/api/categories` | GET | none | Active categories only |

### Customer API Routes (auth required)
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/checkout` | POST | any | Create Order + SupplierOrders, validate stock/price, decrement stock, send Telegram. **Session 82 Phase C — FIFO checkout integration:** purchased-sourcing products consume their FIFO cost layers atomically with the stock decrement (stockVersion + retry), snapshot `OrderItem.fifoUnitCost` (exact weighted FIFO cost — `supplierPrice` untouched, consignment/pre-cutover = null), and create **NO SupplierOrder** for purchased units (payout safety — consignment keeps the existing SupplierOrder/amountOwed flow); every purchased sale records an append-only `sale` InventoryMovement; rollbacks/refunds/cancels restore the exact consumed layers at the snapshot cost. **Phase C hardening (HIGH-1):** the SupplierOrder-creation-failure rollback restores the exact consumed layers too (`fifoUnitCost` → `restoreStock`, stock+layers always move together) and deletes any SOs already created for the rolled-back order |
| `/api/orders` | GET | any | List customer's orders (sorted newest) or single by `?id=` |
| `/api/profile` | GET, PUT | any | Read/update name, address (phone is read-only) |
| `/api/register` | POST | none | Create new user account (role=customer) |

### Admin API Routes
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/admin/stats` | GET | admin | Revenue, counts, growth from MongoDB aggregation |
| `/api/admin/suppliers` | GET | admin | Supplier list — default: active-only dropdown shape; `?all=true`: full management shape (wallet + populated user) for `/admin/suppliers` (Session 66) |
| `/api/admin/products` | GET, POST, PUT, DELETE | admin | Full CRUD. GET supports `?id=` for single fetch |
| `/api/admin/orders` | GET, PUT | admin | List + single. PUT validates status transitions + sends admin Telegram |
| `/api/admin/users` | GET | admin | List with optional `?role=` filter, excludes passwordHash |
| `/api/admin/users` | POST, PATCH | admin | Create admin/supplier (auto Supplier doc) · toggle-active / change-role / reset-password. **Session 66:** deactivation flips linked Supplier.isActive + bumps tokenVersion; role change bumps tokenVersion (sessions revoked immediately) |
| `/api/admin/categories` | GET | admin, supplier | Simple list for dropdowns |
| `/api/admin/suppliers` | GET | admin | Active suppliers list for dropdowns |
| `/api/admin/supplier-applications` | GET, PATCH | admin | Public supplier-application queue (Session 67). GET: pending-first with populated applicant. PATCH: **atomic approve/reject** — approve seeds the Supplier doc from the application (businessName/description), flips the applicant's role to supplier, bumps tokenVersion + evicts the cache (old customer sessions revoked), sets decidedBy/decidedAt, notifies the applicant; reject leaves the role untouched. Only `pending` decidable (400); malformed ObjectId → 400, unknown → 404 |
| `/api/admin/reports/[report]` | GET | admin | Accounting-ready reporting services (Session 81): `dashboard`, `sales`, `orders`, `payments`, `refunds`, `coupons`, `customer-sales`, `inventory`, `profit-loss` + **`purchases` (Session 82 Phase B)** + **`expenses` (Session 82 Phase E)** + **`profitability` (Session 87 foundation / Session 88 completion — executive KPIs with previous-period comparison, 8-step waterfall, product rows, expense analysis, rule-based diagnostics, financial-health indicators and day/week/month trend buckets via `?group=day|week|month`; COGS uses the same `fifoUnitCost` → historical `supplierPrice` snapshot rule as the other reports, never the current product price)**. Bounded `from`/`to` (invalid → 400), typed per-report filters, server-side pagination; sales/COGS/profit from immutable Order/OrderItem snapshots — **Phase C:** COGS = `fifoUnitCost` (purchased post-cutover, exact FIFO layer cost) else the `supplierPrice` snapshot (consignment/pre-cutover); inventory VALUE for post-cutover purchased products = Σ remaining × unitCost across FIFO cost layers, unlayered inventory keeps the current-cost approximation (current stock × current supplierPrice); coupon discounts allocated proportionally by line so Σ line net = Σ order totalAmount; **Phase E:** P&L operating expenses = Σ non-void expense amounts in the window and **Net Profit = Gross Profit − Operating Expenses** (expense report totals also exclude voided rows); unknown report → 404 |
| `/api/admin/reports/[report]/export` | GET | admin | Same filters → real multi-sheet `.xlsx` workbook (exceljs): Summary + report sheet (the generic summary sheet is **skipped for `purchases` and `profitability`**, which write their own self-contained sheets — profitability emits خلاصه سودآوری / آبشار سودآوری / سودآوری محصولات / تحلیل هزینه‌ها / روند; omitting the generic sheet is what fixed its former HTTP 500, since the profitability payload has no generic `summary` envelope), Persian names, styled headers + freeze panes + auto-filter + column widths + number/date/percent formats + totals; rate-limited `REPORT_EXPORT_LIMIT` 10/actor/15min; unsupported metrics labeled «در دسترس نیست» (no fake zeros) |
| `/api/admin/purchases` | GET, POST | admin | Procurement (Session 82 Phase B). GET: list with status/payment filters + pagination. POST: create a **draft** PurchaseOrder (only `sourcing: "purchased"` products — consignment purchase → 400; totals recomputed server-side from items; `PURCHASE_WRITE_LIMIT` 60/actor/15min). **Creating/paying never creates inventory** — only receiving does |
| `/api/admin/purchases/[id]` | GET, PATCH | admin | Purchase detail (incl. items with ordered/received/outstanding + receipts history) · PATCH: `action: order` (draft→ordered), update draft, `action: cancel` (draft/ordered only — never destroys already-received inventory/layers). Malformed ObjectId → 400 |
| `/api/admin/purchases/[id]/receive` | POST | admin | **The only inventory-creating operation:** partial receiving per item (qty ≥1 ≤ outstanding, over-receive → 409 with no partial state), creates exact FIFO cost layers (unit cost from the PurchaseItem, never current supplierPrice) + append-only `receipt` InventoryMovements + atomic stock increments via stockVersion; **idempotent via per-receipt client `key`** (same-key retry → already-applied, no double stock/layers; concurrent duplicate-key claim → retry) |
| `/api/admin/purchases/[id]/pay` | POST | admin | Record `amountPaid` + derive `paymentStatus` (unpaid/partial/paid). Financially separate from receiving — **never touches stock or cost layers** |
| `/api/admin/inventory/adjustments` | POST | admin | **The single audited path for stock changes outside the existing flows (Session 82 Phase D):** `applyInventoryAdjustment()` — product/variantId, signed quantity delta (never below 0), unitCost, **mandatory reason** + notes; single-document atomic stockVersion update; **exactly-once via the movement's unique `sourceRef` index + `completedAt` crash-recovery** (Phase C hardening — a pending claim from an interrupted run is COMPLETED on same-key retry, never falsely idempotent, never double-applied; layer effects recomputed on every apply attempt); positive → new FIFO layer at the CONFIRMED cost (never silently supplierPrice), negative → FIFO layers consumed oldest-first (fail-safe on insufficient layers, no partial mutation); malformed ids → 400, insufficient stock → 409; `INVENTORY_WRITE_LIMIT` 30/actor/15min |
| `/api/admin/inventory/movements` | GET | admin | Append-only ledger view — filters: product, variant, type, sourceRef, date range, search, pagination; enough for «چه چیزی / چه زمانی / چقدر / با چه بهایی / به چه دلیل / توسط چه کسی / منبع»; no customer PII |
| `/api/admin/inventory/layers` | GET | admin | Active FIFO cost layers — product, variant, remaining qty, unitCost, total layer value (remaining × unitCost), acquiredAt, source/ref; fully-consumed layers remain auditable via movements |
| `/api/admin/expenses` | GET, POST | admin | Expense ledger (Session 82 Phase E). GET: status/category/date-range/q filters + pagination. POST: create (10-category enum, description 2–500, integer amount ≥ 0, expenseDate, paymentMethod, reference/payee/notes; default status `pending`); validation BEFORE the `EXPENSE_WRITE_LIMIT` 60/actor/15min limiter |
| `/api/admin/expenses/[id]` | GET, PATCH | admin | Expense detail (voided rows stay visible for audit) · PATCH: edit while NOT void — voided → 400 (corrections are NEW rows). Malformed → 400, unknown → 404 |
| `/api/admin/expenses/[id]/pay` | POST | admin | pending → paid (**idempotent**); voided → 400 (financial history immutable) |
| `/api/admin/expenses/[id]/void` | POST | admin | **AUDITED VOID** — voidReason REQUIRED (2–500, before the limiter), stamps voidedAt/voidedBy/voidReason, row NEVER deleted; paid/pending → void, already-voided → idempotent 200; voids are final |
| `/api/admin/sms/templates` | GET, POST, PUT, DELETE | admin | Business-SMS template CRUD (Session 90 Phase 1b): list (newest first), create (duplicate name → 409; client-declared `variables` ignored — always re-derived server-side from the body placeholders), partial update (body edits re-derive variables; unknown → 404, malformed → 400), delete (SmsLog rows keep their `templateName` snapshot). Write verbs rate-limited `SMS_TEMPLATE_WRITE_LIMIT` 30/admin/15min (independent `sms-template-write:` namespace — OTP limiter keys untouched) |
| `/api/admin/sms/send` | POST | admin | Manual business-SMS send (Session 90 Phase 1b) through `src/lib/sms-business.ts` — **never `sendOtp()`**: exactly one of `templateId`/`message`; recipient normalized server-side (`^09\d{9}$`); template state loaded from the DB (a request body can never inject a provider pattern id); **inactive template → 400 refusal (no SMS, no log row)**; fail-closed missing/extra variable validation; sender identity always the authenticated session token; every attempt (sent OR failed) persisted to `SmsLog`; controlled error codes only (no provider internals/secrets). `SMS_SEND_LIMIT` 10/admin/15min |
| `/api/admin/sms/logs` | GET | admin | Paginated business-SMS audit trail (Session 90 Phase 1b): `status` (sent/failed), `messageType`, `templateId` filters + escaped recipient search; per-attempt rows carry the rendered message, `templateName` snapshot, provider, error codes and the admin actor |

### Public Supplier Application Routes (Session 67)
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/supplier-applications` | POST | customer | Submit a supplier application. Rate-limited (2/user + 5/IP per 15min), validates businessName/description/contactPhone, pending-dedup 409 (unique partial index), notifies all admins. **Never touches role or the Supplier collection** — the applicant stays `role: customer` until an admin approves |
| `/api/supplier-applications/me` | GET | customer | The applicant's latest application + status (drives the `/become-supplier` page state) |
| `/api/conversations` | POST, GET | customer | Create an order-linked support conversation for one of the customer's OWN paid/refunded orders (Session 68) — order ownership via `Order.findOne({_id, customer})`, supplier derived from the SupplierOrder (never the body), paid-only eligibility, rate-limited 5/user/15min, one active conversation per SupplierOrder (unique partial index → E11000 → 409). List own (status filter, paginated) |
| `/api/conversations/eligible-orders` | GET | customer | Own paid orders with their supplier-orders grouped (drives the create-form pickers) |
| `/api/conversations/[id]` | GET | customer | Own conversation detail — same 404 for not-found/not-owned; marks `customerUnread=false` |
| `/api/conversations/[id]/messages` | POST | customer | Send a message (15/actor/15min); sender identity from the session; `closed` → 400, `resolved` auto-reopens to `open`; notifies the conversation's supplier.user (templated, no content in payloads) |
| `/api/conversations/[id]/status` | PATCH | customer | Close/resolve/reopen own conversation (state machine `open|pending|resolved|closed`, unit-tested transitions) |
| `/api/admin/conversations` | GET | admin | All conversations — status filter + subject/customer/order `search` |
| `/api/admin/conversations/[id]` | GET | admin | Any conversation detail; marks `staffUnread=false` |
| `/api/admin/conversations/[id]/messages` | POST | admin | Reply to any conversation; flips status to `pending`, notifies the customer |
| `/api/admin/conversations/[id]/status` | PATCH | admin | Resolve/close/reopen any conversation |
| `/api/supplier/conversations` | GET | supplier | ONLY the caller's own supplier's conversations (via `Supplier.findOne({user})`) |
| `/api/supplier/conversations/[id]` | GET | supplier | Own conversation detail — same 404 for any other supplier's thread; marks `staffUnread=false` |
| `/api/supplier/conversations/[id]/messages` | POST | supplier | Reply to own conversations (reply-only in v1; no status control) |

### Supplier API Routes
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/supplier/stats` | GET | supplier | Products count, orders, balance, earnings (filtered by supplier) |
| `/api/supplier/products` | GET, POST, PUT, DELETE | supplier | CRUD for own products. Ownership verified via `supplier` field |
| `/api/supplier/orders` | GET, PUT | supplier | List + detail + status transitions. Sends Telegram + in-app notifications |
| `/api/supplier/wallet` | GET, POST | supplier | Balance info, payout requests, transaction history |
| `/api/supplier/settings` | GET, PUT, POST | supplier | Telegram chat ID (GET/PUT) and test message (POST) |

---

## 5. Telegram Notification Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Checkout   │────→│  sendNewOrder    │────→│  Supplier (DB)  │
│  (Order     │     │  Notification()  │     │  telegramChatId │
│   created)  │     └──────────────────┘     └─────────────────┘
│             │     ┌──────────────────┐     ┌─────────────────┐
│             │────→│  sendAdminNew    │────→│  .env           │
│             │     │  OrderNotif()    │     │  ADMIN_TELEGRAM │
└─────────────┘     └──────────────────┘     └─────────────────┘

┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Supplier   │────→│  sendOrderStatus │────→│  Supplier (DB)  │
│  Orders PUT │     │  Notification()  │     │  telegramChatId │
│  (status    │     └──────────────────┘     └─────────────────┘
│   changed)  │     ┌──────────────────┐     ┌─────────────────┐
│             │────→│  sendAdminOrder  │────→│  .env           │
│             │     │  StatusNotif()   │     │  ADMIN_TELEGRAM │
└─────────────┘     └──────────────────┘     └─────────────────┘

┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Admin      │────→│  sendAdminOrder  │────→│  .env           │
│  Orders PUT │     │  StatusNotif()   │     │  ADMIN_TELEGRAM │
│  (status    │     └──────────────────┘     └─────────────────┘
│   changed)  │
└─────────────┘
```

### Key Design Decisions
- **Fire-and-forget:** All Telegram calls are not awaited — the main request never blocks on Telegram
- **Graceful no-op:** If `TELEGRAM_BOT_TOKEN` or chat IDs are not configured, notifications silently skip
- **In-app records:** `Notification` model records are created alongside Telegram messages with `sentToTelegram` flag
- **Admin vs Supplier:** Admin chat ID from env var (single admin), supplier chat IDs from Supplier model (per-supplier)

---

## 6. State Management

| Need | Solution |
|------|----------|
| API data (products, orders, users) | React Query (`useQuery`, `useMutation`) |
| UI state (sidebar, modals) | Zustand app-store |
| Theme preference | Zustand persist middleware |
| Cart (persisted) | Zustand persist middleware (localStorage) |
| Auth session | next-auth `useSession()` |
| Form state | react-hook-form (local) |

### React Query Defaults
- `staleTime`: 60,000ms (1 minute)
- `gcTime`: 300,000ms (5 minutes)
- Auto-refresh: 30s on dashboard stats and wallet

---

## 7. Database Schema

### Collections (22 total — core subset below; full catalog + key fields in PROJECT_STATE.md)
| Collection | Key Fields | Notes |
|------------|-----------|-------|
| **User** | name, phone, passwordHash (optional — OTP), role, supplier, address, isActive, **tokenVersion** | role: customer/supplier/admin |
| **Product** | name, slug, description, price, supplierPrice, stock, category, supplier, images[], isActive | supplierPrice = wholesale cost |
| **Order** | customer, items[], totalAmount, shippingAddress, payment, status, statusHistory[] | items = snapshots at purchase time |
| **SupplierOrder** | order ref, supplier ref, items[], amountOwed, status, isPaidOut, timestamps | Per-supplier sub-orders — created ONLY for consignment-sourcing lines (Phase C); purchased-sourcing lines pay the supplier via purchases instead |
| **CustomerConversation** | customer (ref), order (ref), supplierOrder (ref), supplier (ref), product (optional), category, subject, status (open/pending/resolved/closed), customerUnread, staffUnread, lastMessage*, messages[], resolvedAt, closedAt | Order-linked support (Session 68); one active conversation per supplier-order (unique partial index) |
| **PurchaseOrder** | number (P-YYYYMMDD-NNN), supplier (ref), purchaseDate, reference, notes, status (draft/ordered/partially_received/received/cancelled), subtotal, discount, additionalCosts, total, paymentStatus (unpaid/partial/paid), amountPaid, items[] (product ref, variantId, quantity, receivedQuantity, unitCost, lineTotal), receipts[] (idempotency key, itemId, quantity, receivedAt, receivedBy), createdBy, cancelledAt/By/Reason | Procurement (Session 82 Phase B). **Only receiving creates stock + FIFO cost layers + receipt movements**; partial + idempotent receiving; consignment products rejected |
| **InventoryMovement** | product (ref), variantId, type (opening_balance/receipt/sale/return_restock/cancellation_restock/purchase_return/adjustment/sourcing_change — the last is RESERVED, no code path emits it, excluded from UI filters), quantity (signed), unitCost, totalCost, sourceRef, sourceType, description, createdBy, createdAt, **completedAt** (Phase C hardening — stamped with the final costs ONLY after an adjustment's atomic apply succeeds; `null` = pending claim that a same-key retry COMPLETES, never falsely idempotent) | Append-only immutable audit ledger (Session 82 Phase C/D); unique partial index `{sourceRef} where $gt: ""` — the original `$ne` form never built (MongoDB limitation), fixed + rebuilt unique; `Product.stock` stays the fast cache, this is the historical source of truth |
| **Expense** | category (10-enum), description 2–500, amount (int ≥ 0), expenseDate, paymentMethod, reference/payee/notes, status (paid/pending/void), createdBy, updatedBy, voidedAt/voidedBy/voidReason | Operating-expense ledger (Session 82 Phase E). **Audited void** (reason required, never deleted, voids final); P&L operating expenses = Σ non-void in window; Net Profit = Gross Profit − Operating Expenses |
| **Category** | name, slug, isActive | Simple categorization |
| **Supplier** | user ref, businessName, contactPhone, bankAccount, balance, **telegramChatId**, isActive | telegramChatId for notifications |
| **Notification** | recipient, type[], message, relatedOrder, isRead, **sentToTelegram** | In-app + Telegram tracking |
| **Transaction** | supplier ref, type[], amount, relatedOrder, note, balanceAfter | Wallet ledger |
| **SmsTemplate** | name (unique), type (order_confirmation/shipping_update/tracking_code/delivery_followup/custom), providerTemplateId (optional, digits-only — stored in MongoDB, not env vars), variables (server-derived from body placeholders), body (≤500, `{{variable}}`), isActive, createdBy/updatedBy | Admin business-SMS templates (Session 90 Phase 1a); unique name index + `{type, isActive}` |
| **SmsLog** | recipient (canonical 09…), user/order/template (optional refs), templateName snapshot (survives template deletion), messageType, provider (mock/smsir/none), providerMessageId, status (sent/failed — written AFTER the provider returns), error info, message (rendered audit copy), sentAt, createdBy | Business-SMS audit trail (Session 90 Phase 1a); query indexes; **intentionally NO TTL and NO dedupe key** |

### SMS Architecture Note (Session 90)
`src/lib/sms-business.ts` is **intentionally a separate module from `src/lib/sms.ts`** to isolate business SMS from the OTP flow: it never imports `sendOtp`, has its own provider resolver, **never reads the OTP-specific `SMS_IR_TEMPLATE_ID`**, and stores per-template SMS.ir pattern ids in the `SmsTemplate.providerTemplateId` field instead. The business provider is **production-disabled by default** — real sending requires the explicit `SMS_BUSINESS_ENABLED=1` kill-switch (plus the existing `SMS_IR_API_KEY`); without it every send returns a controlled `SMS_BUSINESS_DISABLED` error, so deploying the feature cannot accidentally message real users. |

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

### Payment Status Flow
```
pending → paid (via gateway)
pending → failed (on cancel)
```

---

## 8. Project Routes (45 total)

### Storefront
- `/` — Homepage with hero, features, CTA, footer
- `/login`, `/register` — Auth pages
- `/products` — Product catalog with search & filters
- `/products/[slug]` — Product detail
- `/cart` — Shopping cart
- `/checkout` — Checkout flow
- `/orders` — Customer order history
- `/orders/[id]` — Order detail
- `/profile` — User profile editor

### Admin Panel
- `/admin` — Redirect to dashboard
- `/admin/dashboard` — Stats dashboard
- `/admin/products` — Product list
- `/admin/products/new` — Create product
- `/admin/products/[id]/edit` — Edit product
- `/admin/orders` — Orders list
- `/admin/orders/[id]` — Order detail
- `/admin/users` — User management
- `/admin/suppliers` — Supplier management (create / promote / deactivate / status / payouts link) — Session 66
- `/admin/sms` — Business-SMS management: templates / delivery logs / manual send («پیامک‌ها») — Session 90
- `/admin/settings` — Settings (placeholder)

### Supplier Panel
- `/supplier` — Redirect to dashboard
- `/supplier/dashboard` — Stats dashboard
- `/supplier/products` — Product list
- `/supplier/products/new` — Create product
- `/supplier/products/[id]/edit` — Edit product
- `/supplier/orders` — Orders list
- `/supplier/orders/[id]` — Order detail
- `/supplier/wallet` — Wallet, payouts, Telegram settings

### API (17 routes)
- `/api/auth/[...nextauth]`
- `/api/register`
- `/api/checkout`
- `/api/orders`
- `/api/profile`
- `/api/products`
- `/api/categories`
- `/api/admin/*` (12 routes — incl. Session 68 `/api/admin/conversations*` × 4 and Session 81 `/api/admin/reports*` × 2)
- `/api/supplier/*` (8 routes — incl. Session 68 `/api/supplier/conversations*` × 3)
- `/api/conversations*` (6 customer routes, Session 68)

### Other
- `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`
- `/_not-found`

---

## 9. Important Architecture Decisions

### Input + FormItemContext (Session 7)
Input consumes `FormItemContext` directly via `React.useContext()` to derive its `id` attribute, matching `FormLabel`'s `htmlFor`. Fixes label-click accessibility. Fallback: explicit `id` prop > context > no id.

### Custom Slot (Session 3)
Replaces `@radix-ui/react-slot` (package unavailable). Merges `className` and `style`. Keeps parent props over child for conflicts. Known limitation: only keeps parent's event handlers when both parent and child have the same handler.

### Supplier Product Ownership (Session 8)
API routes verify ownership via `Product.findOne({ _id, supplierId })` — prevents suppliers from accessing/modifying each other's products.

### Supplier Product Form Schema (Session 8)
Uses `productSchema.omit({ supplier: true })` — supplier is auto-set server-side from JWT.

### Telegram Notifications (Session 15-18)
- **Fire-and-forget:** Notifications never block the request/response cycle
- **Env-based admin:** Single admin's chat ID from `ADMIN_TELEGRAM_CHAT_ID` env var
- **DB-based suppliers:** Each supplier's `telegramChatId` stored in Supplier model
- **Test endpoint:** POST `/api/supplier/settings` sends test message to validate bot connection
- **In-app + Telegram:** Both `Notification` model records and Telegram messages created

### Payment Integration (Not Yet Implemented)
The checkout supports two payment methods: `manual` (cash on delivery) and `zarinpal` (placeholder). Zarinpal integration requires handling payment callbacks at a dedicated endpoint.
