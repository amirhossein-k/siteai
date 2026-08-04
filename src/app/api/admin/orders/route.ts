import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
} from "@/lib/auth-utils";
import Order from "@/models/Order";
import User from "@/models/User";
import { sendAdminOrderStatusNotification } from "@/lib/telegram";
import { notifyOrderEvent } from "@/lib/notifications";
import { restoreOrderStock } from "@/lib/inventory";
import { releaseCouponUsage } from "@/lib/coupons";
import { reverseOrderSales } from "@/lib/product-sales";
import {
  parsePaginationParams,
  buildPaginatedResponse,
  escapeRegex,
} from "@/lib/pagination";

// Valid status transitions
const validTransitions: Record<string, string[]> = {
  pending_payment: ["processing", "cancelled"],
  processing: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // If ?id= is provided, return a single order
    if (id) {
      const order = await Order.findById(id)
        .populate("customer", "name phone")
        .lean();

      if (!order) {
        return NextResponse.json(
          { error: "سفارش یافت نشد" },
          { status: 404 }
        );
      }

      return NextResponse.json(order);
    }

    // --- List orders with search + status filter + pagination ---
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const filter: Record<string, unknown> = {};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Search — matches order id, customer name, or customer phone.
    // customer is an ObjectId ref at query time, so resolve matching user ids
    // first (dotted-path filters like "customer.name" never match).
    if (search) {
      const safeSearch = escapeRegex(search);
      const regex = new RegExp(safeSearch, "i");
      const customerIds = await User.find({
        $or: [{ name: regex }, { phone: regex }],
      }).distinct("_id");
      filter.$or = [
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: safeSearch,
              options: "i",
            },
          },
        },
        { customer: { $in: customerIds } },
      ];
    }

    const { page, limit, skip } = parsePaginationParams(searchParams);

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .populate("customer", "name phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(orders, total, page, limit)
    );
  } catch (error) {
    console.error("Error fetching orders:", error);
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه سفارش الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { status, note } = body;

    if (!status) {
      return NextResponse.json(
        { error: "وضعیت جدید الزامی است" },
        { status: 400 }
      );
    }

    // Find the order to validate transition
    const order = await Order.findById(id);
    if (!order) {
      return NextResponse.json(
        { error: "سفارش یافت نشد" },
        { status: 404 }
      );
    }

    // Validate status transition
    const allowedTransitions = validTransitions[order.status];
    if (!allowedTransitions || !allowedTransitions.includes(status)) {
      return NextResponse.json(
        {
          error: `امکان تغییر وضعیت از "${
            order.status
          }" به "${status}" وجود ندارد`,
        },
        { status: 400 }
      );
    }

    // Add status history entry
    order.statusHistory.push({
      status,
      at: new Date(),
      note: note || "",
    });

    // Update order status
    order.status = status;

    // Auto-update payment status when order is cancelled
    if (status === "cancelled" && order.payment.status === "pending") {
      order.payment.status = "failed";
    }

    await order.save();

    // When cancelling, restore stock for all items (if not already restored)
    if (status === "cancelled" && !order.stockRestored) {
      await restoreOrderStock(id);
    }

    // When cancelling, release the coupon claim (idempotent; no-op when no
    // coupon was applied — mirrors the payment-failure release paths)
    if (status === "cancelled") {
      await releaseCouponUsage(id);
    }

    // Session 56 — a PAID order cancelled by admin is no longer a valid sale:
    // reverse the best-sellers counter (fail-silent; exactly-once — the
    // cancelled transition is reachable only once per order). Pending cancels
    // were never counted, so they are skipped. Mirrors the refund reversal.
    if (status === "cancelled" && order.payment.status === "paid") {
      await reverseOrderSales(id);
    }

    // Notify admin about admin's own status change (for awareness)
    sendAdminOrderStatusNotification(
      id,
      status,
      "مدیر سیستم",
      note
    );

    // --- Notify the CUSTOMER about order status changes (in-app, best-effort) ---
    // In-app is the source of truth; telegram adapter only applies to
    // supplier-side events. notifyOrderEvent() never throws, so a notification
    // can never fail the status transition above.
    const customerId = order.customer ? String(order.customer) : null;
    if (customerId) {
      const customerNotifs: Record<
        string,
        { type: string; message: string }
      > = {
        confirmed: {
          type: "order_confirmed",
          message: `سفارش شما #${id.slice(-8)} تأیید شد.`,
        },
        shipped: {
          type: "order_shipped",
          message: `سفارش شما #${id.slice(-8)} ارسال شد.`,
        },
        delivered: {
          type: "order_delivered",
          message: `سفارش شما #${id.slice(-8)} تحویل شد.`,
        },
        cancelled: {
          type: "order_cancelled",
          message: `سفارش شما #${id.slice(-8)} لغو شد.`,
        },
      };
      const cfg = customerNotifs[status];
      if (cfg) {
        await notifyOrderEvent({
          recipient: customerId,
          type: cfg.type,
          category: "order",
          message: cfg.message,
          relatedOrder: id,
          link: `/orders/${id}`,
          notificationKey: `order_${id}_${cfg.type}`,
        });
      }
    }

    // Return populated order
    const updatedOrder = await Order.findById(order._id)
      .populate("customer", "name phone")
      .lean();

    return NextResponse.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order:", error);
    return serverError();
  }
}

// NOTE: restoreOrderStock() is imported from @/lib/inventory — the shared,
// variant-aware, stockRestored-idempotent restoration helper used by admin
// cancellation, payment verification, and failed/cancelled payments.
// No duplicated inventory logic lives in this route.
