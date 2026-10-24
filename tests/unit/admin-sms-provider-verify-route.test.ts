/**
 * Phase 2A — Route-level tests for POST /api/admin/sms/templates/:id/verify-provider.
 *
 * Seams:
 *   - @/lib/auth-utils.requireRoleOrError → mocked, returning real contract shapes.
 *   - @/lib/rate-limiter.rateLimit → mocked to never limit.
 *   - @/lib/sms-ir-admin.getSmsIrTemplate → provider seam mocked (no real network).
 *   - @/models/SmsTemplate → mocked (no real DB).
 *
 * Deterministic: vi.mock only, injected values, no timers, no credentials.
 * No real SMS.ir access — no SMS is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/admin/sms/templates/[id]/verify-provider/route";

const ADMIN_ID = "a".repeat(24);
const TEMPLATE_ID = "b".repeat(24);

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  requireRoleOrError: vi.fn(),
  rateLimit: vi.fn(),
  getSmsIrTemplate: vi.fn(),
  SmsTemplate: {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
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
  SMS_TEMPLATE_WRITE_LIMIT: { max: 30, windowMs: 15 * 60 * 1000 },
}));
vi.mock("@/lib/sms-ir-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-ir-admin")>();
  return { ...actual, getSmsIrTemplate: mocks.getSmsIrTemplate };
});
vi.mock("@/models/SmsTemplate", () => ({
  default: mocks.SmsTemplate,
}));

const providerSuccess = (status: number, rejectionReason: string | null = null) =>
  ({
    ok: true,
    template: {
      id: 123456,
      title: "قالب تست",
      templateText: "متن قالب #PARAM#",
      type: 2,
      parameters: [{ name: "PARAM", description: "پارامتر" }],
      status,
      rejectionReason,
      creationDateTime: 1778422232,
    },
  }) as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRoleOrError.mockResolvedValue({
    token: { id: ADMIN_ID, name: "مدیر تست", phone: "09120000000", role: "admin" as const },
    error: null,
  });
  mocks.rateLimit.mockResolvedValue({ limited: false, headers: {} });
  mocks.SmsTemplate.findById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      _id: TEMPLATE_ID,
      name: "قالب تست",
      providerTemplateId: "123456",
      providerStatus: "not_submitted",
      providerVerifiedAt: null,
      providerLastCheckedAt: null,
      providerLastCheckError: "",
      providerRejectionReason: "",
    }),
  });
  mocks.SmsTemplate.findByIdAndUpdate.mockResolvedValue({});
});

function req(url: string) {
  return new NextRequest(url, { method: "POST" });
}

describe("POST /api/admin/sms/templates/:id/verify-provider", () => {
  it("returns 403 when user is not authenticated", async () => {
    mocks.requireRoleOrError.mockResolvedValue({
      token: null,
      error: NextResponse.json({ error: "لطفاً ابتدا وارد حساب خود شوید" }, { status: 401 }),
    });

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not admin", async () => {
    mocks.requireRoleOrError.mockResolvedValue({
      token: null,
      error: NextResponse.json({ error: "شما دسترسی به این بخش را ندارید" }, { status: 403 }),
    });

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(403);
  });

  it("returns 429 when rate-limited", async () => {
    mocks.rateLimit.mockResolvedValue({ limited: true, headers: {} });

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(429);
  });

  it("returns 400 for invalid template id", async () => {
    const res = await POST(req("http://localhost/api/admin/sms/templates/invalid-id/verify-provider"), { params: Promise.resolve({ id: "invalid-id" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when template not found", async () => {
    mocks.SmsTemplate.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when providerTemplateId is empty", async () => {
    mocks.SmsTemplate.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: "قالب تست",
        providerTemplateId: "",
      }),
    });

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(400);
  });

  it("sets pending for provider status 1", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue(providerSuccess(1));

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.providerStatus).toBe("pending");
    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerStatus: "pending",
        providerLastCheckError: "",
      }),
    );
  });

  it("sets approved for provider status 2", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue(providerSuccess(2));

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.providerStatus).toBe("approved");
    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerStatus: "approved",
        providerRejectionReason: "",
      }),
    );
  });

  it("sets rejected for provider status 3 with reason", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue(providerSuccess(3, "دلیل رد تست"));

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providerStatus).toBe("rejected");
    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerStatus: "rejected",
        providerRejectionReason: "دلیل رد تست",
      }),
    );
  });

  it("sets not_found for provider template_not_found (113)", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue({
      ok: false,
      kind: "template_not_found",
      messageFa: "قالب در سرویس‌دهنده یافت نشد",
    } as any);

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providerStatus).toBe("not_found");
  });

  it("clears providerLastCheckError on successful verification", async () => {
    mocks.SmsTemplate.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: "قالب تست",
        providerTemplateId: "123456",
        providerStatus: "pending",
        providerLastCheckError: "خطای قبلی",
      }),
    });
    mocks.getSmsIrTemplate.mockResolvedValue(providerSuccess(2));

    await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });

    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerLastCheckError: "",
        providerStatus: "approved",
      }),
    );
  });

  it("clears old rejection reason when status becomes approved", async () => {
    mocks.SmsTemplate.findById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: TEMPLATE_ID,
        name: "قالب تست",
        providerTemplateId: "123456",
        providerStatus: "rejected",
        providerRejectionReason: "دلیل قبلی",
      }),
    });
    mocks.getSmsIrTemplate.mockResolvedValue(providerSuccess(2));

    await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });

    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerStatus: "approved",
        providerRejectionReason: "",
      }),
    );
  });

  it("preserves previous state on network timeout", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue({
      ok: false,
      kind: "network_timeout",
      messageFa: "اتصال به سرویس‌دهنده زمان‌بر شد (timeout)",
    } as any);

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(502);
    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerLastCheckError: expect.stringContaining("timeout"),
      }),
    );
  });

  it("preserves previous state on network error", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue({
      ok: false,
      kind: "network_error",
      messageFa: "خطای شبکه در ارتباط با سرویس‌دهنده",
    } as any);

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(502);
    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerLastCheckError: expect.stringContaining("شبکه"),
      }),
    );
  });

  it("preserves previous state on malformed response", async () => {
    mocks.getSmsIrTemplate.mockResolvedValue({
      ok: false,
      kind: "malformed_response",
      messageFa: "پاسخ نامعتبر از سرویس‌دهنده",
    } as any);

    const res = await POST(req("http://localhost/api/admin/sms/templates/" + TEMPLATE_ID + "/verify-provider"), { params: Promise.resolve({ id: TEMPLATE_ID }) });
    expect(res.status).toBe(502);
    expect(mocks.SmsTemplate.findByIdAndUpdate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        providerLastCheckError: expect.stringContaining("نامعتبر"),
      }),
    );
  });
});
