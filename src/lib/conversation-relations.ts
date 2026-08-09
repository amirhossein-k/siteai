/**
 * Conversation relation helpers (Session 68 hardening) — null-safe access to
 * the POPULATED refs on a CustomerConversation.
 *
 * WHY: Mongoose `.populate()` sets a relation to `null` at runtime when the
 * referenced document was deleted (e.g. a conversation whose supplier was
 * removed by a test-seed teardown). The old `typeof x === "object"` idiom was
 * null-UNSAFE because `typeof null === "object"` — it dereferenced `.businessName`
 * on null and crashed the customer/admin support detail pages. Per the Session
 * 65 convention ("populated relations can be null at runtime — consumers must
 * normalize, never assume a populated doc"), these helpers return a safe
 * fallback instead of throwing.
 *
 * Pure + isomorphic (no mongoose/server imports) — safe for client components.
 */
import type { CustomerConversation } from "@/types";

type SupplierRef = CustomerConversation["supplier"];
type CustomerRef = CustomerConversation["customer"];
type OrderRef = CustomerConversation["order"];

/**
 * businessName of a (possibly deleted) supplier ref, or "" when the ref is
 * missing/unpopulated — never throws, never renders "null".
 */
export function getSupplierName(supplier: SupplierRef): string {
  return supplier && typeof supplier === "object"
    ? supplier.businessName || ""
    : "";
}

/**
 * name of a (possibly deleted) customer ref, or "" when missing.
 */
export function getCustomerName(customer: CustomerRef): string {
  return customer && typeof customer === "object"
    ? customer.name || ""
    : "";
}

/**
 * Short display id (last 8 hex chars) of the linked order, or "؟" when the
 * order ref is missing/deleted.
 */
export function getOrderShortId(order: OrderRef): string {
  if (!order) return "؟";
  const id = typeof order === "object" ? order._id : order;
  return id ? String(id).slice(-8) : "؟";
}

/**
 * Full order id string (for deep links), or "" when missing/deleted — the
 * caller can skip rendering the link entirely on "".
 */
export function getOrderId(order: OrderRef): string {
  if (!order) return "";
  return typeof order === "object"
    ? String(order._id || "")
    : String(order);
}
