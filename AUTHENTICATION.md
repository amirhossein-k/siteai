# Authentication System — فروشگاه من

## Overview

Authentication is handled by **NextAuth.js v4** with the **Credentials Provider** (phone + password). The system uses a **JWT strategy** — no session database is required.

### Flow

```
User → Login Page → signIn("credentials") → NextAuth authorize()
  → dbConnect() → User.findOne(phone) → bcrypt.compare(password)
  → JWT Token { id, name, phone, role }
  → Session callback adds role/id to session.user
  → UI reads session.user.role for role-based rendering
```

### Key Files

| File | Role |
|------|------|
| `src/lib/auth.js` | NextAuth configuration (providers, callbacks, pages) |
| `src/lib/auth-utils.ts` | **Centralized RBAC helpers** for API routes |
| `src/app/api/auth/[...nextauth]/route.js` | NextAuth API route handler |
| `src/types/next-auth.d.ts` | TypeScript augmentation for custom `role`/`id` fields |
| `src/middleware.js` | Route-level protection for `/admin/*` and `/supplier/*` |

---

## JWT Token Fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | User.\_id | MongoDB user ID |
| `name` | User.name | Display name |
| `phone` | User.phone | Phone number (login ID) |
| `role` | User.role | `customer` / `supplier` / `admin` |

---

## Session & Token Augmentation

The default NextAuth types are extended in `src/types/next-auth.d.ts`:

```typescript
// Session.user gets role + id
interface Session {
  user: {
    id: string;
    name: string;
    phone: string;
    role: "customer" | "supplier" | "admin";
  };
}

// JWT token gets role + id
interface JWT {
  id: string;
  role: "customer" | "supplier" | "admin";
}
```

---

## How Authorization Works

### Server-side (API Routes)

Every protected API route uses the centralized `requireRole()` or `requireAuth()` helpers from `src/lib/auth-utils.ts`:

```typescript
import { requireRole, unauthorized } from "@/lib/auth-utils";

// Require admin role
const token = await requireRole(req, ["admin"]);
if (!token) return unauthorized();

// Require admin OR supplier (for shared routes)
const token = await requireRole(req, ["admin", "supplier"]);
if (!token) return unauthorized();

// Require any authenticated user
const token = await requireAuth(req);
if (!token) return unauthorized();
```

These helpers call `getToken()` from `next-auth/jwt` behind the scenes. **Authorization always happens server-side** — never trust client-side role checks.

### Route-level (Middleware)

The `src/middleware.js` file protects entire route groups:

| Route | Required Role |
|-------|---------------|
| `/admin/*` | `admin` |
| `/supplier/*` | `supplier` |

Unauthenticated users are redirected to `/login`. Users with the wrong role are redirected to `/`.

### Client-side (UI)

UI components use `useSession()` from `next-auth/react` for conditional rendering:

```tsx
const { data: session } = useSession();

// Show admin link only to admins
{session?.user?.role === "admin" && <Link href="/admin">پنل مدیریت</Link>}
```

**Note:** Client-side role checks are for UX only. Every API call is verified server-side.

---

## Role-based Login Redirect

After a successful login, users are redirected based on their role:

| Role | Redirect |
|------|----------|
| `admin` | `/admin/dashboard` |
| `supplier` | `/supplier/dashboard` |
| `customer` | `/` |

This is implemented in `src/app/(storefront)/login/page.tsx` by fetching `/api/auth/session` after `signIn()` to get the role before redirecting.

---

## Password Security

- Passwords are hashed with **bcryptjs** (10 salt rounds)
- The `passwordHash` field is never returned to the client
- Admin can reset any user's password via the admin panel
- Users can only update their name and address, **not** their phone or role
