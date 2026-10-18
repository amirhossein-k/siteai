/**
 * Price-stamp CAS orchestration (Session 93).
 *
 * THE WRITE CONTRACT for `Product.priceLastUpdatedAt` (product PUT routes):
 *
 *   1. READ a fresh snapshot pinned to the product (id + ownership scope):
 *      `priceVersion` is the CAS token, the normalized pricing revision is the
 *      change detector (src/lib/product-price-audit.ts).
 *   2. DECIDE: does THIS update move the pricing revision? If yes the stamp
 *      becomes `now()`; if no the write still proceeds (field edits must
 *      persist) but `priceLastUpdatedAt` is left EXACTLY as stored.
 *   3. WRITE conditionally: filter `{ …scope, priceVersion: token }` +
 *      `$inc: { priceVersion: 1 }` (+ `$set.priceLastUpdatedAt` only when the
 *      revision moved). A `null` result means another writer moved the token
 *      between step 1 and step 3.
 *   4. BOUNDED RETRY: at most `PRICE_STAMP_MAX_ATTEMPTS` (3) snapshots. A
 *      document that keeps changing under us is reported as a conflict so the
 *      route answers 409 — there is NEVER an unconditional fallback write (a
 *      fallback would re-introduce exactly the stamp mis-attribution this
 *      mechanism exists to prevent).
 *
 * SLUG NESTING (deliberate): `createWithUniqueSlug` runs INSIDE the CAS loop —
 * the loop stays OUTERMOST so every attempt re-pins its own token. A slug
 * collision retry performs NO write (the DB rejected the write), so it reuses
 * the same pinned token, does not consume CAS attempts and needs no new
 * snapshot. `createWithUniqueSlug` deliberately returns `{ ok: false }` when it
 * runs out of candidates and rethrows non-duplicate errors: the loop maps
 * `{ ok: false }` to `slug_conflict` (the routes' existing 409) and lets real
 * errors bubble up to the routes' catch blocks (unchanged 500 path).
 *
 * MECHANICS PINNED BY TESTS (tests/unit/product-price-cas.test.ts):
 *   - `token: null` (legacy document, `priceVersion` absent) is a VALID token:
 *     Mongo's `{ priceVersion: null }` matches a missing field, while
 *     `undefined` would be dropped by the caster and disable the condition;
 *   - `$set` never carries `undefined` values — an omitted body field must not
 *     become an explicit write (Mongoose drops them today; this keeps the
 *     update document identical and explicit);
 *   - the stamp is set ONLY on a revision change, never cleared, never bumped
 *     for a no-op edit.
 */

import { PRICE_STAMP_MAX_ATTEMPTS } from "@/lib/constants";
import Product from "@/models/Product";
import {
  normalizePriceVersionToken,
  pricingRevisionChanged,
  toPricingRevision,
  type PricingRevision,
  type PricingRevisionSource,
} from "@/lib/product-price-audit";
import { createWithUniqueSlug } from "@/lib/product-slug";

/** Deterministic slug-suffix budget for auto-generated slugs (mirrors POST). */
export const PRICE_STAMP_AUTO_SLUG_TRIES = 20;

/** The pinned read: CAS token + normalized pricing revision. */
export interface PriceStampSnapshot {
  token: number | null;
  revision: PricingRevision;
}

/** One conditional write attempt (token + optional stamp + slug candidate). */
export interface PriceStampAttempt {
  candidate: string;
  token: number | null;
  stamp: Date | null;
}

export interface PriceStampOptions<S extends PriceStampSnapshot, T> {
  /** Fresh snapshot pinned to the product; `null` ⇒ gone or out of scope. */
  readSnapshot: () => Promise<S | null>;
  /** Cheap existence probe that tells "deleted" from "concurrently edited". */
  stillExists: () => Promise<boolean>;
  /** The pricing revision THIS update would persist (from the snapshot). */
  buildNextRevision: (snapshot: S) => PricingRevision;
  /** One atomic conditional write; MUST return `null` on a CAS miss. */
  write: (attempt: PriceStampAttempt) => Promise<T | null>;
  /** Slug base for this update (auto-generated slugs may get a suffix). */
  effectiveSlug: string;
  /** `true` ⇒ deterministic collision suffix; `false` ⇒ user's slug is final. */
  autoSlug?: boolean;
  maxAttempts?: number;
  /** Injected clock (deterministic tests); defaults to `new Date()`. */
  now?: () => Date;
}

export type PriceStampOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "not_found" }
  | { status: "slug_conflict" }
  | { status: "price_conflict" };

/** Drop `undefined` entries so an omitted field never becomes an explicit write. */
function withoutUndefined(
  fields: Record<string, unknown>
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) set[key] = value;
  }
  return set;
}

/**
 * The conditional write document handed to `findOneAndUpdate`: `$set` carries
 * the caller's fields (+ the stamp when it moved), `$inc` advances the token.
 */
export interface PriceCasWriteDocument {
  filter: Record<string, unknown>;
  update: {
    $set: Record<string, unknown>;
    $inc: Record<string, number>;
  };
}

/**
 * Build the conditional Mongo update for one CAS attempt.
 *
 * `token` is the snapshot's `priceVersion` (a number, or `null` for legacy
 * documents). The stamp is added to `$set` ONLY when the revision moved — so a
 * non-pricing edit leaves the stored stamp byte-for-byte intact — and
 * `priceVersion` always advances by exactly one, keeping the token monotonic
 * (mirrors `stockVersion`).
 */
export function buildPriceCasUpdate(
  scopeFilter: Record<string, unknown>,
  fields: Record<string, unknown>,
  token: number | null,
  stamp: Date | null
): PriceCasWriteDocument {
  const set = withoutUndefined(fields);
  if (stamp !== null) set.priceLastUpdatedAt = stamp;
  return {
    filter: { ...scopeFilter, priceVersion: token },
    update: { $set: set, $inc: { priceVersion: 1 } },
  };
}

/**
 * Run the bounded CAS loop for one product update.
 *
 * Never throws for an expected outcome — the four `status` values map onto the
 * existing route behaviors:
 *   - `ok`              → respond with `value` (the updated, populated doc),
 *   - `not_found`       → the product is gone / out of the caller's scope,
 *   - `slug_conflict`   → the routes' existing «اسلاگ تکراری» 409,
 *   - `price_conflict`  → CAS attempts exhausted (concurrent editors): 409.
 * Unexpected driver errors (validation, cast, non-slug duplicate keys) are
 * rethrown untouched — the routes' error handling stays authoritative.
 */
export async function updateProductWithPriceStamp<
  S extends PriceStampSnapshot,
  T,
>(options: PriceStampOptions<S, T>): Promise<PriceStampOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? PRICE_STAMP_MAX_ATTEMPTS;
  const now = options.now ?? (() => new Date());

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snapshot = await options.readSnapshot();
    if (snapshot === null) return { status: "not_found" };

    const changed = pricingRevisionChanged(
      snapshot.revision,
      options.buildNextRevision(snapshot)
    );
    const stamp = changed ? now() : null;

    const slugResult = await createWithUniqueSlug(
      options.effectiveSlug,
      (candidate) =>
        options.write({ candidate, token: snapshot.token, stamp }),
      options.autoSlug === true ? PRICE_STAMP_AUTO_SLUG_TRIES : 1
    );
    if (!slugResult.ok) return { status: "slug_conflict" };
    if (slugResult.value !== null) {
      return { status: "ok", value: slugResult.value as T };
    }

    // CAS miss: distinguish "deleted/out of scope" from "changed under us".
    if (!(await options.stillExists())) return { status: "not_found" };
  }

  return { status: "price_conflict" };
}

/**
 * The fields a CAS snapshot MUST read: the token plus every leaf compared by
 * `toPricingRevision`. Kept here (not in the routes) so both PUT routes read
 * exactly the same projection — an inclusive `select` deliberately names the
 * `select: false` token, which Mongo returns because the inclusion wins.
 */
export const PRICE_SNAPSHOT_PROJECTION =
  "priceVersion price hasVariants variants discount";

/**
 * Build the snapshot reader for one product scope (`{ _id }` for admin,
 * `{ _id, supplier }` for the ownership-pinned supplier route).
 *
 * This is the ONLY Mongoose-aware export of this module — the CAS loop itself
 * stays injectable/pure so it can be driven by fakes in unit tests.
 */
export function createProductPriceSnapshotReader(
  filter: Record<string, unknown>
): () => Promise<PriceStampSnapshot | null> {
  return async () => {
    const doc = await Product.findOne(filter)
      .select(PRICE_SNAPSHOT_PROJECTION)
      .lean();
    if (!doc) return null;
    const raw = doc as { priceVersion?: unknown } & PricingRevisionSource;
    return {
      token: normalizePriceVersionToken(raw.priceVersion),
      revision: toPricingRevision(raw),
    };
  };
}