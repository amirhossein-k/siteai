import { describe, it, expect, vi } from "vitest";
import {
  PRICE_STAMP_AUTO_SLUG_TRIES,
  buildPriceCasUpdate,
  updateProductWithPriceStamp,
  type PriceStampAttempt,
  type PriceStampSnapshot,
} from "@/lib/product-price-cas";
import { toPricingRevision } from "@/lib/product-price-audit";
import { PRICE_STAMP_MAX_ATTEMPTS } from "@/lib/constants";

/**
 * Session 93 — the bounded CAS write contract behind `priceLastUpdatedAt`.
 *
 * Everything is driven by fakes: the loop must prove it (a) re-pins a FRESH
 * token on every attempt, (b) never falls back to an unconditional write, (c)
 * stops at PRICE_STAMP_MAX_ATTEMPTS with a reportable conflict, (d) keeps slug
 * retries inside one attempt, and (e) lets real driver errors escape to the
 * routes' existing error handling.
 */

const NOW = new Date("2026-10-17T09:30:00.000Z");

/**
 * Write mocks that ignore their attempt argument — it stays fully inspectable
 * through `mock.calls`, while the explicit signature keeps the argument typed.
 */
const writeReturning = <T,>(value: T) =>
  vi.fn<(attempt: PriceStampAttempt) => Promise<T>>(async () => value);

/** Normalized revision at a base price (simple product, no discount). */
const revisionAt = (price: number) =>
  toPricingRevision({ price, hasVariants: false, variants: [], discount: null });

/** Snapshot carrying a CAS token. */
const snapshotAt = (
  token: number | null,
  price = 1_000_000
): PriceStampSnapshot => ({ token, revision: revisionAt(price) });

/** E11000 on the slug unique index — what createWithUniqueSlug retries on. */
function slugDuplicate(): Error & {
  code: number;
  keyPattern: Record<string, number>;
} {
  const err = new Error("E11000 duplicate key error") as Error & {
    code: number;
    keyPattern: Record<string, number>;
  };
  err.code = 11000;
  err.keyPattern = { slug: 1 };
  return err;
}

/** E11000 on a DIFFERENT unique index — must NOT be swallowed as a slug clash. */
function skuDuplicate(): Error & {
  code: number;
  keyPattern: Record<string, number>;
} {
  const err = new Error("E11000 duplicate key error") as Error & {
    code: number;
    keyPattern: Record<string, number>;
  };
  err.code = 11000;
  err.keyPattern = { "variants.sku": 1 };
  return err;
}

describe("updateProductWithPriceStamp — stamp decision", () => {
  it("persists a non-pricing edit without touching the stamp", async () => {
    const write = writeReturning({
      _id: "p1",
      name: "edited",
    });
    const readSnapshot = vi.fn(async () => snapshotAt(5));
    const stillExists = vi.fn(async () => true);

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot,
      stillExists,
      // Same price, only non-pricing fields differ.
      buildNextRevision: (snapshot) => snapshot.revision,
      write,
      now: () => NOW,
    });

    expect(outcome).toEqual({
      status: "ok",
      value: { _id: "p1", name: "edited" },
    });
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(stillExists).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toEqual({
      candidate: "kala",
      token: 5,
      stamp: null,
    });
  });

  it("stamps the injected clock when the pricing revision moves", async () => {
    const write = writeReturning({ _id: "p1" });

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot: async () => snapshotAt(2),
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(1_100_000),
      write,
      now: () => NOW,
    });

    expect(outcome.status).toBe("ok");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].stamp).toBe(NOW);
    expect(write.mock.calls[0][0].token).toBe(2);
  });

  it("stamps a legacy document too (token null is a valid CAS token)", async () => {
    const write = writeReturning({ _id: "legacy" });

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "legacy",
      readSnapshot: async () => snapshotAt(null),
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(999_000),
      write,
      now: () => NOW,
    });

    expect(outcome.status).toBe("ok");
    expect(write.mock.calls[0][0]).toEqual({
      candidate: "legacy",
      token: null,
      stamp: NOW,
    });
  });
});

describe("updateProductWithPriceStamp — CAS retry behavior", () => {
  it("re-reads and re-pins a FRESH token after a miss (never a stale retry)", async () => {
    let reads = 0;
    const write = vi.fn(async (attempt: PriceStampAttempt) =>
      attempt.token === 5 ? null : { _id: "p1" }
    );

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot: async () => {
        reads += 1;
        return reads === 1 ? snapshotAt(5) : snapshotAt(6);
      },
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(1_200_000),
      write,
      now: () => NOW,
    });

    expect(outcome.status).toBe("ok");
    expect(reads).toBe(2);
    expect(write.mock.calls.map((call) => call[0].token)).toEqual([5, 6]);
    // The revision moved in both reads, so both attempts carried a stamp.
    expect(write.mock.calls.map((call) => call[0].stamp)).toEqual([NOW, NOW]);
  });

  it("reports not_found when the snapshot is already gone (no write)", async () => {
    const write = writeReturning({ _id: "x" });
    const stillExists = vi.fn(async () => false);

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot: async () => null,
      stillExists,
      buildNextRevision: () => revisionAt(1),
      write,
    });

    expect(outcome).toEqual({ status: "not_found" });
    expect(write).not.toHaveBeenCalled();
    expect(stillExists).not.toHaveBeenCalled();
  });

  it("reports not_found (not a conflict) when the product vanished mid-write", async () => {
    const write = writeReturning<null>(null);
    const stillExists = vi.fn(async () => false);

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot: async () => snapshotAt(3),
      stillExists,
      buildNextRevision: () => revisionAt(1_200_000),
      write,
    });

    expect(outcome).toEqual({ status: "not_found" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(stillExists).toHaveBeenCalledTimes(1);
  });

  it("exhausts exactly PRICE_STAMP_MAX_ATTEMPTS and reports a conflict", async () => {
    const write = writeReturning<null>(null);
    const stillExists = vi.fn(async () => true);

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot: async () => snapshotAt(5),
      stillExists,
      buildNextRevision: () => revisionAt(1_200_000),
      write,
      now: () => NOW,
    });

    expect(outcome).toEqual({ status: "price_conflict" });
    expect(write).toHaveBeenCalledTimes(PRICE_STAMP_MAX_ATTEMPTS);
    // NO unconditional fallback: every attempt carried the token it read.
    expect(write.mock.calls.every((call) => call[0].token === 5)).toBe(true);
    expect(stillExists).toHaveBeenCalledTimes(PRICE_STAMP_MAX_ATTEMPTS);
  });

  it("honors an explicit attempt budget", async () => {
    const write = writeReturning<null>(null);

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      readSnapshot: async () => snapshotAt(1),
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(2),
      write,
      maxAttempts: 1,
    });

    expect(outcome).toEqual({ status: "price_conflict" });
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("updateProductWithPriceStamp — slug handling stays intact", () => {
  it("keeps slug retries INSIDE one attempt (same token, one snapshot read)", async () => {
    let writes = 0;
    const write = vi.fn<(attempt: PriceStampAttempt) => Promise<{ _id: string }>>(async () => {
      writes += 1;
      if (writes < 20) throw slugDuplicate();
      return { _id: "p1" };
    });
    const readSnapshot = vi.fn(async () => snapshotAt(7));

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      autoSlug: true,
      readSnapshot,
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(1_200_000),
      write,
      now: () => NOW,
    });

    expect(outcome.status).toBe("ok");
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(20);
    // The slug suffix changes; the CAS token (and stamp) do not.
    expect(write.mock.calls[0][0].token).toBe(7);
    expect(write.mock.calls[19][0].token).toBe(7);
    expect(write.mock.calls[19][0].candidate).toBe("kala-20");
  });

  it("maps an exhausted auto-slug budget to slug_conflict", async () => {
    const write = vi.fn<(attempt: PriceStampAttempt) => Promise<null>>(async () => {
      throw slugDuplicate();
    });
    const readSnapshot = vi.fn(async () => snapshotAt(7));

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "kala",
      autoSlug: true,
      readSnapshot,
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(1_200_000),
      write,
    });

    expect(outcome).toEqual({ status: "slug_conflict" });
    expect(write).toHaveBeenCalledTimes(PRICE_STAMP_AUTO_SLUG_TRIES);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps a user-entered slug authoritative (single attempt → slug_conflict)", async () => {
    const write = vi.fn<(attempt: PriceStampAttempt) => Promise<null>>(async () => {
      throw slugDuplicate();
    });

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "taken-slug",
      readSnapshot: async () => snapshotAt(1),
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(2),
      write,
    });

    expect(outcome).toEqual({ status: "slug_conflict" });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty slug base without writing anything", async () => {
    const write = writeReturning({ _id: "p1" });

    const outcome = await updateProductWithPriceStamp({
      effectiveSlug: "   ",
      autoSlug: true,
      readSnapshot: async () => snapshotAt(1),
      stillExists: async () => true,
      buildNextRevision: () => revisionAt(2),
      write,
    });

    expect(outcome).toEqual({ status: "slug_conflict" });
    expect(write).not.toHaveBeenCalled();
  });

  it("rethrows non-duplicate errors (the routes' unchanged 500 path)", async () => {
    const boom = new Error("boom");

    await expect(
      updateProductWithPriceStamp({
        effectiveSlug: "kala",
        readSnapshot: async () => snapshotAt(1),
        stillExists: async () => true,
        buildNextRevision: () => revisionAt(2),
        write: async () => {
          throw boom;
        },
      })
    ).rejects.toThrow(boom);
  });

  it("rethrows a non-slug E11000 (variants.sku keeps the routes' existing 409)", async () => {
    await expect(
      updateProductWithPriceStamp({
        effectiveSlug: "kala",
        autoSlug: true,
        readSnapshot: async () => snapshotAt(1),
        stillExists: async () => true,
        buildNextRevision: () => revisionAt(2),
        write: async () => {
          throw skuDuplicate();
        },
      })
    ).rejects.toThrow(/E11000/);
  });
});

describe("buildPriceCasUpdate — the conditional write document", () => {
  it("pins the scope + token in the filter and increments priceVersion", () => {
    const { filter, update } = buildPriceCasUpdate(
      { _id: "p1", supplier: "s1" },
      { price: 900 },
      4,
      null
    );
    expect(filter).toEqual({ _id: "p1", supplier: "s1", priceVersion: 4 });
    expect(update).toEqual({ $set: { price: 900 }, $inc: { priceVersion: 1 } });
  });

  it("keeps a legacy null token in the filter (matches a MISSING priceVersion)", () => {
    const { filter } = buildPriceCasUpdate({ _id: "p1" }, {}, null, null);
    expect("priceVersion" in filter).toBe(true);
    expect(filter.priceVersion).toBeNull();
  });

  it("adds the stamp ONLY when the revision moved (never clears it)", () => {
    const moved = buildPriceCasUpdate({ _id: "p1" }, { price: 900 }, 1, NOW);
    expect(moved.update.$set).toEqual({ price: 900, priceLastUpdatedAt: NOW });

    const untouched = buildPriceCasUpdate(
      { _id: "p1" },
      { price: 900, isActive: false },
      1,
      null
    );
    expect(untouched.update.$set).toEqual({ price: 900, isActive: false });
    expect("priceLastUpdatedAt" in untouched.update.$set).toBe(false);
    // The token still advances for a no-op edit (the write itself happened).
    expect(untouched.update.$inc).toEqual({ priceVersion: 1 });
  });

  it("drops undefined body fields (an omitted field is never written) but keeps falsy values", () => {
    const { update } = buildPriceCasUpdate(
      { _id: "p1" },
      {
        images: undefined,
        descriptionRich: undefined,
        isActive: undefined,
        brand: null,
        price: 0,
        stock: 0,
      },
      0,
      null
    );
    expect("images" in update.$set).toBe(false);
    expect("descriptionRich" in update.$set).toBe(false);
    expect("isActive" in update.$set).toBe(false);
    expect(update.$set).toEqual({ brand: null, price: 0, stock: 0 });
  });

  it("carries the slug candidate through untouched", () => {
    const { update } = buildPriceCasUpdate({ _id: "p1" }, { slug: "kala-2" }, 1, null);
    expect(update.$set.slug).toBe("kala-2");
  });

  it("does not mutate its inputs", () => {
    const scope = { _id: "p1" };
    const fields: Record<string, unknown> = { price: 1, images: undefined };
    buildPriceCasUpdate(scope, fields, null, NOW);
    expect(scope).toEqual({ _id: "p1" });
    expect(Object.keys(fields)).toEqual(["price", "images"]);
    expect(fields.images).toBeUndefined();
  });

  it("mirrors the POST path's deterministic slug budget", () => {
    expect(PRICE_STAMP_AUTO_SLUG_TRIES).toBe(20);
  });
});