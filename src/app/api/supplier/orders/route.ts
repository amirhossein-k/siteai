import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import {
  requireRoleOrError,
  serverError,
  forbidden,
} from "@/lib/auth-utils";
import Supplier from "@/models/Supplier";
import SupplierOrder from "@/models/SupplierOrder";
import Transaction from "@/models/Transaction";
import { sendOrderStatusNotification, sendAdminOrderStatusNotification } from "@/lib/telegram";
import { notifyOrderEvent } from "@/lib/notifications";

const supplierStatusTransitions: Record<string, string[]> = {
  pending: ["confirmed", "rejected"],
  confirmed: ["shipped"],
  rejected: [],
  shipped: ["delivered"],
  delivered: [],
};

export async function GET(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const supplierOrder = await SupplierOrder.findById(id)
        .populate({
          path: "order",
          populate: { path: "customer", select: "name phone" },
        })
        .lean() as (Record<string, unknown> & { supplier?: { _id?: { toString(): string } } | string | { toString(): string } }) | null;

      if (!supplierOrder) {
        return NextResponse.json(
          { error: "سفارش یافت نشد" },
          { status: 404 }
        );
      }

      const supplierId = typeof supplierOrder.supplier === "object" && supplierOrder.supplier !== null
        ? ((supplierOrder.supplier as { _id?: { toString(): string } | string })?._id?.toString() || (supplierOrder.supplier as { toString(): string }).toString())
        : String(supplierOrder.supplier || "");

      if (supplierId !== supplier._id.toString()) {
        return forbidden();
      }

      return NextResponse.json(supplierOrder);
    }

    const supplierOrders = await SupplierOrder.find({
      supplier: supplier._id,
    })
      .populate({
        path: "order",
        populate: { path: "customer", select: "name phone" },
      })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(supplierOrders);
  } catch (error) {
    console.error("Error fetching supplier orders:", error);
    return serverError();
  }
}

export async function PUT(req: NextRequest) {
  const { token, error } = await requireRoleOrError(req, ["supplier"]);
  if (error) return error;

  try {
    await dbConnect();

    const supplier = await Supplier.findOne({ user: token!.id });
    if (!supplier) {
      return NextResponse.json(
        { error: "پروفایل فروشنده یافت نشد" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "شناسه سفارش الزامی است" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { status: newStatus } = body;

    if (!newStatus) {
      return NextResponse.json(
        { error: "وضعیت جدید الزامی است" },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawOrder: any = await SupplierOrder.findById(id).lean();
    if (!rawOrder) {
      return NextResponse.json(
        { error: "سفارش یافت نشد" },
        { status: 404 }
      );
    }

    const rawSupplierId =
      rawOrder.supplier && typeof rawOrder.supplier === "object"
        ? String(rawOrder.supplier._id || rawOrder.supplier)
        : String(rawOrder.supplier || "");

    if (rawSupplierId !== supplier._id.toString()) {
      return NextResponse.json(
        { error: "این سفارش متعلق به شما نیست" },
        { status: 403 }
      );
    }

    const currentStatus = rawOrder.status as string;
    const allowedTransitions = supplierStatusTransitions[currentStatus];
    if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
      return NextResponse.json(
        {
          error: `امکان تغییر وضعیت از "${currentStatus}" به "${newStatus}" وجود ندارد`,
        },
        { status: 400 }
      );
    }

    const updateFields: Record<string, unknown> = {
      status: newStatus,
    };
    if (newStatus === "confirmed") {
      updateFields.confirmedAt = new Date();
    } else if (newStatus === "shipped") {
      updateFields.shippedAt = new Date();
    } else if (newStatus === "delivered") {
      updateFields.deliveredAt = new Date();
    }

    await SupplierOrder.findByIdAndUpdate(id, updateFields, { new: true });

    if (newStatus === "delivered") {
      const amount = rawOrder.amountOwed || 0;
      if (amount > 0) {
        const newBalance = (supplier.balance || 0) + amount;

        await Transaction.create({
          supplier: supplier._id,
          type: "order_credit",
          amount: amount,
          relatedOrder: id,
          note: `اعتبار بابت تحویل سفارش #${id.slice(-6)}`,
          balanceAfter: newBalance,
        });

        supplier.balance = newBalance;
        await supplier.save();
      }
    }

    const mainOrderId =
      (rawOrder.order && typeof rawOrder.order === "object"
        ? String(rawOrder.order._id || rawOrder.order)
        : String(rawOrder.order || "")) || id;

    sendAdminOrderStatusNotification(
      mainOrderId,
      newStatus,
      supplier.businessName || "فروشنده",
      body.note
    );

    // In-app notification is the source of truth; telegram remains an adapter.
    // notifyOrderEvent() never throws — a notification can never fail the
    // status transition or the wallet credit above.
    if (
      newStatus === "confirmed" ||
      newStatus === "shipped" ||
      newStatus === "delivered" ||
      newStatus === "rejected"
    ) {
      const notificationTypes: Record<string, string> = {
        confirmed: "order_confirmed",
        shipped: "order_shipped",
        delivered: "order_delivered",
        rejected: "order_rejected",
      };
      const notifType = notificationTypes[newStatus] || "new_order";

      const statusMessages: Record<string, string> = {
        confirmed: `وضعیت سفارش #${mainOrderId.slice(-8)} به «تأیید شده» تغییر یافت.`,
        shipped: `وضعیت سفارش #${mainOrderId.slice(-8)} به «ارسال شده» تغییر یافت.`,
        delivered: `وضعیت سفارش #${mainOrderId.slice(-8)} به «تحویل شده» تغییر یافت. مبلغ ${new Intl.NumberFormat("fa-IR").format(rawOrder.amountOwed || 0)} تومان به کیف پول شما اضافه شد.`,
        rejected: `وضعیت سفارش #${mainOrderId.slice(-8)} به «رد شده» تغییر یافت.`,
      };

      await notifyOrderEvent({
        recipient: String(supplier.user),
        type: notifType,
        category: "order",
        message:
          statusMessages[newStatus] ||
          `وضعیت سفارش #${mainOrderId.slice(-8)} بروزرسانی شد.`,
        relatedOrder: mainOrderId,
        link: `/supplier/orders/${id}`,
        notificationKey: `order_${mainOrderId}_${notifType}`,
        telegram: supplier.telegramChatId
          ? () =>
              sendOrderStatusNotification(
                supplier.telegramChatId,
                mainOrderId,
                newStatus,
                body.note
              )
          : undefined,
      });
    }

    const updated = await SupplierOrder.findById(id)
      .populate({
        path: "order",
        populate: { path: "customer", select: "name phone" },
      })
      .lean();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating supplier order:", error);
    return NextResponse.json(
      { error: "خطا در بروزرسانی سفارش" },
      { status: 500 }
    );
  }
}