import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
       dbConnect: vi.fn(),
       productFind: vi.fn(),
       productCountDocuments: vi.fn(),
       productAggregate: vi.fn(),
       reviewAggregate: vi.fn(),
       attributeFind: vi.fn(),
       brandFind: vi.fn(),
       tagFind: vi.fn(),
       categoryFind: vi.fn(),
       computeRatingSummaries: vi.fn(),
       getRatedProductOrder: vi.fn(),
}));

vi.mock("@/lib/dbConnect", () => ({
       dbConnect: mocks.dbConnect,
}));

vi.mock("@/models/Product", () => ({
       default: {
              find: mocks.productFind,
              countDocuments: mocks.productCountDocuments,
              aggregate: mocks.productAggregate,
       },
}));

vi.mock("@/models/Review", () => ({
       default: {
              aggregate: mocks.reviewAggregate,
              collection: { name: "reviews" },
       },
}));

vi.mock("@/models/Attribute", () => ({
       default: { find: mocks.attributeFind },
}));

vi.mock("@/models/Brand", () => ({
       default: { find: mocks.brandFind },
}));

vi.mock("@/models/Tag", () => ({
       default: { find: mocks.tagFind },
}));

vi.mock("@/models/Category", () => ({
       default: { find: mocks.categoryFind },
}));

vi.mock("@/lib/rating-summary", () => ({
       parseMinRating: (value: string | null) => {
              if (value === null || value === "") return null;
              const n = Number(value);
              return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
       },
       getRatedProductOrder: mocks.getRatedProductOrder,
       computeRatingSummaries: mocks.computeRatingSummaries,
}));

import { GET } from "@/app/api/products/route";

const ID_A = "6aaab0a2351255a9fdea5401";
const ID_B = "6aaab0a2351255a9fdea5402";
const ID_C = "6aaab0a2351255a9fdea5403";

function product(id: string, createdAt: string) {
       return {
              _id: id,
              name: `Product ${id.slice(-1)}`,
              price: 100,
              createdAt: new Date(createdAt),
              variants: [],
       };
}

function query(url: string) {
       return new Request(`http://localhost${url}`) as Parameters<typeof GET>[0];
}

function chainableFindResult(rows: unknown[]) {
       const chain = {
              select: vi.fn(() => chain),
              populate: vi.fn(() => chain),
              sort: vi.fn(() => chain),
              skip: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              lean: vi.fn(async () => rows),
       };
       return chain;
}

function chainableAttributeResult(rows: unknown[]) {
       return {
              select: () => ({
                     lean: async () => rows,
              }),
       };
}

describe("GET /api/products rating behavior", () => {
       beforeEach(() => {
              vi.clearAllMocks();

              mocks.dbConnect.mockResolvedValue(undefined);
              mocks.attributeFind.mockReturnValue(chainableAttributeResult([]));
              mocks.brandFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });
              mocks.tagFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });
              mocks.categoryFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });

              mocks.getRatedProductOrder.mockResolvedValue([]);
              mocks.computeRatingSummaries.mockImplementation(
                     async (ids: string[]) =>
                            new Map(
                                   ids.map((id) => [
                                          id,
                                          { average: 0, count: 0 },
                                   ]),
                            ),
              );
       });

       afterEach(() => {
              vi.restoreAllMocks();
       });

       it("puts rated products first and keeps unrated products newest-first", async () => {
              const newestUnrated = product(ID_C, "2026-10-03T10:00:00Z");
              const olderUnrated = product(ID_B, "2026-10-02T10:00:00Z");
              const ratedProduct = product(ID_A, "2026-10-01T10:00:00Z");

              mocks.getRatedProductOrder.mockResolvedValue([
                     { _id: ID_A, average: 4.8, count: 12 },
              ]);

              mocks.productFind
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   newestUnrated,
                                   olderUnrated,
                                   ratedProduct,
                            ]),
                     )
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   ratedProduct,
                                   newestUnrated,
                                   olderUnrated,
                            ]),
                     );

              const response = await GET(query("/api/products?sort=rating_desc&limit=10"));
              const body = await response.json();

              expect(response.status).toBe(200);
              expect(body.data.map((p: { _id: string }) => p._id)).toEqual([
                     ID_A,
                     ID_C,
                     ID_B,
              ]);
              expect(body.total).toBe(3);
              expect(mocks.getRatedProductOrder).toHaveBeenCalledWith(null);
       });

       it("applies pagination after rating order is computed", async () => {
              mocks.getRatedProductOrder.mockResolvedValue([
                     { _id: ID_A, average: 4.9, count: 5 },
                     { _id: ID_B, average: 4.5, count: 10 },
              ]);

              mocks.productFind
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   product(ID_C, "2026-10-03T10:00:00Z"),
                                   product(ID_A, "2026-10-01T10:00:00Z"),
                                   product(ID_B, "2026-10-02T10:00:00Z"),
                            ]),
                     )
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   product(ID_B, "2026-10-02T10:00:00Z"),
                            ]),
                     );

              const response = await GET(
                     query("/api/products?sort=rating_desc&page=2&limit=1"),
              );
              const body = await response.json();

              expect(response.status).toBe(200);
              expect(body.data.map((p: { _id: string }) => p._id)).toEqual([ID_B]);
              expect(body.page).toBe(2);
              expect(body.limit).toBe(1);
              expect(body.total).toBe(3);
       });

       it("restricts results to products meeting minRating", async () => {
              mocks.getRatedProductOrder.mockResolvedValue([
                     { _id: ID_A, average: 4, count: 3 },
              ]);

              mocks.productFind
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   product(ID_A, "2026-10-01T10:00:00Z"),
                            ]),
                     )
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   product(ID_A, "2026-10-01T10:00:00Z"),
                            ]),
                     );

              const response = await GET(
                     query("/api/products?sort=rating_desc&minRating=4"),
              );
              const body = await response.json();

              expect(response.status).toBe(200);
              expect(body.data.map((p: { _id: string }) => p._id)).toEqual([ID_A]);
              expect(mocks.getRatedProductOrder).toHaveBeenCalledWith(4);

              const findFilter = mocks.productFind.mock.calls[0][0] as {
                     $and?: Array<Record<string, unknown>>;
              };
              expect(findFilter.$and).toEqual(
                     expect.arrayContaining([
                            { _id: { $in: [ID_A] } },
                     ]),
              );
       });

       it("returns rating summaries for products on the current page", async () => {
              mocks.getRatedProductOrder.mockResolvedValue([
                     { _id: ID_A, average: 4.7, count: 9 },
              ]);

              mocks.productFind
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   product(ID_A, "2026-10-01T10:00:00Z"),
                            ]),
                     )
                     .mockReturnValueOnce(
                            chainableFindResult([
                                   product(ID_A, "2026-10-01T10:00:00Z"),
                            ]),
                     );

              mocks.computeRatingSummaries.mockResolvedValue(
                     new Map([[ID_A, { average: 4.7, count: 9 }]]),
              );

              const response = await GET(query("/api/products?sort=rating_desc"));
              const body = await response.json();

              expect(response.status).toBe(200);
              expect(body.data[0].ratingSummary).toEqual({
                     average: 4.7,
                     count: 9,
              });
              expect(mocks.computeRatingSummaries).toHaveBeenCalledWith([ID_A]);
       });
       it("keeps search relevance ahead of rating and paginates after sorting", async () => {
              mocks.brandFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });
              mocks.tagFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });
              mocks.categoryFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });

              mocks.productAggregate.mockResolvedValue([
                     { _id: ID_A },
              ]);
              mocks.productCountDocuments.mockResolvedValue(2);

              mocks.productFind.mockReturnValue(
                     chainableFindResult([
                            product(ID_A, "2026-10-01T10:00:00Z"),
                     ]),
              );

              const response = await GET(
                     query("/api/products?search=shirt&sort=rating_desc&page=2&limit=1"),
              );

              expect(response.status).toBe(200);

              const pipeline = mocks.productAggregate.mock.calls[0][0] as Array<
                     Record<string, unknown>
              >;

              const sortStageIndex = pipeline.findIndex(
                     (stage) => "$sort" in stage,
              );
              const skipStageIndex = pipeline.findIndex(
                     (stage) => "$skip" in stage,
              );
              const limitStageIndex = pipeline.findIndex(
                     (stage) => "$limit" in stage,
              );

              expect(sortStageIndex).toBeGreaterThan(-1);
              expect(pipeline[sortStageIndex].$sort).toEqual({
                     score: -1,
                     ratingAverage: -1,
                     ratingCount: -1,
                     createdAt: -1,
                     _id: -1,
              });

              expect(skipStageIndex).toBeGreaterThan(sortStageIndex);
              expect(limitStageIndex).toBeGreaterThan(skipStageIndex);
              expect(pipeline[skipStageIndex].$skip).toBe(1);
              expect(pipeline[limitStageIndex].$limit).toBe(1);
       });

       it("uses approved reviews and rounded average in the rating lookup", async () => {
              mocks.brandFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });
              mocks.tagFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });
              mocks.categoryFind.mockReturnValue({
                     distinct: vi.fn().mockResolvedValue([]),
              });

              mocks.productAggregate.mockResolvedValue([{ _id: ID_A }]);
              mocks.productCountDocuments.mockResolvedValue(1);
              mocks.productFind.mockReturnValue(
                     chainableFindResult([
                            product(ID_A, "2026-10-01T10:00:00Z"),
                     ]),
              );

              const response = await GET(
                     query("/api/products?search=shirt&sort=rating_desc"),
              );

              expect(response.status).toBe(200);

              const pipeline = mocks.productAggregate.mock.calls[0][0] as Array<
                     Record<string, unknown>
              >;

              const lookupStage = pipeline.find((stage) => "$lookup" in stage);
              expect(lookupStage).toBeDefined();

              const lookup = lookupStage!.$lookup as {
                     from: string;
                     pipeline: Array<Record<string, unknown>>;
              };

              expect(lookup.from).toBe("reviews");
              expect(lookup.pipeline).toContainEqual({
                     $group: {
                            _id: null,
                            average: { $avg: "$rating" },
                            count: { $sum: 1 },
                     },
              });
              expect(lookup.pipeline).toContainEqual({
                     $project: {
                            _id: 0,
                            average: { $round: ["$average", 1] },
                            count: 1,
                     },
              });

              const matchStage = lookup.pipeline.find(
                     (stage) => "$match" in stage,
              );
              expect(matchStage).toBeDefined();

              const match = matchStage!.$match as {
                     $expr: { $and: unknown[] };
              };

              expect(match.$expr.$and).toContainEqual({
                     $eq: ["$status", "approved"],
              });
       });
});