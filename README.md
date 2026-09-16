# فروشگاه من — Online Store

A Persian (RTL) e-commerce platform: storefront, customer account area, supplier panel and
an admin back-office with accounting-grade reporting (FIFO COGS, P&L, profitability).

| | |
|---|---|
| Framework | Next.js **16** (App Router, Turbopack, React 19) |
| Language | TypeScript (strict) + JavaScript models |
| Database | MongoDB via Mongoose 8 — database name `marlooai` |
| Auth | NextAuth v4 (JWT) — phone + password / SMS OTP; roles `customer` / `supplier` / `admin` |
| Styling | Tailwind CSS 4, shadcn/ui |
| Tests | Vitest (unit) · Playwright (E2E) · `scripts/verify-*.js` (real-API suites) |

Architecture and history live in `ARCHITECTURE.md`, `RBAC.md`, `AUTHENTICATION.md`,
`PROJECT_STATE.md` and `CHANGELOG.md`.

---

## 1. Requirements

- **Node.js >= 20.9.0** (enforced via `engines`; Next.js 16's own floor). Node 22/24 recommended.
- **npm** (the lockfile is `package-lock.json` — use `npm ci`).
- A **MongoDB** deployment reachable from the app (the app connects to database `marlooai`).

## 2. Local setup

```bash
npm ci
cp .env.example .env.local      # then fill in every placeholder
node scripts/seed-admin.js      # idempotent — creates the first admin
npm run dev                     # http://localhost:3000
```

`scripts/seed-admin.js` is safe to re-run: it prints *"already exists. Skipping."* when the
account is present. Defaults (`ADMIN_SEED_PHONE` / `ADMIN_SEED_PASSWORD` / `ADMIN_SEED_NAME`)
are the documented dev credentials `09120000000` / `admin123456`.

> **Never put real credentials in `.env.example`.** That file is committed and is a
> placeholders-only template; real values belong in `.env.local` (gitignored) or, in
> production, in the hosting panel's environment settings.

## 3. Environment variables

Full annotated list: **`.env.example`**. The critical ones:

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | ✅ | Mongo connection string. The database name is forced to `marlooai` in `src/lib/dbConnect.js` — do not rely on it from the URI. |
| `NEXTAUTH_SECRET` | ✅ | JWT signing secret (`openssl rand -base64 32`). |
| `NEXTAUTH_URL` | ✅ | Absolute origin of the deployment. |
| `NEXT_PUBLIC_APP_URL` | ✅ in production | Public origin. **The build fails fast** if it is missing or not an absolute `http(s)` URL — canonical URLs, sitemap, OG/JSON-LD and the Zarinpal callback derive from it. |
| `ZARINPAL_MERCHANT_ID` | for payments | Online payment gateway merchant id. |
| `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_CHAT_ID` | optional | Admin/supplier notifications. |
| `LIARA_ENDPOINT` / `_BUCKET_NAME` / `_ACCESS_KEY` / `_SECRET_KEY` / `_REGION` | optional | S3-compatible object storage for images (uploads return a controlled 503 while unset). |
| `SMS_IR_API_KEY` + `SMS_IR_TEMPLATE_ID` | for real OTP | SMS provider for OTP login/registration. |
| `SMS_MOCK=1` | dev/CI only | Hermetic OTP seam — no sms.ir account needed. |
| `ZARINPAL_MOCK=1` | dev/CI only | Hermetic payment gateway for E2E. **Never in production.** |

## 4. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (Turbopack). |
| `npm run build` | Production build. **DB-independent** — needs no database. |
| `npm start` | Serve the production build (`next start`). Honors `PORT`. |
| `npm run check` | `tsc --noEmit` + ESLint over `src/lib tests/unit tests/e2e`. |
| `npm test` | Vitest unit suite (hermetic — no DB, no network). |
| `npm run e2e` | Playwright E2E (boots its own dev server; hermetic in CI). |
| `node scripts/run-regression.js` | The full sequential real-API regression (**50 suites**) against a running dev server + the real database. |

Regression prerequisites: a dev server on `:3000` started with `SMS_MOCK=1`
(`SMS_MOCK=1 npm run dev`) and a reachable database. `ZARINPAL_MOCK` must **not** be set —
several suites assert real-sandbox behaviour.

```bash
SMS_MOCK=1 npm run dev                       # terminal 1
node scripts/run-regression.js               # terminal 2
```

## 5. Production build & deployment

The runtime is a **plain Node server** — no platform manifest, no container:

```bash
npm ci && npm run build && npm start
```

`package.json` `start` is `next start`, which serves the build in `.next/` and reads `PORT`
(default `3000`).

### Chabokan (the deployment target in use)

Chabokan's cloud-hosting **"NextJs"** service is a managed app host: it runs the project's own
`npm install` → `npm run build` → `npm start` scripts and holds all configuration in its
service dashboard. There is therefore **no `vercel.json` / `Dockerfile` / platform manifest in
this repo** — adding one would be inventing infrastructure the platform does not read.

Deploy with the Chabokan CLI (`chabok deploy`), git, FTP or the file manager; then, in the
service dashboard:

1. **Environment variables** — add every variable from `.env.example` (real values).
2. **Node version** — 20.9 or newer (the panel offers 14–24; older versions cannot run Next 16).
3. **Port** — 3000 (the default the service expects), or update it here if changed via `PORT`.
4. **Health check / uptime monitor** — point it at `GET /api/health` (see below).

Before deploying, verify the whole production path locally (it builds, boots, serves and stays
secret-free):

```bash
npm run build && node scripts/verify-deployment.js
```

## 6. Health check

```
GET /api/health      # public, unauthenticated, never cached
```

```jsonc
// 200 — app + database ready
{ "status": "ok",       "db": "up",   "uptimeSeconds": 42, "latencyMs": 2,  "timestamp": "…" }
// 503 — database unreachable
{ "status": "degraded", "db": "down", "uptimeSeconds": 5,  "latencyMs": 4000, "timestamp": "…" }
```

The probe issues only the MongoDB `ping` command, is bounded to ~4 s (so a dead database
answers 503 instead of hanging), and deliberately exposes **no** connection string, host,
database name or credential. It returns a non-2xx status whenever readiness fails, so it can
gate a load balancer directly.

## 7. Verification

| Layer | Command | Notes |
|---|---|---|
| Types + lint | `npm run check` | 0 errors expected (4 pre-existing warnings). |
| Unit | `npm test` | Hermetic. |
| E2E | `npm run e2e` | Boots a dev server; `SMS_MOCK=1` + `ZARINPAL_MOCK=1` in CI. |
| Real-API regression | `node scripts/run-regression.js` | 50 suites, sequential, needs the dev server + DB. |
| Health endpoint | `node scripts/verify-health.js` | 9 probes against a running server (`HEALTH_BASE` overrides the origin). |
| Deployment | `node scripts/verify-deployment.js` | Build artifact + production boot + health + no-secret-log + no legacy DB target. |

## 8. Rollback / checkpoints

Every session lands as a focused commit, so the rollback unit is a commit:

```bash
git log --oneline -10          # find the last known-good commit
git revert <commit>            # preferred: keeps history auditable
# or, for a hard reset on a throwaway branch:
#   git reset --hard <commit>
```

Then rebuild and redeploy (`npm ci && npm run build && npm start`, or `chabok deploy`). The
old release keeps serving until the new build is promoted, so a bad deploy is recovered by
redeploying the previous commit.

Notes:

- **No database migrations.** Schema changes are additive in Mongoose and the project has no
  migration tool, so a code rollback needs no data rollback. Historic accounting rows are
  immutable snapshots on the order itself.
- **Never roll back FIFO/accounting data by hand** — `OrderItem.fifoUnitCost` and friends are
  the audit trail for COGS.

## 9. Known constraints

- **Google Fonts at build time.** `src/app/layout.tsx` uses `next/font/google` (Geist +
  Vazirmatn); the fonts are downloaded during `npm run build` and then self-hosted from
  `.next/static/media`. A build machine without outbound internet cannot complete the build.
  The runtime is unaffected.
- **Zarinpal sandbox flakiness.** `verify-payment-retry` exercises the real sandbox; it can
  fail on gateway timeouts/rate limits unrelated to this codebase. Re-run when the sandbox is
  responsive rather than treating it as a regression.
- **Category profitability is intentionally empty** — historical `OrderItem`s carry no
  immutable category snapshot, and back-filling one is a separate schema/migration session.
