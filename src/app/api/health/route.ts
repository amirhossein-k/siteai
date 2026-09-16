import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/dbConnect";
import {
  buildHealthPayload,
  healthStatusCode,
  type DbReadiness,
} from "@/lib/health";

/**
 * Liveness / readiness probe (Session 89 — production readiness).
 *
 * - Public: no authentication, no rate limit (a probe must never be throttled).
 * - Non-mutating: the only query issued is the MongoDB `ping` command.
 * - Cheap: one bounded round-trip, no collection reads.
 * - Honest: 200 only when the database is actually reachable, otherwise 503.
 *
 * Deployed behind a load balancer / uptime monitor, this is the endpoint that
 * answers "is this instance able to serve traffic right now?".
 */

// Never prerender or cache: the answer must describe THIS process and its
// database at request time. `force-dynamic` also keeps the handler from being
// invoked during `next build` (which would attempt a connection at build time).
export const dynamic = "force-dynamic";

/**
 * Upper bound for the readiness probe. `dbConnect()` uses the driver's default
 * `serverSelectionTimeoutMS` (30s); a monitor must get an answer well before
 * that, so the connection attempt is raced against this budget and the probe
 * reports "down" instead of hanging the health check open.
 */
const READINESS_TIMEOUT_MS = 4000;

async function probeDatabase(): Promise<DbReadiness> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("readiness probe timed out")),
      READINESS_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([dbConnect(), budget]);

    const conn = mongoose.connection;
    if (conn.readyState !== 1 || !conn.db) return "down";

    // `ping` is the cheapest server round-trip and never touches data.
    await Promise.race([conn.db.admin().command({ ping: 1 }), budget]);
    return "up";
  } catch {
    // Swallow — and never log — the driver error: it can embed the connection
    // string, and this endpoint is public. The body carries no error detail.
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const startedAt = Date.now();
  const db = await probeDatabase();

  return NextResponse.json(
    buildHealthPayload({
      db,
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: process.uptime(),
    }),
    {
      status: healthStatusCode(db),
      headers: { "Cache-Control": "no-store" },
    }
  );
}
