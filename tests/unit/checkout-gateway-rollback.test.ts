import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  requireAuth: vi.fn(),
  unauthorized: vi.fn(),
  serverError: vi.fn(),
  productFindById: vi.fn(),
  productFindOneAndUpdate: vi.fn(),
  inventoryMovementExists: vi.fn(),
  orderCreate: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
  orderFindById: vi.fn(),
  orderFindByIdAndUpdate: vi.fn(),
  supplierOrderCreate: vi.fn(),
  supplierOrderDeleteMany: vi.fn(),
  supplierFindById: vi.fn(),
  userFind: vi.fn(),
  inventoryMovementCreate: vi.fn(),
  couponFindByIdAndUpdate: vi.fn(),
  couponUsageUpdateOne: vi.fn(),
  sendNewOrderNotification: vi.fn(),
  sendAdminNewOrderNotification: vi.fn(),
  notifyOrderEvent: vi.fn(),
  requestPayment: vi.fn(),
  reserveStock: vi.fn(),
  restoreStock: vi.fn(),
}));

vi.mock("@/lib/dbConnect", () => ({ dbConnect: mocks.dbConnect }));
vi.mock("@/lib/auth-utils", () => ({
  requireAuth: mocks.requireAuth,
  unauthorized: mocks.unauthorized,
  serverError: mocks.serverError,
}));
vi.mock("@/models/Product", () => ({
  default: {
    findById: mocks.productFindById,
    // The REAL restoreOrderStock → real restoreStock runs against this seam.
    findOneAndUpdate: mocks.productFindOneAndUpdate,
  },
}));
vi.mock("@/models/Order", () => ({
  default: {
    create: mocks.orderCreate,
    findOneAndUpdate: mocks.orderFindOneAndUpdate,
    findById: mocks.orderFindById,
    findByIdAndUpdate: mocks.orderFindByIdAndUpdate,
  },
}));
vi.mock("@/models/SupplierOrder", () => ({
  default: {
    create: mocks.supplierOrderCreate,
    deleteMany: mocks.supplierOrderDeleteMany,
  },
}));
vi.mock("@/models/Supplier", () => ({
  default: { findById: mocks.supplierFindById },
}));
vi.mock("@/models/User", () => ({ default: { find: mocks.userFind } }));
vi.mock("@/models/InventoryMovement", () => ({
  default: {
    create: mocks.inventoryMovementCreate,
    exists: mocks.inventoryMovementExists,
  },
}));
vi.mock("@/models/Coupon", () => ({
  default: { findByIdAndUpdate: mocks.couponFindByIdAndUpdate },
}));
vi.mock("@/models/CouponUsage", () => ({
  default: { updateOne: mocks.couponUsageUpdateOne },
}));
vi.mock("@/lib/telegram", () => ({
  sendNewOrderNotification: mocks.sendNewOrderNotification,
  sendAdminNewOrderNotification: mocks.sendAdminNewOrderNotification,
}));
vi.mock("@/lib/notifications", () => ({
  notifyOrderEvent: mocks.notifyOrderEvent,
}));
vi.mock("@/lib/zarinpal", () => ({ requestPayment: mocks.requestPayment }));
// Keep the REAL restoreOrderStock (Order.stockRestored claim → per-item
// variant-routed restore through Product seams) and the REAL
// releaseCouponUsage — only the DB primitives are stubbed. The route's own
// reserveStock is stubbed at the same seam.
vi.mock("@/lib/inventory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/inventory")>();
  return {
    ...actual,
    reserveStock: mocks.reserveStock,
    restoreStock: mocks.restoreStock,
  };
});

import { POST } from "@/app/api/checkout/route";

/**
 * Session 89 — /api/checkout POST: the gateway-unavailable (502) AND the
 * gateway-unconfigured (503) paths must roll the committed order + stock
 * reservation back through the established payment-failure lifecycle, while
 * the successful and the out-of-stock paths stay byte-identical.
 *
 * The REAL rollback helper (src/lib/checkout-rollback.ts), the REAL
 * restoreOrderStock and the REAL releaseCouponUsage run here — only the
 * Mongoose primitives are mocked. The full flow is asserted at the seams:
 *   reservation → commit → gateway failure → cancel claim → stockRestored
 *   claim → variant-routed restoreStock → coupon usage released → unchanged
 *   502/503 response.
 */

const CUSTOMER_ID = "d".repeat(24);
const PRODUCT_ID = "6aaab0a2351255a9fdea54cf";
const VARIANT_ID = "6aaab0a2351255a9fdea54d0";
const SUPPLIER_ID = "6aaab0a2351255a9fdea5400";
const ORDER_ID = "6aabc47f317341a4178289ff";
const COUPON_ID = "e".repeat(24);
const CART_PRICE = 150000;
const AUTHORITY = "A00000000000000000000000000000123";

const ORIGINAL_MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID;

/** The product document reserveStock() returns after a successful reservation. */
function reservedProduct() {
  return {
    _id: PRODUCT_ID,
    name: "پیراهن دموی E2E",
    price: CART_PRICE,
    supplier: SUPPLIER_ID,
    sourcing: "consignment",
    variants: [
      {
        _id: VARIANT_ID,
        sku: "E2EDEMO-RED-M",
        price: CART_PRICE,
        supplierPrice: 110000,
        stock: 2,
        isActive: true,
        images: [],
        attributes: [
          { name: "رنگ", value: "قرمز" },
          { name: "سایز", value: "M" },
        ],
      },
    ],
  };
}

/** The lean() product read used by the reservation-failure error branch. */
function currentProduct(stock: number) {
  return {
    select: () => ({
      lean: async () => ({
        name: "پیراهن دموی E2E",
        stock,
        variants: [
          {
            _id: VARIANT_ID,
            stock,
            isActive: true,
            attributes: [
              { name: "رنگ", value: "قرمز" },
              { name: "سایز", value: "M" },
            ],
          },
        ],
      }),
    }),
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        id: PRODUCT_ID,
        variantId: VARIANT_ID,
        quantity: 2,
        price: CART_PRICE,
        name: "پیراهن دموی E2E",
      },
    ],
    shippingAddress: {
      fullName: "E2E Customer",
      phone: "09120000000",
      address: "Tehran, Some Street 1",
      postalCode: "1234567890",
    },
    paymentMethod: "zarinpal",
    ...overrides,
  };
}

async function callCheckout(body: Record<string, unknown>) {
  const req = { json: async () => body } as unknown as Request;
  return POST(req as unknown as Parameters<typeof POST>[0]);
}

/** The order doc releaseCouponUsage() reads when a coupon WAS claimed. */
const ORDER_WITH_COUPON = {
  discount: { couponId: COUPON_ID, released: false },
  customer: CUSTOMER_ID,
};

beforeAll(() => {
  // The route reads the merchant id per request; every test re-seeds one in
  // beforeEach so the success/502 paths are reachable (the 503 test deletes
  // it locally — beforeEach restores it for the next test).
});

afterAll(() => {
  if (ORIGINAL_MERCHANT_ID === undefined) {
    delete process.env.ZARINPAL_MERCHANT_ID;
  } else {
    process.env.ZARINPAL_MERCHANT_ID = ORIGINAL_MERCHANT_ID;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  // Fresh merchant config per test (the 503 test deletes it locally).
  process.env.ZARINPAL_MERCHANT_ID = "test-merchant-id";
  mocks.dbConnect.mockResolvedValue(undefined);
  mocks.requireAuth.mockResolvedValue({
    id: CUSTOMER_ID,
    phone: "09120000000",
    name: "E2E Customer",
    role: "customer",
  });
  mocks.reserveStock.mockResolvedValue(reservedProduct());
  mocks.orderCreate.mockResolvedValue({ _id: ORDER_ID });
  mocks.supplierOrderCreate.mockResolvedValue({ _id: "supplier-order" });
  mocks.orderFindByIdAndUpdate.mockResolvedValue({ _id: ORDER_ID });
  mocks.supplierFindById.mockReturnValue({
    select: () => ({ lean: async () => null }),
  });
  mocks.userFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  mocks.requestPayment.mockResolvedValue(null); // gateway unavailable
  mocks.productFindOneAndUpdate.mockResolvedValue({ _id: PRODUCT_ID });
  mocks.inventoryMovementExists.mockResolvedValue(null);
  // Real rollback-helper seams on the Order model:
  //  - cancel claim (filter carries status: "pending_payment") → succeeds
  //  - stockRestored claim (filter carries stockRestored: false) → returns the
  //    committed items so the REAL restoreOrderStock routes the restore
  //  - releaseCouponUsage's released-claim (filter carries
  //    "discount.released") → chainable .lean() (it calls .lean() directly)
  mocks.orderFindOneAndUpdate.mockImplementation((filter: Record<string, unknown>) => {
    if (filter.stockRestored === false) {
      return {
        select: () => ({
          lean: async () => ({
            items: [
              { product: PRODUCT_ID, quantity: 2, variantId: VARIANT_ID },
            ],
          }),
        }),
      };
    }
    if (filter["discount.released"] !== undefined) {
      return {
        lean: async () => ({
          discount: { couponId: COUPON_ID },
          customer: CUSTOMER_ID,
        }),
      };
    }
    return Promise.resolve({ _id: ORDER_ID, status: "cancelled" });
  });
  // releaseCouponUsage reads the order: default = no coupon on the order.
  mocks.orderFindById.mockReturnValue({
    select: () => ({ lean: async () => ({ discount: null, customer: CUSTOMER_ID }) }),
  });
  mocks.restoreStock.mockResolvedValue(undefined);
  mocks.couponFindByIdAndUpdate.mockResolvedValue({});
  mocks.couponUsageUpdateOne.mockResolvedValue({});
});

describe("POST /api/checkout — gateway unavailable (502)", () => {
  it("returns 502 and rolls the committed order + reservation back", async () => {
    const res = await callCheckout(payload());

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("درگاه پرداخت موقتاً در دسترس نیست");

    // The leak precondition: stock WAS reserved and the order WAS committed.
    expect(mocks.reserveStock).toHaveBeenCalledTimes(1);
    expect(mocks.reserveStock).toHaveBeenCalledWith(PRODUCT_ID, 2, VARIANT_ID);
    expect(mocks.orderCreate).toHaveBeenCalledTimes(1);
    expect(mocks.supplierOrderCreate).toHaveBeenCalledTimes(1);

    // Rollback step 1 — the SAME atomic cancellation claim as
    // cleanupAbandonedPayments/orders-cancel (only an unpaid pending order).
    const cancelCall = mocks.orderFindOneAndUpdate.mock.calls.find(
      ([filter]) => (filter as Record<string, unknown>).status === "pending_payment"
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall![0]).toEqual({
      _id: ORDER_ID,
      status: "pending_payment",
      "payment.status": { $in: ["pending", "failed", "canceled"] },
    });
    const cancelUpdate = cancelCall![1] as {
      $set: Record<string, unknown>;
      $push: { statusHistory: { status: string; note: string } };
    };
    expect(cancelUpdate.$set).toEqual({
      status: "cancelled",
      "payment.status": "canceled",
    });
    expect(cancelUpdate.$push.statusHistory.status).toBe("cancelled");
    expect(cancelUpdate.$push.statusHistory.note.length).toBeGreaterThan(0);

    // Rollback step 2 — stockRestored claim, then the variant-routed restore
    // through the REAL restoreOrderStock → real restoreStock chain, landing on
    // the Product seam: units return to the VARIANT stock (not the product
    // summary alone) via the same $inc shape restoreStock uses.
    const claimCall = mocks.orderFindOneAndUpdate.mock.calls.find(
      ([filter]) => (filter as Record<string, unknown>).stockRestored === false
    );
    expect(claimCall).toBeDefined();
    expect(claimCall![0]).toEqual({ _id: ORDER_ID, stockRestored: false });
    expect(mocks.productFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.productFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: PRODUCT_ID, "variants._id": VARIANT_ID },
      {
        $inc: {
          "variants.$.stock": 2,
          "variants.$.stockVersion": 1,
          stock: 2,
        },
      }
    );

    // Rollback step 3 — the coupon claim is released when applicable (here:
    // no coupon on the order → the idempotent release is a no-op).
    expect(mocks.couponFindByIdAndUpdate).not.toHaveBeenCalled();

    // The order is never deleted — its FIFO sale movements are committed.
    expect(mocks.supplierOrderDeleteMany).not.toHaveBeenCalled();

    // Ordering: reserve → ... → rollback restore (never restored before reserving).
    const reservedAt = mocks.reserveStock.mock.invocationCallOrder[0];
    const restoredAt = mocks.productFindOneAndUpdate.mock.invocationCallOrder[0];
    expect(reservedAt).toBeLessThan(restoredAt);
  });

  it("releases the coupon usage when the order carries a coupon claim", async () => {
    mocks.orderFindById.mockReturnValue({
      select: () => ({ lean: async () => ORDER_WITH_COUPON }),
    });

    const res = await callCheckout(payload());

    expect(res.status).toBe(502);
    expect(mocks.couponFindByIdAndUpdate).toHaveBeenCalledWith(COUPON_ID, {
      $inc: { usedCount: -1 },
    });
    expect(mocks.couponUsageUpdateOne).toHaveBeenCalledWith(
      { coupon: COUPON_ID, user: CUSTOMER_ID },
      { $inc: { count: -1 } }
    );
  });

  it("still answers 502 when the rollback fails (logged, never a 500)", async () => {
    mocks.orderFindOneAndUpdate.mockRejectedValue(new Error("write conflict"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await callCheckout(payload());

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("درگاه پرداخت موقتاً در دسترس نیست");
    expect(body.error).not.toContain("write conflict");
    // Not swallowed silently — the failure is logged server-side.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("POST /api/checkout — gateway unconfigured (503)", () => {
  it("reservation → missing merchant config → rollback → unchanged 503", async () => {
    delete process.env.ZARINPAL_MERCHANT_ID;

    const res = await callCheckout(payload());

    // The response body/status are byte-identical to the pre-fix behavior.
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      "درگاه پرداخت آنلاین پیکربندی نشده است. لطفاً روش پرداخت نقدی را انتخاب کنید."
    );

    // The gateway was never called, but the leak precondition existed:
    // stock reserved + order + supplier order committed.
    expect(mocks.requestPayment).not.toHaveBeenCalled();
    expect(mocks.reserveStock).toHaveBeenCalledTimes(1);
    expect(mocks.orderCreate).toHaveBeenCalledTimes(1);
    expect(mocks.supplierOrderCreate).toHaveBeenCalledTimes(1);

    // SAME established lifecycle as the 502 path:
    expect(mocks.orderFindOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: ORDER_ID,
        status: "pending_payment",
        "payment.status": { $in: ["pending", "failed", "canceled"] },
      },
      expect.objectContaining({
        $set: { status: "cancelled", "payment.status": "canceled" },
      })
    );
    expect(mocks.productFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: PRODUCT_ID, "variants._id": VARIANT_ID },
      {
        $inc: {
          "variants.$.stock": 2,
          "variants.$.stockVersion": 1,
          stock: 2,
        },
      }
    );
    // No coupon on this order → no coupon-store writes; nothing deleted.
    expect(mocks.couponFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(mocks.supplierOrderDeleteMany).not.toHaveBeenCalled();

    // Ordering: reserve → rollback restore.
    const reservedAt = mocks.reserveStock.mock.invocationCallOrder[0];
    const restoredAt = mocks.productFindOneAndUpdate.mock.invocationCallOrder[0];
    expect(reservedAt).toBeLessThan(restoredAt);
  });
});

describe("POST /api/checkout — success paths unchanged", () => {
  it("zarinpal: redirects with the authority and never rolls back", async () => {
    mocks.requestPayment.mockResolvedValue({
      authority: AUTHORITY,
      redirectUrl: `https://sandbox.zarinpal.com/pg/StartPay/${AUTHORITY}`,
    });

    const res = await callCheckout(payload());

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      orderId: string;
      paymentUrl: string;
      authority: string;
    };
    expect(body.orderId).toBe(ORDER_ID);
    expect(body.authority).toBe(AUTHORITY);
    expect(body.paymentUrl).toContain(AUTHORITY);
    expect(mocks.orderFindByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, {
      $set: { "payment.authority": AUTHORITY },
    });

    // Stock stays reserved for the pending payment — no cancellation claim,
    // no restore, no coupon release.
    expect(mocks.orderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.restoreStock).not.toHaveBeenCalled();
    expect(mocks.couponFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("manual payment: 201 without any gateway call or rollback", async () => {
    const res = await callCheckout(payload({ paymentMethod: "manual" }));

    expect(res.status).toBe(201);
    const body = (await res.json()) as { orderId: string };
    expect(body.orderId).toBe(ORDER_ID);
    expect(mocks.requestPayment).not.toHaveBeenCalled();
    expect(mocks.orderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.restoreStock).not.toHaveBeenCalled();
  });
});

describe("POST /api/checkout — reservation failure unchanged", () => {
  it("keeps the 409 out-of-stock message and creates nothing", async () => {
    mocks.reserveStock.mockResolvedValue(null);
    mocks.productFindById.mockReturnValue(currentProduct(0));

    const res = await callCheckout(payload());

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("به اتمام رسیده است");
    expect(mocks.orderCreate).not.toHaveBeenCalled();
    expect(mocks.orderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.restoreStock).not.toHaveBeenCalled();
  });
});
