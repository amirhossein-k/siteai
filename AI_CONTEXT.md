# AI Context - فروشگاه من (Online Store)

## 📋 Project Overview

A Persian (RTL) e-commerce platform built with Next.js 16 App Router. Supports three user roles: **customer**, **supplier**, and **admin**. Features phone-based authentication, product management, order processing, role-based dashboards, Telegram notifications, brand/tag management, S3 file uploads, Zarinpal payment, and atomic inventory concurrency protection.

**Project Root:** `D:\New folder\site`

---

## 🛠️ Technology Stack

| Category | Technology | Version | Notes |
|----------|-----------|---------|-------|
| **Framework** | Next.js | 16.2.12 | App Router, Turbopack, React 19 |
| **Language** | TypeScript | ^5 | Strict mode enabled |
| **Styling** | Tailwind CSS | v4 | CSS-first config, `@theme inline` |
| **UI Library** | shadcn/ui | v4 (new-york style) | Custom Slot (no @radix-ui/react-slot) |
| **Database** | MongoDB + Mongoose | ^8.9.0 | DB name: `marlooai` |
| **Auth** | NextAuth.js | ^4.24.10 | JWT strategy, Credentials Provider |
| **Forms** | react-hook-form + zod | latest | With @hookform/resolvers |
| **State (Client)** | Zustand | ^5 | Devtools + persist middleware |
| **State (Server)** | TanStack Query | ^5 | Stale: 1min, GC: 5min |
| **Icons** | Lucide React | ^1.27 | Tree-shakeable |
| **Toast** | Sonner | latest | Dark mode via MutationObserver |
| **Animations** | Framer Motion | ^12 | Available for use |
| **Font** | Geist + Vazirmatn | - | Google Fonts via next/font |
| **Formatters** | Prettier | ^3.9 | Custom config |
| **Linter** | ESLint | ^9 | Next.js config |
| **HTTP** | Axios | ^1.7 | Used in React Query hooks |
| **Storage** | S3-compatible (Liara) | - | File uploads |
| **Payment** | Zarinpal | v4 | Sandbox in dev, production in prod |

---

## 📐 Coding Conventions

### General
- **Language:** UI text in **Persian (Farsi)**, code/comments in English
- **Direction:** RTL (`dir="rtl"` on all page containers)
- **Naming:** camelCase for functions/vars, PascalCase for components, kebab-case for files
- **Imports:** Use `@/` alias (e.g., `@/components/ui/button`)
- **CSS:** Use Tailwind utility classes + shadcn CSS variables

### Component Patterns
- **"use client"** directive on interactive components
- **Server Components** as default (no directive needed)
- Use `React.forwardRef` for reusable UI components
- shadcn/ui components are customized copies in `src/components/ui/`
- Use `cn()` from `@/lib/utils` for class merging

### State Management
- **Server state:** TanStack Query (React Query)
- **Client state:** Zustand — UI state, theme, sidebar, cart
- **Form state:** react-hook-form with zod validation

### Database
- Models use `mongoose.models.ModelName || mongoose.model("ModelName", Schema)`
- Connection cached in `global.mongoose` (singleton pattern)
- Named export `{ dbConnect }` from `@/lib/dbConnect`
- DB name: `marlooai` (NOT `trackbot` as some old docs say)

---

## 🔐 Authentication & RBAC

### NextAuth v4 — JWT Strategy
- Credentials Provider: phone + password login
- JWT contains: `id`, `phone`, `role`, `name`
- Session strategy: JWT (no database sessions)
- API route auth: `requireAuth()` / `requireRole()` from `@/lib/auth-utils`
- Middleware: protects `/admin/*` (role=admin), `/supplier/*` (role=supplier)

### Roles
- **customer:** Browse products, manage cart, checkout, view orders, edit profile
- **supplier:** Dashboard, products (own), orders (own), wallet, Telegram settings
- **admin:** Dashboard, all products, all orders, all users, categories, brands, tags, settings

### Seed Credentials
- Admin: `09120000000` / `admin123456`
- Customer: `09121111111` / `test123456`

---

## 🗄️ Database Models (11 total)

| Model | Key Fields | Notes |
|-------|-----------|-------|
| **User** | name, phone, passwordHash, role (customer/supplier/admin), supplier (ref), address, isActive | |
| **Product** | name, slug, description, price, supplierPrice, stock, **stockVersion**, **brand** (ref), **tags[]** (refs), category (ref), supplier (ref), **images[]**, isActive | Optimistic concurrency via stockVersion |
| **Order** | customer (ref), items[], totalAmount, shippingAddress, **payment** (status/method/authority/refId/cardPan/paidAt), status, **stockRestored**, statusHistory[] | stockRestored prevents double restoration |
| **SupplierOrder** | order (ref), supplier (ref), items[], amountOwed, status (pending/confirmed/shipped/delivered/rejected), isPaidOut | Per-supplier sub-order |
| **Category** | name, slug, parent (self-ref), icon, image, description, sortOrder, isActive, metaTitle, metaDescription | Nested tree structure |
| **Brand** | name, slug, description, logo, website, isActive | Flat list |
| **Tag** | name, slug, isActive | Flat list, used for multi-tag on products |
| **Supplier** | user (ref), businessName, contactPhone, bankAccount, balance, telegramChatId, isActive | |
| **Notification** | recipient (ref), type (new_order/confirmed/shipped/delivered/rejected), message, relatedOrder (ref), isRead, sentToTelegram | |
| **Transaction** | supplier (ref), type (sale/payout/adjustment), amount, relatedOrder (ref), note, balanceAfter | Wallet ledger |
| **File** | url, key, name, size, mimeType, category (image/video/document), uploadedBy (ref), product (ref) | Uploaded file metadata |

---

## 🧠 Inventory Concurrency Protection

### Problem
Original checkout used read-then-write: `Product.findById()` → check stock → create order → `Product.findByIdAndUpdate($inc: -qty)`. Two concurrent requests could both pass the stock check before either decremented, causing overselling.

### Solution: Optimistic Concurrency with stockVersion

1. **`stockVersion`** field on Product (Number, default: 0) — incremented on every stock change
2. **`stockRestored`** field on Order (Boolean, default: false) — prevents double restoration
3. **Checkout:** Reads current `stockVersion` → atomically decrements via `findOneAndUpdate({ stock: { $gte: qty }, stockVersion })` → if null, another request modified stock → rollback + 409 Conflict
4. **Payment:** Atomic claim patterns (`findOneAndUpdate` with conditional filters) for all state transitions
5. **Restoration:** Only first caller to set `stockRestored=true` actually restores stock

### Verification: 10/10 tests passing
- Concurrent checkout for last item (stock=1, 10 req → exactly 1 success)
- Stock never negative under extreme concurrency
- Rollback restores all reserved stock on failure
- Duplicate payment verification prevented
- Admin cancellation restores stock idempotently

### Rules
- ALWAYS use `reserveStock()` for atomic stock reservation — never manual read-then-write
- ALWAYS use `stockRestored` atomic claim pattern — never direct `$inc` on stock for restoration

---

## 🧩 Project Structure

```
src/
├── app/
│   ├── (storefront)/     cart, checkout, login, orders/, products/, profile, register, layout
│   ├── admin/            dashboard, orders/, products/, users, settings, brands, categories, tags, layout
│   ├── supplier/         dashboard, orders/, products/, wallet, layout
│   ├── api/              auth/[...nextauth], register, checkout, orders, products, categories, profile
│   │   ├── admin/        stats, products, orders, users, categories, suppliers, brands, tags
│   │   ├── supplier/     stats, products, orders, wallet, settings
│   │   ├── payment/      verify
│   │   └── upload/       route.ts
│   ├── layout.tsx, page.tsx, globals.css, Providers.jsx
│   ├── error.tsx, not-found.tsx, sitemap.ts, robots.ts, manifest.ts
├── components/
│   ├── ui/           badge, button, card, form, input, label, skeleton, slot, sonner, toast, file-upload, loading, error-boundary
│   ├── layout/       admin/ (sidebar, header), supplier/ (sidebar, header)
│   ├── admin/        product-form
│   ├── supplier/     supplier-product-form
│   ├── storefront/   product-card, image-lightbox
│   ├── providers/    index, query-provider
│   └── seo/          json-ld-script
├── lib/
│   ├── auth.js, auth-utils.ts, dbConnect.js, utils.ts, constants.ts
│   ├── env.ts, upload.ts, telegram.ts, zarinpal.ts, seo.ts
│   ├── schemas/      json-ld.ts
│   └── validations/  auth.ts, product.ts
├── hooks/            All use-*.ts files for React Query
├── models/           All 11 Mongoose models
├── stores/           app-store, auth-store, cart-store, index
└── types/            index.ts
```

---

## 🚀 Current Status & Next Task

### Completed Features
- ✅ Authentication & RBAC (phone+password, 3 roles, middleware, RBAC utility)
- ✅ Admin panel (dashboard, products CRUD, orders management, users, settings)
- ✅ Supplier panel (dashboard, products, orders, wallet, Telegram settings)
- ✅ Customer features (catalog, cart, checkout, order history, profile)
- ✅ Categories (nested, SEO, tree UI, inline CRUD)
- ✅ Brands (model, CRUD, product integration)
- ✅ Tags (model, CRUD, chip-based multi-select)
- ✅ S3 file uploads (drag-and-drop, image gallery, lightbox)
- ✅ Zarinpal payment (sandbox, verification, callback, stock reversion)
- ✅ Telegram notifications (new orders, status changes, settings UI)
- ✅ Inventory concurrency protection (stockVersion, atomic reservation, rollback, idempotent restoration)
- ✅ Zero TypeScript errors (`npx tsc --noEmit`)

### Known Issues
1. **Product PUT response** — Missing brand/tags population in admin & supplier PUT handlers
2. **No pagination** — All list APIs fetch all records (performance problem at scale)
3. **Slot event handlers** — Custom Slot doesn't chain handlers like @radix-ui/react-slot
4. **No tests** — No unit or E2E tests
5. **Google Fonts build blocker** — `next build` fails when Google Fonts unreachable

### Next Task: API Pagination (Session 27)
Implement server-side pagination for:
- `/api/products` (public catalog)
- `/api/orders` (customer orders)
- `/api/admin/products`
- `/api/admin/orders`

All pagination at database level. Preserve existing search, sorting, and filtering.

---

## ✅ Environment

- `.env.local` — contains real credentials (MongoDB, NextAuth, Telegram, Zarinpal, S3/Liara)
- `.env.example` — template with placeholder values
- **NEVER** print, log, or expose `.env.local` values
- Build validation: `npx tsc --noEmit` (not `next build` — blocked by Google Fonts)

---

## 📚 Important Files

| File | Purpose |
|------|---------|
| `middleware.js` | Role-based route protection (admin/supplier) |
| `src/lib/auth.js` | NextAuth configuration |
| `src/lib/auth-utils.ts` | `requireAuth()`, `requireRole()`, `unauthorized()`, `forbidden()`, `serverError()` |
| `src/lib/dbConnect.js` | Mongoose singleton connection |
| `src/lib/upload.ts` | S3 upload service |
| `src/lib/telegram.ts` | Telegram Bot notification service |
| `src/lib/zarinpal.ts` | Zarinpal payment service |
| `src/lib/env.ts` | Environment variable validation |
| `PROJECT_STATE.md` | Full project state and architecture decisions |
| `NEXT_SESSION.md` | Quick handoff for next development session |
