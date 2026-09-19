# Role-Based Access Control (RBAC) — فروشگاه من

## Architecture

The access control system has three layers:

```
┌─────────────────────────────────────────────┐
│ Layer 1: Proxy (src/proxy.js)                 │
│ Route-level protection for /admin and /supplier│
├─────────────────────────────────────────────┤
│ Layer 2: API Routes (requireRole helper)     │
│ Function-level authorization in every handler │
├─────────────────────────────────────────────┤
│ Layer 3: UI (useSession)                     │
│ Conditional rendering for role-aware UX       │
└─────────────────────────────────────────────┘
```

**All security-critical checks happen at Layers 1 and 2.** Layer 3 is for user experience only.

---

## Roles

| Role | Description | Access |
|------|-------------|--------|
| `customer` | End-user who browses products and places orders | Storefront, cart, checkout, order history, profile |
| `supplier` | Vendor who manages their own products | Supplier dashboard, own products, orders, wallet |
| `admin` | System administrator | Admin dashboard, all products/orders, user management |

---

## Permissions Matrix

| Action | customer | supplier | admin |
|--------|----------|----------|-------|
| Browse products | ✅ | ✅ | ✅ |
| Place orders | ✅ | ❌ | ❌ |
| View own orders | ✅ | ❌ | ❌ |
| Manage own products | ❌ | ✅ | ❌ |
| View own supplier orders | ❌ | ✅ | ❌ |
| Supplier wallet/payouts | ❌ | ✅ | ❌ |
| Telegram settings | ❌ | ✅ | ❌ |
| Admin dashboard | ❌ | ❌ | ✅ |
| Manage all products | ❌ | ❌ | ✅ |
| Manage all orders | ❌ | ❌ | ✅ |
| Manage users | ❌ | ❌ | ✅ |
| Manage business-SMS templates / manual send / delivery logs (Session 90) | ❌ | ❌ | ✅ |
| Upload files | ❌ | ✅ | ✅ |

---

## Centralized Authorization Utility

**File:** `src/lib/auth-utils.ts`

This utility provides reusable authorization helpers for all API routes. Every route should use these instead of duplicating `getToken()` + role checks.

### Available Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `getServerToken(req)` | Extract JWT from request | `ServerToken \| null` |
| `requireAuth(req)` | Require any authenticated user | `ServerToken \| null` |
| `requireRole(req, roles)` | Require specific role(s) | `ServerToken \| null` |
| `unauthorized()` | 401 response | `NextResponse` |
| `forbidden()` | 403 response | `NextResponse` |
| `serverError(error?)` | 500 response | `NextResponse` |
| `isAdmin(token)` | Check if admin | `boolean` |
| `isSupplier(token)` | Check if supplier | `boolean` |
| `isCustomer(token)` | Check if customer | `boolean` |

### Usage Examples

```typescript
// Admin-only route
const token = await requireRole(req, ["admin"]);
if (!token) return unauthorized();

// Admin or supplier route (categories, upload)
const token = await requireRole(req, ["admin", "supplier"]);
if (!token) return unauthorized();

// Any authenticated user (profile, orders, checkout)
const token = await requireAuth(req);
if (!token) return unauthorized();
```

---

## Proxy Protection

**File:** `src/proxy.js` (Next.js 16 renamed the `middleware` file convention to `proxy` — Session 89)

The proxy runs before route handlers and checks JWT validity + role:

```javascript
// /admin/* — requires admin role
if (isAdminRoute && token?.role !== "admin") {
  return NextResponse.redirect(new URL("/", req.url));
}

// /supplier/* — requires supplier role
if (isSupplierRoute && token?.role !== "supplier") {
  return NextResponse.redirect(new URL("/", req.url));
}
```

Unauthenticated users are redirected to `/login`.

---

## User Registration

- **Public registration** (`POST /api/register`) always creates users with `role: "customer"`
- The `role` field is hardcoded server-side — clients cannot pass it
- **Admin/supplier accounts** are only created by existing admins via `POST /api/admin/users`
- Seed script (`scripts/seed-admin.js`) creates the first admin account

---

## Admin User Management

The admin users page (`/admin/users`) provides:

| Action | API Endpoint | Description |
|--------|-------------|-------------|
| Create user | `POST /api/admin/users` | Create admin or supplier account |
| Toggle active | `PATCH /api/admin/users?id=X` | Activate/deactivate user |
| Change role | `PATCH /api/admin/users?id=X` | Change user's role |
| Reset password | `PATCH /api/admin/users?id=X` | Reset user's password |

All endpoints require `admin` role and use the centralized `requireRole` helper.

### Admin Business-SMS Management (Session 90 Phase 1)

A dedicated **`/admin/sms`** page (sidebar «پیامک‌ها») is the home for admin business-SMS management. **All surfaces are admin-only** and every API enforces `requireRoleOrError(req, ["admin"])` server-side (the admin page itself additionally sits behind the `/admin` proxy guard):

| Surface | API Endpoint | Admin-only capabilities |
|--------|-------------|--------------------------|
| Template management | `/api/admin/sms/templates` (GET/POST/PUT/DELETE) | CRUD for business-SMS templates (server-derived variables; duplicate name → 409) |
| Manual send | `/api/admin/sms/send` (POST) | Send a template-based or free-form business SMS (rate-limited 10/admin/15min) |
| Delivery logs | `/api/admin/sms/logs` (GET) | The audited per-attempt trail with status/type/recipient filters + pagination |

**Session 90 enforcement:**
- **No new role or permission semantics were introduced** — the three surfaces reuse the existing `requireRoleOrError` admin gate exactly like every other admin API. Customer and supplier tokens receive **403** on all of them (proven by `verify-sms.js` + the admin-sms E2E); anonymous requests receive **401**.
- The page `/admin/sms` is reached only through the existing `/admin/:path*` proxy guard (unauthenticated → `/login`; non-admin → `/`), so UI hiding is never the security boundary — the API checks are.
- Rate limiting uses **independent SMS-specific key namespaces** (`sms-send:`, `sms-template-write:`) — the existing OTP rate-limit keys and limits are untouched.

### Admin Supplier Management (Session 66)

A dedicated **`/admin/suppliers`** page (sidebar «فروشندگان») is the home for Supplier onboarding:

| Action | Mechanism |
|--------|-----------|
| Create Supplier | Reuses `POST /api/admin/users` (role=supplier) via the shared CreateUserModal — **no duplicate supplier-creation API** |
| Promote customer → supplier | Reuses `PATCH /api/admin/users?id=X` (action `change-role`, value `supplier`) |
| View status | `GET /api/admin/suppliers?all=true` — management shape (wallet figures + populated user) |
| Deactivate/reactivate | Reuses `PATCH /api/admin/users?id=X` (action `toggle-active`) |
| Settlement | Link to `/admin/payouts` |

**Session 66 enforcement:**
- **Deactivating a supplier** now also flips the linked `Supplier.isActive` (so the public storefront surfaces `/api/suppliers`, `/api/suppliers/[id]`, sitemap hide them) **and** bumps `tokenVersion` + evicts the cache → the supplier's existing sessions are revoked immediately.
- **Any role change** bumps `tokenVersion` + evicts the cache → the user's old-role sessions die instantly (they must log in again to pick up the new role claim).
- The default `GET /api/admin/suppliers` (no param) stays the active-only dropdown shape for product forms — unchanged.
- **No public Supplier registration / application queue** — supplier accounts are still created by admins only (out of scope by design).

### Public Supplier Application + Admin Approval Queue (Session 67)

Customers can now **apply** to become suppliers through a public flow — but the **role flip is still admin-only**:

| Actor | Can | Cannot |
|-------|-----|--------|
| Anonymous visitor | View the `/become-supplier` page (sign-in prompt) | Submit an application |
| Customer (authenticated) | Submit an application (`POST /api/supplier-applications`), view own status (`GET /api/supplier-applications/me`) | **Never assign roles or touch the Supplier collection** — the applicant stays `role: customer` until an admin approves |
| Supplier / Admin | — | Submit or decide applications (403 on the public submit route) |
| Admin | Approve/reject via `GET + PATCH /api/admin/supplier-applications` (queue tab on `/admin/suppliers`) | — |

**Security model (Session 67):**
- **Self-role-assignment is impossible by construction** — the public submit route only creates a `pending` `SupplierApplication` row (with a unique partial index preventing a second open application, E11000 → 409); it never writes `User.role` or `Supplier`.
- **Approve is atomic and admin-only** — a single `PATCH` provisions the Supplier doc (seeded **from the application**'s businessName/description via the shared `ensureSupplierForUser`), flips the role, **bumps `tokenVersion` + evicts the cache** (the applicant's old customer sessions are revoked immediately — they must re-login to obtain the supplier claim), records `decidedBy`/`decidedAt`, and notifies the applicant.

### Customer Communication / Order Support (Session 68)

Order-linked support conversations, split by **SupplierOrder** (one thread per customer × supplier-order — checkout already creates one SupplierOrder per supplier, so **cross-supplier leakage is structurally impossible**). All 11 endpoints enforce `requireRoleOrError` + server-side ownership with a **same-404 for not-found/not-owned** (a foreign conversation is indistinguishable from a missing one):

| Actor | Can | Cannot |
|-------|-----|--------|
| Anonymous | — | Any conversation access (401) |
| Customer (authenticated) | Create a conversation **for one of their OWN paid/refunded orders** (`POST /api/conversations` — order ownership validated via `Order.findOne({_id, customer: token.id})`; supplier derived from the SupplierOrder, never the body; duplicate active → 409); list own (`GET /api/conversations`), read eligible orders (`GET /api/conversations/eligible-orders`), read own detail (`GET /api/conversations/[id]` — marks `customerUnread=false`), send messages (`POST .../messages`), close/reopen/resolve own (`PATCH .../status`) | **Read/send/close another customer's conversation** (same 404), create for another customer's order (404), create for an unpaid order (400), impersonate a sender (sender identity always from the session) |
| Supplier | Access **only** conversations whose `supplier` ref equals their OWN Supplier doc (`Supplier.findOne({user: token.id})` — `GET /api/supplier/conversations`, detail marks `staffUnread=false`, reply `POST .../messages`) | Read/reply to **any other supplier's** conversation (same 404; the supplier list never contains foreign rows), change status (reply-only in v1 — transitions owned by customer + admin) |
| Admin | Full access: list all (`GET /api/admin/conversations` — status filters + subject/customer/order search), read any detail (marks `staffUnread=false`), reply, resolve/close/reopen (`PATCH .../status`) | — |

**Security model (Session 68):**
- **Sender identity is server-derived** — message `sender`/`senderRole` come from the authenticated session, never the request body.
- **Order ownership is server-validated** — `Order.findOne({ _id, customer: token.id })` + paid/refunded eligibility; a foreign order returns the same 404 as a missing one.
- **Supplier ownership is server-validated** — the conversation's `supplier` ref is written from the SupplierOrder at creation and every supplier route re-checks it against the caller's own Supplier doc.
- **Rate limited** — create 5/user/15min, message 15/actor/15min (validation before the limiter).
- **Notifications** reuse the `notifyOrderEvent` facade (`support` category, `support_message` type, per-message dedupe key, templated message with no content in payloads); customer messages notify the conversation's supplier.user only; staff messages notify the customer.
- **Reject leaves the role untouched** — a rejected customer may re-apply (no open-application dedup conflict).
- Rate limits: submit 2/user + 5/IP per 15min; decision 30/actor per 15min. All decision metadata (`adminNote`) is validated + capped.
- Zero changes to `auth.js` / OTP / password login / middleware / the Session 66 admin flows / Supplier ownership rules.

### Supplier Document Auto-Creation

When a user's role is set to `supplier` (either via **POST** create or **PATCH** change-role), the API **automatically creates** a corresponding `Supplier` document with default values:

| Supplier Field | Default Value |
|---------------|---------------|
| `businessName` | User's `name` |
| `contactPhone` | User's `phone` |
| `bankAccount` | Empty (`""`) |
| `telegramChatId` | Empty (`""`) |
| `balance` | `0` |
| `isActive` | `true` |

The `Supplier` document is linked to the `User` via the `supplier` field on the User model. If a Supplier document already exists for that user (e.g., from a previous role change), it is **reactivated** rather than duplicated.

Newly created suppliers can later configure their business details through the supplier settings page (`/supplier/wallet`).
