import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/auth-utils";
import {
  subscribeToUserStream,
  countUserConnections,
  MAX_CONNECTIONS_PER_USER,
  STREAM_HEARTBEAT_MS,
} from "@/lib/notification-stream";

/**
 * GET /api/notifications/stream — Server-Sent Events (Session 40)
 *
 * Real-time push layer on top of the Session 36 in-app Notification system.
 *
 * Invariants preserved:
 *  - Authenticated + OWNER-SCOPED: the stream is registered under token.id
 *    and only notifyOrderEvent() (the single facade) publishes to that user —
 *    a subscriber can never receive another user's events.
 *  - The MongoDB write is the source of truth. The stream is a delivery hint:
 *    the client invalidates its React Query cache on receipt and refetches
 *    the authoritative inbox. The existing 30s polling stays as fallback, so
 *    even a dropped stream degrades gracefully.
 *  - FAIL-SILENT by design: pushing to a dead controller is swallowed by the
 *    registry; the route only ever returns an SSE response or a 401/429.
 *  - GET-only (no state change) → no CSRF surface; cookies are sent
 *    same-origin by EventSource, so requireAuth works without tokens in URLs.
 *
 * Connection lifecycle:
 *  - Connection cap per user (MAX_CONNECTIONS_PER_USER → 429 when exceeded).
 *  - Heartbeat comment every STREAM_HEARTBEAT_MS keeps proxies from dropping
 *    idle connections and lets dead clients be detected.
 *  - Cleanup happens on client abort (req.signal) AND on stream cancel —
 *    both call the same idempotent unregister, so no leaked subscriptions.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  // Connection cap — cheap pre-check (benign TOCTOU, same tolerance as the
  // rate limiter; the registry also prunes dead subscribers on publish).
  if (countUserConnections(token.id) >= MAX_CONNECTIONS_PER_USER) {
    return NextResponse.json(
      { error: "تعداد اتصالات زنده زیاد است" },
      { status: 429 }
    );
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const unregister = subscribeToUserStream(token.id, {
        enqueue: (frame: string) => {
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // Controller closed (client gone) — the cancel/abort path will
            // unregister; ignore the failed write.
          }
        },
      });

      // Single idempotent teardown — called by BOTH the client-abort signal
      // and the stream cancel() callback, whichever fires first. Guarantees
      // the heartbeat interval never leaks when cancel() runs without abort
      // (and vice versa); clearInterval on an already-cleared timer is a no-op.
      cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unregister();
      };

      // Initial comment — flushes headers so the client sees the stream open
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
      } catch {
        /* client disconnected immediately */
      }

      // Heartbeat — keeps proxies from killing the idle connection and gives
      // the client a liveness signal.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // Dead connection — tear down now instead of waiting for the next
          // tick (enqueue will keep failing otherwise).
          cleanup?.();
        }
      }, STREAM_HEARTBEAT_MS);

      // Client disconnect → full teardown.
      req.signal.addEventListener("abort", () => cleanup?.(), { once: true });
    },
    cancel() {
      // Stream cancelled by the runtime — same idempotent teardown.
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
