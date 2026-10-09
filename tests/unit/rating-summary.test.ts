import { describe, it, expect } from "vitest";
import {
  buildApprovedReviewMatch,
  mergeRatingRows,
  parseMinRating,
  roundRatingAverage,
  sortSearchResultsByRelevanceThenRating,
  meetsMinRating
} from "@/lib/rating-summary";

const P1 = "65a000000000000000000001";
const P2 = "65a000000000000000000002";
const P3 = "65a000000000000000000003";
describe("buildApprovedReviewMatch", () => {
  it("matches approved reviews only, for the requested products", () => {
    const stage = buildApprovedReviewMatch([P1, P2]);
    expect(stage.$match.status).toBe("approved");
    expect(stage.$match.product.$in).toHaveLength(2);
    expect(String(stage.$match.product.$in[0])).toBe(P1);
  });
});

describe("mergeRatingRows", () => {
  it("returns the rounded average and the approved count", () => {
    const map = mergeRatingRows([P1], [{ _id: P1, average: 4.333, count: 3 }]);
    expect(map.get(P1)).toEqual({ average: 4.3, count: 3 });
  });

  it("returns the explicit zero state for products without approved reviews", () => {
    const map = mergeRatingRows([P1, P2], [{ _id: P1, average: 5, count: 1 }]);
    expect(map.get(P2)).toEqual({ average: 0, count: 0 });
  });

  it("gives every requested product an entry, even with no rows at all", () => {
    const map = mergeRatingRows([P1, P2, P3], []);
    expect(map.size).toBe(3);
    for (const id of [P1, P2, P3]) {
      expect(map.get(id)).toEqual({ average: 0, count: 0 });
    }
  });

  it("does not return summaries for products that were not requested", () => {
    const map = mergeRatingRows([P1], [{ _id: P2, average: 2, count: 2 }]);
    expect(map.has(P2)).toBe(false);
    expect(map.get(P1)).toEqual({ average: 0, count: 0 });
  });
});

describe("parseMinRating", () => {
  it("accepts integers 1 through 5", () => {
    for (const v of ["1", "3", "4", "5"]) {
      expect(parseMinRating(v)).toBe(Number(v));
    }
  });

  it("ignores absent, empty, out-of-range and non-integer values", () => {
    for (const v of [null, "", "0", "6", "-1", "3.5", "abc"]) {
      expect(parseMinRating(v)).toBeNull();
    }
  });
});

describe("roundRatingAverage", () => {
  it("rounds to one decimal place", () => {
    expect(roundRatingAverage(3.25)).toBe(3.3);
    expect(roundRatingAverage(4)).toBe(4);
    expect(roundRatingAverage(1.04)).toBe(1);
  });
});

describe("meetsMinRating", () => {
  it("uses the rounded average at the threshold boundary", () => {
    expect(meetsMinRating(3.96, 4)).toBe(true);
    expect(meetsMinRating(3.94, 4)).toBe(false);
  });

  it("accepts an exact threshold", () => {
    expect(meetsMinRating(4, 4)).toBe(true);
  });

  it("does not filter when the minimum is null", () => {
    expect(meetsMinRating(0, null)).toBe(true);
  });
});
describe("sortSearchResultsByRelevanceThenRating", () => {
  it("prioritizes relevance over rating", () => {
    const results = sortSearchResultsByRelevanceThenRating([
      {
        id: "high-rating",
        relevance: 40,
        average: 5,
        count: 100,
        createdAt: "2026-01-01",
      },
      {
        id: "high-relevance",
        relevance: 100,
        average: 3,
        count: 1,
        createdAt: "2026-01-01",
      },
    ]);

    expect(results.map((item) => item.id)).toEqual([
      "high-relevance",
      "high-rating",
    ]);
  });

  it("uses rating and review count to break relevance ties", () => {
    const results = sortSearchResultsByRelevanceThenRating([
      {
        id: "lower-rating",
        relevance: 40,
        average: 4,
        count: 100,
        createdAt: "2026-01-03",
      },
      {
        id: "higher-rating",
        relevance: 40,
        average: 4.8,
        count: 2,
        createdAt: "2026-01-01",
      },
      {
        id: "more-reviews",
        relevance: 40,
        average: 4,
        count: 101,
        createdAt: "2026-01-01",
      },
    ]);

    expect(results.map((item) => item.id)).toEqual([
      "higher-rating",
      "more-reviews",
      "lower-rating",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      {
        id: "a",
        relevance: 1,
        average: 1,
        count: 1,
        createdAt: "2026-01-01",
      },
      {
        id: "b",
        relevance: 2,
        average: 2,
        count: 2,
        createdAt: "2026-01-02",
      },
    ];

    const original = [...input];

    sortSearchResultsByRelevanceThenRating(input);

    expect(input).toEqual(original);
  });
});
