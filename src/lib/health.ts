/**
 * Health / readiness contract (Session 89 — production readiness).
 *
 * The single source of truth for the `/api/health` payload. Kept in `src/lib`
 * (not in the route file) for two reasons: Next.js route handlers may only
 * export HTTP methods + reserved config, and a pure builder can be unit-tested
 * without a database or an HTTP server.
 *
 * SECURITY: this endpoint is public and unauthenticated, so the payload is
 * deliberately limited to non-sensitive operational facts. It NEVER includes
 * the Mongo URI, its host, the database name, credentials, environment
 * variable values, build numbers or error messages (a driver error can embed
 * the connection string).
 */

/** Readiness of the backing datastore. */
export type DbReadiness = "up" | "down";

/** Overall service status. */
export type HealthStatus = "ok" | "degraded";

export interface HealthPayload {
  status: HealthStatus;
  db: DbReadiness;
  /** Process uptime in seconds (coarse). */
  uptimeSeconds: number;
  /** Duration of the readiness probe itself, in milliseconds. */
  latencyMs: number;
  /** ISO-8601 timestamp of the probe. */
  timestamp: string;
}

/** The service is ready only when the database is reachable. */
export function isHealthy(db: DbReadiness): boolean {
  return db === "up";
}

/**
 * 200 when ready, 503 when not — a probe must never return a false 200, or a
 * load balancer keeps routing traffic to an instance that cannot serve it.
 */
export function healthStatusCode(db: DbReadiness): number {
  return isHealthy(db) ? 200 : 503;
}

export function buildHealthPayload(input: {
  db: DbReadiness;
  latencyMs: number;
  uptimeSeconds: number;
  /** Injectable for deterministic tests. */
  timestamp?: string;
}): HealthPayload {
  return {
    status: isHealthy(input.db) ? "ok" : "degraded",
    db: input.db,
    // Coerce defensively: a clock/uptime oddity must not emit -0.4 seconds.
    uptimeSeconds: Math.max(0, Math.floor(input.uptimeSeconds)),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
