# Role-Based Access Control (RBAC) — فروشگاه من

## Architecture

The access control system has three layers:

```
┌─────────────────────────────────────────────┐
│ Layer 1: Middleware (src/middleware.js)       │
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

## Middleware Protection

**File:** `src/middleware.js`

The middleware runs before route handlers and checks JWT validity + role:

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
