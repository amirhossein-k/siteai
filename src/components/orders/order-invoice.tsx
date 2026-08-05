"use client";

import { Package } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { AdminOrder } from "@/types";

/**
 * Shared order invoice (Session 57) — the items table + subtotal/discount/
 * total footer rendered identically on the admin and customer order detail
 * pages. Also the print-friendly invoice area (download/PDF is future scope).
 */
export function OrderInvoice({ order }: { order: AdminOrder }) {
  const items = order.items || [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-4 py-3 text-right font-medium">محصول</th>
            <th className="px-4 py-3 text-right font-medium">قیمت واحد</th>
            <th className="px-4 py-3 text-right font-medium">تعداد</th>
            <th className="px-4 py-3 text-left font-medium">جمع</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="border-b last:border-0">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-10 w-10 shrink-0 rounded-md border object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Package className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{item.name}</p>
                    {item.variantLabel && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.variantLabel}
                      </p>
                    )}
                    {item.sku && (
                      <p
                        className="mt-0.5 font-mono text-[10px] text-muted-foreground"
                        dir="ltr"
                      >
                        SKU: {item.sku}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">{formatPrice(item.price)}</td>
              <td className="px-4 py-3">{item.quantity}</td>
              <td className="px-4 py-3 text-left font-medium">
                {formatPrice(item.price * item.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {order.subtotalAmount != null && order.discount?.amount ? (
            <>
              <tr className="border-t">
                <td
                  colSpan={3}
                  className="px-4 py-2 text-left text-muted-foreground"
                >
                  جمع جزء
                </td>
                <td className="px-4 py-2 text-left font-medium">
                  {formatPrice(order.subtotalAmount)}
                </td>
              </tr>
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-2 text-left text-emerald-600"
                >
                  تخفیف ({order.discount.code})
                </td>
                <td className="px-4 py-2 text-left font-medium text-emerald-600">
                  −{formatPrice(order.discount.amount)}
                </td>
              </tr>
            </>
          ) : null}
          <tr className="border-t-2">
            <td colSpan={3} className="px-4 py-3 text-left font-bold">
              جمع کل
            </td>
            <td className="px-4 py-3 text-left text-lg font-bold">
              {formatPrice(order.totalAmount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
