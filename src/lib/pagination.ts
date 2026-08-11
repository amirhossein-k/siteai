import { PAGINATION } from "@/lib/constants";
import type { PaginatedResponse } from "@/types";

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Parse a raw `?page=` value into a safe 1-based page number (Session 76).
 *
 * The SINGLE page-coercion used by the API, the /products catalog URL state,
 * the category page and the SEO policy — one mechanism, no second copy.
 * Missing / null / non-integer / zero / negative values coerce to 1.
 */
export function parsePageParam(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Safely parse `page` and `limit` query params.
 *
 * - `page` is 1-based. Invalid/negative/non-integer values coerce to 1
 *   (via parsePageParam).
 * - `limit` defaults to `PAGINATION.DEFAULT_PAGE_SIZE` and is capped at
 *   `PAGINATION.MAX_PAGE_SIZE`. Invalid/negative/non-integer values coerce to
 *   the default.
 */
export function parsePaginationParams(
  searchParams: URLSearchParams
): PaginationParams {
  const page = parsePageParam(searchParams.get("page"));
  const rawLimit = Number(searchParams.get("limit"));

  const limit =
    Number.isInteger(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, PAGINATION.MAX_PAGE_SIZE)
      : PAGINATION.DEFAULT_PAGE_SIZE;

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Build the standardized pagination response body:
 * { data, page, limit, total, totalPages, hasNextPage, hasPreviousPage }
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/** Escape a user-supplied string before interpolating it into a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
