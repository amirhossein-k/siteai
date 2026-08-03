/**
 * Notification Service — Core Notifications (Session 36)
 *
 * DESIGN (per approved Session 36 design):
 *  - `notifyOrderEvent()` is the SINGLE facade for creating in-app
 *    notifications. In-app is the source of truth; Telegram is an adapter.
 *  - SAFETY: this function NEVER throws and NEVER blocks the caller. Any
 *    failure (DB write, duplicate key, telegram send) is logged separately
 *    and swallowed. Call sites invoke it AFTER their business transaction
 *    has committed, so a notification can never fail a checkout, payment
 *    verification, refund, or order status transition.
 *  - DEDUPE: each event carries a `notificationKey` ("order_<id>_<event>").
 *    The unique partial index { recipient, notificationKey } rejects a
 *    second insert with E11000 — treated as "already notified" → no-op.
 *  - Telegram remains an adapter: an optional `telegram` callback invoked
 *    best-effort; its boolean result is stored in `sentToTelegram`.
 */

import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import Notification from "@/models/Notification";
import { publishToUserStream } from "@/lib/notification-stream";

export type NotificationCategory = "order" | "payment" | "payout" | "system";

export interface NotificationEventInput {
  /** Recipient user id (customer or supplier's user account). */
  recipient: string;
  /** Notification type — must be a member of the model enum. */
  type: string;
  category?: NotificationCategory;
  /** Persian message shown in the inbox. */
  message: string;
  relatedOrder?: string | null;
  /** Deep-link target, e.g. "/orders/<id>" or "/supplier/orders/<id>". */
  link?: string;
  /** Dedupe key, e.g. "order_<id>_order_confirmed". */
  notificationKey?: string;
  /** Best-effort telegram adapter (optional). Never awaited by callers. */
  telegram?: () => Promise<boolean>;
}

/**
 * Create an in-app notification + dispatch the optional telegram adapter.
 *
 * Returns true on success (or dedupe-hit), false on failure — callers may
 * ignore the return value entirely.
 */
export async function notifyOrderEvent(
  input: NotificationEventInput
): Promise<boolean> {
  try {
    await dbConnect();

    let created = null;
    try {
      created = await Notification.create({
        recipient: new mongoose.Types.ObjectId(input.recipient),
        type: input.type,
        category: input.category || "order",
        message: input.message,
        relatedOrder: input.relatedOrder
          ? new mongoose.Types.ObjectId(input.relatedOrder)
          : null,
        link: input.link || "",
        notificationKey: input.notificationKey || null,
        isRead: false,
        readAt: null,
        sentToTelegram: false,
        metadata: {},
      });
    } catch (err) {
      // Duplicate key → this event was already notified (dedupe). No-op.
      if ((err as { code?: number })?.code === 11000) return true;
      throw err;
    }

    // --- Live stream publish (Session 40) — AFTER the DB write committed ---
    // The MongoDB document is the source of truth; the SSE push is a delivery
    // hint to already-open connections. publishToUserStream() is structurally
    // fail-silent (never throws), so a dead stream can never affect the
    // business flow or this facade's return value. The E11000 dedupe path
    // above returns early, so deduped events are never re-pushed.
    try {
      publishToUserStream(String(created.recipient), {
        id: String(created._id),
        type: created.type,
        category: created.category || "order",
        message: created.message,
        link: created.link || "",
        relatedOrder: created.relatedOrder ? String(created.relatedOrder) : null,
        isRead: false,
        createdAt: new Date(created.createdAt || Date.now()).toISOString(),
      });
    } catch (err) {
      console.error("[notifications] stream publish failed:", err);
    }

    // Telegram adapter — fire-and-forget, never blocks, never throws upward.
    if (input.telegram && created) {
      const notifId = String(created._id);
      input
        .telegram()
        .then(async (sent) => {
          if (sent) {
            await Notification.updateOne(
              { _id: notifId },
              { $set: { sentToTelegram: true } }
            ).catch(() => {});
          }
        })
        .catch((err) => {
          console.error("[notifications] telegram dispatch failed:", err);
        });
    }

    return true;
  } catch (error) {
    // Notifications must never break business flows.
    console.error("[notifications] notifyOrderEvent failed:", error);
    return false;
  }
}
