/**
 * Customer Conversation helpers (Session 68) — pure validation + state-machine
 * logic for the order-linked support threads, plus the shared atomic
 * message-append and the notification dispatcher used by all three role
 * surfaces (customer / admin / supplier).
 *
 * SECURITY INVARIANTS:
 *  - senderRole is ALWAYS derived from the authenticated session by the route
 *    and passed in explicitly — never parsed from a request body.
 *  - appendConversationMessage() claims on the CURRENT status set (single
 *    atomic findOneAndUpdate), so two concurrent replies can never both win a
 *    closed/forbidden transition, and a closed conversation can never receive
 *    a message (null → the route maps it to 400).
 *  - notifyConversationMessage() is fail-silent (mirrors the Session 36/37
 *    safeNotify pattern) — a notification failure can never turn a committed
 *    message into a 500, and the templated Persian message NEVER includes the
 *    conversation's message contents.
 */

import mongoose from "mongoose";
import CustomerConversation from "@/models/CustomerConversation";
import {
  notifyOrderEvent,
  type NotificationEventInput,
} from "@/lib/notifications";
import { sanitizePlainText } from "@/lib/sanitize";

// ============================================================
// Constants
// ============================================================

export const CONVERSATION_STATUSES = [
  "open",
  "pending",
  "resolved",
  "closed",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_CATEGORIES = [
  "general",
  "order",
  "delivery",
  "product",
  "refund",
] as const;
export type ConversationCategory = (typeof CONVERSATION_CATEGORIES)[number];

export const CONVERSATION_SENDER_ROLES = [
  "customer",
  "admin",
  "supplier",
] as const;
export type ConversationSenderRole =
  (typeof CONVERSATION_SENDER_ROLES)[number];

export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 2000;
export const PREVIEW_MAX = 120;

/**
 * Orders eligible for a support conversation: the customer must have genuinely
 * purchased (paid) — refunded counts as purchased; pending/failed/canceled do
 * not. Decision approved in Session 68 design.
 */
export function isEligibleOrderPayment(paymentStatus: unknown): boolean {
  return paymentStatus === "paid" || paymentStatus === "refunded";
}

// ============================================================
// Validation (pure)
// ============================================================

/** Validate + sanitize the subject. Returns null on invalid input. */
export function parseSubject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > SUBJECT_MAX) return null;
  const sanitized = sanitizePlainText(trimmed);
  return sanitized.length > 0 ? sanitized : null;
}

/** Validate the category against the enum. Returns the category or null. */
export function parseCategory(value: unknown): ConversationCategory | null {
  if (typeof value !== "string") return null;
  return (CONVERSATION_CATEGORIES as readonly string[]).includes(value)
    ? (value as ConversationCategory)
    : null;
}

/** Validate + sanitize a message body. Returns null on invalid input. */
export function parseMessageText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MESSAGE_MAX) return null;
  const sanitized = sanitizePlainText(trimmed);
  return sanitized.length > 0 ? sanitized : null;
}

/** List preview of a message (denormalized for list rendering). */
export function formatMessagePreview(text: string): string {
  return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX - 1) + "…" : text;
}

// ============================================================
// Status state machine (pure — unit-tested)
// ============================================================

/**
 * Allowed status transitions per role (approved Session 68 design):
 *  - customer: open|pending → resolved · resolved|closed → open (reopen)
 *  - admin:    any → resolved · any → closed · resolved|closed → open
 *  - supplier: reply-only — NO status writes in v1
 */
const TRANSITIONS: Record<ConversationStatus, Partial<Record<ConversationSenderRole | "admin", ConversationStatus[]>>> = {
  open: {
    customer: ["resolved"],
    admin: ["resolved", "closed"],
  },
  pending: {
    customer: ["resolved"],
    admin: ["resolved", "closed"],
  },
  resolved: {
    customer: ["open"],
    admin: ["open", "closed"],
  },
  closed: {
    customer: ["open"],
    admin: ["open"],
  },
};

/** Can `role` move a conversation from `from` to `to`? */
export function canTransit(
  from: string,
  to: string,
  role: ConversationSenderRole
): boolean {
  const fromRow = TRANSITIONS[from as ConversationStatus];
  if (!fromRow) return false;
  const allowed = fromRow[role];
  return !!allowed && allowed.includes(to as ConversationStatus);
}

/**
 * Next status when a message is appended, or null when messaging is not
 * allowed from the current status:
 *  - customer message: open/pending/resolved → open (auto-reopen from resolved)
 *  - staff message:    open/pending → pending (awaiting the customer)
 *  - any sender on a CLOSED conversation → null (400 — reopen first)
 */
export function nextStatusOnMessage(
  current: string,
  senderRole: ConversationSenderRole
): ConversationStatus | null {
  if (current === "closed") return null;
  if (senderRole === "customer") return "open";
  if (current === "open" || current === "pending") return "pending";
  // Staff messaging a resolved conversation is not allowed — reopen first.
  return null;
}

/** Status values a message send may claim from (atomic filter). */
export function allowedFromForMessage(
  senderRole: ConversationSenderRole
): ConversationStatus[] {
  return senderRole === "customer"
    ? ["open", "pending", "resolved"]
    : ["open", "pending"];
}

// ============================================================
// Shared atomic message append
// ============================================================

export interface AppendMessageInput {
  conversationId: string;
  currentStatus: string;
  senderUserId: string;
  senderRole: ConversationSenderRole;
  text: string;
}

/**
 * Atomically append a message + update status/unread/lastMessage denormals.
 * Returns the updated conversation (lean), or null when the claim failed
 * (concurrent status change or a forbidden transition — the route maps null
 * to 400). The message _id is generated here so the caller can use it as the
 * notification dedupe key.
 */
export async function appendConversationMessage(
  input: AppendMessageInput
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const nextStatus = nextStatusOnMessage(input.currentStatus, input.senderRole);
  if (!nextStatus) return null;

  const now = new Date();
  const messageId = new mongoose.Types.ObjectId();
  const message = {
    _id: messageId,
    sender: new mongoose.Types.ObjectId(input.senderUserId),
    senderRole: input.senderRole,
    text: input.text,
    createdAt: now,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimed: any = await CustomerConversation.findOneAndUpdate(
    {
      _id: input.conversationId,
      status: { $in: allowedFromForMessage(input.senderRole) },
    },
    {
      $push: { messages: message },
      $set: {
        status: nextStatus,
        lastMessageAt: now,
        lastMessagePreview: formatMessagePreview(input.text),
        lastMessageFrom: input.senderRole,
        customerUnread: input.senderRole !== "customer",
        staffUnread: input.senderRole === "customer",
      },
    },
    { new: true }
  ).lean();

  return claimed;
}

// ============================================================
// Notifications (fail-silent — never leaks message content)
// ============================================================

/** Structurally fail-silent notify (the Session 36/37 safeNotify pattern). */
async function safeNotifyOrderEvent(input: NotificationEventInput) {
  try {
    await notifyOrderEvent(input);
  } catch (err) {
    console.error(
      "[Conversations] notification dispatch failed (non-blocking):",
      err
    );
  }
}

export interface NotifyConversationMessageInput {
  conversationId: string;
  orderId?: string | null;
  senderRole: ConversationSenderRole;
  messageId: string;
  /** conversation.customer user id — notified when a STAFF message is sent. */
  customerUserId: string;
  /** the conversation supplier's USER id — notified when the CUSTOMER sends. */
  supplierUserId?: string;
}

/**
 * One in-app notification per message (dedupe key conversation_<id>_<messageId>
 * → the unique partial index rejects a duplicate; the SECOND message always
 * carries a fresh key). The templated Persian message never contains the
 * conversation body. Admins are NOT notified per-message in v1 (approved
 * decision — they monitor the /admin/support queue via staffUnread).
 */
export async function notifyConversationMessage(
  input: NotifyConversationMessageInput
): Promise<void> {
  const orderShort = input.orderId ? String(input.orderId).slice(-8) : "؟";

  if (input.senderRole === "customer") {
    if (input.supplierUserId) {
      await safeNotifyOrderEvent({
        recipient: input.supplierUserId,
        type: "support_message",
        category: "support",
        message: `مشتری در گفتگوی سفارش #${orderShort} پیام جدیدی ارسال کرد.`,
        relatedOrder: input.orderId ? String(input.orderId) : null,
        link: `/supplier/support/${input.conversationId}`,
        notificationKey: `conversation_${input.conversationId}_${input.messageId}`,
      });
    }
    return;
  }

  // Staff (admin/supplier) message → notify the customer.
  await safeNotifyOrderEvent({
    recipient: input.customerUserId,
    type: "support_message",
    category: "support",
    message: `پاسخ جدیدی در گفتگوی سفارش #${orderShort} دریافت کردید.`,
    relatedOrder: input.orderId ? String(input.orderId) : null,
    link: `/support/${input.conversationId}`,
    notificationKey: `conversation_${input.conversationId}_${input.messageId}`,
  });
}
