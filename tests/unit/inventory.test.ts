import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  productFindById,
  productFindOne,
  productFindOneAndUpdate,
  productFindByIdAndUpdate,
  orderFindOneAndUpdate,
} = vi.hoisted(() => ({
  productFindById: vi.fn(),
  productFindOne: vi.fn(),
  productFindOneAndUpdate: vi.fn(),
  productFindByIdAndUpdate: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/models/Product", () => ({
  default: {
    findById: productFindById,
    findOne: productFindOne,
    findOneAndUpdate: productFindOneAndUpdate,
    findByIdAndUpdate: productFindByIdAndUpdate,
  },
}));
vi.mock("@/models/Order", () => ({
  default: { findOneAndUpdate: orderFindOneAndUpdate },
}));

import {
  reserveStock,
  restoreOrderStock,
  restoreStock,
  setVariantStock,
} from "@/lib/inventory";

const PID = "a".repeat(24);
const VID = "b".repeat(24);

function leanOf(value: unknown) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // restoreOrderStock is fail-silent and logs to console.error; keep the
  // suite output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("reserveStock (simple product)", () => {
  it("returns null when the product is missing", async () => {
    productFindById.mockReturnValue({
      select: () => ({ lean: vi.fn().mockResolvedValue(null) }),
    });
    expect(await reserveStock(PID, 1)).toBeNull();
    expect(productFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns null when stock is insufficient", async () => {
    productFindById.mockReturnValue({
      select: () =>
        ({ lean: vi.fn().mockResolvedValue({ _id: PID, stock: 1, stockVersion: 0 }) }),
    });
    expect(await reserveStock(PID, 2)).toBeNull();
    expect(productFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reserves atomically with the optimistic-lock filter", async () => {
    productFindById.mockReturnValue({
      select: () =>
        ({ lean: vi.fn().mockResolvedValue({ _id: PID, stock: 10, stockVersion: 3 }) }),
    });
    productFindOneAndUpdate.mockReturnValue(
      leanOf({ _id: PID, stock: 8, stockVersion: 4 })
    );

    const result = await reserveStock(PID, 2);

    expect(result).not.toBeNull();
    const [filter, update, options] = productFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(filter).toEqual({
      _id: PID,
      stock: { $gte: 2 },
      stockVersion: 3,
    });
    expect(update).toEqual({ $inc: { stock: -2, stockVersion: 1 } });
    expect(options).toEqual({ new: true });
  });
});

describe("reserveStock (variant product)", () => {
  it("returns null when the variant is missing or the product is gone", async () => {
    productFindOne.mockReturnValue(leanOf(null));
    expect(await reserveStock(PID, 1, VID)).toBeNull();
    expect(productFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns null for an inactive variant", async () => {
    productFindOne.mockReturnValue(
      leanOf({ _id: PID, variants: [{ _id: VID, stock: 5, stockVersion: 1, isActive: false }] })
    );
    expect(await reserveStock(PID, 1, VID)).toBeNull();
  });

  it("returns null when the variant stock is insufficient", async () => {
    productFindOne.mockReturnValue(
      leanOf({ _id: PID, variants: [{ _id: VID, stock: 5, stockVersion: 1, isActive: true }] })
    );
    expect(await reserveStock(PID, 6, VID)).toBeNull();
  });

  it("reserves via $elemMatch on the same variant element", async () => {
    productFindOne.mockReturnValue(
      leanOf({ _id: PID, variants: [{ _id: VID, stock: 5, stockVersion: 2, isActive: true }] })
    );
    productFindOneAndUpdate.mockReturnValue(leanOf({ _id: PID }));

    const result = await reserveStock(PID, 2, VID);
    expect(result).not.toBeNull();

    const [filter, update] = productFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    const elemMatch = (filter.variants as { $elemMatch: Record<string, unknown> })
      .$elemMatch;
    expect(elemMatch).toEqual({
      _id: VID,
      isActive: true,
      stock: { $gte: 2 },
      stockVersion: 2,
    });
    const inc = update.$inc as Record<string, number>;
    expect(inc["variants.$.stock"]).toBe(-2);
    expect(inc["variants.$.stockVersion"]).toBe(1);
    expect(inc.stock).toBe(-2); // top-level summary stays in sync
  });
});

describe("setVariantStock", () => {
  it("rejects invalid stock values without querying", async () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await setVariantStock(PID, VID, bad)).toBeNull();
    }
    expect(productFindOne).not.toHaveBeenCalled();
  });

  it("returns null when the variant is missing or inactive", async () => {
    productFindOne.mockReturnValue(leanOf(null));
    expect(await setVariantStock(PID, VID, 5)).toBeNull();

    productFindOne.mockReturnValue(
      leanOf({ _id: PID, variants: [{ _id: VID, stock: 1, stockVersion: 0, isActive: false }] })
    );
    expect(await setVariantStock(PID, VID, 5)).toBeNull();
  });

  it("sets the absolute stock and applies the delta to the summary", async () => {
    productFindOne.mockReturnValue(
      leanOf({ _id: PID, variants: [{ _id: VID, stock: 5, stockVersion: 1, isActive: true }] })
    );
    productFindOneAndUpdate.mockReturnValue(leanOf({ _id: PID }));

    const result = await setVariantStock(PID, VID, 8);
    expect(result).not.toBeNull();

    const [filter, update] = productFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    const elemMatch = (filter.variants as { $elemMatch: Record<string, unknown> })
      .$elemMatch;
    expect(elemMatch.stockVersion).toBe(1);
    const set = update.$set as Record<string, unknown>;
    expect(set["variants.$.stock"]).toBe(8);
    const inc = update.$inc as Record<string, number>;
    expect(inc.stock).toBe(3); // 8 - 5
    expect(inc["variants.$.stockVersion"]).toBe(1);
  });
});

describe("restoreStock", () => {
  it("restores a simple product via $inc", async () => {
    await restoreStock(PID, 5);
    expect(productFindByIdAndUpdate).toHaveBeenCalledWith(PID, {
      $inc: { stock: 5, stockVersion: 1 },
    });
  });

  it("restores a variant via the positional operator + summary", async () => {
    await restoreStock(PID, 5, VID);
    expect(productFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: PID, "variants._id": VID },
      {
        $inc: {
          "variants.$.stock": 5,
          "variants.$.stockVersion": 1,
          stock: 5,
        },
      }
    );
  });
});

describe("restoreOrderStock", () => {
  it("is a no-op when the claim fails (already restored)", async () => {
    orderFindOneAndUpdate.mockReturnValue({
      select: () => ({ lean: vi.fn().mockResolvedValue(null) }),
    });
    await restoreOrderStock("o".repeat(24));
    expect(productFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(productFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("restores every item, routing variants correctly", async () => {
    const orderId = "o".repeat(24);
    orderFindOneAndUpdate.mockReturnValue({
      select: () =>
        ({
          lean: vi.fn().mockResolvedValue({
            _id: orderId,
            items: [
              { product: "p".repeat(24), quantity: 2 },
              { product: "q".repeat(24), quantity: 1, variantId: VID },
            ],
          }),
        }) as never,
    });

    await restoreOrderStock(orderId);

    expect(productFindByIdAndUpdate).toHaveBeenCalledWith("p".repeat(24), {
      $inc: { stock: 2, stockVersion: 1 },
    });
    expect(productFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "q".repeat(24), "variants._id": VID },
      {
        $inc: {
          "variants.$.stock": 1,
          "variants.$.stockVersion": 1,
          stock: 1,
        },
      }
    );
  });

  it("is fail-silent when the order read throws", async () => {
    orderFindOneAndUpdate.mockReturnValue({
      select: () => ({ lean: vi.fn().mockRejectedValue(new Error("db down")) }),
    });
    await expect(restoreOrderStock("o".repeat(24))).resolves.toBeUndefined();
  });
});
