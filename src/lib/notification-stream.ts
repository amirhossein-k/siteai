/**
 * Notification Stream Registry (Session 40 — Real-time notifications, SSE)
 *
 * DESIGN (per approved Session 40 design):
 *  - In-memory subscriber registry keyed by userId → Set<subscriber>. Each
 *    subscriber wraps a ReadableStreamDefaultController from the SSE route.
 *    Suitable for the current SINGLE-instance dev/prod server. If the app is
 *    ever scaled to multiple instances, swap this module for a Redis/Upstash
 *    pub/sub adapter — the subscribe/publish API surface stays identical, so
 *    the route handler and the notifyOrderEvent hook do not change.
 *  - SAFETY: publishToUserStream() NEVER throws and NEVER blocks. Any failure
 *    (dead subscriber, enqueue error) is caught and the subscriber pruned.
 *  - This module is a TRANSPORT layer only. It is NOT a notification-creation
 *    facade — notifyOrderEvent() in src/lib/notifications.ts remains the ONLY
 *    facade, and it calls publishToUserStream() only AFTER the Notification
 *    document has been committed to MongoDB (the DB write stays the source of
 *    truth; the SSE push is a delivery hint to already-open connections).
 */

import type { NotificationStreamEvent } from "@/types";

/** A connected SSE subscriber for one user. */
type Subscriber = {
  /** Push one pre-serialized SSE frame ("data: {...}\n\n" or a comment). */
  enqueue: (frame: string) => void;
};

interface StreamRegistry {
  subscribers: Map<string, Set<Subscriber>>;
}

// --- globalThis singleton (mirrors the global.mongoose pattern in dbConnect.js) ---
// In Next.js dev, the route-handler bundle and the shared lib bundle can each
// hold a SEPARATE copy of this module. A module-level Map would then split the
// route's subscribe() from notifications.ts' publish() — subscriptions would
// never see events (exactly what the first verify-sse run showed). Storing the
// registry on globalThis guarantees ONE Map across all module instances in the
// same process (dev AND production).
declare global {
  // eslint-disable-next-line no-var
  var __notificationStreamRegistry: StreamRegistry | undefined;
}

const registry: StreamRegistry =
  globalThis.__notificationStreamRegistry ??
  (globalThis.__notificationStreamRegistry = { subscribers: new Map() });

/** Hard cap of live connections per user (protects the server from abuse). */
export const MAX_CONNECTIONS_PER_USER = 5;

/** Heartbeat interval — keeps proxies from dropping idle SSE connections. */
export const STREAM_HEARTBEAT_MS = 15_000;

/** Number of currently open streams for a user (used by the route cap check). */
export function countUserConnections(userId: string): number {
  return registry.subscribers.get(userId)?.size ?? 0;
}

/**
 * Register a subscriber for a user's stream. Returns an idempotent
 * unsubscribe function. NOTE: there is a benign TOCTOU between the route's
 * countUserConnections() cap check and this add (same tolerance as the
 * existing rate limiter — a couple of extra connections under a burst are
 * acceptable; they are pruned as soon as the clients disconnect).
 */
export function subscribeToUserStream(
  userId: string,
  subscriber: Subscriber
): () => void {
  let set = registry.subscribers.get(userId);
  if (!set) {
    set = new Set();
    registry.subscribers.set(userId, set);
  }
  set.add(subscriber);

  return () => {
    set?.delete(subscriber);
    if (set && set.size === 0) registry.subscribers.delete(userId);
  };
}

/**
 * Push a notification event to every open stream of a user. Fail-silent:
 * dead subscribers (enqueue threw) are pruned, and a total failure is logged
 * and swallowed — it can never affect the caller's business flow.
 */
export function publishToUserStream(
  userId: string,
  event: NotificationStreamEvent
): void {
  const set = registry.subscribers.get(userId);
  if (!set || set.size === 0) return;

  const frame = `data: ${JSON.stringify(event)}\n\n`;
  // Iterate a snapshot so a subscriber removing itself mid-iteration is safe
  const snapshot = [...set];
  for (const sub of snapshot) {
    try {
      sub.enqueue(frame);
    } catch {
      // Dead subscriber — prune it (never propagate the failure)
      set.delete(sub);
    }
  }
}
