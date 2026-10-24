/**
 * Phase 1 — Route-level tests for GET /api/admin/sms/provider/templates.
 *
 * Seams (mirroring tests/unit/admin-sms-status-route.test.ts):
 *   - @/lib/auth-utils.requireRoleOrError → mocked, returning real contract shapes.
 *   - @/lib/rate-limiter.rateLimit → mocked to never limit.
 *   - @/lib/sms-ir-admin.getSmsIrTemplates → provider seam mocked (no real network).
 *   - Everything else from @/lib/sms-ir-admin stays REAL.
 *
 * Deterministic: vi.mock only, injected values, no timers, no credentials.
 * No real SMS.ir access — no SMS is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/admin/sms/provider/templates/route";

const FAKE_KEY = "phase1-test-key-987654321";
const ADMIN_ID = "a".repeat(24);

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  requireRoleOrError: vi.fn(),
  rateLimit: vi.fn(),
  getSmsIrTemplates: vi.fn(),
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
  SMS_TEMPLATE_READ_LIMIT: { max: 30, windowMs: 15 * 60 * 1000 },
}));
vi.mock("@/lib/sms-ir-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-ir-admin")>();
  return { ...actual, getSmsIrTemplates: mocks.getSmsIrTemplates };
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRoleOrError.mockResolvedValue({
    token: { id: ADMIN_ID, name: "مدیر تست", phone: "09120000000", role: "admin" as const },
    error: null,
  });
  mocks.rateLimit.mockResolvedValue({ limited: false, headers: {} });
});

describe("GET /api/admin/sms/provider/templates", () => {
  it("returns 403 when user is not admin", async () => {
    mocks.requireRoleOrError.mockResolvedValue({
      token: null,
      error: NextResponse.json({ error: "شما دسترسی به این بخش را ندارید" }, { status: 403 }),
    });

    const req = new NextRequest("http://localhost/api/admin/sms/provider/templates", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 429 when rate-limited", async () => {
    mocks.rateLimit.mockResolvedValue({ limited: true, headers: {} });

    const req = new NextRequest("http://localhost/api/admin/sms/provider/templates", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(429);
  });

  it("returns provider templates on success", async () => {
    mocks.getSmsIrTemplates.mockResolvedValue({
      ok: true,
      templates: [
        {
          id: 574993,
          title: "کد otp",
          templateText: "کد ورود شما: #OTP#",
          type: 1,
          parameters: [{ name: "OTP", description: "رمز یکبار مصرف" }],
          status: 2,
          rejectionReason: null,
          creationDateTime: 1778422232,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const req = new NextRequest("http://localhost/api/admin/sms/provider/templates", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.templates.length).toBe(1);
    expect(json.templates[0].id).toBe(574993);
    expect(json.templates[0].title).toBe("کد otp");
    expect(json.templates[0].parameters[0].name).toBe("OTP");
  });

  it("returns 502 when provider call fails", async () => {
    mocks.getSmsIrTemplates.mockResolvedValue({
      ok: false,
      kind: "template_not_found",
      messageFa: "قالب در سرویس‌دهنده یافت نشد",
    });

    const req = new NextRequest("http://localhost/api/admin/sms/provider/templates", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(502);

    const json = await res.json();
    expect(json.ok).toBeUndefined();
    expect(json.error).toBe("قالب در سرویس‌دهنده یافت نشد");
  });

  it("passes pageNumber and pageSize to provider", async () => {
    mocks.getSmsIrTemplates.mockResolvedValue({
      ok: true,
      templates: [],
      total: 0,
      page: 2,
      pageSize: 5,
    });

    const req = new NextRequest(
      "http://localhost/api/admin/sms/provider/templates?pageNumber=2&pageSize=5",
      { method: "GET" }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mocks.getSmsIrTemplates).toHaveBeenCalledTimes(1);
    const callArg = mocks.getSmsIrTemplates.mock.calls[0][0];
    expect(callArg.pageNumber).toBe(2);
    expect(callArg.pageSize).toBe(5);
  });

  it("passes status filter to provider", async () => {
    mocks.getSmsIrTemplates.mockResolvedValue({
      ok: true,
      templates: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });

    const req = new NextRequest(
      "http://localhost/api/admin/sms/provider/templates?status=2",
      { method: "GET" }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const callArg = mocks.getSmsIrTemplates.mock.calls[0][0];
    expect(callArg.status).toBe(2);
  });
});
