import { describe, expect, it } from "vitest";
import { PAGINATION } from "@/lib/constants";
import {
  buildPaginatedResponse,
  escapeRegex,
  parsePageParam,
  parsePaginationParams,
} from "@/lib/pagination";

function params(entries: Array<[string, string]>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("parsePageParam (Session 76 — single page-coercion used by the API,\n  the catalog URL state, the category page and the SEO policy)", () => {
  it("missing / null / undefined → 1", () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam(undefined)).toBe(1);
  });

  it("valid integers ≥ 1 pass through", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam("100")).toBe(100);
  });

  it("invalid values coerce to 1", () => {
    for (const v of ["0", "-2", "1.5", "abc", "NaN", " ", ""]) {
      expect(parsePageParam(v), `value=${JSON.stringify(v)}`).toBe(1);
    }
  });
});

describe("parsePaginationParams", () => {
  it("defaults to page 1 and DEFAULT_PAGE_SIZE when no params", () => {
    expect(parsePaginationParams(new URLSearchParams())).toEqual({
      page: 1,
      limit: PAGINATION.DEFAULT_PAGE_SIZE,
      skip: 0,
    });
  });

  it("parses valid page and limit", () => {
    expect(
      parsePaginationParams(params([["page", "3"], ["limit", "15"]]))
    ).toEqual({ page: 3, limit: 15, skip: 30 });
  });

  it("caps limit at MAX_PAGE_SIZE", () => {
    expect(parsePaginationParams(params([["limit", "500"]])).limit).toBe(
      PAGINATION.MAX_PAGE_SIZE
    );
  });

  it("coerces invalid page values to 1", () => {
    for (const v of ["0", "-2", "1.5", "abc", "NaN"]) {
      expect(parsePaginationParams(params([["page", v]])).page).toBe(1);
    }
  });

  it("coerces invalid limit values to the default", () => {
    for (const v of ["0", "-5", "1.5", "abc"]) {
      expect(parsePaginationParams(params([["limit", v]])).limit).toBe(
        PAGINATION.DEFAULT_PAGE_SIZE
      );
    }
  });

  it("computes skip correctly", () => {
    expect(parsePaginationParams(params([["page", "5"], ["limit", "10"]])).skip).toBe(
      40
    );
  });
});

describe("buildPaginatedResponse", () => {
  it("preserves data, page, limit and total", () => {
    const res = buildPaginatedResponse([1, 2], 42, 1, 20);
    expect(res.data).toEqual([1, 2]);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
    expect(res.total).toBe(42);
  });

  it("computes totalPages as ceil(total / limit) with a floor of 1", () => {
    expect(buildPaginatedResponse([], 0, 1, 20).totalPages).toBe(1);
    expect(buildPaginatedResponse([], 21, 1, 20).totalPages).toBe(2);
    expect(buildPaginatedResponse([], 40, 2, 20).totalPages).toBe(2);
  });

  it("sets hasNextPage / hasPreviousPage on the boundaries", () => {
    const first = buildPaginatedResponse([], 40, 1, 20);
    expect(first.hasNextPage).toBe(true);
    expect(first.hasPreviousPage).toBe(false);

    const last = buildPaginatedResponse([], 40, 2, 20);
    expect(last.hasNextPage).toBe(false);
    expect(last.hasPreviousPage).toBe(true);

    const single = buildPaginatedResponse([], 5, 1, 20);
    expect(single.hasNextPage).toBe(false);
    expect(single.hasPreviousPage).toBe(false);
  });
});

describe("escapeRegex", () => {
  it("escapes all regex metacharacters", () => {
    expect(escapeRegex("a.b+c")).toBe("a\\.b\\+c");
    expect(escapeRegex("(test)")).toBe("\\(test\\)");
    expect(escapeRegex("[x]")).toBe("\\[x\\]");
    expect(escapeRegex("$5")).toBe("\\$5");
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
    expect(escapeRegex("a?b*")).toBe("a\\?b\\*");
    expect(escapeRegex("100%")).toBe("100%");
  });

  it("leaves plain strings untouched", () => {
    expect(escapeRegex("hello world")).toBe("hello world");
    expect(escapeRegex("")).toBe("");
  });
});
