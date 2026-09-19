import mongoose from "mongoose";

/**
 * Session 90 — Business-SMS log (Phase 1a).
 *
 * One immutable row per manual business-SMS send attempt (the actor is always
 * an admin — see /api/admin/sms/send). Records the FINAL outcome of the
 * attempt (`sent` / `failed` + error info) rather than a queued state — the
 * row is written AFTER the provider call returns, so there is never a
 * dangling "queued" row when the process dies mid-send. Order-event
 * automation is a later phase; when it arrives it can reuse this model
 * as-is (actor may be null for system sends).
 *
 * PRIVACY/SAFETY notes:
 *   - `message` stores the FINAL rendered text. This module has NO OTP
 *     semantics — plaintext OTP codes are never persisted here (OTP codes
 *     live only in src/lib/otp.ts's hashed OtpCode flow).
 *   - No TTL index: the log is an audit record and is never auto-deleted.
 *   - No unique dedupe key in Phase 1: sends are explicit manual admin
 *     actions, so duplicates are intentional retries, not bugs. Order-event
 *     dedupe (if ever needed) belongs to the later automation phase.
 */
const SmsLogSchema = new mongoose.Schema(
  {
    // Canonical 09xxxxxxxxx recipient (normalized by the API layer).
    recipient: {
      type: String,
      required: true,
      trim: true,
    },
    // Optional linked user (e.g. the customer the order belongs to).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Optional linked order (manual sends may reference an order context).
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    // Optional linked template (null for free-form custom sends without one).
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SmsTemplate",
      default: null,
    },
    // Snapshot of the template name at send time (survives template deletion).
    templateName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100,
    },
    // Business message type — mirrors SmsTemplate.type ("custom" for
    // free-form sends that bypass templates).
    messageType: {
      type: String,
      enum: [
        "order_confirmation",
        "shipping_update",
        "tracking_code",
        "delivery_followup",
        "custom",
      ],
      required: true,
      default: "custom",
    },
    // Provider that attempted delivery ("mock" in dev/CI, "smsir" later,
    // "none" when unconfigured → row still recorded with status failed).
    provider: {
      type: String,
      enum: ["mock", "smsir", "none"],
      required: true,
    },
    // Provider message id on success ("" when the provider returns none).
    providerMessageId: {
      type: String,
      default: "",
      maxlength: 64,
    },
    // Final outcome of the attempt.
    status: {
      type: String,
      enum: ["sent", "failed"],
      required: true,
    },
    // Controlled error code from the business-SMS service
    // (SMS_BUSINESS_NOT_CONFIGURED / SMS_BUSINESS_API_ERROR / NETWORK_ERROR /
    // TEMPLATE_INACTIVE / VALIDATION_ERROR) + a short human-readable note.
    error: {
      type: String,
      default: "",
      maxlength: 64,
    },
    errorMessage: {
      type: String,
      default: "",
      maxlength: 300,
    },
    // Final rendered message text (audit copy — never contains OTP codes).
    message: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    // When the provider call completed (sent OR failed).
    sentAt: {
      type: Date,
      default: null,
    },
    // Audit — the admin actor who triggered the send (null for future
    // system-triggered sends).
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Admin logs list: newest first, filterable by status/type/recipient.
SmsLogSchema.index({ createdAt: -1 });
SmsLogSchema.index({ status: 1, createdAt: -1 });
SmsLogSchema.index({ messageType: 1, createdAt: -1 });
SmsLogSchema.index({ recipient: 1, createdAt: -1 });
SmsLogSchema.index({ template: 1 });

export default mongoose.models.SmsLog ||
  mongoose.model("SmsLog", SmsLogSchema);
