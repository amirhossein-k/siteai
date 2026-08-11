import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireAuth, unauthorized, serverError } from "@/lib/auth-utils";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Supplier from "@/models/Supplier";
import SupplierOrder from "@/models/SupplierOrder";
import { sendNewOrderNotification, sendAdminNewOrderNotification } from "@/lib/telegram";
import { notifyOrderEvent } from "@/lib/notifications";
import { requestPayment } from "@/lib/zarinpal";
import { reserveStock, restoreStock } from "@/lib/inventory";
import { claimCouponForOrder, releaseCouponClaim } from "@/lib/coupons";
import { getEffectivePrice } from "@/lib/product-pricing";

interface CheckoutItem {
  id: string;
  variantId?: string;
  quantity: number;
  price: number;
  name: string;
}

interface ShippingAddress {
  fullName: string;
  phone: string;
  address: string;
  postalCode: string;
}

/** Build a human-readable variant label from variant attributes */
function buildVariantLabel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variant: any
): string {
  if (!variant?.attributes || variant.attributes.length === 0) return "";
  return variant.attributes
    .map((a: { name: string; value: string }) => `${a.name}: ${a.value}`)
    .join("، ");
}

interface ReservedEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  product: any;
  quantity: number;
  variantId?: string;
}

/**
 * Restore all reserved products, routing each item to the correct variant
 * (simple product vs variant) using the variantId recorded at reservation time.
 */
async function restoreReserved(
  reservedProducts: ReservedEntry[]
): Promise<void> {
  await Promise.all(
    reservedProducts.map((r) =>
      restoreStock(String(r.product._id), r.quantity, r.variantId)
    )
  );
}

export async function POST(req: NextRequest) {
  const token = await requireAuth(req);
  if (!token) return unauthorized();

  try {
    await dbConnect();

    const body = await req.json();
    const { items, shippingAddress, paymentMethod, couponCode } = body as {
      items: CheckoutItem[];
      shippingAddress: ShippingAddress;
      paymentMethod?: string;
      couponCode?: string;
    };

    // --- Validation ---
    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "سبد خرید خالی است" },
        { status: 400 }
      );
    }

    if (
      !shippingAddress?.fullName ||
      !shippingAddress?.phone ||
      !shippingAddress?.address
    ) {
      return NextResponse.json(
        { error: "لطفاً اطلاعات ارسال را کامل کنید" },
        { status: 400 }
      );
    }

    // Coupon code is optional; when present it must be a string (format is
    // validated server-side in claimCouponForOrder after price revalidation).
    if (couponCode !== undefined && typeof couponCode !== "string") {
      return NextResponse.json(
        { error: "کد تخفیف نامعتبر است" },
        { status: 400 }
      );
    }

    // ============================================================
    // PHASE 1: Atomically reserve stock for ALL items BEFORE creating order
    // ============================================================
    // reserveStock() (shared with payment/admin restore paths) uses
    // findOneAndUpdate with { stock: { $gte: quantity }, stockVersion }
    // as the optimistic concurrency guard — for variants it matches the
    // specific variant via "variants._id" + "variants.$.stockVersion".
    // MongoDB serializes writes to the same document, so two concurrent
    // checkouts for the same unit cannot both succeed.
    //
    // If a reservation fails (null returned), we roll back ALL successfully
    // reserved stock for this checkout attempt.
    // ============================================================

    const reservedProducts: ReservedEntry[] = [];

    try {
      for (const cartItem of items) {
        const product = await reserveStock(
          cartItem.id,
          cartItem.quantity,
          cartItem.variantId
        );

        if (!product) {
          // Read current state for a helpful error message
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const current: any = await Product.findById(cartItem.id)
            .select("name stock variants")
            .lean();

          const productName = current?.name || cartItem.name;

          let errorMsg: string;
          if (cartItem.variantId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const variant: any = (current?.variants || []).find(
              (v: { _id: unknown }) =>
                String(v._id) === String(cartItem.variantId)
            );
            const variantLabel = buildVariantLabel(variant);
            const label = variantLabel ? ` (${variantLabel})` : "";
            const availableStock = variant?.stock ?? 0;

            if (!variant) {
              errorMsg = `تنوع "${productName}"${label} در دسترس نیست`;
            } else if (variant.isActive === false) {
              errorMsg = `تنوع "${productName}"${label} در دسترس نیست`;
            } else {
              errorMsg =
                availableStock <= 0
                  ? `موجودی تنوع "${productName}"${label} به اتمام رسیده است`
                  : `موجودی تنوع "${productName}"${label} کافی نیست. موجودی: ${availableStock}`;
            }
          } else {
            const availableStock = current?.stock ?? 0;
            errorMsg =
              availableStock <= 0
                ? `محصول "${productName}" در انبار موجود نیست`
                : `موجودی "${productName}" کافی نیست. موجودی: ${availableStock}`;
          }

          // Roll back all successfully reserved stock
          await restoreReserved(reservedProducts);

          return NextResponse.json({ error: errorMsg }, { status: 409 });
        }

        // --- Resolve the effective price + variant for price validation ---
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const productAny: any = product;
        const variant = cartItem.variantId
          ? (productAny.variants || []).find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (v: any) => String(v._id) === String(cartItem.variantId)
            )
          : null;

        // Session 77 — the SERVER recomputes the effective (post-discount)
        // unit price from the freshly reserved product; the client cart price
        // must equal it EXACTLY. A stale ORIGINAL price (discount now active)
        // and a manipulated discounted price (no active discount) BOTH fail
        // here → 409. The client can never determine the payable price.
        const unitPrice =
          cartItem.variantId && variant ? variant.price : productAny.price;
        const effectivePrice = getEffectivePrice(
          unitPrice,
          productAny.discount
        ).finalPrice;

        // Verify price hasn't changed since added to cart
        if (effectivePrice !== cartItem.price) {
          await restoreReserved(reservedProducts);
          await restoreStock(cartItem.id, cartItem.quantity, cartItem.variantId);

          return NextResponse.json(
            {
              error: `قیمت "${productAny.name}" تغییر کرده است. لطفاً سبد خرید را به‌روز کنید`,
            },
            { status: 409 }
          );
        }

        if (productAny.isActive === false) {
          await restoreReserved(reservedProducts);
          await restoreStock(cartItem.id, cartItem.quantity, cartItem.variantId);

          return NextResponse.json(
            { error: `محصول "${productAny.name}" در دسترس نیست` },
            { status: 400 }
          );
        }

        reservedProducts.push({
          product,
          quantity: cartItem.quantity,
          variantId: cartItem.variantId,
        });
      }
    } catch (err) {
      // Unexpected error during reservation — roll back everything
      await restoreReserved(reservedProducts);
      throw err;
    }

    // ============================================================
    // PHASE 2: Build order items from successfully reserved stock
    // ============================================================

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderItems: Array<any> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supplierItemsMap: Record<string, any[]> = {};
    let totalAmount = 0;

    for (const { product, quantity, variantId } of reservedProducts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const productAny: any = product;
      const supplierId = String(productAny.supplier || "");
      if (!supplierId) {
        await restoreReserved(reservedProducts);
        return NextResponse.json(
          { error: `محصول "${productAny.name}" فروشنده ندارد` },
          { status: 400 }
        );
      }

      const variant = (variantId
        ? (productAny.variants || []).find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v: any) => String(v._id) === String(variantId)
          )
        : null) as
        | {
            price?: number;
            supplierPrice?: number;
            sku?: string;
            attributes?: Array<{ name: string; value: string }>;
            images?: string[];
          }
        | null;

      // Session 77 — server-authoritative discounted unit price:
      // price = the ACTUAL effective unit price paid (getEffectivePrice),
      // originalPrice = pre-discount snapshot, discountAmount = per-unit
      // reduction (0 when no discount was active). Immutable — later discount
      // changes or expiration never touch existing orders.
      const unitPrice = (variant?.price ?? productAny.price) as number;
      const effective = getEffectivePrice(unitPrice, productAny.discount);

      const orderItem = {
        product: String(productAny._id),
        supplier: supplierId,
        // Variant snapshot (immutable — survives later product edits)
        variantId,
        sku: variant?.sku || undefined,
        variantLabel: variant ? buildVariantLabel(variant) : undefined,
        image: (variant?.images?.[0] as string | undefined) ||
          (productAny.images?.[0] as string | undefined) ||
          "",
        name: productAny.name as string,
        price: effective.finalPrice,
        originalPrice: unitPrice,
        discountAmount: effective.discountAmount,
        supplierPrice: (variant?.supplierPrice ?? productAny.supplierPrice) as number,
        quantity,
      };

      orderItems.push(orderItem);
      totalAmount += effective.finalPrice * quantity;

      if (!supplierItemsMap[supplierId]) {
        supplierItemsMap[supplierId] = [];
      }
      supplierItemsMap[supplierId].push(orderItem);
    }

    // ============================================================
    // PHASE 2.5: Apply coupon (server-authoritative, AFTER price revalidation)
    //
    // The subtotal was computed from freshly reserved server prices above, so
    // a stale client cart price can neither bypass the 409 revalidation nor
    // inflate the discount. totalAmount becomes the PAYABLE amount (subtotal −
    // discount); requestPayment/verifyPayment keep using totalAmount unchanged.
    //
    // The coupon usage is CLAIMED here (atomic global + per-user), before
    // Order.create. If order/supplier creation fails afterwards, the claim is
    // released via releaseCouponClaim in the catch blocks below.
    // ============================================================
    let subtotalAmount = totalAmount;
    let discountInfo: Record<string, unknown> | null = null;
    let claimedCoupon: { id: string; userId: string } | null = null;

    if (couponCode) {
      const couponResult = await claimCouponForOrder(
        couponCode,
        token.id,
        subtotalAmount
      );

      if (!couponResult.ok) {
        // Roll back all successfully reserved stock before returning the error
        await restoreReserved(reservedProducts);
        return NextResponse.json(
          { error: couponResult.error || "کد تخفیف نامعتبر است" },
          { status: 400 }
        );
      }

      claimedCoupon = {
        id: String(couponResult.coupon!._id),
        userId: token.id,
      };
      discountInfo = {
        code: couponResult.coupon!.code,
        couponId: couponResult.coupon!._id,
        type: couponResult.coupon!.type,
        value: couponResult.coupon!.value,
        amount: couponResult.discount!,
        released: false,
      };
      totalAmount = couponResult.payable!;
    }

    // ============================================================
    // PHASE 3: Create Order (with stockReserved flag already false)
    // ============================================================

    let order;
    try {
      order = await Order.create({
        customer: token.id,
        items: orderItems,
        totalAmount,
        subtotalAmount,
        discount: discountInfo,
        shippingAddress: {
          fullName: shippingAddress.fullName,
          phone: shippingAddress.phone,
          address: shippingAddress.address,
          postalCode: shippingAddress.postalCode || "",
        },
        payment: {
          status: "pending",
          method: paymentMethod === "zarinpal" ? "zarinpal" : "manual",
        },
        status: "pending_payment",
        stockRestored: false,
        statusHistory: [
          {
            status: "pending_payment",
            at: new Date(),
            note: "سفارش ثبت شد",
          },
        ],
      });
    } catch (err) {
      // Order creation failed — release the coupon claim (if any) and roll
      // back all reserved stock
      if (claimedCoupon) {
        await releaseCouponClaim(claimedCoupon.id, claimedCoupon.userId);
      }
      await restoreReserved(reservedProducts);
      throw err;
    }

    // --- Create SupplierOrders for each supplier ---
    try {
      const supplierOrderPromises = Object.entries(supplierItemsMap).map(
        ([supplierId, supplierItems]) => {
          const amountOwed = supplierItems.reduce(
            (sum, item) => sum + item.supplierPrice * item.quantity,
            0
          );

          return SupplierOrder.create({
            order: order._id,
            supplier: supplierId,
            items: supplierItems.map((item) => ({
              product: item.product,
              variantId: item.variantId,
              sku: item.sku,
              variantLabel: item.variantLabel,
              image: item.image || "",
              name: item.name,
              supplierPrice: item.supplierPrice,
              quantity: item.quantity,
            })),
            amountOwed,
            status: "pending",
            isPaidOut: false,
          });
        }
      );

      await Promise.all(supplierOrderPromises);
    } catch (err) {
      // SupplierOrder creation failed — release the coupon claim (if any),
      // roll back stock AND delete the order
      if (claimedCoupon) {
        await releaseCouponClaim(claimedCoupon.id, claimedCoupon.userId);
      }
      await Promise.all([
        ...reservedProducts.map((r) =>
          restoreStock(String(r.product._id), r.quantity, r.variantId)
        ),
        Order.findByIdAndDelete(order._id),
      ]);
      throw err;
    }

    // ============================================================
    // NOTE: Stock is ALREADY decremented at this point (reserved in Phase 1).
    // No additional stock decrement needed.
    // ============================================================

    // --- Send Telegram notifications (fire-and-forget) ---
    const customerName = (token as any)?.name || "مشتری";
    const orderShortId = order._id.toString();

    // Notify admin about new order
    sendAdminNewOrderNotification(
      orderShortId,
      customerName,
      orderItems.length,
      totalAmount,
      `${shippingAddress.fullName} - ${shippingAddress.address}`
    );

    // Notify each supplier about their items (in-app = source of truth,
    // telegram = best-effort adapter)
    Object.entries(supplierItemsMap).forEach(
      async ([supplierId, supplierItems]) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const supplier: any = await Supplier.findById(supplierId)
            .select("telegramChatId businessName user")
            .lean();

          if (!supplier?.user) return;

          // Build items summary (include variant label when present)
          const itemsSummary = supplierItems
            .map(
              (item) =>
                `  • ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} — ${item.quantity} × ${new Intl.NumberFormat(
                  "fa-IR"
                ).format(item.supplierPrice)} تومان`
            )
            .join("\n");

          // In-app notification + best-effort telegram adapter
          await notifyOrderEvent({
            recipient: String(supplier.user),
            type: "new_order",
            category: "order",
            message: `سفارش جدید #${orderShortId.slice(
              -8
            )} ثبت شد. ${supplierItems.length} محصول از شما در این سفارش موجود است.`,
            relatedOrder: String(order._id),
            link: "/supplier/orders",
            notificationKey: `order_${order._id}_new_order`,
            telegram: supplier.telegramChatId
              ? () =>
                  sendNewOrderNotification(
                    supplier.telegramChatId,
                    orderShortId,
                    customerName,
                    itemsSummary,
                    supplierItems.reduce(
                      (sum, item) =>
                        sum + item.supplierPrice * item.quantity,
                      0
                    ),
                    `${shippingAddress.fullName} - ${shippingAddress.address}`
                  )
              : undefined,
          });
        } catch (err) {
          // Don't fail the checkout — notifications are best-effort
          console.error(
            `[Checkout] Notification failed for supplier ${supplierId}:`,
            err
          );
        }
      }
    );

    // --- Handle Zarinpal payment (if selected) ---
    if (paymentMethod === "zarinpal") {
      const merchantId = process.env.ZARINPAL_MERCHANT_ID;
      if (!merchantId) {
        return NextResponse.json(
          {
            error:
              "درگاه پرداخت آنلاین پیکربندی نشده است. لطفاً روش پرداخت نقدی را انتخاب کنید.",
          },
          { status: 503 }
        );
      }

      const orderDesc = `سفارش #${orderShortId.slice(-8)}`;
      const customerMobile = (token as any)?.phone || "";
      const paymentResult = await requestPayment(
        totalAmount,
        orderDesc,
        orderShortId,
        customerMobile
      );

      if (!paymentResult) {
        return NextResponse.json(
          {
            error:
              "درگاه پرداخت موقتاً در دسترس نیست. لطفاً دقایقی بعد تلاش کنید یا روش پرداخت نقدی را انتخاب کنید.",
          },
          { status: 502 }
        );
      }

      // --- Store the payment authority on the order (security: cross-check on callback) ---
      await Order.findByIdAndUpdate(order._id, {
        $set: {
          "payment.authority": paymentResult.authority,
        },
      });

      return NextResponse.json(
        {
          message: "در حال انتقال به درگاه پرداخت...",
          orderId: orderShortId,
          paymentUrl: paymentResult.redirectUrl,
          authority: paymentResult.authority,
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        message: "سفارش با موفقیت ثبت شد",
        orderId: orderShortId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error placing order:", error);
    return NextResponse.json(
      { error: "خطا در ثبت سفارش" },
      { status: 500 }
    );
  }
}
