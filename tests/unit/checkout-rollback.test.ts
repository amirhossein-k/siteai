import { beforeEach, describe, expect, it, vi } from "vitest";

const { orderFindOneAndUpdate } = vi.hoisted(() => ({
  orderFindOneAndUpdate: vi.fn(),
}));
const { restoreOrderStock } = vi.hoisted(() => ({ restoreOrderStock: vi.fn() }));
const { releaseCouponUsage } = vi.hoisted(() => ({ releaseCouponUsage: vi.fn() }));

vi.mock("@/models/Order", () => ({
  default: { findOneAndUpdate: orderFindOneAndUpdate },
}));
vi.mock("@/lib/inventory", () => ({ restoreOrderStock }));
vi.mock("@/lib/coupons", () => ({ releaseCouponUsage }));

import { rollbackUnavailablePaymentCheckout } from "@/lib/checkout-rollback";

/**
 * Session 89 — gateway-failure checkout rollback.
 *
 * The bug being guarded: /api/checkout committed the order + the stock
 * reservation BEFORE calling the payment gateway, so a 502
 * ("gateway unavailable") leaked the reservation on every retry. These tests
 * pin the rollback's contract — cancel through the established payment-failure
 * lifecycle, restore inventory, release the coupon claim, never throw (the
 * caller must still answer 502) and never swallow a failure silently.
 */

const ORDER_ID = "c".repeat(24);

function errSpy() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  orderFindOneAndUpdate.mockResolvedValue({ _id: ORDER_ID, status: "cancelled" });
  restoreOrderStock.mockResolvedValue(undefined);
  releaseCouponUsage.mockResolvedValue(undefined);
});

describe("rollbackUnavailablePaymentCheckout", () => {
  it("cancels the unpaid pending order and restores stock + coupon usage", async () => {
    await rollbackUnavailablePaymentCheckout(ORDER_ID);

    expect(orderFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = orderFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $push: { statusHistory: Record<string, unknown> } },
    ];
    // Same atomic claim as cleanupAbandonedPayments: only an order still
    // awaiting payment may be cancelled by this path.
    expect(filter).toEqual({
      _id: ORDER_ID,
      status: "pending_payment",
      "payment.status": { $in: ["pending", "failed", "canceled"] },
    });
    expect(update.$set).toEqual({
      status: "cancelled",
      "payment.status": "canceled",
    });

    const history = update.$push.statusHistory;
    expect(history.status).toBe("cancelled");
    expect(history.at).toBeInstanceOf(Date);
    expect(typeof history.note).toBe("string");
    expect((history.note as string).length).toBeGreaterThan(0);

    // Inventory: the SHARED idempotent helper (variant/FIFO aware, also writes
    // the compensating cancellation_restock movements).
    expect(restoreOrderStock).toHaveBeenCalledTimes(1);
    expect(restoreOrderStock).toHaveBeenCalledWith(ORDER_ID);

    // Coupon: the idempotent order-level release (flips discount.released once).
    expect(releaseCouponUsage).toHaveBeenCalledTimes(1);
    expect(releaseCouponUsage).toHaveBeenCalledWith(ORDER_ID);
  });

  it("never deletes the order — its FIFO sale movements are already committed", async () => {
    const orderModel = (await import("@/models/Order"))
      .default as unknown as Record<string, unknown>;

    await rollbackUnavailablePaymentCheckout(ORDER_ID);

    // A delete would orphan the append-only sale movements of this order and
    // strand the admin/supplier notifications already dispatched.
    expect(orderModel.findByIdAndDelete).toBeUndefined();
    expect(orderModel.deleteOne).toBeUndefined();
    expect(orderModel.deleteMany).toBeUndefined();
  });

  it("still restores stock and releases the coupon when the cancel claim fails", async () => {
    orderFindOneAndUpdate.mockRejectedValue(new Error("write conflict"));
    const spy = errSpy();

    await expect(rollbackUnavailablePaymentCheckout(ORDER_ID)).resolves.toBeUndefined();

    expect(restoreOrderStock).toHaveBeenCalledWith(ORDER_ID);
    expect(releaseCouponUsage).toHaveBeenCalledWith(ORDER_ID);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain(ORDER_ID);
    spy.mockRestore();
  });

  it("still releases the coupon when the stock restore fails", async () => {
    restoreOrderStock.mockRejectedValue(new Error("layer conflict"));
    const spy = errSpy();

    await expect(rollbackUnavailablePaymentCheckout(ORDER_ID)).resolves.toBeUndefined();

    expect(releaseCouponUsage).toHaveBeenCalledWith(ORDER_ID);
    expect(String(spy.mock.calls[0][0])).toContain(ORDER_ID);
    spy.mockRestore();
  });

  it("never throws when the coupon release fails (the caller must still return 502)", async () => {
    releaseCouponUsage.mockRejectedValue(new Error("coupon store down"));
    const spy = errSpy();

    await expect(rollbackUnavailablePaymentCheckout(ORDER_ID)).resolves.toBeUndefined();

    expect(orderFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(restoreOrderStock).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain(ORDER_ID);
    spy.mockRestore();
  });

  it("logs only the order id and the failed step — no credentials", async () => {
    orderFindOneAndUpdate.mockRejectedValue(new Error("boom"));
    restoreOrderStock.mockRejectedValue(new Error("boom"));
    releaseCouponUsage.mockRejectedValue(new Error("boom"));
    const spy = errSpy();

    await rollbackUnavailablePaymentCheckout(ORDER_ID);

    const logged = spy.mock.calls.map((c) => String(c[0])).join(" | ");
    expect(logged).toContain(ORDER_ID);
    expect(logged).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(logged.toLowerCase()).not.toContain("merchant");
    expect(logged.toLowerCase()).not.toContain("authority");
    spy.mockRestore();
  });
});
