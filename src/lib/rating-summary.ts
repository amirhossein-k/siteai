import mongoose from "mongoose";
import Review from "@/models/Review";
import type { RatingSummary } from "@/types";

/** Only approved reviews contribute to ratings (finalized requirement). */
export const APPROVED_REVIEW_STATUS = "approved" as const;

export const EMPTY_RATING_SUMMARY: RatingSummary = { average: 0, count: 0 };

/** Round an average to one decimal place (matches computeRatingSummary). */
export function roundRatingAverage(value: number): number {
  return Math.round(value * 10) / 10;
}

export function meetsMinRating(
  average: number,
  minRating: number | null
): boolean {
  if (minRating === null) return true;
  return roundRatingAverage(average) >= minRating;
}

/**
 * Build the `$match` stage that selects approved reviews for a set of products.
 * Exported so the aggregation contract is unit-testable without a database.
 */
export function buildApprovedReviewMatch(productIds: string[]) {
  return {
    $match: {
      status: APPROVED_REVIEW_STATUS,
      product: {
        $in: productIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    },
  };
}

/**
 * Pure merge: given the grouped aggregation rows, return a summary for every
 * requested product id. Missing products get the explicit zero state, so the
 * caller never has to handle `undefined`.
 */
export function mergeRatingRows(
  productIds: string[],
  rows: Array<{ _id: unknown; average: number; count: number }>
): Map<string, RatingSummary> {
  const byId = new Map<string, RatingSummary>();
  for (const row of rows) {
    byId.set(String(row._id), {
      average: roundRatingAverage(row.average),
      count: row.count,
    });
  }
  const result = new Map<string, RatingSummary>();
  for (const id of productIds) {
    result.set(id, byId.get(id) ?? { ...EMPTY_RATING_SUMMARY });
  }
  return result;
}

/** Parse `minRating` (integer 1–5). Anything else means "no rating filter". */
export function parseMinRating(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * Catalog-wide ordering of rated products. Groups ALL approved reviews (not the
 * current page) so filtering and sorting run before pagination. Returns the
 * rated ids in descending average, then descending count, then id (stable).
 */
export async function getRatedProductOrder(
  minRating: number | null,
  restrictToIds?: mongoose.Types.ObjectId[]
): Promise<Array<{ _id: mongoose.Types.ObjectId; average: number; count: number }>> {
  const pipeline: mongoose.PipelineStage[] = [
    { $match: { status: APPROVED_REVIEW_STATUS } },
    ...(restrictToIds
      ? [{ $match: { product: { $in: restrictToIds } } } as mongoose.PipelineStage]
      : []),
    {
      $group: {
        _id: "$product",
        average: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
    // Rounded to one decimal to match the average shown on the card.
    {
      $project: {
        average: { $round: ["$average", 1] },
        count: 1,
      },
    },
    ...(minRating !== null
      ? [{ $match: { average: { $gte: minRating } } } as mongoose.PipelineStage]
      : []),
    { $sort: { average: -1, count: -1, _id: -1 } },
  ];
  return Review.aggregate(pipeline);
}

/**
 * Batched rating summaries for one list request: ONE grouped aggregation over
 * the approved reviews of all requested products (no per-product query).
 */
export async function computeRatingSummaries(
  productIds: string[]
): Promise<Map<string, RatingSummary>> {
  if (productIds.length === 0) return new Map();
  const rows = await Review.aggregate<{
    _id: unknown;
    average: number;
    count: number;
  }>([
    buildApprovedReviewMatch(productIds),
    {
      $group: {
        _id: "$product",
        average: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);
  return mergeRatingRows(productIds, rows);
}

export interface RankedProduct {
  id: string;
  relevance: number;
  average: number;
  count: number;
  createdAt: Date | string;
}

/**
 * Sort search results without allowing rating to outrank relevance.
 * Average values must already use the same one-decimal rounding as the UI.
 */
export function sortSearchResultsByRelevanceThenRating<T extends RankedProduct>(
  products: T[]
): T[] {
  return [...products].sort((a, b) => {
    if (a.relevance !== b.relevance) {
      return b.relevance - a.relevance;
    }

    if (a.average !== b.average) {
      return b.average - a.average;
    }

    if (a.count !== b.count) {
      return b.count - a.count;
    }

    const dateDifference =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

    if (dateDifference !== 0) return dateDifference;

    return b.id.localeCompare(a.id);
  });
}