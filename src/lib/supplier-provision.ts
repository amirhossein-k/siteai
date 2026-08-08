import Supplier from "@/models/Supplier";

/** The minimum shape of the (Mongoose) user document this helper needs. */
export interface SupplierProvisionUser {
  _id: unknown;
  name: string;
  phone: string;
  /** Existing linked Supplier id (ObjectId or null). */
  supplier: unknown;
}

/** Optional profile seed used when CREATING a new Supplier document. */
export interface SupplierSeedInput {
  /** Business name — defaults to the user's name (change-role behavior). */
  businessName?: string;
  /** Public shop description — defaults to "" (change-role behavior). */
  description?: string;
  /** Contact phone — defaults to the user's phone (change-role behavior). */
  contactPhone?: string;
}

/**
 * Session 67 — shared Supplier provisioning, extracted BEHAVIOR-PRESERVING
 * from `PATCH /api/admin/users` (action: change-role) so the Session 67
 * approval path reuses the exact same semantics instead of duplicating the
 * supplier-creation code:
 *
 *  - user.supplier exists → reactivate it (a Supplier left from a previous
 *    role change must come back online), keep the link.
 *  - otherwise → create a new Supplier document with the supplied seed
 *    (falling back to the change-role defaults: businessName = user.name,
 *    contactPhone = user.phone, description = "") and link it back to the
 *    user (user.supplier = supplier._id — the caller persists the user).
 *
 * NOTE: the caller is responsible for persisting the user (role change /
 * tokenVersion bump / supplier link) and for the tokenVersion cache
 * invalidation — this helper only provisions the Supplier document.
 */
export async function ensureSupplierForUser(
  user: SupplierProvisionUser,
  seed: SupplierSeedInput = {}
): Promise<{ supplier: unknown; created: boolean }> {
  if (user.supplier) {
    await Supplier.findByIdAndUpdate(user.supplier, {
      $set: { isActive: true },
    });
    const existing = await Supplier.findById(user.supplier).lean();
    return { supplier: existing, created: false };
  }

  // Idempotency backstop: an earlier attempt may have created the Supplier
  // doc but failed to persist the user back-link (crash between the two
  // writes). Never create a SECOND Supplier doc for the same user — adopt
  // the orphaned one and re-link it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orphaned: any = await Supplier.findOne({ user: user._id }).lean();
  if (orphaned) {
    await Supplier.findByIdAndUpdate(orphaned._id, {
      $set: { isActive: true },
    });
    user.supplier = orphaned._id;
    return { supplier: orphaned, created: false };
  }

  const supplier = await Supplier.create({
    user: user._id,
    businessName: seed.businessName || user.name,
    contactPhone: seed.contactPhone || user.phone,
    description: seed.description || "",
    bankAccount: {
      cardNumber: "",
      iban: "",
      ownerName: "",
    },
    telegramChatId: "",
    balance: 0,
    isActive: true,
  });

  user.supplier = supplier._id;
  return { supplier, created: true };
}
