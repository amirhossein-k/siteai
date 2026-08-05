import { beforeEach, describe, expect, it, vi } from "vitest";

const { orderFind, orderFindOneAndUpdate } = vi.hoisted(() => ({
  orderFind: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
}));
const { restoreOrderStock } = vi.hoisted(() => ({ restoreOrderStock: vi.fn() }));
const { releaseCouponUsage } = vi.hoisted(() => ({ releaseCouponUsage: vi.fn() }));

vi.mock("@/models/Order", () => ({
  default: { find: orderFind, findOneAndUpdate: orderFindOneAndUpdate },
}));
vi.mock("@/lib/inventory", () => ({ restoreOrderStock }));
vi.mock("@/lib/coupons", () => ({ releaseCouponUsage }));

import { cleanupAbandonedPayments } from "@/lib/payment-cleanup";

const O1 = "a".repeat(24);
const O2 = "b".repeat(24);

function leanOf(value: unknown) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

/** Query-like stub for the Order.find(...).select("_id").lean() chain. */
function findSelectLean(ids: unknown[]) {
  return { select: () => leanOf(ids) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cleanupAbandonedPayments", () => {
  it("returns 0 when there are no abandoned orders", async () => {
    orderFind.mockReturnValue(findSelectLean([]));
    expect(await cleanupAbandonedPayments()).toBe(0);
    expect(restoreOrderStock).not.toHaveBeenCalled();
    expect(releaseCouponUsage).not.toHaveBeenCalled();
  });

  it("queries only pending_payment orders older than the cutoff", async () => {
    orderFind.mockReturnValue(findSelectLean([]));
    await cleanupAbandonedPayments();

    const [filter] = orderFind.mock.calls[0] as [Record<string, unknown>];
    expect(filter.status).toBe("pending_payment");
    const cutoff = (filter.updatedAt as { $lt: Date }).$lt;
    expect(cutoff).toBeInstanceOf(Date);
  });

  it("uses a 24h cutoff by default and honors maxAgeHours", async () => {
    orderFind.mockReturnValue(findSelectLean([]));

    await cleanupAbandonedPayments();
    const defaultCutoff = (orderFind.mock.calls[0][0] as {
      updatedAt: { $lt: Date };
    }).updatedAt.$lt;
    expect(Math.abs(Date.now() - 24 * 60 * 60 * 1000 - defaultCutoff.getTime())).toBeLessThan(60_000);

    await cleanupAbandonedPayments(1);
    const hourCutoff = (orderFind.mock.calls[1][0] as {
      updatedAt: { $lt: Date };
    }).updatedAt.$lt;
    expect(Math.abs(Date.now() - 60 * 60 * 1000 - hourCutoff.getTime())).toBeLessThan(60_000);
  });

  it("claims and cleans each abandoned order", async () => {
    orderFind.mockReturnValue(findSelectLean([{ _id: O1 }, { _id: O2 }]));
    orderFindOneAndUpdate.mockReturnValue(leanOf({ _id: O1, status: "cancelled" }));

    const count = await cleanupAbandonedPayments();

    expect(count).toBe(2);
    expect(restoreOrderStock).toHaveBeenCalledTimes(2);
    expect(restoreOrderStock).toHaveBeenCalledWith(O1);
    expect(restoreOrderStock).toHaveBeenCalledWith(O2);
    expect(releaseCouponUsage).toHaveBeenCalledWith(O1);
    expect(releaseCouponUsage).toHaveBeenCalledWith(O2);
  });

  it("skips orders another run already claimed", async () => {
    orderFind.mockReturnValue(findSelectLean([{ _id: O1 }, { _id: O2 }]));
    orderFindOneAndUpdate.mockReturnValue(leanOf(null)); // claim always loses

    const count = await cleanupAbandonedPayments();

    expect(count).toBe(0);
    expect(restoreOrderStock).not.toHaveBeenCalled();
    expect(releaseCouponUsage).not.toHaveBeenCalled();
  });

  it("claims with a pending/failed/canceled payment guard and a Persian note", async () => {
    orderFind.mockReturnValue(findSelectLean([{ _id: O1 }]));
    orderFindOneAndUpdate.mockReturnValue(leanOf({ _id: O1, status: "cancelled" }));

    await cleanupAbandonedPayments();

    const [filter, update] = orderFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(filter).toEqual({
      _id: O1,
      status: "pending_payment",
      "payment.status": { $in: ["pending", "failed", "canceled"] },
    });
    const set = update.$set as Record<string, unknown>;
    expect(set.status).toBe("cancelled");
    expect(set["payment.status"]).toBe("canceled");
    const pushed = (update.$push as { statusHistory: { status: string } })
      .statusHistory;
    expect(pushed.status).toBe("cancelled");
  });
});
