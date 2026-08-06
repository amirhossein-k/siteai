# Authentication System — فروشگاه من

## Overview

Authentication is handled by **NextAuth.js v4** with the **Credentials Provider**. Two sign-in methods exist (Session 62): the original **phone + password** flow and an additive **SMS one-time-password (OTP)** flow. The system uses a **JWT strategy** — no session database is required.

### Password Flow

```
User → Login Page → signIn("credentials", { phone, password }) → NextAuth authorize()
  → dbConnect() → User.findOne(phone) → bcrypt.compare(password)
  → JWT Token { id, name, phone, role, tokenVersion }
  → Session callback adds role/id/phone/tokenVersion to session.user
  → UI reads session.user.role for role-based rendering
```

### OTP Flow (Session 62 — additive; password flow unchanged)

```
Login/Register page (OTP tab)
  → POST /api/auth/otp/request   { phone, purpose: login|register }
      → rate limits (per-phone 5/15min, per-IP 15/15min) + 60s resend cooldown
      → 6-digit code → SHA-256 stored on an OtpCode row → SMS adapter sends it
  → POST /api/auth/otp/verify    { phone, code, purpose, name? (register) }
      → wrong code: attempts++ (lock after 5); correct code:
      → login:  must exist · register: creates a passwordless customer
      → consumes the CODE and attaches a one-time loginTokenHash
      → returns { loginToken }  (256-bit random, hashed in DB)
  → signIn("credentials", { phone, loginToken })
      → authorize() OTP branch: atomic single-use claim of the loginToken
      → same JWT/session pipeline as password login
```

### Key Files

| File | Role |
|------|------|
| `src/lib/auth.js` | NextAuth configuration (providers, callbacks, pages) — password + OTP `loginToken` branches |
| `src/lib/auth-utils.ts` | **Centralized RBAC helpers** for API routes |
| `src/app/api/auth/[...nextauth]/route.js` | NextAuth API route handler |
| `src/app/api/auth/otp/{request,verify,dev-last}/route.js` | OTP request / verify / dev-only code-reader endpoints |
| `src/lib/otp.ts` | OTP crypto + constants (generation, SHA-256 hashing, normalization, TTLs) |
| `src/lib/sms.ts` | **Adapter-first SMS abstraction** — mock (dev/CI) · sms.ir (production, opt-in) · none (controlled 503) |
| `src/models/OtpCode.js` | OTP rows (codeHash, attempts, codeConsumedAt, loginTokenHash, TTL index) |
| `src/models/User.js` | `passwordHash` now optional (OTP accounts); additive `tokenVersion` |
| `src/types/next-auth.d.ts` | TypeScript augmentation for custom `role`/`id`/`phone`/`tokenVersion` fields |
| `src/middleware.js` | Route-level protection for `/admin/*` and `/supplier/*` |

---

## JWT Token Fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | User.\_id | MongoDB user ID |
| `name` | User.name | Display name |
| `phone` | User.phone | Phone number (login ID) |
| `role` | User.role | `customer` / `supplier` / `admin` |
| `tokenVersion` | User.tokenVersion | Session-revocation foundation (Session 62) — bumping it invalidates old JWTs (enforcement is a future step) |

---

## Session & Token Augmentation

The default NextAuth types are extended in `src/types/next-auth.d.ts`:

```typescript
// Session.user gets role + id + phone + tokenVersion
interface Session {
  user: {
    id: string;
    name: string;
    phone: string;
    role: "customer" | "supplier" | "admin";
    tokenVersion?: number;
  };
}

// JWT token gets role + id + phone + tokenVersion
interface JWT {
  id: string;
  phone: string;
  role: "customer" | "supplier" | "admin";
  tokenVersion?: number;
}
```

> **Note (Session 62):** `session.user.phone` was declared in the types but never populated at runtime — the session callback now copies `token.phone` so the contract is real. This is additive; the password path is untouched.

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

## SMS/OTP Login & Registration (Session 62)

### Model

- **`OtpCode`** (new collection `otpcodes`) — `phone`, `purpose` (`login`/`register`), SHA-256 `codeHash` (the plaintext is **never** stored in production), `attempts`, `codeConsumedAt` (the CODE is single-use), `consumedAt` (the one-time LOGIN TOKEN is single-use — separate so verify and exchange are each single-use), `loginTokenHash` + `loginTokenExpiresAt` (TTL-aligned with the row so a token can never outlive it), `devPlaintextCode` (**mock-only**), `expiresAt` with a TTL index (2-minute lifetime, auto-cleanup).

### SMS provider — adapter-first, opt-in

- `src/lib/sms.ts` resolves the provider at call time: **mock** (`NODE_ENV=development` AND `SMS_MOCK=1` — the code is logged + stored as `devPlaintextCode`, read back via `GET /api/auth/otp/dev-last` for E2E/verify suites), **sms.ir** (production; active ONLY when BOTH `SMS_IR_API_KEY` and `SMS_IR_TEMPLATE_ID` are configured — `POST https://api.sms.ir/v1/send/verify`, `x-api-key` header, `{ mobile, templateId, parameters: [{ name: "Code", value }] }`), or **none** (no mock + no credentials → controlled `SMS_NOT_CONFIGURED` → the request API returns 503 — local development never breaks on a missing sms.ir account).

### Security properties

- **Codes:** `crypto.randomInt` 6 digits; SHA-256 hashed at rest; 2-minute TTL; 60s resend cooldown; locked after 5 wrong attempts (`codeConsumedAt`).
- **Rate limits:** `otp_request:<phone>` 5/15min · `otp_request_ip:<ip>` 15/15min (SMS-bombing guard) · `otp_verify:<phone>` 5/15min (brute force) · the credentials exchange rides the existing `login:<phone>` 10/15min + `login_ip:<ip>` 30/15min limits.
- **Login tokens:** 256-bit random; SHA-256 hashed; exchanged through NextAuth's existing credentials endpoint where `authorize()` claims the row **atomically** (`updateOne({ _id, consumedAt: null })`) — a replayed token can never mint a second session (replay-proof).
- **Anti-enumeration:** for the `login` purpose an UNKNOWN phone receives the same `200 { sent: true }` as an existing one, and **no code is created or sent** — account existence is never revealed; verify then fails uniformly. **Accepted trade-off:** the 60s resend cooldown can only fire for existing phones (no row exists for unknown ones), so rapid re-requests expose existence via a 200-vs-429 difference — the register purpose already reveals the same fact through its standard `409`, so no new oracle is added.
- **Passwordless accounts:** OTP-registered customers have `passwordHash: null` and can only sign in via OTP (an admin can later reset a password). Existing password accounts can ALSO use OTP login (backward compatible).
- **`tokenVersion`** is stored on the User and embedded in the JWT at sign-in — the foundation for future "logout all devices" (no revocation UI/flow in this session; enforcement is future work).

### UI

- Login page: «ورود با رمز عبور» (default) / «ورود با کد یک‌بارمصرف» toggle. Register page: «ثبت‌نام با رمز عبور» (default) / «ثبت‌نام با کد یک‌بارمصرف» toggle (OTP registration asks for a name — the account is created at verify). Both reuse the shared `OtpPanel` + `OtpCodeInput` components. The password forms are untouched and remain the default.

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
- The `passwordHash` field is never returned to the client; OTP-only accounts store `null`
- Admin can reset any user's password via the admin panel
- Users can only update their name and address, **not** their phone or role

---

## Development / CI notes (Session 62)

- The E2E journey + `verify-otp` suite require the dev server started with **`SMS_MOCK=1`** (same convention as `ZARINPAL_MOCK`); `playwright.config.ts` sets it in the CI webServer env automatically.
- `GET /api/auth/otp/dev-last` returns the latest unconsumed code ONLY when the mock seam is active; everywhere else it 404s (and no plaintext exists).
