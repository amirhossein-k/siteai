import { describe, it, expect } from "vitest";
import {
  PRICE_STAMP_INTERNAL_FIELDS,
  PRICE_STAMP_LABEL_PREFIX,
  applyPriceStampVisibility,
  buildPriceStampLabel,
  computePricingFingerprint,
  initialPriceStampFields,
  normalizePriceVersionToken,
  omitInternalPriceFields,
  pricingRevisionChanged,
  pricingRevisionsEqual,
  resolveNextDiscount,
  toPricingRevision,
} from "@/lib/product-price-audit";
import { STORE_TIMEZONE, PRICE_STAMP_MAX_ATTEMPTS } from "@/lib/constants";
import { applyEffectivePricing } from "@/lib/product-pricing";

/**
 * Session 93 — the price stamp's decision logic.
 *
 * These tests pin the CONTRACT of `priceLastUpdatedAt`: it moves when (and only
 * when) the pricing revision changes, the comparison is a multiset over
 * {price, hasVariants, variants[{price,isActive}], discount}, legacy shapes
 * normalize to the schema defaults, and the raw stamp/token can never reach a
 * public payload.
 */

const STAMP = new Date("2024-11-15T00:00:00.000Z");
/**
 * 2024-11-15T00:00Z rendered in the store zone (Asia/Tehran) — Jalali calendar,
 * Persian digits, and the CLOCK TIME (03:30 Tehran = 00:00Z), which is part of
 * the label's contract (`hourCycle: "h23"`).
 */
const JALALI = "۲۵ آبان ۱۴۰۳ ساعت ۰۳:۳۰";

const simple = (overrides: Record<string, unknown> = {}) =>
  toPricingRevision({
    price: 1_000_000,
    hasVariants: false,
    variants: [],
    discount: null,
    ...overrides,
  });

describe("toPricingRevision — normalization of stored / submitted shapes", () => {
  it("treats a missing source as an empty, price-less revision", () => {
    const revision = toPricingRevision(null);
    expect(revision).toEqual({
      price: 0,
      hasVariants: false,
      variants: [],
      discount: null,
    });
    expect(toPricingRevision(undefined)).toEqual(revision);
  });

  it("normalizes legacy variant / discount rows (no isActive) to the schema default true", () => {
    const revision = toPricingRevision({
      price: 500,
      hasVariants: true,
      variants: [{ price: 500 }, { price: 700, isActive: false }],
      discount: { type: "percent", value: 10 },
    });
    expect(revision.variants).toEqual([
      { price: 500, isActive: true },
      { price: 700, isActive: false },
    ]);
    expect(revision.discount).toEqual({
      type: "percent",
      value: 10,
      startsAt: null,
      endsAt: null,
      isActive: true,
    });
  });

  it("reads the same instant from a Date and an ISO string identically", () => {
    const fromDate = toPricingRevision({
      price: 1,
      discount: { type: "fixed", value: 100, startsAt: STAMP, endsAt: STAMP },
    });
    const fromString = toPricingRevision({
      price: 1,
      discount: {
        type: "fixed",
        value: 100,
        startsAt: STAMP.toISOString(),
        endsAt: STAMP.toISOString(),
      },
    });
    expect(pricingRevisionsEqual(fromDate, fromString)).toBe(true);
    expect(fromDate.discount?.startsAt).toBe("2024-11-15T00:00:00.000Z");
  });

  it("maps malformed dates to null instead of Invalid Date", () => {
    const revision = toPricingRevision({
      discount: { type: "percent", value: 5, startsAt: "not-a-date" },
    });
    expect(revision.discount?.startsAt).toBeNull();
  });

  it("sorts variants canonically (multiset, not array order)", () => {
    const revision = toPricingRevision({
      hasVariants: true,
      variants: [
        { price: 900, isActive: false },
        { price: 300, isActive: true },
      ],
    });
    expect(revision.variants).toEqual([
      { price: 300, isActive: true },
      { price: 900, isActive: false },
    ]);
  });

  it("treats a non-array variants value as an empty matrix", () => {
    expect(toPricingRevision({ hasVariants: false, variants: undefined }).variants).toEqual([]);
    expect(toPricingRevision({ variants: "nope" }).variants).toEqual([]);
  });

  it("defaults an unknown discount type to percent (mirrors getEffectivePrice)", () => {
    expect(toPricingRevision({ discount: { value: 5 } }).discount?.type).toBe("percent");
  });
});

describe("pricingRevisionChanged — what moves the stamp", () => {
  it("ignores edits that touch no pricing field", () => {
    // Same pricing fields, different everything else (name/description/images/
    // slug/category/brand/tags/isActive/stock are simply not read).
    const after = simple({
      name: "اسم جدید",
      description: "توضیح تازه",
      images: ["/new.jpg"],
      slug: "new-slug",
      isActive: false,
      stock: 42,
    });
    expect(pricingRevisionChanged(simple(), after)).toBe(false);
  });

  it("detects a base price change", () => {
    expect(pricingRevisionChanged(simple(), simple({ price: 1_000_001 }))).toBe(true);
  });

  it("does not treat a numeric string as a price change", () => {
    expect(pricingRevisionChanged(simple(), simple({ price: "1000000" }))).toBe(false);
  });

  it("detects a simple ⇄ variant flip", () => {
    expect(pricingRevisionChanged(simple(), simple({ hasVariants: true }))).toBe(true);
    expect(
      pricingRevisionChanged(
        toPricingRevision({ hasVariants: true, price: 300, variants: [{ price: 300 }] }),
        toPricingRevision({ hasVariants: false, price: 300 })
      )
    ).toBe(true);
  });

  it("ignores a variant row reshuffle but detects swapped prices", () => {
    const before = toPricingRevision({
      hasVariants: true,
      price: 300,
      variants: [
        { price: 300, isActive: true },
        { price: 900, isActive: true },
      ],
    });
    const reshuffled = toPricingRevision({
      hasVariants: true,
      price: 300,
      variants: [
        { price: 900, isActive: true },
        { price: 300, isActive: true },
      ],
    });
    const swapped = toPricingRevision({
      hasVariants: true,
      price: 300,
      variants: [
        { price: 900, isActive: true },
        { price: 300, isActive: false },
      ],
    });
    expect(pricingRevisionChanged(before, reshuffled)).toBe(false);
    expect(pricingRevisionChanged(before, swapped)).toBe(true);
  });

  it("detects a non-minimum variant price change even when the summary price is unchanged", () => {
    const before = toPricingRevision({
      hasVariants: true,
      price: 300,
      variants: [
        { price: 300, isActive: true },
        { price: 900, isActive: true },
      ],
    });
    const after = toPricingRevision({
      hasVariants: true,
      price: 300,
      variants: [
        { price: 300, isActive: true },
        { price: 950, isActive: true },
      ],
    });
    expect(pricingRevisionChanged(before, after)).toBe(true);
  });

  it("detects variant availability flips and row add/remove", () => {
    const one = toPricingRevision({
      hasVariants: true,
      variants: [{ price: 300, isActive: true }],
    });
    expect(
      pricingRevisionChanged(
        one,
        toPricingRevision({ hasVariants: true, variants: [{ price: 300, isActive: false }] })
      )
    ).toBe(true);
    expect(
      pricingRevisionChanged(
        one,
        toPricingRevision({
          hasVariants: true,
          variants: [
            { price: 300, isActive: true },
            { price: 400, isActive: true },
          ],
        })
      )
    ).toBe(true);
    expect(
      pricingRevisionChanged(one, toPricingRevision({ hasVariants: true, variants: [] }))
    ).toBe(true);
  });

  it("fingerprints are stable and variant-order insensitive", () => {
    const a = toPricingRevision({
      price: 100,
      variants: [{ price: 100 }, { price: 200 }],
    });
    const b = toPricingRevision({
      price: 100,
      variants: [{ price: 200 }, { price: 100 }],
    });
    expect(computePricingFingerprint(a)).toBe(computePricingFingerprint(b));
    expect(computePricingFingerprint(a)).toBe(computePricingFingerprint(a));
    expect(computePricingFingerprint(a)).not.toBe(
      computePricingFingerprint(simple({ price: 100 }))
    );
  });
});
describe("discount semantics — omitted vs cleared vs changed", () => {
  const stored = { type: "percent", value: 20, isActive: true };

  it("an OMITTED discount (undefined) never moves the stamp", () => {
    const before = simple({ discount: stored });
    const after = simple({ discount: resolveNextDiscount(before.discount, undefined) });
    expect(pricingRevisionChanged(before, after)).toBe(false);
    // Same for a product with no stored discount yet: still a no-op.
    const none = simple();
    expect(
      pricingRevisionChanged(
        none,
        simple({ discount: resolveNextDiscount(none.discount, undefined) })
      )
    ).toBe(false);
  });

  it("CLEARING the discount (null) moves the stamp only when something was stored", () => {
    const withDiscount = simple({ discount: stored });
    expect(
      pricingRevisionChanged(
        withDiscount,
        simple({ discount: resolveNextDiscount(withDiscount.discount, null) })
      )
    ).toBe(true);
    // Nothing stored + explicit null → still "no discount" → no change.
    expect(pricingRevisionChanged(simple(), simple({ discount: null }))).toBe(false);
  });

  it("detects value / type / window / enabled changes", () => {
    const before = simple({ discount: stored });
    const cases: Array<Record<string, unknown>> = [
      { type: "percent", value: 25, isActive: true },
      { type: "fixed", value: 20, isActive: true },
      { type: "percent", value: 20, isActive: false },
      { type: "percent", value: 20, isActive: true, startsAt: STAMP },
      { type: "percent", value: 20, isActive: true, endsAt: STAMP },
    ];
    for (const discount of cases) {
      expect(
        pricingRevisionChanged(before, simple({ discount })),
        JSON.stringify(discount)
      ).toBe(true);
    }
  });

  it("compares discount windows at millisecond precision", () => {
    const before = simple({
      discount: { type: "percent", value: 20, endsAt: new Date("2024-11-15T00:00:00.000Z") },
    });
    const sameMs = simple({
      discount: { type: "percent", value: 20, endsAt: "2024-11-15T00:00:00.000Z" },
    });
    const nextMs = simple({
      discount: { type: "percent", value: 20, endsAt: new Date("2024-11-15T00:00:00.001Z") },
    });
    expect(pricingRevisionChanged(before, sameMs)).toBe(false);
    expect(pricingRevisionChanged(before, nextMs)).toBe(true);
  });
});

describe("normalizePriceVersionToken — the CAS token", () => {
  it("keeps finite versions (including 0) and maps everything else to null", () => {
    expect(normalizePriceVersionToken(0)).toBe(0);
    expect(normalizePriceVersionToken(7)).toBe(7);
    expect(normalizePriceVersionToken(-1)).toBe(-1);
    // Absent (legacy document), explicit null, junk → null: Mongo's
    // `{ priceVersion: null }` matches a MISSING field, while `undefined` would
    // be dropped by the caster and disable the CAS condition.
    expect(normalizePriceVersionToken(undefined)).toBeNull();
    expect(normalizePriceVersionToken(null)).toBeNull();
    expect(normalizePriceVersionToken("3")).toBeNull();
    expect(normalizePriceVersionToken(Number.NaN)).toBeNull();
    expect(normalizePriceVersionToken(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("initialPriceStampFields — the creation-time initializer", () => {
  it("returns ONLY the stamp, with the injected instant", () => {
    expect(initialPriceStampFields(STAMP)).toEqual({ priceLastUpdatedAt: STAMP });
  });

  it("defaults to now (the create payloads call it with no argument)", () => {
    const before = Date.now();
    const fields = initialPriceStampFields();
    const after = Date.now();
    expect(fields.priceLastUpdatedAt).toBeInstanceOf(Date);
    const t = fields.priceLastUpdatedAt.getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("NEVER sets priceVersion — the schema default 0 stays the 'no write yet' token", () => {
    expect("priceVersion" in initialPriceStampFields(STAMP)).toBe(false);
  });

  it("spreads into a create payload without disturbing it, and stamps surface a label", () => {
    const payload = {
      name: "کالا",
      price: 1000,
      isActive: true,
      ...initialPriceStampFields(STAMP),
    };
    expect(payload).toEqual({
      name: "کالا",
      price: 1000,
      isActive: true,
      priceLastUpdatedAt: STAMP,
    });
    // The creation stamp is immediately renderable on the public detail payload.
    expect(applyPriceStampVisibility(payload).priceLastUpdatedLabel).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ${JALALI}`
    );
  });
});

describe("price-stamp policy constants", () => {
  it("bounds the CAS loop to three attempts", () => {
    expect(PRICE_STAMP_MAX_ATTEMPTS).toBe(3);
  });
});
describe("stamp label — Jalali, store time zone, never the raw timestamp", () => {
  it("renders the prefix + Jalali date for a Date and for an ISO string", () => {
    expect(buildPriceStampLabel(STAMP)).toBe(`${PRICE_STAMP_LABEL_PREFIX}: ${JALALI}`);
    expect(buildPriceStampLabel(STAMP.toISOString())).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ${JALALI}`
    );
  });

  it("renders in the store zone (Asia/Tehran), not the host zone", () => {
    // 2024-11-14T21:00Z is already 2024-11-15 00:30 in Tehran — the SAME Jalali
    // day as STAMP, a DIFFERENT clock time, which is exactly why the label needs
    // the hour/minute and why a host-zone (UTC) host would print ۲۵ آبان ۱۴۰۳
    // ساعت ۰۰:۳۰ only by accident of a shifted date.
    expect(buildPriceStampLabel(new Date("2024-11-14T21:00:00.000Z"))).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ۲۵ آبان ۱۴۰۳ ساعت ۰۰:۳۰`
    );
    // 20:29Z is still ۲۴ آبان ۱۴۰۳ in Tehran (23:59) — one minute earlier would
    // roll the Jalali DAY back in UTC while Tehran keeps ۲۵ آبان.
    expect(buildPriceStampLabel(new Date("2024-11-14T20:29:00.000Z"))).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ۲۴ آبان ۱۴۰۳ ساعت ۲۳:۵۹`
    );
    expect(STORE_TIMEZONE).toBe("Asia/Tehran");
  });

  it("pads the clock time and renders midnight as ۰۰:۰۰ (h23, never ۲۴:۰۰)", () => {
    expect(buildPriceStampLabel(new Date("2024-11-14T20:30:00.000Z"))).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ۲۵ آبان ۱۴۰۳ ساعت ۰۰:۰۰`
    );
    expect(buildPriceStampLabel(new Date("2024-11-14T20:30:00.000Z"))).not.toContain(
      "۲۴:۰۰"
    );
    // Midday is two digits too.
    expect(buildPriceStampLabel(new Date("2024-11-15T08:30:00.000Z"))).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ۲۵ آبان ۱۴۰۳ ساعت ۱۲:۰۰`
    );
  });

  it("never leaks the fa-IR day period («قبل از ظهر» / «بعد از ظهر»)", () => {
    for (const iso of [
      "2024-11-15T00:00:00.000Z",
      "2024-11-15T08:30:00.000Z",
      "2024-11-15T15:00:00.000Z",
    ]) {
      const label = buildPriceStampLabel(new Date(iso))!;
      expect(label, iso).not.toContain("قبل از ظهر");
      expect(label, iso).not.toContain("بعد از ظهر");
    }
  });

  it("returns null — never 'Invalid Date' — for missing or malformed stamps", () => {
    for (const value of [null, undefined, "", "nope", new Date("nope")]) {
      expect(buildPriceStampLabel(value), JSON.stringify(String(value))).toBeNull();
    }
  });
});

describe("leak guards — the raw stamp/token never leave the server", () => {
  it("lists exactly the two internal fields", () => {
    expect([...PRICE_STAMP_INTERNAL_FIELDS]).toEqual([
      "priceVersion",
      "priceLastUpdatedAt",
    ]);
  });

  it("omitInternalPriceFields drops both fields, keeps the rest, mutates nothing", () => {
    const doc = {
      name: "کالا",
      price: 1000,
      priceVersion: 4,
      priceLastUpdatedAt: STAMP.toISOString(),
    };
    const visible = omitInternalPriceFields(doc);
    expect(visible).toEqual({ name: "کالا", price: 1000 });
    expect("priceVersion" in visible).toBe(false);
    expect("priceLastUpdatedAt" in visible).toBe(false);
    // Input untouched (lean docs are still in scope at the call site).
    expect(doc.priceVersion).toBe(4);
  });

  it("passes non-objects (a vanished-document write) through", () => {
    expect(omitInternalPriceFields(null)).toBeNull();
    expect(omitInternalPriceFields(undefined)).toBeUndefined();
  });

  it("applyPriceStampVisibility exchanges the timestamp for the label", () => {
    const doc = {
      name: "کالا",
      price: 1000,
      priceVersion: 9,
      priceLastUpdatedAt: STAMP.toISOString(),
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const visible = applyPriceStampVisibility(doc);
    expect(visible.priceLastUpdatedLabel).toBe(
      `${PRICE_STAMP_LABEL_PREFIX}: ${JALALI}`
    );
    expect("priceLastUpdatedAt" in visible).toBe(false);
    expect("priceVersion" in visible).toBe(false);
    expect(visible.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    // The source document keeps its raw stamp (the loader may still read it).
    expect(doc.priceLastUpdatedAt).toBe(STAMP.toISOString());
  });

  it("labels an unstamped product as null instead of inventing a date", () => {
    expect(applyPriceStampVisibility({ price: 10 }).priceLastUpdatedLabel).toBeNull();
    expect(
      applyPriceStampVisibility({ price: 10, priceLastUpdatedAt: null })
        .priceLastUpdatedLabel
    ).toBeNull();
  });

  it("stays leak-free after the public pricing layer (detail payload pipeline)", () => {
    // The real order in src/lib/public-products.ts: stamp visibility first, then
    // applyEffectivePricing (which replaces the raw discount with public metadata).
    const priced = applyEffectivePricing(
      applyPriceStampVisibility({
        price: 1000,
        priceVersion: 3,
        priceLastUpdatedAt: STAMP.toISOString(),
        discount: { type: "percent", value: 10, isActive: true },
      })
    );
    expect(priced.effectivePrice).toBe(900);
    expect(priced.discount?.percent).toBe(10);
    expect(priced.priceLastUpdatedLabel).toBe(`${PRICE_STAMP_LABEL_PREFIX}: ${JALALI}`);
    expect("priceLastUpdatedAt" in priced).toBe(false);
    expect("priceVersion" in priced).toBe(false);
  });
});