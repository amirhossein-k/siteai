import { beforeEach, describe, expect, it, vi } from "vitest";

const { orderFindById, productBulkWrite } = vi.hoisted(() => ({
  orderFindById: vi.fn(),
  productBulkWrite: vi.fn(),
}));

vi.mock("@/models/Order", () => ({ default: { findById: orderFindById } }));
vi.mock("@/models/Product", () => ({ default: { bulkWrite: productBulkWrite } }));

import { recordOrderSales, reverseOrderSales } from "@/lib/product-sales";

const OID = "a".repeat(24);
const P1 = "b".repeat(24);
const P2 = "c".repeat(24);

function orderOf(items: Array<Record<string, unknown>>) {
  return {
    select: () => ({ lean: vi.fn().mockResolvedValue({ _id: OID, items }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The fail-silent paths intentionally log to console.error; keep the
  // suite output readable by silencing those expected messages.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("recordOrderSales", () => {
  it("increments soldCount for every item with a product id", async () => {
    orderFindById.mockReturnValue(
      orderOf([
        { product: P1, quantity: 2 },
        { product: P2, quantity: 1 },
      ])
    );
    productBulkWrite.mockResolvedValue({});

    await recordOrderSales(OID);

    expect(productBulkWrite).toHaveBeenCalledTimes(1);
    const [writes] = productBulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: Record<string, unknown>; update: unknown[] } }>
    ];
    expect(writes).toHaveLength(2);
    expect(writes[0].updateOne.filter).toEqual({ _id: P1 });
    // Increment pipeline: $add over $ifNull so legacy docs start from 0.
    const pipeline = writes[0].updateOne.update as Array<{
      $set: { soldCount: { $add: unknown[] } };
    }>;
    expect(pipeline[0].$set.soldCount.$add[1]).toBe(2);
  });

  it("is a no-op for an invalid order id", async () => {
    await recordOrderSales("not-an-object-id");
    expect(orderFindById).not.toHaveBeenCalled();
    expect(productBulkWrite).not.toHaveBeenCalled();
  });

  it("is a no-op when the order or its items are missing", async () => {
    orderFindById.mockReturnValue(orderOf([]));
    await recordOrderSales(OID);
    expect(productBulkWrite).not.toHaveBeenCalled();

    orderFindById.mockReturnValue({
      select: () => ({ lean: vi.fn().mockResolvedValue(null) }),
    });
    await recordOrderSales(OID);
    expect(productBulkWrite).not.toHaveBeenCalled();
  });

  it("skips items without a product id or with an invalid quantity", async () => {
    orderFindById.mockReturnValue(
      orderOf([
        { quantity: 2 }, // deleted-product placeholder
        { product: P1, quantity: "abc" }, // non-finite
        { product: P2, quantity: 0 }, // non-positive
      ])
    );

    await recordOrderSales(OID);
    expect(productBulkWrite).not.toHaveBeenCalled();
  });

  it("is fail-silent when the order read or bulkWrite throws", async () => {
    orderFindById.mockReturnValue({
      select: () => ({ lean: vi.fn().mockRejectedValue(new Error("db down")) }),
    });
    await expect(recordOrderSales(OID)).resolves.toBeUndefined();

    orderFindById.mockReturnValue(orderOf([{ product: P1, quantity: 1 }]));
    productBulkWrite.mockRejectedValue(new Error("bulk failed"));
    await expect(recordOrderSales(OID)).resolves.toBeUndefined();
  });
});

describe("reverseOrderSales", () => {
  it("decrements soldCount with a floor at 0", async () => {
    orderFindById.mockReturnValue(orderOf([{ product: P1, quantity: 3 }]));
    productBulkWrite.mockResolvedValue({});

    await reverseOrderSales(OID);

    const [writes] = productBulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: Record<string, unknown>; update: unknown[] } }>
    ];
    const pipeline = writes[0].updateOne.update as Array<{
      $set: { soldCount: { $max: unknown[] } };
    }>;
    const max = pipeline[0].$set.soldCount.$max as unknown[];
    const add = max[0] as { $add: unknown[] };
    expect(add.$add[1]).toBe(-3);
    expect(max[1]).toBe(0); // refund can never drive a legacy product negative
  });
});
