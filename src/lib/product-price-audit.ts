/**
 * Product PRICE-STAMP decision logic (Session 93) — PURE, storage-agnostic.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Product.priceLastUpdatedAt` must mean exactly one thing: "the moment this
 * product's PRICING CONFIGURATION last changed". Every write that touches a
 * pricing field (price · variant prices · variant availability · discount)
 * moves it; every write that does not (name, description, images, slug,
 * category, brand, tags, active flag, supplier, stock summary …) must leave it
 * EXACTLY as stored — a trustworthy stamp is what a customer can read as "this
 * is when the price changed", not "someone last saved the form".
 *
 * The comparison is a multiset comparison over the pricing REVISION:
 *   { price, hasVariants, variants: [{ price, isActive }], discount }
 *
 * CREATION: a new product's stamp starts at its CREATION instant
 * (`initialPriceStampFields`) — the pricing configuration a product is born with
 * IS its first one, so it never starts as "never priced". Legacy documents
 * stay `null` (no backfill).
 *
 * PINNED SEMANTICS (tests/unit/product-price-audit.test.ts):
 *   - variant ORDER is not part of the revision (canonically sorted) — a row
 *     reshuffle is not a price change;
 *   - variants are compared as a multiset of (price, isActive) pairs — two
 *     variants SWAPPING prices IS a change (the pairs differ);
 *   - the variant matrix is variant-type-driven state, so `hasVariants`
 *     flipping (simple ⇄ variant) is a change;
 *   - a missing `isActive` (legacy rows written before the field existed)
 *     normalizes to the model default `true` — same for `discount.isActive`;
 *   - discount dates are compared at ISO millisecond precision, so an
 *     equivalent instant sent as `Date` or ISO string is NOT a change;
 *   - `undefined` (field omitted on a PUT) is never a change by itself — the
 *     caller resolves it against the stored value first (`resolveNextDiscount`);
 *   - `null` (discount explicitly cleared) IS a change when something was
 *     stored, and an ABSENT discount equals `null` (legacy products).
 *
 * Everything here is pure: no Mongoose, no HTTP, no DB. The CAS loop lives in
 * src/lib/product-price-cas.ts; the routes own all I/O.
 */

import { formatPersianDate } from "@/lib/persian-date";

/** A discount as it participates in the revision comparison (normalized). */
export interface PricingDiscountRevision {
  type: "percent" | "fixed";
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

/** One variant's pricing footprint — price + availability, nothing else. */
export interface VariantPricingRevision {
  price: number;
  isActive: boolean;
}

/** The complete pricing configuration of a product at one instant. */
export interface PricingRevision {
  price: number;
  hasVariants: boolean;
  variants: VariantPricingRevision[];
  discount: PricingDiscountRevision | null;
}

/** Raw input accepted by `toPricingRevision` (stored doc | update field set). */
export interface PricingRevisionSource {
  price?: unknown;
  hasVariants?: unknown;
  variants?: unknown;
  discount?: unknown;
}

/**
 * Fields that are INTERNAL to the price-stamp mechanism: never part of any API
 * response. They are `select: false` in the model AND stripped from write
 * responses (see `omitInternalPriceFields`) — a leak scan asserts both.
 */
export const PRICE_STAMP_INTERNAL_FIELDS = [
  "priceVersion",
  "priceLastUpdatedAt",
] as const;

/**
 * Persian label prefix used by the public detail payload's price stamp:
 * «آخرین تغییر تنظیمات قیمت و تخفیف: ۲۵ آبان ۱۴۰۳ ساعت ۰۳:۳۰». The wording names
 * BOTH price and discount because the stamp moves for either (approved spec —
 * never reworded past the prefix, the value is always the rendered date + time).
 */
export const PRICE_STAMP_LABEL_PREFIX = "آخرین تغییر تنظیمات قیمت و تخفیف";

function toFiniteNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Date | ISO string | Mongo Date → ISO instant string; junk → `null`. */
function toIsoInstant(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDiscountRevision(value: unknown): PricingDiscountRevision | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    // Mirrors getEffectivePrice's fallback: an unknown type reads as percent.
    type: raw.type === "fixed" ? "fixed" : "percent",
    value: toFiniteNumber(raw.value),
    startsAt: toIsoInstant(raw.startsAt),
    endsAt: toIsoInstant(raw.endsAt),
    // Missing (legacy) ⇒ the schema default (true).
    isActive: raw.isActive !== false,
  };
}

function compareVariants(
  a: VariantPricingRevision,
  b: VariantPricingRevision
): number {
  return a.price - b.price || Number(a.isActive) - Number(b.isActive);
}

function toVariantRevisions(value: unknown): VariantPricingRevision[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = (entry ?? {}) as Record<string, unknown>;
      return {
        price: toFiniteNumber(raw.price),
        isActive: raw.isActive !== false,
      };
    })
    .sort(compareVariants);
}

/**
 * Normalize a stored document or a route's update-field set into the
 * comparison form. Both sides of a comparison MUST go through this function
 * (it is what makes `Date` and ISO-string dates, legacy rows and sorted
 * variants comparable).
 */
export function toPricingRevision(
  source: PricingRevisionSource | null | undefined
): PricingRevision {
  const raw = (source ?? {}) as PricingRevisionSource;
  return {
    price: toFiniteNumber(raw.price),
    hasVariants: raw.hasVariants === true,
    variants: toVariantRevisions(raw.variants),
    discount: toDiscountRevision(raw.discount),
  };
}

/**
 * Stable, comparable fingerprint of a normalized revision (diagnostics +
 * equality). Deterministic because every leaf is a primitive and variants are
 * sorted by `toPricingRevision`.
 */
export function computePricingFingerprint(revision: PricingRevision): string {
  return JSON.stringify([
    revision.price,
    revision.hasVariants,
    revision.discount,
    revision.variants,
  ]);
}

/** True when two normalized revisions describe the same pricing configuration. */
export function pricingRevisionsEqual(
  a: PricingRevision,
  b: PricingRevision
): boolean {
  return computePricingFingerprint(a) === computePricingFingerprint(b);
}

/** True when `next` moves the pricing revision — i.e. the stamp must move. */
export function pricingRevisionChanged(
  previous: PricingRevision,
  next: PricingRevision
): boolean {
  return !pricingRevisionsEqual(previous, next);
}

/**
 * PUT semantics for the discount field (exactly what the routes persist):
 *   - `undefined` (field omitted) → the STORED config is kept (never a change),
 *   - `null` (explicitly cleared)  → the stored config is cleared,
 *   - object (validated payload)   → replaces the stored config.
 */
export function resolveNextDiscount(
  stored: unknown,
  submitted: unknown
): unknown {
  return submitted === undefined ? stored : submitted;
}

/**
 * The CAS token as stored: a finite version number, or `null` for documents
 * written before `priceVersion` existed (field ABSENT) and for explicit nulls.
 *
 * `null` is deliberate, not a shortcut: Mongo's `{ priceVersion: null }` filter
 * matches a MISSING field, whereas `undefined` is silently DROPPED by the
 * driver's query caster — which would remove the CAS condition entirely and let
 * every write win unconditionally.
 */
export function normalizePriceVersionToken(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * CREATION-TIME stamp — the initializer merged into every create payload (admin
 * POST · supplier POST · CSV import). A brand-new product's pricing
 * configuration IS whatever it was created with, so the product starts with a
 * real, trustworthy stamp instead of `null` ("never priced") and the public
 * detail payload shows its label from day one.
 *
 * `priceVersion` is deliberately NOT set: the schema default `0` is the "no
 * pricing write has happened yet" CAS token.
 *
 * LEGACY documents (created before the field existed) stay `null` — there is NO
 * backfill, because stamping them with an invented date would be a lie; the
 * public payload renders no label at all for them (`buildPriceStampLabel` →
 * null).
 */
export function initialPriceStampFields(
  at: Date = new Date()
): { priceLastUpdatedAt: Date } {
  return { priceLastUpdatedAt: at };
}

/**
 * Persian display label for a stored stamp
 * («آخرین تغییر تنظیمات قیمت و تخفیف: ۲۵ آبان ۱۴۰۳ ساعت ۰۳:۳۰»), or `null` when
 * the product has no usable stamp — i.e. a LEGACY document created before the
 * field existed (no backfill: every product created since is stamped at creation
 * time, see `initialPriceStampFields`). Rendering is the Jalali date + clock time
 * in the store time zone (src/lib/persian-date.ts) — never the host's locale/TZ.
 */
export function buildPriceStampLabel(stamp: unknown): string | null {
  if (stamp === null || stamp === undefined || stamp === "") return null;
  const formatted = formatPersianDate(
    stamp instanceof Date ? stamp : String(stamp)
  );
  return formatted === null ? null : `${PRICE_STAMP_LABEL_PREFIX}: ${formatted}`;
}

/**
 * Leak guard — shallow copy of a document with the internal price fields
 * removed. Route responses pass through this so `priceVersion` /
 * `priceLastUpdatedAt` can never reach admin/supplier JSON even if a server
 * ignores the projection the schema-level `select: false` sets up.
 * Non-objects (the `null` returned when a write matched nothing) pass through.
 */
export function omitInternalPriceFields<T>(doc: T): T {
  if (!doc || typeof doc !== "object") return doc;
  const clone: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
  for (const field of PRICE_STAMP_INTERNAL_FIELDS) delete clone[field];
  return clone as T;
}

/**
 * PUBLIC DETAIL projection of the price stamp: the raw timestamp is replaced by
 * its display label and can never be read off the payload. Returns a NEW object
 * (the input is left untouched), so a loader can keep using the raw value
 * internally while the response carries only `priceLastUpdatedLabel`.
 */
export function applyPriceStampVisibility<T extends object>(product: T): Omit<
  T,
  "priceLastUpdatedAt" | "priceVersion"
> & {
  priceLastUpdatedLabel: string | null;
} {
  const label = buildPriceStampLabel(
    (product as { priceLastUpdatedAt?: unknown }).priceLastUpdatedAt
  );
  const visible = omitInternalPriceFields(product) as Omit<
    T,
    "priceLastUpdatedAt" | "priceVersion"
  >;
  return { ...visible, priceLastUpdatedLabel: label };
}