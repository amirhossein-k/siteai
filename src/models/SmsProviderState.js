import mongoose from "mongoose";

/**
 * Phase 1 — Durable SMS.ir provider synchronization state.
 *
 * A SINGLE document (fixed _id "smsir") records the last read-only provider
 * probe (credit + lines) and the last provider error, so the admin dashboard
 * can display "last successful synchronization" and "last synchronization
 * error" honestly and persistently (never fabricated):
 *   - `lastSyncAt` is set ONLY after a probe that reached the provider;
 *   - `lastError` stores a stable taxonomy code + bounded Persian summary —
 *     NEVER the API key or a raw provider body;
 *   - `credit`/`lines` snapshots store the provider-confirmed values only
 *     when the provider actually returned them (missing = not probed yet).
 *
 * No TTL, one row, upserted on every probe. Monotonic fields only — nothing
 * destructive is ever renamed (Phase 2 may extend, not rewrite).
 */
const SmsProviderStateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true, default: "smsir" },
    lastSyncAt: { type: Date, default: null },
    lastSyncOk: { type: Boolean, default: null },
    credit: {
      value: { type: Number, default: null },
      syncedAt: { type: Date, default: null },
    },
    lines: {
      lineNumbers: { type: [String], default: [] },
      syncedAt: { type: Date, default: null },
    },
    lastError: {
      kind: { type: String, maxlength: 64, default: null },
      messageFa: { type: String, maxlength: 300, default: "" },
      httpStatus: { type: Number, default: null },
      providerStatus: { type: Number, default: null },
      providerMessage: { type: String, maxlength: 200, default: "" },
      at: { type: Date, default: null },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.SmsProviderState ||
  mongoose.model("SmsProviderState", SmsProviderStateSchema);
