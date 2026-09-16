import { describe, expect, it } from "vitest";
import {
  buildHealthPayload,
  healthStatusCode,
  isHealthy,
  type DbReadiness,
} from "@/lib/health";

/**
 * Session 89 — the /api/health readiness contract.
 *
 * These guard the two things that matter for a probe: the status code must
 * never claim health it cannot back (a false 200 keeps a broken instance in a
 * load-balancer rotation), and the payload must stay free of secrets.
 */
describe("healthStatusCode", () => {
  it("returns 200 only when the database is up", () => {
    expect(healthStatusCode("up")).toBe(200);
    expect(healthStatusCode("down")).toBe(503);
  });

  it("agrees with isHealthy for every readiness value", () => {
    const values: DbReadiness[] = ["up", "down"];
    for (const db of values) {
      expect(isHealthy(db)).toBe(db === "up");
      expect(healthStatusCode(db) === 200).toBe(isHealthy(db));
    }
  });
});

describe("buildHealthPayload", () => {
  it("reports ok/up with the probe metrics when the database is reachable", () => {
    const payload = buildHealthPayload({
      db: "up",
      latencyMs: 7,
      uptimeSeconds: 42,
      timestamp: "2026-09-16T00:00:00.000Z",
    });

    expect(payload).toEqual({
      status: "ok",
      db: "up",
      latencyMs: 7,
      uptimeSeconds: 42,
      timestamp: "2026-09-16T00:00:00.000Z",
    });
  });

  it("reports degraded/down when the database is unreachable", () => {
    const payload = buildHealthPayload({
      db: "down",
      latencyMs: 4001,
      uptimeSeconds: 3,
      timestamp: "2026-09-16T00:00:00.000Z",
    });

    expect(payload.status).toBe("degraded");
    expect(payload.db).toBe("down");
    expect(payload.latencyMs).toBe(4001);
  });

  it("always sets the status from db, never independently", () => {
    expect(buildHealthPayload({ db: "up", latencyMs: 0, uptimeSeconds: 0 }).status).toBe("ok");
    expect(buildHealthPayload({ db: "down", latencyMs: 0, uptimeSeconds: 0 }).status).toBe(
      "degraded"
    );
  });

  it("normalizes odd metric values instead of emitting them", () => {
    const payload = buildHealthPayload({
      db: "up",
      latencyMs: 12.6,
      uptimeSeconds: -3,
    });

    expect(payload.latencyMs).toBe(13);
    expect(payload.uptimeSeconds).toBe(0);
  });

  it("derives a current ISO timestamp when none is injected", () => {
    const payload = buildHealthPayload({ db: "up", latencyMs: 1, uptimeSeconds: 1 });
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it("exposes an exact, closed set of fields (no secret can leak through)", () => {
    const payload = buildHealthPayload({ db: "up", latencyMs: 1, uptimeSeconds: 1 });
    expect(Object.keys(payload).sort()).toEqual([
      "db",
      "latencyMs",
      "status",
      "timestamp",
      "uptimeSeconds",
    ]);
    // The payload is a public surface: it must not carry the connection
    // string, its host, or any env value.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(serialized).not.toContain("marlooai");
  });
});
