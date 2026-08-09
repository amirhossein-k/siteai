import { beforeEach, describe, expect, it, vi } from "vitest";

const { conversationFindOneAndUpdate } = vi.hoisted(() => ({
  conversationFindOneAndUpdate: vi.fn(),
}));
const { notifyOrderEvent } = vi.hoisted(() => ({ notifyOrderEvent: vi.fn() }));

vi.mock("@/models/CustomerConversation", () => ({
  default: { findOneAndUpdate: conversationFindOneAndUpdate },
}));
vi.mock("@/lib/notifications", () => ({ notifyOrderEvent }));

import {
  canTransit,
  nextStatusOnMessage,
  allowedFromForMessage,
  parseSubject,
  parseCategory,
  parseMessageText,
  isEligibleOrderPayment,
  formatMessagePreview,
  appendConversationMessage,
  notifyConversationMessage,
} from "@/lib/conversations";

const CONV_ID = "a".repeat(24);
const SENDER_ID = "b".repeat(24);
const CUSTOMER_ID = "c".repeat(24);
const SUPPLIER_USER_ID = "d".repeat(24);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// canTransit — status state machine
// ============================================================

describe("canTransit — customer transitions", () => {
  it("allows open|pending → resolved and resolved|closed → open (reopen)", () => {
    expect(canTransit("open", "resolved", "customer")).toBe(true);
    expect(canTransit("pending", "resolved", "customer")).toBe(true);
    expect(canTransit("resolved", "open", "customer")).toBe(true);
    expect(canTransit("closed", "open", "customer")).toBe(true);
  });

  it("rejects everything else for customers", () => {
    expect(canTransit("open", "closed", "customer")).toBe(false);
    expect(canTransit("open", "pending", "customer")).toBe(false);
    expect(canTransit("resolved", "closed", "customer")).toBe(false);
    expect(canTransit("closed", "resolved", "customer")).toBe(false);
    expect(canTransit("pending", "closed", "customer")).toBe(false);
  });
});

describe("canTransit — admin transitions", () => {
  it("allows any → resolved, any → closed, resolved|closed → open", () => {
    expect(canTransit("open", "resolved", "admin")).toBe(true);
    expect(canTransit("pending", "resolved", "admin")).toBe(true);
    expect(canTransit("open", "closed", "admin")).toBe(true);
    expect(canTransit("pending", "closed", "admin")).toBe(true);
    expect(canTransit("resolved", "closed", "admin")).toBe(true);
    expect(canTransit("resolved", "open", "admin")).toBe(true);
    expect(canTransit("closed", "open", "admin")).toBe(true);
  });

  it("rejects invalid admin transitions", () => {
    expect(canTransit("closed", "resolved", "admin")).toBe(false);
    expect(canTransit("open", "pending", "admin")).toBe(false);
    expect(canTransit("pending", "open", "admin")).toBe(false);
  });
});

describe("canTransit — supplier is reply-only (v1)", () => {
  it("rejects ALL status writes by suppliers", () => {
    expect(canTransit("open", "resolved", "supplier")).toBe(false);
    expect(canTransit("pending", "resolved", "supplier")).toBe(false);
    expect(canTransit("open", "closed", "supplier")).toBe(false);
    expect(canTransit("closed", "open", "supplier")).toBe(false);
    expect(canTransit("resolved", "open", "supplier")).toBe(false);
  });
});

// ============================================================
// nextStatusOnMessage / allowedFromForMessage
// ============================================================

describe("nextStatusOnMessage", () => {
  it("customer messages always land on open (auto-reopen from resolved)", () => {
    expect(nextStatusOnMessage("open", "customer")).toBe("open");
    expect(nextStatusOnMessage("pending", "customer")).toBe("open");
    expect(nextStatusOnMessage("resolved", "customer")).toBe("open");
  });

  it("staff messages move open/pending → pending (awaiting the customer)", () => {
    expect(nextStatusOnMessage("open", "admin")).toBe("pending");
    expect(nextStatusOnMessage("pending", "supplier")).toBe("pending");
  });

  it("staff cannot message a resolved conversation (reopen first)", () => {
    expect(nextStatusOnMessage("resolved", "admin")).toBeNull();
    expect(nextStatusOnMessage("resolved", "supplier")).toBeNull();
  });

  it("closed is message-immutable for every sender", () => {
    expect(nextStatusOnMessage("closed", "customer")).toBeNull();
    expect(nextStatusOnMessage("closed", "admin")).toBeNull();
    expect(nextStatusOnMessage("closed", "supplier")).toBeNull();
  });
});

describe("allowedFromForMessage", () => {
  it("customers claim open|pending|resolved; staff claim open|pending", () => {
    expect(allowedFromForMessage("customer")).toEqual([
      "open",
      "pending",
      "resolved",
    ]);
    expect(allowedFromForMessage("admin")).toEqual(["open", "pending"]);
    expect(allowedFromForMessage("supplier")).toEqual(["open", "pending"]);
  });
});

// ============================================================
// Validation (pure)
// ============================================================

describe("parseSubject", () => {
  it("accepts a trimmed valid subject", () => {
    expect(parseSubject("  پیگیری وضعیت ارسال  ")).toBe("پیگیری وضعیت ارسال");
  });

  it("rejects empty / whitespace-only / over-cap subjects", () => {
    expect(parseSubject("")).toBeNull();
    expect(parseSubject("   ")).toBeNull();
    expect(parseSubject("x".repeat(121))).toBeNull();
    expect(parseSubject(123)).toBeNull();
    expect(parseSubject(null)).toBeNull();
  });

  it("strips HTML (defense-in-depth)", () => {
    expect(parseSubject("<script>alert(1)</script>سوال")).toBe("alert(1)سوال");
  });

  it("rejects content that sanitizes to nothing", () => {
    expect(parseSubject("<b></b>")).toBeNull();
  });
});

describe("parseCategory", () => {
  it("accepts the enum values and rejects everything else", () => {
    expect(parseCategory("general")).toBe("general");
    expect(parseCategory("delivery")).toBe("delivery");
    expect(parseCategory("other")).toBeNull();
    expect(parseCategory("")).toBeNull();
    expect(parseCategory(undefined)).toBeNull();
  });
});

describe("parseMessageText", () => {
  it("accepts a trimmed valid message", () => {
    expect(parseMessageText("  سلام، وضعیت سفارش من چطور است؟  ")).toBe(
      "سلام، وضعیت سفارش من چطور است؟"
    );
  });

  it("rejects empty / whitespace-only / over-cap messages", () => {
    expect(parseMessageText("")).toBeNull();
    expect(parseMessageText("   ")).toBeNull();
    expect(parseMessageText("x".repeat(2001))).toBeNull();
    expect(parseMessageText(42)).toBeNull();
    expect(parseMessageText(undefined)).toBeNull();
  });

  it("strips HTML and rejects pure-markup input", () => {
    expect(parseMessageText("<b>متن</b>")).toBe("متن");
    expect(parseMessageText("<img src=x onerror=alert(1)>")).toBeNull();
  });
});

describe("isEligibleOrderPayment", () => {
  it("paid and refunded are eligible; everything else is not", () => {
    expect(isEligibleOrderPayment("paid")).toBe(true);
    expect(isEligibleOrderPayment("refunded")).toBe(true);
    expect(isEligibleOrderPayment("pending")).toBe(false);
    expect(isEligibleOrderPayment("failed")).toBe(false);
    expect(isEligibleOrderPayment("canceled")).toBe(false);
    expect(isEligibleOrderPayment(undefined)).toBe(false);
  });
});

describe("formatMessagePreview", () => {
  it("keeps short text and truncates long text with an ellipsis", () => {
    expect(formatMessagePreview("کوتاه")).toBe("کوتاه");
    const long = "x".repeat(200);
    expect(formatMessagePreview(long)).toHaveLength(120);
    expect(formatMessagePreview(long).endsWith("…")).toBe(true);
  });
});

// ============================================================
// appendConversationMessage — atomic claim
// ============================================================

describe("appendConversationMessage", () => {
  it("returns null when messaging is forbidden from the current status (closed)", async () => {
    const result = await appendConversationMessage({
      conversationId: CONV_ID,
      currentStatus: "closed",
      senderUserId: SENDER_ID,
      senderRole: "customer",
      text: "پیام",
    });
    expect(result).toBeNull();
    expect(conversationFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns null when a concurrent transition lost the claim", async () => {
    conversationFindOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(null) });
    const result = await appendConversationMessage({
      conversationId: CONV_ID,
      currentStatus: "open",
      senderUserId: SENDER_ID,
      senderRole: "customer",
      text: "پیام",
    });
    expect(result).toBeNull();
  });

  it("customer message → status open, staffUnread true, customerUnread false", async () => {
    conversationFindOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ _id: CONV_ID, status: "open" }),
    });

    const result = await appendConversationMessage({
      conversationId: CONV_ID,
      currentStatus: "resolved", // auto-reopen
      senderUserId: SENDER_ID,
      senderRole: "customer",
      text: "پیام جدید",
    });

    expect(result).not.toBeNull();
    const [filter, update] = conversationFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(filter.status).toEqual({ $in: ["open", "pending", "resolved"] });
    const set = update.$set as Record<string, unknown>;
    expect(set.status).toBe("open");
    expect(set.staffUnread).toBe(true);
    expect(set.customerUnread).toBe(false);
    expect(set.lastMessageFrom).toBe("customer");
    expect(set.lastMessagePreview).toBe("پیام جدید");
    const pushed = (
      update.$push as { messages: { senderRole: string; sender?: unknown; _id?: unknown } }
    ).messages;
    expect(pushed.senderRole).toBe("customer");
    expect(pushed.sender).toBeDefined();
    expect(pushed._id).toBeDefined();
  });

  it("admin message → status pending, customerUnread true, staffUnread false", async () => {
    conversationFindOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ _id: CONV_ID, status: "pending" }),
    });

    await appendConversationMessage({
      conversationId: CONV_ID,
      currentStatus: "open",
      senderUserId: SENDER_ID,
      senderRole: "admin",
      text: "پاسخ پشتیبانی",
    });

    const [, update] = conversationFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(update.$set).toMatchObject({
      status: "pending",
      customerUnread: true,
      staffUnread: false,
      lastMessageFrom: "admin",
    });
  });
});

// ============================================================
// notifyConversationMessage — fail-silent routing + dedupe keys
// ============================================================

describe("notifyConversationMessage", () => {
  const base = {
    conversationId: CONV_ID,
    orderId: "e".repeat(24),
    messageId: "f".repeat(24),
    customerUserId: CUSTOMER_ID,
  };

  it("customer message notifies ONLY the conversation's supplier user", async () => {
    await notifyConversationMessage({
      ...base,
      senderRole: "customer",
      supplierUserId: SUPPLIER_USER_ID,
    });

    expect(notifyOrderEvent).toHaveBeenCalledTimes(1);
    const input = notifyOrderEvent.mock.calls[0][0];
    expect(input.recipient).toBe(SUPPLIER_USER_ID);
    expect(input.type).toBe("support_message");
    expect(input.category).toBe("support");
    expect(input.notificationKey).toBe(`conversation_${CONV_ID}_${base.messageId}`);
    // The USER's message BODY is never part of the notification payload —
    // only the templated Persian summary is.
    expect(JSON.stringify(input)).not.toContain("متن گفتگو کاربر");
  });

  it("customer message with no supplier user produces no notification", async () => {
    await notifyConversationMessage({
      ...base,
      senderRole: "customer",
      supplierUserId: undefined,
    });
    expect(notifyOrderEvent).not.toHaveBeenCalled();
  });

  it("staff message (admin/supplier) notifies the customer", async () => {
    await notifyConversationMessage({ ...base, senderRole: "admin" });
    expect(notifyOrderEvent).toHaveBeenCalledTimes(1);
    expect(notifyOrderEvent.mock.calls[0][0].recipient).toBe(CUSTOMER_ID);

    notifyOrderEvent.mockClear();
    await notifyConversationMessage({ ...base, senderRole: "supplier" });
    expect(notifyOrderEvent).toHaveBeenCalledTimes(1);
    expect(notifyOrderEvent.mock.calls[0][0].recipient).toBe(CUSTOMER_ID);
  });

  it("never throws when the notification facade fails", async () => {
    notifyOrderEvent.mockRejectedValueOnce(new Error("db down"));
    await expect(
      notifyConversationMessage({ ...base, senderRole: "admin" })
    ).resolves.toBeUndefined();
  });
});
