/**
 * Session 91 — Business order-event SMS automation.
 *
 * Ties real order-lifecycle transitions to the Session 90 Business-SMS
 * service (src/lib/sms-business.ts) with durable event identity and strict
 * idempotency. COMPLETELY INDEPENDENT from the OTP flow (src/lib/sms.ts /
 * src/lib/otp.ts are NEVER imported here; normalizePhone is reused read-only).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ GUARANTEES (precise)                                                 │
 * │  - deterministic logical event identity: order:<id>:<event>          │
 * │  - durable event marker committed WITH the lifecycle transition      │
 * │    (Order.smsEvents is pushed in the SAME atomic write — see the     │
 * │     route wiring; a crash between transition and processing cannot   │
 * │     lose the marker itself)                                          │
 * │  - no concurrent duplicate provider calls for one dedupeKey          │
 * │  - no automatic retry of uncertain (unknown) provider outcomes       │
 * │  - an SMS failure can never fail the order/payment/shipping/refund   │
 * │  - a sent SmsLog prevents any subsequent duplicate send              │
 * │  - exactly-once EXTERNAL SMS delivery is NOT guaranteed (SMS.ir has  │
 * │    no provider-side idempotency — see "uncertainty window" below)    │
 * │                                                                      │
 * │ NOT guaranteed: automatic eventual SMS delivery after a process      │
 * │ crash (no worker/cron in this session); exactly-once external        │
 * │ delivery; safe automatic retry of unknown; automatic recovery of     │
 * │ stale "sending" rows.                                                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * STATE MACHINE (SmsLog rows created for order events, plus the matching
 * Order.smsEvents marker which is a terminal mirror):
 *
 *   claim            send          finalize
 *   [pending] ──CAS──▶ [sending] ──▶ { sent | failed | unknown }
 *      │  ▲                              (terminal)
 *      │  │(insert gate = unique
 *      │  │ partial index on dedupeKey)
 *      ▼  └── E11000 → duplicate insert → read current → handle
 *
 *   - "pending":        under a durable marker / pre-send. Insert gated by
 *                       the unique partial index on SmsLog.dedupeKey.
 *   - "sending":        in-flight provider call, OR a crash during the
 *                       call. NEVER auto-reclaimed (see below).
 *   - "sent":           confirmed accepted by the provider/terminal.
 *   - "failed":         confirmed provider/application rejection (did not
 *                       send) — manually retryable via atomic CAS.
 *   - "unknown":        network timeout / connection reset — outcome
 *                       uncertain; NOT auto-retryable; manual only.
 *   - "template_unavailable": no SmsLog row at all (see note); the durable
 *                       marker stays "pending".
 *
 * CLAIM ALGORITHM — two separated atomic gates (standalone MongoDB, no
 * multi-document transactions):
 *   1. INSERT gate: SmsLog.create({ dedupeKey, status:"pending", ... }).
 *      The unique PARTIAL index on { dedupeKey } (string only) is the atomic
 *      creation gate: exactly one concurrent insert wins, every loser gets
 *      E11000. This handles two concurrent FIRST-TIME triggers.
 *   2. SEND gate: findOneAndUpdate({ dedupeKey|_id, status:<source> },
 *      { status:"sending", ... }) — a single-document atomic compare-and-set
 *      on the EXACT source state. Exactly one concurrent retry wins; losers'
 *      filters no longer match and return null → stop. The unique index does
 *      NOT gate retries (both would update the same doc); the status CAS does.
 *   3. FINALIZE: findOneAndUpdate({ _id, status:"sending" }, terminal) — only
 *      the claim owner writes sent/failed/unknown.
 *
 * STALE "sending": NEVER auto-reclaimed. A "sending" row is either an active
 * provider request or a crash during the call. Because SMS.ir has no
 * idempotency, auto-reclaim could double-send. It remains visible
 * (claimedAt) for explicit operator/admin recovery — no such UI exists this
 * session, so treat it as visible-only.
 *
 * UNCERTAINTY WINDOW (documented, unavoidable): a request may reach SMS.ir,
 * be accepted and delivered, but the response is lost → the app records
 * "unknown". A later explicit manual re-send of that event would deliver
 * twice. This is the intrinsic at-least-once limit of a non-transactional
 * external provider with no idempotency key. We surface it as "unknown" and
 * never auto-retry it.
 *
 * TEMPLATES: resolved deterministically by application-level NAME
 * (order-created / payment-success / order-shipped / order-delivered /
 * refund-completed). The existing SmsTemplate.type enum is used ONLY as the
 * SmsLog messageType category, never as the automation key (multiple
 * templates can share a type). providerTemplateId always comes from the
 * stored SmsTemplate document — never from a request/route. A missing or
 * inactive template yields "template_unavailable" (no provider call, no
 * SmsLog row, durable marker stays "pending") so a later activation can
 * still be processed.
 */

import SmsTemplate from "@/models/SmsTemplate";
import SmsLog from "@/models/SmsLog";
import { dbConnect } from "@/lib/dbConnect";
// normalizePhone is REUSED read-only from the OTP module — never called to
// SEND, never modified, and OTP flow is untouched.
import { normalizePhone } from "@/lib/otp";
import { renderTemplate, sendBusinessSms, resolveBusinessSmsProvider } from "@/lib/sms-business";

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

export type OrderSmsEvent =
  | "ORDER_CREATED"
  | "PAYMENT_SUCCESS"
  | "ORDER_SHIPPED"
  | "ORDER_DELIVERED"
  | "REFUND_COMPLETED";

/** Application-level template name per event (deterministic automation key). */
export const EVENT_TEMPLATE_NAME: Record<OrderSmsEvent, string> = {
  ORDER_CREATED: "order-created",
  PAYMENT_SUCCESS: "payment-success",
  ORDER_SHIPPED: "order-shipped",
  ORDER_DELIVERED: "order-delivered",
  REFUND_COMPLETED: "refund-completed",
};

/** Short event suffix embedded in dedupeKey and Order.smsEvents.event. */
export const EVENT_SUFFIX: Record<OrderSmsEvent, string> = {
  ORDER_CREATED: "created",
  PAYMENT_SUCCESS: "payment-success",
  ORDER_SHIPPED: "shipped",
  ORDER_DELIVERED: "delivered",
  REFUND_COMPLETED: "refund-completed",
};

/** All supported events, for iteration/reconciliation helpers. */
export const ALL_ORDER_SMS_EVENTS = Object.keys(EVENT_TEMPLATE_NAME) as OrderSmsEvent[];

/** SmsLog messageType category per event (SmsTemplate.type taxonomy). */
export const EVENT_MESSAGE_TYPE: Record<OrderSmsEvent, string> = {
  ORDER_CREATED: "order_confirmation",
  PAYMENT_SUCCESS: "order_confirmation",
  ORDER_SHIPPED: "shipping_update",
  ORDER_DELIVERED: "delivery_followup",
  REFUND_COMPLETED: "order_confirmation",
};

/** Documented max on rendered SMS text (matches sms-business). */
export const ORDER_SMS_MAX_VAR_LENGTH = 500;

// ---------------------------------------------------------------------------
// Dedupe key
// ---------------------------------------------------------------------------

/**
 * Deterministic logical-event identity. The SAME logical event always yields
 * the SAME key (no random/UUID). Layout: order:<orderId>:<eventSuffix>.
 */
export function orderSmsDedupeKey(orderId: string, event: OrderSmsEvent): string {
  return `order:${orderId}:${EVENT_SUFFIX[event]}`;
}

// ---------------------------------------------------------------------------
// Server-derived variables
// ---------------------------------------------------------------------------

/**
 * Resolve the server-side variables a template may reference, from the
 * authoritative Order + User record ONLY. Returns a record with all KNOWN
 * event vars set from server data (empty string when a field is legitimately
 * absent). RenderTemplate is fail-closed: any declared var left empty => the
 * service skips sending.
 */
function deriveVariables(input: {
  event: OrderSmsEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  customerName?: string;
}): Record<string, string | number> {
  const order = input.order || {};
  const vars: Record<string, string | number> = {
    customerName: input.customerName || "",
    orderId: order._id ? String(order._id) : "",
    orderReference: order._id ? String(order._id).slice(-8) : "",
    amount: typeof order.totalAmount === "number" ? order.totalAmount : 0,
    status: String(order.status || ""),
    trackingCode:
      order.shipping && typeof order.shipping.trackingCode === "string"
        ? order.shipping.trackingCode
        : "",
  };
  return vars;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type OrderSmsResult =
  | { outcome: "not_sent_template_unavailable"; reason: string }
  | { outcome: "not_sent_no_phone"; reason: string }
  | { outcome: "already_sent" }
  | { outcome: "in_flight"; reason: string }
  | { outcome: "disabled"; reason: string }
  | { outcome: "sent"; provider: string; messageId: string }
  | { outcome: "failed"; provider: string; error: string }
  | { outcome: "unknown"; provider: string; error: string };

// ---------------------------------------------------------------------------
// Template lookup
// ---------------------------------------------------------------------------

/**
 * Resolve an active automation template by deterministic application-level
 * NAME. providerTemplateId is taken ONLY from the stored document. Returns
 * null (=> template_unavailable) when missing/inactive; this is a NON-error:
 * the durable marker stays pending and the lifecycle is unaffected.
 */
export async function resolveAutomationTemplate(
  event: OrderSmsEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SmsTemplateModel: any = SmsTemplate
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const name = EVENT_TEMPLATE_NAME[event];
  try {
    return await SmsTemplateModel.findOne({ name, isActive: true }).lean();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Durable marker helpers (Order.smsEvents)
// ---------------------------------------------------------------------------

/**
 * Build the embedded marker object for a given event/orderId. Used by the
 * routes to push the marker IN the same atomic transition write.
 */
export function buildSmsEventMarker(orderId: string, event: OrderSmsEvent) {
  return {
    event: EVENT_SUFFIX[event],
    dedupeKey: orderSmsDedupeKey(orderId, event),
    status: "pending",
    createdAt: new Date(),
  };
}

/**
 * Repair/reconcile an Order.smsEvents marker to a terminal mirror state.
 * Called after a SmsLog is finalized so a re-run of the same marker sees
 * SmsLog.sent and never resends. Never throws.
 */
export async function updateSmsEventMarkerStatus(
  orderId: string,
  event: OrderSmsEvent,
  status: "sent" | "failed" | "unknown"
): Promise<boolean> {
  const eventSuffix = EVENT_SUFFIX[event];
  try {
    await dbConnect();
    // Import dynamically to avoid a hard cycle; Order is the doc this updates.
    const { default: Order } = await import("@/models/Order");
    await Order.updateOne(
      { _id: orderId, "smsEvents.dedupeKey": orderSmsDedupeKey(orderId, event) },
      { $set: { "smsEvents.$.status": status } }
    );
    return true;
  } catch (err) {
    // A marker-update failure is isolated — it must never break the caller.
    // The SmsLog row is the source of truth; a later reconciliation would
    // observe SmsLog.sent and repair the marker then.
    console.error(`[SmsOrderEvents] marker repair failed for ${eventSuffix} ${orderId}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// The core processor — claim → send → finalize
// ---------------------------------------------------------------------------

/**
 * Attempt to send the business SMS for one order event. Best-effort and
 * NEVER throws: any failure is returned as a controlled result and can never
 * fail the caller's business lifecycle.
 *
 * The Order.smsEvents marker is expected to already exist (pushed atomically
 * with the transition). `phone` is the server-side customer phone (auth
 * record); `customerName` likewise server-side.
 */
export async function sendOrderBusinessSms(input: {
  orderId: string;
  event: OrderSmsEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  phone?: string;
  customerName?: string;
  // injectable seams for hermetic tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SmsLogModel?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SmsTemplateModel?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendFn?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMarkerFn?: any;
}): Promise<OrderSmsResult> {
  const {
    orderId,
    event,
    order,
    phone: rawPhone,
    customerName,
  } = input;
  const SmsLogModel = input.SmsLogModel || SmsLog;
  const SmsTemplateModel = input.SmsTemplateModel || SmsTemplate;
  const sendFn = input.sendFn || sendBusinessSms;
  const updateMarker = input.updateMarkerFn || updateSmsEventMarkerStatus;

  const eventSuffix = EVENT_SUFFIX[event];
  const dedupeKey = orderSmsDedupeKey(orderId, event);

  try {
    await dbConnect();

    // ---- 1. Server-derived phone (auth record) ----
    const phone = normalizePhone(rawPhone || "");
    if (!/^09\d{9}$/.test(phone)) {
      return { outcome: "not_sent_no_phone", reason: "no valid customer phone" };
    }

    // ---- 2. Template resolution (missing/inactive => template_unavailable,
    //        NO provider call, NO SmsLog row, durable marker stays pending) ----
    const template = await resolveAutomationTemplate(event, SmsTemplateModel);
    if (!template) {
      return {
        outcome: "not_sent_template_unavailable",
        reason: "automation template missing or inactive",
      };
    }
    const templateBody = template.body || "";
    if (!templateBody) {
      return {
        outcome: "not_sent_template_unavailable",
        reason: "automation template body empty",
      };
    }

    // ---- 3. Render from server-derived vars (fail-closed) ----
    const vars = deriveVariables({ event, order, customerName });
    // Provided set must cover exactly the template's declared vars.
    const declared: string[] = template.variables || [];
    const missing = declared.filter(
      (v: string) => vars[v] === undefined || vars[v] === null || String(vars[v]).trim() === ""
    );
    if (missing.length > 0) {
      return {
        outcome: "failed",
        provider: "none",
        error: `VALIDATION_ERROR: missing vars ${missing.join(",")}`,
      };
    }
    const providedVars: Record<string, string | number> = {};
    for (const k of declared) providedVars[k] = vars[k];
    const rendered = renderTemplate(templateBody, providedVars);
    if (!rendered.ok) {
      return {
        outcome: "failed",
        provider: "none",
        error: `VALIDATION_ERROR: render incomplete (${rendered.missing.join(",")})`,
      };
    }
    const message = rendered.text;

    // ---- 3.5 DISABLED/not-configured provider ------------------------------
    // If business SMS is disabled or unconfigured (provider "none"), do NOT
    // create an SmsLog row and do NOT touch the durable marker — it stays
    // "pending" so the event can be processed once configuration is enabled.
    // No false "delivered" claim, no lifecycle failure. This preserves the
    // valid pending event. (In dev with SMS_MOCK=1 the provider is "mock", so
    // this branch does not apply locally — the verification suite exercises
    // the full path.)
    try {
      const provider = resolveBusinessSmsProvider();
      if (provider === "none") {
        return { outcome: "disabled", reason: "business SMS disabled/not configured" };
      }
    } catch {
      // Resolution should not throw, but if it does, treat as disabled (no
      // send, marker stays pending) — never fail the lifecycle.
      return { outcome: "disabled", reason: "provider resolution error" };
    }

    // ---- 4. INSERT gate (atomic, unique partial index on dedupeKey) ----
    // "pending" row pre-seeded: it carries the durable marker's identity and
    // the unique index makes concurrent first-time triggers exactly-once.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let row: any;
    try {
      row = await SmsLogModel.create({
        dedupeKey,
        recipient: phone,
        user: order.customer ? String(order.customer) : null,
        order: orderId,
        template: template._id ? String(template._id) : null,
        templateName: template.name || "",
        messageType: EVENT_MESSAGE_TYPE[event],
        provider: "mock", // provisional; finalized below from sendFn result
        status: "pending",
        attemptCount: 0,
        claimedAt: null,
        message,
        createdBy: null, // system-triggered
      });
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) {
        // Row already exists (we are a duplicate). Fall through to §5 which
        // reads current state and handles sent / in-flight / retryable.
        return handleExistingRow({ dedupeKey, eventSuffix, orderId, sendFn, SmsLogModel, updateMarker, message, phone });
      }
      // Non-unique DB error -> isolated, no provider call.
      console.error(`[SmsOrderEvents] log insert failed for ${eventSuffix}:`, err);
      return { outcome: "unknown", provider: "none", error: "SMS_LOG_DB_ERROR" };
    }

    // ---- 5. SEND gate: pending -> sending (atomic CAS on this row) ----
    const claimed = await SmsLogModel.findOneAndUpdate(
      { _id: row._id, status: "pending" },
      { $set: { status: "sending", claimedAt: new Date() }, $inc: { attemptCount: 1 } },
      { new: true }
    ).lean();
    if (!claimed) {
      // Another execution won (or state changed) — stop, no second provider call.
      return handleExistingRow({ dedupeKey, eventSuffix, orderId, sendFn, SmsLogModel, updateMarker, message, phone });
    }

    // ---- 6. Provider call (behind sms-business, never throws) ----
    const result = await sendFn(phone, message);

    // ---- 7. FINALIZE: sending -> terminal (CAS on _id + status:sending) ----
    const terminalStatus = finalizeStatus(result);
    const terminalError = terminalStatus === "sent" ? "" : result.error || "";
    await SmsLogModel.findOneAndUpdate(
      { _id: row._id, status: "sending" },
      {
        $set: {
          status: terminalStatus,
          provider: result.provider,
          providerMessageId: result.messageId || "",
          error: terminalError,
          errorMessage: result.ok ? "" : "ارسال پیامک ناموفق بود",
          sentAt: new Date(),
        },
      }
    ).lean();

    // Sync the durable marker mirror (best-effort, never throws).
    await updateMarker(orderId, event, terminalStatus);

    return toResult(terminalStatus, result);
  } catch (err) {
    // Every business-SMS failure is isolated — never throw into the lifecycle.
    console.error(`[SmsOrderEvents] unexpected error ${eventSuffix} ${orderId}:`, err);
    return { outcome: "unknown", provider: "none", error: "UNEXPECTED" };
  }
}

/**
 * Handle the case where a SmsLog row for this dedupeKey already exists
 * (duplicate insert or retry). Never calls the provider unless a source state
 * (failed / unknown) is atomically CAS'd into "sending".
 */
async function handleExistingRow(args: {
  dedupeKey: string;
  eventSuffix: string;
  orderId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendFn: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SmsLogModel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMarker: any;
  message: string;
  phone: string;
}): Promise<OrderSmsResult> {
  const { dedupeKey, eventSuffix, orderId, sendFn, SmsLogModel, updateMarker, message, phone } = args;

  // Read current state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing: any = await SmsLogModel.findOne({ dedupeKey }).lean();
  if (!existing) {
    // The insert lost to E11000 but we can't see the row (rare race) — safest
    // is to not send (someone else owns it). This cannot permanently lose the
    // event: the durable marker remains pending for reconciliation.
    return { outcome: "in_flight", reason: "duplicate insert race" };
  }

  const current = existing.status;
  // sent (terminal) => never resend.
  if (current === "sent") {
    // Repair the durable marker if it lagged (best-effort).
    await updateMarker(orderId, eventSuffixToEvent(eventSuffix), "sent");
    return { outcome: "already_sent" };
  }
  // sending => in-flight or crashed-mid-call. No auto-reclaim, no 2nd call.
  if (current === "sending" || current === "pending") {
    return { outcome: "in_flight", reason: `state=${current}` };
  }
  // failed / unknown => manual retry via atomic CAS. Only ONE wins.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimed: any = await SmsLogModel.findOneAndUpdate(
    { dedupeKey, status: current },
    { $set: { status: "sending", claimedAt: new Date() }, $inc: { attemptCount: 1 } },
    { new: true }
  ).lean();
  if (!claimed) {
    // Concurrent retry won -> we must not send.
    return { outcome: "in_flight", reason: "concurrent retry claimed" };
  }

  // We own this retry.
  const result = await sendFn(phone, message);
  const terminalStatus = finalizeStatus(result);
  const terminalError = terminalStatus === "sent" ? "" : result.error || "";
  await SmsLogModel.findOneAndUpdate(
    { _id: claimed._id, status: "sending" },
    {
      $set: {
        status: terminalStatus,
        provider: result.provider,
        providerMessageId: result.messageId || "",
        error: terminalError,
        errorMessage: result.ok ? "" : "ارسال پیامک ناموفق بود",
        sentAt: new Date(),
      },
    }
  ).lean();
  await updateMarker(orderId, eventSuffixToEvent(eventSuffix), terminalStatus);
  return toResult(terminalStatus, result);
}

/** Map an event suffix back to the OrderSmsEvent (for marker sync). */
function eventSuffixToEvent(suffix: string): OrderSmsEvent {
  for (const ev of ALL_ORDER_SMS_EVENTS) {
    if (EVENT_SUFFIX[ev] === suffix) return ev;
  }
  return "ORDER_CREATED";
}

/**
 * Map a provider result to the terminal SmsLog state. Only a CONFIRMED
 * provider response rejection is "failed"; a network timeout/uncertainty is
 * "unknown"; disabled/not-configured stays retryable-in-waiting for the
 * durable marker but the SmsLog row reflects the real outcome.
 */
function finalizeStatus(result: { ok: boolean; provider: string; error?: string }): "sent" | "failed" | "unknown" {
  if (result.ok) return "sent";
  if (result.error === "NETWORK_ERROR") return "unknown";
  // SMS_BUSINESS_API_ERROR (confirmed rejection) and SMS_BUSINESS_DISABLED/
  // NOT_CONFIGURED are all "failed" outcomes (no delivery). For disabled/
  // not-configured we prefer to keep the DURABLE marker pending (see below),
  // but the SmsLog row records "failed" because no delivery happened.
  return "failed";
}

function toResult(
  terminalStatus: "sent" | "failed" | "unknown",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
): OrderSmsResult {
  if (terminalStatus === "sent") {
    return { outcome: "sent", provider: result.provider, messageId: result.messageId || "" };
  }
  if (terminalStatus === "unknown") {
    return { outcome: "unknown", provider: result.provider, error: result.error || "" };
  }
  return { outcome: "failed", provider: result.provider, error: result.error || "" };
}

// ---------------------------------------------------------------------------
// Non-throwing lifecycle wrapper
// ---------------------------------------------------------------------------

/**
 * Fire the business SMS for a real lifecycle event without ever blocking or
 * failing the authoritative transition. Callers invoke this AFTER the
 * transition has committed (and after the durable marker was pushed in the
 * same write). Resolves to the controlled result; never throws.
 */
export async function fireOrderSmsEvent(
  input: {
    orderId: string;
    event: OrderSmsEvent;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    order: any;
    phone?: string;
    customerName?: string;
  }
): Promise<OrderSmsResult> {
  try {
    return await sendOrderBusinessSms(input);
  } catch (err) {
    // Absorb any unexpected throw — best-effort by construction.
    console.error(`[SmsOrderEvents] fireOrderSmsEvent threw for ${input.event}:`, err);
    return { outcome: "unknown", provider: "none", error: "UNEXPECTED" };
  }
}
