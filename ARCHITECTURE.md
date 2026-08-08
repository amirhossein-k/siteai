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
│  │  Admin:    /api/admin/* (6 routes)                      │
│  │  Supplier: /api/supplier/* (5 routes)                   │
│  └─────────────────────────────────────────────────────────┘
│  ┌─────────────────────────────────────────────────────────┐
│  │              Middleware + Telegram Service               │
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
  → Middleware checks token.role for route access (/admin, /supplier)
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
| `/api/products` | GET | none | Public catalog: search, category filter, price range, sort, slug lookup |
| `/api/categories` | GET | none | Active categories only |

### Customer API Routes (auth required)
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/checkout` | POST | any | Create Order + SupplierOrders, validate stock/price, decrement stock, send Telegram |
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

### Public Supplier Application Routes (Session 67)
| Route | Methods | Auth | Description |
|-------|---------|------|-------------|
| `/api/supplier-applications` | POST | customer | Submit a supplier application. Rate-limited (2/user + 5/IP per 15min), validates businessName/description/contactPhone, pending-dedup 409 (unique partial index), notifies all admins. **Never touches role or the Supplier collection** — the applicant stays `role: customer` until an admin approves |
| `/api/supplier-applications/me` | GET | customer | The applicant's latest application + status (drives the `/become-supplier` page state) |

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

### Collections (8 total)
| Collection | Key Fields | Notes |
|------------|-----------|-------|
| **User** | name, phone, passwordHash, role, supplier, address, isActive | role: customer/supplier/admin |
| **Product** | name, slug, description, price, supplierPrice, stock, category, supplier, images[], isActive | supplierPrice = wholesale cost |
| **Order** | customer, items[], totalAmount, shippingAddress, payment, status, statusHistory[] | items = snapshots at purchase time |
| **SupplierOrder** | order ref, supplier ref, items[], amountOwed, status, isPaidOut, timestamps | Per-supplier sub-orders |
| **Category** | name, slug, isActive | Simple categorization |
| **Supplier** | user ref, businessName, contactPhone, bankAccount, balance, **telegramChatId**, isActive | telegramChatId for notifications |
| **Notification** | recipient, type[], message, relatedOrder, isRead, **sentToTelegram** | In-app + Telegram tracking |
| **Transaction** | supplier ref, type[], amount, relatedOrder, note, balanceAfter | Wallet ledger |

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

## 8. Project Routes (44 total)

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
- `/api/admin/*` (6 routes)
- `/api/supplier/*` (5 routes)

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
