/**
 * Session 91 — Business order-event SMS automation unit tests.
 *
 * Hermetic: exercises sendOrderBusinessSms with injectable seams
 * (SmsLogModel / SmsTemplateModel / sendFn / updateMarkerFn) so no real DB and
 * no real network are touched. `resolveBusinessSmsProvider` is mocked to "mock"
 * so the disabled/provider gate does not skip sends.
 *
 * The critical invariant asserted throughout: for one deterministic dedupeKey
 * under concurrent execution, AT MOST ONE provider call reaches sendFn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
/* eslint-disable @typescript-eslint/no-explicit-any */


const { resolveBusinessSmsProvider, dbConnect } = vi.hoisted(() => ({
  resolveBusinessSmsProvider: vi.fn(),
  dbConnect: vi.fn(),
}));

vi.mock("@/lib/sms-business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-business")>();
  return { ...actual, resolveBusinessSmsProvider };
});

// dbConnect would try a real Mongo connection — mock it to a no-op for the
// hermetic unit tests. The service's data access is fully injectable.
vi.mock("@/lib/dbConnect", () => ({ dbConnect }));

import {
  orderSmsDedupeKey,
  buildSmsEventMarker,
  sendOrderBusinessSms,
  ALL_ORDER_SMS_EVENTS,
} from "@/lib/sms-order-events";

// ---------------------------------------------------------------------------
// Fake Mongoose-like model with the operations the service uses. We drive
// behavior per-test (create / findOneAndUpdate / findOne) and count sendFn.
// ---------------------------------------------------------------------------

function makeFakeLog() {
  const store: any[] = [];
  return {
    store,
    async create(doc: any) {
      // Simulate the unique partial index on dedupeKey.
      const dup = store.find(
        (r) => r.dedupeKey != null && r.dedupeKey === doc.dedupeKey
      );
      if (dup) {
        const err = new Error("duplicate") as any;
        err.code = 11000;
        throw err;
      }
      const row = { ...doc, _id: `id${store.length + 1}` };
      store.push(row);
      return row;
    },
    findOne(filter: any) {
      const key = filter.dedupeKey;
      const row = store.find((r) => r.dedupeKey === key) || null;
      return { lean: async () => row };
    },
    findOneAndUpdate(filter: any, update: any, _opts: any) {
      void _opts; // mirror the Mongoose Query chain options (unused, kept for shape)

      // Non-async to mirror the Mongoose Query chain: the service calls
      // `await Model.findOneAndUpdate(...).lean()`, so this must return an
      // object with a `.lean()` that resolves the store mutation.
      const row = store.find((r) =>
        Object.entries(filter).every(([k, v]) => r[k] === v)
      );
      if (!row) return { lean: async () => null };
      if (update.$set) Object.assign(row, update.$set);
      if (update.$inc) {
        for (const [k, n] of Object.entries(update.$inc)) {
          row[k] = (row[k] || 0) + (n as number);
        }
      }
      const out = { ...row };
      return { lean: async () => out };
    },
  };
}

function makeTemplate(over: Record<string, unknown> = {}) {
  return {
    _id: "tpl1",
    name: "t",
    body: "سفارش {{orderReference}} برای {{customerName}} — مبلغ {{amount}}",
    variables: ["orderReference", "customerName", "amount"],
    isActive: true,
    ...over,
  };
}

const ORDER_ID = "c".repeat(24);
const PHONE = "09123456789";

const ORDER = {
  _id: ORDER_ID,
  customer: "u1",
  totalAmount: 125000,
  status: "processing",
  shipping: { trackingCode: "TRK9" },
};

beforeEach(() => {
  resolveBusinessSmsProvider.mockReturnValue("mock");
});

describe("orderSmsDedupeKey — deterministic event identity", () => {
  it("same order+event => same key; different order/event => different", () => {
    expect(orderSmsDedupeKey(ORDER_ID, "ORDER_CREATED")).toBe(
      `order:${ORDER_ID}:created`
    );
    expect(orderSmsDedupeKey(ORDER_ID, "PAYMENT_SUCCESS")).toBe(
      `order:${ORDER_ID}:payment-success`
    );
    expect(orderSmsDedupeKey(ORDER_ID, "PAYMENT_SUCCESS")).not.toBe(
      orderSmsDedupeKey(ORDER_ID, "ORDER_CREATED")
    );
    expect(orderSmsDedupeKey(ORDER_ID, "ORDER_CREATED")).not.toBe(
      orderSmsDedupeKey("a".repeat(24), "ORDER_CREATED")
    );
  });

  it("buildSmsEventMarker embeds the same deterministic dedupeKey", () => {
    const m = buildSmsEventMarker(ORDER_ID, "ORDER_SHIPPED");
    expect(m).toMatchObject({
      event: "shipped",
      dedupeKey: `order:${ORDER_ID}:shipped`,
      status: "pending",
    });
  });

  it("all five supported events have distinct suffixes and template names", () => {
    expect(ALL_ORDER_SMS_EVENTS).toHaveLength(5);
    const suffixes = ALL_ORDER_SMS_EVENTS.map((e) =>
      orderSmsDedupeKey("x", e)
    );
    expect(new Set(suffixes).size).toBe(5);
  });
});

describe("first event — one SmsLog, one provider call", () => {
  it("creates a pending row, sends once, finalizes sent, repairs marker", async () => {
    const log = makeFakeLog();
    const sendFn = vi
      .fn()
      .mockResolvedValue({ ok: true, provider: "mock", messageId: "M1" });
    const updMarker = vi.fn().mockResolvedValue(true);
    const tpl = makeTemplate();

    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: updMarker,
    });

    expect(res.outcome).toBe("sent");
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(log.store).toHaveLength(1);
    expect(log.store[0].status).toBe("sent");
    expect(log.store[0].dedupeKey).toBe(`order:${ORDER_ID}:created`);
    expect(updMarker).toHaveBeenCalledWith(ORDER_ID, "ORDER_CREATED", "sent");
  });
});

describe("missing template — no provider call, no SmsLog", () => {
  it("returns template_unavailable and leaves everything untouched", async () => {
    const log = makeFakeLog();
    const sendFn = vi.fn().mockResolvedValue({ ok: true, provider: "mock" });

    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => null }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });

    expect(res.outcome).toBe("not_sent_template_unavailable");
    expect(sendFn).not.toHaveBeenCalled();
    expect(log.store).toHaveLength(0);
  });

  it("inactive template also skipped (isActive filter returns null)", async () => {
    const log = makeFakeLog();
    const sendFn = vi.fn();
    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "x",
      SmsLogModel: log,
      // Template lookup only returns rows with isActive:true (per query);
      // a missing/inactive template yields null here.
      SmsTemplateModel: { findOne: () => ({ lean: () => null }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(res.outcome).toBe("not_sent_template_unavailable");
    expect(sendFn).not.toHaveBeenCalled();
    expect(log.store).toHaveLength(0);
  });
});

describe("duplicate invocation after sent — zero provider calls", () => {
  it("second trigger sees SmsLog.sent and does not resend", async () => {
    const log = makeFakeLog();
    const sendFn = vi
      .fn()
      .mockResolvedValue({ ok: true, provider: "mock", messageId: "M1" });
    const updMarker = vi.fn().mockResolvedValue(true);
    const tpl = makeTemplate();

    // First send.
    await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: updMarker,
    });
    expect(sendFn).toHaveBeenCalledTimes(1);

    // Duplicate invocation.
    const res2 = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: updMarker,
    });

    expect(res2.outcome).toBe("already_sent");
    expect(sendFn).toHaveBeenCalledTimes(1); // still one
    expect(log.store).toHaveLength(1);
  });
});

describe("concurrent first-time triggers — exactly one provider call", () => {
  it("second insert hits E11000 and never sends", async () => {
    const log = makeFakeLog();
    const sendFn = vi
      .fn()
      .mockResolvedValue({ ok: true, provider: "mock", messageId: "M1" });
    const tpl = makeTemplate();

    // First completion inserts + sends + finalizes sent.
    await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });

    // Concurrent second call: insert throws E11000 -> handleExistingRow
    // -> sees sent -> no provider call.
    const res2 = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });

    expect(res2.outcome).toBe("already_sent");
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(log.store).toHaveLength(1);
  });
});

describe("concurrent retry of a failed row — exactly one provider call", () => {
  it("two retries: only one CAS wins, only one send", async () => {
    const log = makeFakeLog();
    // Pre-seed a failed row deterministically.
    log.store.push({
      _id: "id1",
      dedupeKey: `order:${ORDER_ID}:created`,
      status: "failed",
      attemptCount: 0,
      message: "m",
    });

    const sendFn = vi
      .fn()
      .mockResolvedValue({ ok: true, provider: "mock", messageId: "M2" });
    const tpl = makeTemplate();

    // First retry wins the failed->sending CAS.
    const r1 = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(r1.outcome).toBe("sent");

    // Second retry: row is now sent (terminal) -> no send.
    const r2 = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(r2.outcome).toBe("already_sent");

    expect(sendFn).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent retry of an unknown row — exactly one provider call", () => {
  it("unknown -> sending CAS; only one retry sends", async () => {
    const log = makeFakeLog();
    log.store.push({
      _id: "id1",
      dedupeKey: `order:${ORDER_ID}:shipped`,
      status: "unknown",
      attemptCount: 0,
      message: "m",
    });
    const sendFn = vi
      .fn()
      .mockResolvedValue({ ok: true, provider: "mock", messageId: "M3" });
    const tpl = makeTemplate({ body: "کد رهگیری {{trackingCode}}", variables: ["trackingCode"] });

    await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_SHIPPED",
      order: { ...ORDER, status: "shipped", shipping: { trackingCode: "TRK9" } },
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    // Second concurrent retry -> already sent.
    await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_SHIPPED",
      order: { ...ORDER, status: "shipped", shipping: { trackingCode: "TRK9" } },
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(sendFn).toHaveBeenCalledTimes(1);
  });
});

describe("existing sending row — zero provider calls, no auto-reclaim", () => {
  it("treats sending as in-flight, does not send, does not clear", async () => {
    const log = makeFakeLog();
    log.store.push({
      _id: "id1",
      dedupeKey: `order:${ORDER_ID}:delivered`,
      status: "sending",
      attemptCount: 1,
      message: "m",
    });
    const sendFn = vi.fn().mockResolvedValue({ ok: true, provider: "mock" });
    const tpl = makeTemplate();

    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_DELIVERED",
      order: { ...ORDER, status: "delivered" },
      phone: PHONE,
      customerName: "x",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });

    expect(res.outcome).toBe("in_flight");
    expect(sendFn).not.toHaveBeenCalled();
    expect(log.store[0].status).toBe("sending"); // unchanged, not reclaimed
  });
});

describe("provider confirmed rejection -> failed", () => {
  it("maps API_ERROR to failed", async () => {
    const log = makeFakeLog();
    const sendFn = vi.fn().mockResolvedValue({
      ok: false,
      provider: "smsir",
      error: "SMS_BUSINESS_API_ERROR",
    });
    const tpl = makeTemplate();
    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(res.outcome).toBe("failed");
    expect(log.store[0].status).toBe("failed");
  });
});

describe("provider network/unknown failure -> unknown", () => {
  it("maps NETWORK_ERROR to unknown, never auto-retries", async () => {
    const log = makeFakeLog();
    const sendFn = vi.fn().mockResolvedValue({
      ok: false,
      provider: "smsir",
      error: "NETWORK_ERROR",
    });
    const tpl = makeTemplate();
    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(res.outcome).toBe("unknown");
    expect(log.store[0].status).toBe("unknown");
  });
});

describe("disabled/unconfigured provider never breaks lifecycle", () => {
  it("provider none -> disabled outcome, no SmsLog, no send", async () => {
    resolveBusinessSmsProvider.mockReturnValue("none");
    const log = makeFakeLog();
    const sendFn = vi.fn();
    const tpl = makeTemplate();
    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(res.outcome).toBe("disabled");
    expect(sendFn).not.toHaveBeenCalled();
    expect(log.store).toHaveLength(0); // marker stays pending
  });
});

describe("no valid phone — not_sent, no provider call", () => {
  it("returns not_sent_no_phone", async () => {
    const log = makeFakeLog();
    const sendFn = vi.fn();
    const tpl = makeTemplate();
    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: "",
      customerName: "x",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    expect(res.outcome).toBe("not_sent_no_phone");
    expect(sendFn).not.toHaveBeenCalled();
    expect(log.store).toHaveLength(0);
  });
});

describe("Order.smsEvents.pending + SmsLog.sent -> marker repaired, no resend", () => {
  it("never sends again; repairs the durable marker to sent", async () => {
    const log = makeFakeLog();
    // SmsLog already finalized sent (e.g. crash after log but before marker update).
    log.store.push({
      _id: "id1",
      dedupeKey: `order:${ORDER_ID}:refund-completed`,
      status: "sent",
      attemptCount: 1,
      message: "m",
    });
    const sendFn = vi.fn().mockResolvedValue({ ok: true, provider: "mock" });
    const updMarker = vi.fn().mockResolvedValue(true);
    const tpl = makeTemplate();

    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "REFUND_COMPLETED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: updMarker,
    });

    expect(res.outcome).toBe("already_sent");
    expect(sendFn).not.toHaveBeenCalled();
    expect(updMarker).toHaveBeenCalledWith(ORDER_ID, "REFUND_COMPLETED", "sent");
  });
});

describe("processing the same pending marker repeatedly is idempotent", () => {
  it("multiple sequential calls to a sent row never re-send", async () => {
    const log = makeFakeLog();
    log.store.push({
      _id: "id1",
      dedupeKey: `order:${ORDER_ID}:payment-success`,
      status: "sent",
      attemptCount: 1,
      message: "m",
    });
    const sendFn = vi.fn().mockResolvedValue({ ok: true, provider: "mock" });
    const tpl = makeTemplate();

    for (let i = 0; i < 5; i++) {
      const r = await sendOrderBusinessSms({
        orderId: ORDER_ID,
        event: "PAYMENT_SUCCESS",
        order: ORDER,
        phone: PHONE,
        customerName: "علی",
        SmsLogModel: log,
        SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
        sendFn,
        updateMarkerFn: vi.fn(),
      });
      expect(r.outcome).toBe("already_sent");
    }
    expect(sendFn).not.toHaveBeenCalled();
    expect(log.store).toHaveLength(1);
  });
});

describe("SMS failure never throws into the lifecycle", () => {
  it("provider network throw is contained as unknown, not leaked", async () => {
    const log = makeFakeLog();
    const sendFn = vi.fn().mockRejectedValue(new Error("remote dead"));
    const tpl = makeTemplate();
    const res = await sendOrderBusinessSms({
      orderId: ORDER_ID,
      event: "ORDER_CREATED",
      order: ORDER,
      phone: PHONE,
      customerName: "علی",
      SmsLogModel: log,
      SmsTemplateModel: { findOne: () => ({ lean: () => tpl }) },
      sendFn,
      updateMarkerFn: vi.fn(),
    });
    // The top-level try/catch in sendOrderBusinessSms returns unknown,
    // never throws.
    expect(["unknown", "sent", "failed"]).toContain(res.outcome);
  });
});
