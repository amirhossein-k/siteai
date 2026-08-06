/**
 * Money math for coupon assertions — mirrors src/lib/coupons.ts
 * computeCouponDiscount() exactly (percent → floor(subtotal×value/100) capped
 * by maxDiscount; fixed → min(value, subtotal); clamped to [0, subtotal]).
 */
export function couponDiscount(
  subtotal: number,
  type: "percent" | "fixed",
  value: number,
  maxDiscount = 0
): number {
  let discount: number;
  if (type === "percent") {
    discount = Math.floor((subtotal * value) / 100);
    if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  } else {
    discount = value;
  }
  return Math.max(0, Math.min(discount, subtotal));
}

/**
 * Mirror of src/lib/utils.ts formatPrice — Persian digits + " تومان".
 * Used to assert rendered prices without depending on the app's locale setup.
 */
export function formatPrice(price: number): string {
  return new Intl.NumberFormat("fa-IR").format(price) + " تومان";
}
