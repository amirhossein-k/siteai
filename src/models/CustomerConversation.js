import mongoose from "mongoose";

/**
 * CustomerConversation (Session 68) — order-linked customer support threads.
 *
 * DESIGN (approved Session 68):
 *  - One conversation per (customer × SupplierOrder): the supplierOrder ref is
 *    the ISOLATION ANCHOR — a conversation belongs to exactly ONE supplier, so
 *    cross-supplier leakage is structurally impossible (a supplier's list
 *    query is { supplier: ownId } and detail re-verifies server-side).
 *  - Eligibility: the linked order must be genuinely purchased
 *    (payment.status ∈ [paid, refunded]) — validated server-side at creation.
 *  - Status machine: open → pending (staff replied, awaiting customer) →
 *    resolved/closed; customer replies auto-reopen from resolved; closed is
 *    message-immutable until reopened. Transitions enforced by the pure
 *    canTransit() helper in src/lib/conversations.ts.
 *  - Unread (v1): conversation-level customerUnread / staffUnread booleans
 *    flipped on detail GET by the respective side (staff = admin OR the
 *    conversation's supplier). Per-message read receipts are future scope.
 *  - Messages are EMBEDDED (v1 — no attachments; bounded by MESSAGE_MAX in
 *    src/lib/conversations.ts and the 16MB doc limit; a message cap is future
 *    scope). senderRole is server-derived from the authenticated session,
 *    NEVER from the request body.
 */
const ConversationMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Server-derived role of the message author (session, never body).
    senderRole: {
      type: String,
      enum: ["customer", "admin", "supplier"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

const CustomerConversationSchema = new mongoose.Schema(
  {
    // Conversation owner (the customer).
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Linked order — ownership + purchase proof.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    // THE isolation anchor: the specific supplier fulfillment this thread
    // covers. Unique partial index below → one ACTIVE conversation per
    // supplier order (resolved/closed frees the slot for a new thread).
    supplierOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierOrder",
      required: true,
    },
    // Denormalized from supplierOrder.supplier at creation (single write path).
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    // Optional item-specific subject (must belong to the supplier order's items).
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    category: {
      type: String,
      enum: ["general", "order", "delivery", "product", "refund"],
      default: "general",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    // open: awaiting staff · pending: awaiting the customer · resolved ·
    // closed (message-immutable until reopened).
    status: {
      type: String,
      enum: ["open", "pending", "resolved", "closed"],
      default: "open",
    },
    customerUnread: {
      type: Boolean,
      default: false,
    },
    staffUnread: {
      type: Boolean,
      default: false,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    // Denormalized last-message preview for list rendering (no message load).
    lastMessagePreview: {
      type: String,
      default: "",
      maxlength: 120,
    },
    lastMessageFrom: {
      type: String,
      enum: ["customer", "admin", "supplier"],
      default: "customer",
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    messages: {
      type: [ConversationMessageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Customer inbox (newest activity first)
CustomerConversationSchema.index({ customer: 1, lastMessageAt: -1 });
// Supplier inbox (their own conversations only)
CustomerConversationSchema.index({ supplier: 1, lastMessageAt: -1 });
// Admin queue (status filter + activity order)
CustomerConversationSchema.index({ status: 1, lastMessageAt: -1 });
// One ACTIVE conversation per supplier order (E11000 → 409). Resolved/closed
// rows fall outside the partial filter, so a new thread may be opened for the
// same fulfillment after the previous one was concluded.
CustomerConversationSchema.index(
  { supplierOrder: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["open", "pending"] } },
  }
);

export default mongoose.models.CustomerConversation ||
  mongoose.model("CustomerConversation", CustomerConversationSchema);
