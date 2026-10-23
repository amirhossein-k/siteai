import mongoose from "mongoose";

/**
 * Session 90 — Admin business-SMS template (Phase 1a).
 *
 * A reusable, admin-managed SMS template for BUSINESS messages (order
 * confirmations, shipping updates, tracking codes, delivery follow-ups and
 * custom notices). Completely independent from the OTP flow:
 *   - OTP delivery lives in src/lib/sms.ts (sendOtp) and its template is the
 *     SMS.ir dashboard template referenced by SMS_IR_TEMPLATE_ID. That config
 *     is NEVER read here.
 *   - A business template stores its OWN SMS.ir pattern ID
 *     (`providerTemplateId`) — registered later in the SMS.ir dashboard and
 *     entered by an admin. In Phase 1 the system is MOCK-FIRST, so
 *     `providerTemplateId` may legitimately stay empty until the real
 *     business patterns are provisioned (a later phase).
 *   - `body` holds the human-readable text with {{variable}} placeholders for
 *     preview + mock rendering. It is also what the manual-send UI previews.
 *
 * Model conventions mirror SupplierApplication/Notification: trimmed strings,
 * explicit enums, `timestamps: true`, safe `mongoose.models.X ||` registration.
 */
const SmsTemplateSchema = new mongoose.Schema(
  {
    // Unique human-readable name (unique index below → 409 on duplicates).
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    // Business message category — drives the logs filter and future
    // order-event automation (explicitly OUT of Phase 1 scope).
    type: {
      type: String,
      enum: [
        "order_confirmation", // تأیید سفارش
        "shipping_update", // اطلاع ارسال سفارش
        "tracking_code", // کد رهگیری مرسوله
        "delivery_followup", // تحویل + درخواست دیدگاه
        "custom", // پیام دستی/سفارشی
      ],
      required: true,
      default: "custom",
    },
    // The SMS.ir pattern/template ID for THIS template (dashboard-registered).
    // Empty string while the system runs mock-first — only the smsir provider
    // requires it (digits only; validated at the API layer and re-checked at
    // send time). Never sourced from a request body at send time.
    providerTemplateId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 12,
    },
    // Provider-side review status of the linked SMS.ir template.
    // Independent from local `isActive`. Set only by link-provider /
    // verify-provider (read-only GET /v1/templates/:id). Never changed by
    // network errors / timeouts / malformed responses.
    providerStatus: {
      type: String,
      enum: ["not_submitted", "pending", "approved", "rejected", "not_found"],
      default: "not_submitted",
    },
    // Timestamp of the last *successful* provider verification that yielded
    // a conclusive template status (1/2/3/404/113). Unchanged on network
    // errors, timeouts, malformed responses, or HTTP 5xx.
    providerVerifiedAt: {
      type: Date,
      default: null,
    },
    // Timestamp of the last *successful* provider check (same semantics as
    // providerVerifiedAt — only updated on conclusive provider responses).
    providerLastCheckedAt: {
      type: Date,
      default: null,
    },
    // Description of the last provider check failure (network / timeout /
    // malformed / 5xx). Preserved independently of providerStatus — never
    // replaces the template status.
    providerLastCheckError: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
    // Provider rejection reason when providerStatus === "rejected".
    providerRejectionReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
    // Declared variable names (e.g. ["orderNo", "customerName"]). A send must
    // provide EXACTLY these keys — no missing, no extra (fail-closed).
    variables: {
      type: [String],
      default: [],
    },
    // Renderable text with {{variable}} placeholders (≤500 chars — SMS.ir
    // pattern bodies are bounded too). Used for preview + mock rendering;
    // the smsir provider sends declared parameters against the pattern ID.
    body: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Audit — the admin actor who created/last edited the template.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// One template per name (E11000 → mapped to 409 by the API route).
SmsTemplateSchema.index({ name: 1 }, { unique: true });
// Admin list filter: by type, active-first.
SmsTemplateSchema.index({ type: 1, isActive: 1 });

export default mongoose.models.SmsTemplate ||
  mongoose.model("SmsTemplate", SmsTemplateSchema);
