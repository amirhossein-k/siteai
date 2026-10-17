/**
 * Phase 1 — route-level + persistence tests for GET /api/admin/sms/status
 * (review follow-up: the route was previously untested).
 *
 * Seams (mirroring tests/unit/checkout-gateway-rollback.test.ts):
 *   - @/lib/auth-utils.requireRoleOrError → mocked, but returning the REAL
 *     contract shapes (401/403 NextResponse envelopes from src/lib/auth-utils)
 *     so the route's own branch behavior is what is exercised.
 *   - @/lib/sms-ir-admin.getSmsIrHealth → the provider seam. Mocked here means
 *     "the provider was/was not consulted" — never a real network call, hence
 *     no real SMS.ir access and no SMS send is possible in these tests.
 *     Everything ELSE from that module (resolveSmsIrConfig, taxonomy, FA
 *     messages) stays REAL — in particular the route's config payload is
 *     derived from the real resolveSmsIrConfig(process.env).
 *   - @/models/SmsProviderState → Mongoose seam; update/filter/options args
 *     are asserted (first-probe upsert, same-doc updates, error clearing,
 *     lastSyncOk) without a real Mongo connection.
 *
 * Deterministic: vi.mock only, injected values, no timers, no credentials
 * (the env key used below is a fake test value set/restored per test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { SmsIrHealth } from "@/lib/sms-ir-admin";

const FAKE_KEY = "phase1-test-key-987654321"; // not a real credential
const FAKE_KEY_HINT = "****4321"; // maskKeyTail(FAKE_KEY)
const ADMIN_ID = "a".repeat(24);
const AT = "2026-01-01T00:00:00.000Z";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  requireRoleOrError: vi.fn(),
  rateLimit: vi.fn(),
  smsStatusLimit: { max: 20, windowMs: 15 * 60 * 1000 },
  health: vi.fn(),
  stateFindOneAndUpdate: vi.fn(),
  stateCreate: vi.fn(),
}));

vi.mock("@/lib/dbConnect", () => ({ dbConnect: mocks.dbConnect }));

vi.mock("@/lib/auth-utils", async () => ({
  requireRoleOrError: mocks.requireRoleOrError,
  serverError: async () => {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });
  },
}));

vi.mock("@/lib/rate-limiter", () => ({
  rateLimit: mocks.rateLimit,
  SMS_STATUS_LIMIT: mocks.smsStatusLimit,
}));

// Only getSmsIrHealth is mocked (the provider seam); the rest of the module —
// including resolveSmsIrConfig used by the route's response builder — is REAL.
vi.mock("@/lib/sms-ir-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-ir-admin")>();
  return { ...actual, getSmsIrHealth: mocks.health };
});

vi.mock("@/models/SmsProviderState", () => ({
  default: {
    findOneAndUpdate: mocks.stateFindOneAndUpdate,
    create: mocks.stateCreate,
  },
}));

import { GET } from "@/app/api/admin/sms/status/route";

// ============================================================
// Fixtures
// ============================================================

/** Real-contract shapes returned by src/lib/auth-utils. */
function adminToken() {
  return { id: ADMIN_ID, name: "مدیر تست", phone: "09120000000", role: "admin" as const };
}

function unauthorizedShape() {
  return {
    token: null,
    error: NextResponse.json(
      { error: "لطفاً ابتدا وارد حساب خود شوید" },
      { status: 401 }
    ),
  };
}

function forbiddenShape() {
  return {
    token: null,
    error: NextResponse.json(
      { error: "شما دسترسی به این بخش را ندارید" },
      { status: 403 }
    ),
  };
}

function authorizedShape() {
  return { token: adminToken(), error: null };
}

const RATE_HEADERS = {
  "X-RateLimit-Limit": "20",
  "X-RateLimit-Remaining": "0",
  "X-RateLimit-Reset": "1700000000",
};

function okHealth(): SmsIrHealth {
  return {
    ok: true,
    envConfigured: true,
    otpTemplateConfigured: false,
    businessSwitch: false,
    senderLineConfigured: false,
    senderLine: null,
    credit: { state: "ok", checkedAt: AT, credit: 165.3 },
    lines: { state: "ok", checkedAt: AT, lines: ["30004505000017"] },
    senderMismatch: { detected: false },
    checkedAt: AT,
  };
}

function failedHealth(): SmsIrHealth {
  return {
    ok: false,
    envConfigured: true,
    otpTemplateConfigured: false,
    businessSwitch: false,
    senderLineConfigured: false,
    senderLine: null,
    credit: {
      state: "failed",
      messageFa: "خطای احراز هویت سرویس‌دهنده — کلید API نامعتبر یا غیرفعال است",
      errorKind: "auth_failed",
      checkedAt: AT,
      credit: null,
    },
    lines: {
      state: "failed",
      messageFa: "خطای احراز هویت سرویس‌دهنده — کلید API نامعتبر یا غیرفعال است",
      errorKind: "auth_failed",
      checkedAt: AT,
      lines: null,
    },
    senderMismatch: { detected: false },
    checkedAt: AT,
  };
}

/** A prior SINGLE persisted state document (with a stale error on it). */
const PRIOR_STATE_DOC = {
  credit: { value: 99, syncedAt: new Date(AT) },
  lines: { lineNumbers: ["10002155613464"], syncedAt: new Date(AT) },
  lastError: {
    kind: "insufficient_credit",
    messageFa: "موجودی حساب SMS.ir کافی نیست",
    at: new Date(AT),
  },
  lastSyncAt: new Date(AT),
  lastSyncOk: true,
};

/** Fresh chainable .lean() response mirroring the real model call chain. */
function stateFindOneAndUpdateResolves(doc: unknown) {
  mocks.stateFindOneAndUpdate.mockReturnValue({
    lean: vi.fn().mockResolvedValue(doc),
  });
}

/** Drive GET with the minimal NextRequest the route actually uses. */
function callRoute(): Promise<Response> {
  const req = {} as unknown as Parameters<typeof GET>[0];
  return GET(req) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbConnect.mockResolvedValue(undefined);
  mocks.requireRoleOrError.mockResolvedValue(authorizedShape());
  mocks.rateLimit.mockResolvedValue({ limited: false, remaining: 19, resetInMs: 900_000, headers: {} });
  mocks.health.mockResolvedValue(okHealth());
  stateFindOneAndUpdateResolves(PRIOR_STATE_DOC);
  // The route reads process.env through the REAL resolveSmsIrConfig — seed a
  // fake key so config flags are live (restored in afterEach).
  process.env.SMS_IR_API_KEY = FAKE_KEY;
});

afterEach(() => {
  delete process.env.SMS_IR_API_KEY;
});

// ============================================================
// RBAC — server-side guard precedes everything else
// ============================================================

describe("GET /api/admin/sms/status — RBAC", () => {
  it("returns 401 for an unauthenticated request and never probes the provider", async () => {
    mocks.requireRoleOrError.mockResolvedValue(unauthorizedShape());

    const res = await callRoute();

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("لطفاً ابتدا وارد حساب خود شوید");

    // Auth fails → nothing downstream runs (provider, DB, persistence).
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.dbConnect).not.toHaveBeenCalled();
    expect(mocks.stateFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.stateCreate).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-admin and never probes the provider", async () => {
    mocks.requireRoleOrError.mockResolvedValue(forbiddenShape());

    const res = await callRoute();

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("شما دسترسی به این بخش را ندارید");

    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.dbConnect).not.toHaveBeenCalled();
    expect(mocks.stateFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 429 with the limiter headers when the admin rate limit is exceeded (probe skipped)", async () => {
    mocks.rateLimit.mockResolvedValue({
      limited: true,
      remaining: 0,
      resetInMs: 1000,
      headers: RATE_HEADERS,
    });

    const res = await callRoute();

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("بیش از حد مجاز");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("20");

    // Keyed per-admin actor, with the real SMS_STATUS_LIMIT config object.
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.rateLimit).toHaveBeenCalledWith(`sms-status:${ADMIN_ID}`, mocks.smsStatusLimit);

    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.dbConnect).not.toHaveBeenCalled();
    expect(mocks.stateFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ============================================================
// Secrets — the response surface must never carry the key landscape
// ============================================================

describe("GET /api/admin/sms/status — no secrets in a successful response", () => {
  it("exposes config booleans and the sender line only — never the key, its hint, or provider internals", async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);

    const raw = JSON.stringify(await res.json());

    // The real API-key env value never appears (resolveSmsIrConfig runs on the
    // REAL env — a regression that spreads cfg or includes the hint fails here).
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain(FAKE_KEY_HINT);
    expect(raw).not.toContain("apiKeyHint");

    // No raw provider internals channel exists on the payload at all.
    expect(raw.includes('"providerMessage"')).toBe(false);
    expect(raw.includes('"httpStatus"')).toBe(false);
    expect(raw.includes('"providerStatus"')).toBe(false);
    expect(raw).not.toContain("****");

    // The sanitized booleans DO flow through the real config reader.
    const body = JSON.parse(raw) as {
      config: { apiKeyConfigured: boolean; senderLineConfigured: boolean; senderLine: string | null };
      credit: { probeState: string };
      ok: boolean;
    };
    expect(body.config.apiKeyConfigured).toBe(true);
    expect(body.config.senderLineConfigured).toBe(false);
    expect(body.config.senderLine).toBeNull();
    expect(body.credit.probeState).toBe("ok");
    expect(body.ok).toBe(true);
  });
});

// ============================================================
// SmsProviderState persistence — single-doc upsert invariant
// ============================================================

describe("GET /api/admin/sms/status — SmsProviderState persistence", () => {
  it("a SUCCESSFUL probe upserts the single smsir document with lastSyncOk=true and clears the prior error", async () => {
    stateFindOneAndUpdateResolves(PRIOR_STATE_DOC); // prior doc carries a stale lastError

    const res = await callRoute();
    expect(res.status).toBe(200);

    expect(mocks.stateFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mocks.stateFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
      { new: boolean; upsert: boolean },
    ];

    // Fixed single-doc target, created (not inserted arbitrarily) on first run.
    expect(filter).toEqual({ _id: "smsir" });
    expect(options.upsert).toBe(true);
    expect(options.new).toBe(true);
    expect(update.$setOnInsert._id).toBe("smsir");

    // lastSyncOk persisted from the probe's own verdict (never fabricated).
    expect(update.$set.lastSyncOk).toBe(true);
    expect(update.$set.lastSyncAt).toBeInstanceOf(Date);
    expect(update.$set.updatedBy).toBe(ADMIN_ID);

    // Successful probe lends provider-confirmed values to the record...
    expect(update.$set["credit.value"]).toBe(165.3);
    expect(update.$set["credit.syncedAt"]).toBeInstanceOf(Date);
    expect(update.$set["lines.lineNumbers"]).toEqual(["30004505000017"]);

    // ...and REPLACES the previous error state (stale lastError cleared).
    expect(update.$set.lastError).toBeNull();

    expect(mocks.stateCreate).not.toHaveBeenCalled();
  });

  it("a FAILED probe persists lastSyncOk=false and the sanitized error, without fake credit values", async () => {
    mocks.health.mockResolvedValue(failedHealth());
    stateFindOneAndUpdateResolves({ ...PRIOR_STATE_DOC, lastError: null });

    const res = await callRoute();
    expect(res.status).toBe(200);

    const [filter, update] = mocks.stateFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
      Record<string, unknown>,
    ];

    expect(filter).toEqual({ _id: "smsir" });
    expect(update.$set.lastSyncOk).toBe(false);
    expect(update.$set.lastError).toMatchObject({
      kind: "auth_failed",
      messageFa: "خطای احراز هویت سرویس‌دهنده — کلید API نامعتبر یا غیرفعال است",
    });

    // Never fabricate credit/lines when the provider returned none.
    expect(update.$set["credit.value"]).toBeUndefined();
    expect(update.$set["lines.lineNumbers"]).toBeUndefined();

    // No raw provider bodies/statuses are persisted either — the fields are
    // explicitly written as null (never populated by the route).
    expect(JSON.stringify(update.$set.lastError)).not.toContain(FAKE_KEY);
    const lastError = update.$set.lastError as Record<string, unknown>;
    expect(lastError.httpStatus).toBeNull();
    expect(lastError.providerStatus).toBeNull();
    expect(lastError.providerMessage).toBe("");

    expect(mocks.stateCreate).not.toHaveBeenCalled();
  });

  it("subsequent probes keep updating the SAME fixed document — the single-record invariant", async () => {
    await callRoute();
    await callRoute();

    expect(mocks.stateFindOneAndUpdate).toHaveBeenCalledTimes(2);
    for (const call of mocks.stateFindOneAndUpdate.mock.calls) {
      const [filter] = call as [Record<string, unknown>];
      expect(filter).toEqual({ _id: "smsir" });
    }
    // The upsert path is the ONLY write: no create/insert fan-out can ever
    // fork a second record (create is asserted here across all tests via
    // clearAllMocks-per-test; within this test it must also never fire).
    expect(mocks.stateCreate).not.toHaveBeenCalled();
  });

  it("the response reads the persisted record ('' last successful sync)", async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      credit: { value: number | null; lastSyncAt: string | null };
      lines: { providerLines: string[] };
      lastError: { kind: string; messageFa: string } | null;
      lastSyncAt: string | null;
      lastSyncOk: boolean | null;
    };

    expect(body.credit.value).toBe(99);
    expect(body.credit.lastSyncAt).toBe(AT);
    expect(body.lines.providerLines).toEqual(["10002155613464"]);
    expect(body.lastError).toMatchObject({ kind: "insufficient_credit" });
    expect(body.lastSyncOk).toBe(true);
  });
});
