/**
 * Phase 1 — SMS.ir template provider unit tests (fully hermetic).
 *
 * Every provider interaction is exercised with an injected fetch/mock — no
 * network, no real SMS.ir calls, no credit consumption.
 */
import { describe, it, expect, vi } from "vitest";
import {
  getSmsIrTemplates,
  getSmsIrTemplate,
  mapSmsIrTemplateStatus,
} from "@/lib/sms-ir-admin";
import type { SmsIrTemplateStatus } from "@/types";

const KEY_ENV = { SMS_IR_API_KEY: "test-key-1234567890" };

function fetchOk(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ status: 1, message: "موفق", data }),
  });
}

function isFailure(r: unknown): r is { ok: false; kind: string; messageFa: string } {
  return typeof r === "object" && r !== null && (r as { ok: boolean }).ok === false;
}

// ============================================================
// mapSmsIrTemplateStatus
// ============================================================

describe("mapSmsIrTemplateStatus", () => {
  it("maps provider status 1 to pending", () => {
    expect(mapSmsIrTemplateStatus(1)).toBe("pending");
  });

  it("maps provider status 2 to approved", () => {
    expect(mapSmsIrTemplateStatus(2)).toBe("approved");
  });

  it("maps provider status 3 to rejected", () => {
    expect(mapSmsIrTemplateStatus(3)).toBe("rejected");
  });

  it("maps unknown status codes to unknown", () => {
    expect(mapSmsIrTemplateStatus(0)).toBe("unknown");
    expect(mapSmsIrTemplateStatus(99)).toBe("unknown");
    expect(mapSmsIrTemplateStatus(-1)).toBe("unknown");
  });
});

// ============================================================
// getSmsIrTemplates
// ============================================================

describe("getSmsIrTemplates", () => {
  it("returns configured error when API key is missing (no network call)", async () => {
    const fetchImpl = vi.fn();
    const res = await getSmsIrTemplates({
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.kind).toBe("not_configured");
    } else {
      throw new Error("Expected failure");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns list of templates on success", async () => {
    const res = await getSmsIrTemplates({
      env: KEY_ENV,
      fetchImpl: fetchOk([
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
      ]) as unknown as typeof fetch,
    });

    if (res.ok) {
      expect(res.templates.length).toBe(1);
      expect(res.templates[0].id).toBe(574993);
      expect(res.templates[0].title).toBe("کد otp");
      expect(res.templates[0].type).toBe(1);
      expect(res.templates[0].parameters[0].name).toBe("OTP");
    } else {
      throw new Error("Expected success");
    }
  });

  it("maps provider status codes correctly", async () => {
    const res = await getSmsIrTemplates({
      env: KEY_ENV,
      fetchImpl: fetchOk([
        { id: 1, title: "A", templateText: "t1 #X#", type: 1, parameters: [], status: 1, rejectionReason: null, creationDateTime: 1 },
        { id: 2, title: "B", templateText: "t2 #Y#", type: 2, parameters: [], status: 2, rejectionReason: null, creationDateTime: 2 },
        { id: 3, title: "C", templateText: "t3 #Z#", type: 3, parameters: [], status: 3, rejectionReason: "bad text", creationDateTime: 3 },
      ]) as unknown as typeof fetch,
    });

    if (res.ok) {
      expect(res.templates[0].status).toBe(1);
      expect(mapSmsIrTemplateStatus(res.templates[0].status)).toBe("pending");
      expect(res.templates[1].status).toBe(2);
      expect(mapSmsIrTemplateStatus(res.templates[1].status)).toBe("approved");
      expect(res.templates[2].status).toBe(3);
      expect(mapSmsIrTemplateStatus(res.templates[2].status)).toBe("rejected");
    } else {
      throw new Error("Expected success");
    }
  });

  it("handles network timeout", async () => {
    const abort = new DOMException("The operation was aborted", "AbortError");
    const res = await getSmsIrTemplates({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockRejectedValue(abort) as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.kind).toBe("network_timeout");
    } else {
      throw new Error("Expected failure");
    }
  });

  it("handles auth failure (HTTP 401)", async () => {
    const res = await getSmsIrTemplates({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ status: 10, message: "کلید نامعتبر" }),
      }) as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.kind).toBe("auth_failed");
    } else {
      throw new Error("Expected failure");
    }
  });

  it("handles rate limit (HTTP 429)", async () => {
    const res = await getSmsIrTemplates({
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "",
      }) as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.kind).toBe("rate_limited");
    } else {
      throw new Error("Expected failure");
    }
  });
});

// ============================================================
// getSmsIrTemplate
// ============================================================

describe("getSmsIrTemplate", () => {
  it("returns single template on success", async () => {
    const res = await getSmsIrTemplate(574993, {
      env: KEY_ENV,
      fetchImpl: fetchOk({
        id: 574993,
        title: "کد otp",
        templateText: "کد ورود شما: #OTP#\nتیم همیار ساختمان مارلو",
        type: 1,
        parameters: [{ name: "OTP", description: "رمز یکبار مصرف" }],
        status: 2,
        rejectionReason: null,
        creationDateTime: 1778422232,
      }) as unknown as typeof fetch,
    });

    if (res.ok) {
      expect(res.template.id).toBe(574993);
      expect(res.template.title).toBe("کد otp");
      expect(res.template.type).toBe(1);
      expect(res.template.parameters[0].name).toBe("OTP");
    } else {
      throw new Error("Expected success");
    }
  });

  it("returns template_not_found when provider returns 113", async () => {
    const res = await getSmsIrTemplate(999999, {
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ status: 113, message: "قالب یافت نشد" }),
      }) as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.kind).toBe("template_not_found");
    } else {
      throw new Error("Expected failure");
    }
  });

  it("handles invalid response body", async () => {
    const res = await getSmsIrTemplate(574993, {
      env: KEY_ENV,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "not-json-at-all",
      }) as unknown as typeof fetch,
    });
    if (isFailure(res)) {
      expect(res.kind).toBe("malformed_response");
    } else {
      throw new Error("Expected failure");
    }
  });
});
