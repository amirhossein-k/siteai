/**
 * Session 67 — pure supplier-application domain helpers (validation + status
 * transitions). No mongoose, no network — hermetic unit-testable.
 */

export const SUPPLIER_APPLICATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
export type SupplierApplicationStatus =
  (typeof SUPPLIER_APPLICATION_STATUSES)[number];

export const SUPPLIER_APPLICATION_LIMITS = {
  /** businessName — min 2, max 80 (matches the model + the display surface). */
  businessName: { min: 2, max: 80 },
  /** description — capped at the Supplier.description maxlength so an
   *  approval can seed the Supplier document without a validation failure. */
  description: { max: 500 },
  adminNote: { max: 500 },
} as const;

/** Trimmed, validated contact phone — 11 digits starting with 0. */
export function normalizeContactPhone(phone: string): string {
  return (phone || "").trim();
}

export function isValidContactPhone(phone: string): boolean {
  return /^0\d{10}$/.test((phone || "").trim());
}

export interface SupplierApplicationInput {
  businessName: string;
  description?: string;
  contactPhone?: string;
}

export type SupplierApplicationValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate a public application submission. `contactPhone` is optional here —
 * when absent the endpoint defaults it to the applicant's User.phone (which
 * is already validated at registration). When present it must be a valid
 * Iranian mobile.
 */
export function validateSupplierApplicationInput(
  input: SupplierApplicationInput
): SupplierApplicationValidation {
  const businessName = (input.businessName || "").trim();
  if (
    businessName.length < SUPPLIER_APPLICATION_LIMITS.businessName.min ||
    businessName.length > SUPPLIER_APPLICATION_LIMITS.businessName.max
  ) {
    return {
      ok: false,
      error: `نام کسب‌وکار باید بین ${SUPPLIER_APPLICATION_LIMITS.businessName.min} تا ${SUPPLIER_APPLICATION_LIMITS.businessName.max} کاراکتر باشد`,
    };
  }

  const description = (input.description || "").trim();
  if (description.length > SUPPLIER_APPLICATION_LIMITS.description.max) {
    return {
      ok: false,
      error: `توضیحات حداکثر ${SUPPLIER_APPLICATION_LIMITS.description.max} کاراکتر می‌تواند باشد`,
    };
  }

  if (input.contactPhone !== undefined && input.contactPhone !== null) {
    if (!isValidContactPhone(input.contactPhone)) {
      return {
        ok: false,
        error: "شماره تماس باید ۱۱ رقم و با ۰ شروع شود",
      };
    }
  }

  return { ok: true };
}

/** Validate an admin decision payload. */
export function validateAdminNote(note: string): SupplierApplicationValidation {
  const trimmed = (note || "").trim();
  if (trimmed.length > SUPPLIER_APPLICATION_LIMITS.adminNote.max) {
    return {
      ok: false,
      error: `یادداشت حداکثر ${SUPPLIER_APPLICATION_LIMITS.adminNote.max} کاراکتر می‌تواند باشد`,
    };
  }
  return { ok: true };
}

/** Only a PENDING application may be decided (approve/reject). */
export function canDecide(status: SupplierApplicationStatus): boolean {
  return status === "pending";
}

export const SUPPLIER_APPLICATION_ACTIONS = ["approve", "reject"] as const;
export type SupplierApplicationAction =
  (typeof SUPPLIER_APPLICATION_ACTIONS)[number];

export function isSupplierApplicationAction(
  value: string
): value is SupplierApplicationAction {
  return (
    (SUPPLIER_APPLICATION_ACTIONS as readonly string[]).indexOf(value) !== -1
  );
}
