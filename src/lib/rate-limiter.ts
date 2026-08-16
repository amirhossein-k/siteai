/**
 * Reusable Rate Limiter
 *
 * Uses MongoDB as a distributed rate-limit store (compatible with the
 * project's existing database). Each limit is a simple TTL document:
 *   { _id: "rl:<key>", count: <number>, expiresAt: <Date> }
 *
 * The TTL index on `expiresAt` auto-cleans expired documents.
 *
 * Usage:
 *   import { rateLimit } from "@/lib/rate-limiter";
 *
 *   const result = await rateLimit("login:09120000000", { max: 5, windowMs: 60000 });
 *   if (result.limited) {
 *     return NextResponse.json(
 *       { error: "تلاش‌های زیادی انجام شده. لطفاً بعداً تلاش کنید." },
 *       { status: 429, headers: result.headers }
 *     );
 *   }
 */

import { dbConnect } from "@/lib/dbConnect";
import mongoose from "mongoose";

// ============================================================
// Rate Limit Model (lazy singleton)
// ============================================================

const getRateLimitModel = () => {
  const schema = new mongoose.Schema(
    {
      _id: { type: String }, // "rl:<key>"
      count: { type: Number, default: 1 },
      expiresAt: { type: Date, required: true },
    },
    { _id: false, timestamps: false }
  );

  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  return (
    (mongoose.models.RateLimit as mongoose.Model<{
      _id: string;
      count: number;
      expiresAt: Date;
    }>) ||
    mongoose.model("RateLimit", schema)
  );
};

// ============================================================
// Types
// ============================================================

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetInMs: number;
  /** Headers to set on the response */
  headers: Record<string, string>;
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

// ============================================================
// Defaults
// ============================================================

/** Login: 10 attempts per 15 minutes */
export const LOGIN_LIMIT: RateLimitConfig = {
  max: 10,
  windowMs: 15 * 60 * 1000,
};

/** Register: 5 attempts per 15 minutes */
export const REGISTER_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** OTP request: 5 per phone per 15 minutes (Session 62 — SMS code requests). */
export const OTP_REQUEST_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** OTP request: 15 per IP per 15 minutes — SMS-bombing guard. */
export const OTP_REQUEST_IP_LIMIT: RateLimitConfig = {
  max: 15,
  windowMs: 15 * 60 * 1000,
};

/** OTP verify: 5 attempts per phone per 15 minutes — brute-force guard. */
export const OTP_VERIFY_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** Password-reset completion: 5 per phone per 15 minutes (Session 84). */
export const PASSWORD_RESET_COMPLETE_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** Password change: 5 attempts per user per 15 minutes (Session 64). */
export const CHANGE_PASSWORD_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** Logout-all: 10 per user per 15 minutes — deliberate action (Session 64). */
export const LOGOUT_ALL_LIMIT: RateLimitConfig = {
  max: 10,
  windowMs: 15 * 60 * 1000,
};

/** Admin session revoke: 30 per admin actor per 15 minutes (Session 64). */
export const REVOKE_SESSION_LIMIT: RateLimitConfig = {
  max: 30,
  windowMs: 15 * 60 * 1000,
};

/** Supplier application submit: 2 per user per 15 minutes (Session 67). */
export const SUPPLIER_APPLICATION_LIMIT: RateLimitConfig = {
  max: 2,
  windowMs: 15 * 60 * 1000,
};

/** Supplier application submit: 5 per IP per 15 minutes — spam guard (Session 67). */
export const SUPPLIER_APPLICATION_IP_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** Admin application decision: 30 per admin actor per 15 minutes (Session 67). */
export const SUPPLIER_APPLICATION_DECISION_LIMIT: RateLimitConfig = {
  max: 30,
  windowMs: 15 * 60 * 1000,
};

/** Support conversation create: 5 per user per 15 minutes (Session 68). */
export const CONVERSATION_CREATE_LIMIT: RateLimitConfig = {
  max: 5,
  windowMs: 15 * 60 * 1000,
};

/** Support message send: 15 per actor per 15 minutes — spam guard (Session 68). */
export const CONVERSATION_MESSAGE_LIMIT: RateLimitConfig = {
  max: 15,
  windowMs: 15 * 60 * 1000,
};

/** Admin report export: 10 per admin per 15 minutes — expensive downloads (Session 81). */
export const REPORT_EXPORT_LIMIT: RateLimitConfig = {
  max: 10,
  windowMs: 15 * 60 * 1000,
};

/** Admin accounting-config writes: 30 per actor per 15 minutes (Session 82). */
export const ACCOUNTING_CONFIG_LIMIT: RateLimitConfig = {
  max: 30,
  windowMs: 15 * 60 * 1000,
};

/** Accounting initialization: 3 per actor per 15 minutes — one-shot financial event (Session 82). */
export const ACCOUNTING_INIT_LIMIT: RateLimitConfig = {
  max: 3,
  windowMs: 15 * 60 * 1000,
};

/** Purchase writes (create/update/receive/pay/cancel): 60 per actor per 15 minutes (Session 82 Phase B). */
export const PURCHASE_WRITE_LIMIT: RateLimitConfig = {
  max: 60,
  windowMs: 15 * 60 * 1000,
};

/** Inventory adjustments: 30 per actor per 15 minutes (Session 82 Phase D). */
export const INVENTORY_WRITE_LIMIT: RateLimitConfig = {
  max: 30,
  windowMs: 15 * 60 * 1000,
};

/** Expense writes (create/update/pay/void): 60 per actor per 15 minutes (Session 82 Phase E). */
export const EXPENSE_WRITE_LIMIT: RateLimitConfig = {
  max: 60,
  windowMs: 15 * 60 * 1000,
};

// ============================================================
// Core
// ============================================================

/**
 * Check and increment the rate limit counter for a given key.
 *
 * The key should be namespaced, e.g. `"login:09120000000"` or
 * `"register:ip:192.168.1.1"`.
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig = LOGIN_LIMIT
): Promise<RateLimitResult> {
  await dbConnect();

  const model = getRateLimitModel();
  const docId = `rl:${key}`;
  const now = new Date();

  // Use findOneAndUpdate with upsert to atomically create or update.
  // The `$inc` increments count only if the document already exists
  // (i.e., the window has been started). We use a two-phase approach
  // to avoid creating a new document with the wrong expiresAt on every update.
  let doc = await model.findById(docId).lean();

  if (!doc) {
    // First request in this window — create the document. Two concurrent
    // first-requests can race this find-then-create (both see no doc and
    // both attempt the insert): the loser hits the _id unique-index E11000
    // and must NOT 500. It re-reads the winner's document and falls through
    // to the normal increment path below, so it is COUNTED exactly like a
    // sequential request (no budget bypass — the DB count ends up equal to
    // the number of admitted requests).
    const expiresAt = new Date(now.getTime() + config.windowMs);
    try {
      await model.create({
        _id: docId,
        count: 1,
        expiresAt,
      });
    } catch (err) {
      if ((err as { code?: number })?.code !== 11000) throw err;
      doc = await model.findById(docId).lean();
    }

    if (!doc) {
      // Genuine first request — this create won the race: fresh window.
      return {
        limited: false,
        remaining: config.max - 1,
        resetInMs: config.windowMs,
        headers: {
          "X-RateLimit-Limit": String(config.max),
          "X-RateLimit-Remaining": String(config.max - 1),
          "X-RateLimit-Reset": String(Math.ceil(expiresAt.getTime() / 1000)),
        },
      };
    }
  }

  // If the window has expired, reset
  if (doc.expiresAt <= now) {
    const expiresAt = new Date(now.getTime() + config.windowMs);
    await model.findByIdAndUpdate(docId, {
      $set: { count: 1, expiresAt },
    });

    return {
      limited: false,
      remaining: config.max - 1,
      resetInMs: config.windowMs,
      headers: {
        "X-RateLimit-Limit": String(config.max),
        "X-RateLimit-Remaining": String(config.max - 1),
        "X-RateLimit-Reset": String(Math.ceil(expiresAt.getTime() / 1000)),
      },
    };
  }

  // Window is still active — increment
  const newCount = doc.count + 1;
  await model.findByIdAndUpdate(docId, { $inc: { count: 1 } });

  const limited = newCount > config.max;
  const remaining = Math.max(0, config.max - newCount);

  return {
    limited,
    remaining,
    resetInMs: Math.max(0, doc.expiresAt.getTime() - now.getTime()),
    headers: {
      "X-RateLimit-Limit": String(config.max),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(Math.ceil(doc.expiresAt.getTime() / 1000)),
      ...(limited ? { "Retry-After": String(Math.ceil((doc.expiresAt.getTime() - now.getTime()) / 1000)) } : {}),
    },
  };
}