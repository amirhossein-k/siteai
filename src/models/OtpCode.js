import mongoose from "mongoose";

/**
 * Session 62 — OTP (One-Time Password) records for SMS login/registration.
 *
 * Lifecycle:
 *   1. POST /api/auth/otp/request creates a row for a phone+purpose with the
 *      SHA-256 `codeHash` only (the plaintext is NEVER stored in production).
 *   2. POST /api/auth/otp/verify finds the latest unconsumed row; on a correct
 *      code it consumes the row AND attaches a one-time `loginTokenHash`
 *      (TTL-aligned with the code expiry) and returns the plaintext token to
 *      the client.
 *   3. The client exchanges the token through the NextAuth CredentialsProvider
 *      (authorize loginToken branch) — the row is atomically consumed there
 *      too, so a token can NEVER be used twice (replay-proof).
 *
 * `devPlaintextCode` is set ONLY when the SMS_MOCK dev seam is active
 * (NODE_ENV=development AND SMS_MOCK=1) so the E2E/verify suites can read the
 * code back via GET /api/auth/otp/dev-last. In every other environment it is
 * null and the endpoint 404s.
 *
 * The TTL index on `expiresAt` auto-deletes expired rows (2-minute lifetime).
 */
const OtpCodeSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ["login", "register"],
      required: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    /**
     * The CODE is single-use: set on a successful verify AND on the
     * attempt-lock. The row then carries only the login-token payload.
     */
    codeConsumedAt: {
      type: Date,
      default: null,
    },
    /**
     * The one-time LOGIN-TOKEN exchange: set ONLY by authorize() when the
     * token is redeemed. Kept separate from codeConsumedAt so the verify
     * step (code) and the exchange step (token) are each single-use.
     */
    consumedAt: {
      type: Date,
      default: null,
    },
    /** Set after a successful verify — the one-time login-token hash. */
    loginTokenHash: {
      type: String,
      default: null,
    },
    /** Mirrors the code-row expiry so the token and the row die together. */
    loginTokenExpiresAt: {
      type: Date,
      default: null,
    },
    /** DEV/MOCK ONLY — plaintext code for the SMS_MOCK seam. null elsewhere. */
    devPlaintextCode: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

OtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.OtpCode || mongoose.model("OtpCode", OtpCodeSchema);
