"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ShoppingCart,
  ChevronRight,
  CreditCard,
  MapPin,
  User,
  Phone,
  AlertCircle,
  CheckCircle2,
  Building,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";
import axios from "axios";
import { usePublicCoupons } from "@/hooks/use-public-coupons";
import type { CouponValidationResponse } from "@/types";

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [orderId, setOrderId] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Address form
  const [fullName, setFullName] = useState(session?.user?.name || "");
  const [phone, setPhone] = useState(session?.user?.phone || "");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");

  // Payment method
  const [paymentMethod, setPaymentMethod] = useState("manual");

  const totalPrice = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  // --- Coupon (Session 39) ---
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResponse | null>(
    null
  );
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);

  /** Display-only estimate — the server recomputes authoritatively at checkout. */
  const couponDiscount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "percent") {
      const d = Math.floor((totalPrice * appliedCoupon.value) / 100);
      return appliedCoupon.maxDiscount > 0
        ? Math.min(d, appliedCoupon.maxDiscount)
        : d;
    }
    return Math.min(appliedCoupon.value, totalPrice);
  }, [appliedCoupon, totalPrice]);

  const payable = Math.max(0, totalPrice - couponDiscount);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      showToast.error("کد تخفیف را وارد کنید");
      return;
    }
    setIsApplyingCoupon(true);
    try {
      const { data } = await axios.post("/api/coupons/validate", {
        code: couponCode.trim(),
      });
      setAppliedCoupon(data);
      showToast.success("کد تخفیف اعمال شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "کد تخفیف معتبر نیست"
          : "کد تخفیف معتبر نیست";
      setAppliedCoupon(null);
      showToast.error(message);
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode("");
  };

  const isFormValid = fullName.trim() && phone.trim() && address.trim();

  // --- Redirect if cart is empty ---
  if (items.length === 0 && !orderPlaced) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <ShoppingCart className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">
            سبد خرید خالی است
          </h1>
          <p className="mb-8 text-muted-foreground">
            برای تسویه حساب ابتدا محصولاتی به سبد خرید اضافه کنید
          </p>
          <Button size="lg" asChild>
            <Link href="/products">مشاهده محصولات</Link>
          </Button>
        </div>
      </div>
    );
  }

  // --- Order Success State ---
  if (orderPlaced) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">
            سفارش با موفقیت ثبت شد!
          </h1>
          <p className="mb-2 text-muted-foreground">
            از خرید شما متشکریم. سفارش شما با موفقیت ثبت و در انتظار پردازش است.
          </p>
          <div className="mt-6 rounded-lg border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">شماره سفارش</p>
            <p className="text-lg font-bold font-mono" dir="ltr">
              #{orderId.slice(-8)}
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3">
            <Button asChild>
              <Link href="/products">ادامه خرید</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">بازگشت به صفحه اصلی</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session) {
      showToast.error("لطفاً ابتدا وارد حساب خود شوید");
      router.push("/login?callbackUrl=/checkout");
      return;
    }

    if (!isFormValid) {
      showToast.error("لطفاً اطلاعات ارسال را تکمیل کنید");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data } = await axios.post("/api/checkout", {
        items: items.map((item) => ({
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price,
          name: item.name,
        })),
        shippingAddress: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          postalCode: postalCode.trim(),
        },
        paymentMethod,
        couponCode: appliedCoupon?.code,
      });

      setOrderId(data.orderId);
      clearCart();
      setAppliedCoupon(null);
      setCouponCode("");

      // If Zarinpal payment, redirect to gateway
      if (data.paymentUrl) {
        setIsRedirecting(true);
        showToast.success("در حال انتقال به درگاه پرداخت...");
        window.location.href = data.paymentUrl;
        return;
      }

      setOrderPlaced(true);
      showToast.success("سفارش با موفقیت ثبت شد");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در ثبت سفارش"
          : "خطا در ثبت سفارش";
      showToast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/cart" className="transition-colors hover:text-foreground">
          سبد خرید
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">تسویه حساب</span>
      </nav>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Left: Forms */}
          <div className="lg:col-span-2 space-y-6">
            {/* Login reminder */}
            {!session && (
              <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
                <CardContent className="flex items-center gap-3 p-4">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    برای ثبت سفارش باید{" "}
                    <Link
                      href="/login?callbackUrl=/checkout"
                      className="font-medium underline underline-offset-2"
                    >
                      وارد حساب
                    </Link>{" "}
                    خود شوید
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Shipping Address */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">اطلاعات ارسال</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      نام و نام خانوادگی
                    </label>
                    <div className="relative">
                      <User className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="مثال: علی محمدی"
                        className="pr-9"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      شماره موبایل
                    </label>
                    <div className="relative">
                      <Phone className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="مثال: ۰۹۱۲۳۴۵۶۷۸۹"
                        className="pr-9"
                        dir="ltr"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">آدرس</label>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="استان، شهر، خیابان، پلاک، واحد"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">کد پستی (اختیاری)</label>
                  <div className="relative">
                    <Building className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      placeholder="مثال: ۱۲۳۴۵۶۷۸۹۰"
                      className="pr-9"
                      dir="ltr"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment Method */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">روش پرداخت</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:has-[:checked]:bg-emerald-950">
                    <input
                      type="radio"
                      name="payment"
                      value="manual"
                      checked={paymentMethod === "manual"}
                      onChange={() => setPaymentMethod("manual")}
                      className="h-4 w-4 text-emerald-600"
                    />
                    <div>
                      <p className="text-sm font-medium">پرداخت نقدی</p>
                      <p className="text-xs text-muted-foreground">
                        پرداخت در محل با کارت بانکی یا پول نقد
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:has-[:checked]:bg-emerald-950">
                    <input
                      type="radio"
                      name="payment"
                      value="zarinpal"
                      checked={paymentMethod === "zarinpal"}
                      onChange={() => setPaymentMethod("zarinpal")}
                      className="h-4 w-4 text-emerald-600"
                    />
                    <div>
                      <p className="text-sm font-medium">پرداخت آنلاین</p>
                      <p className="text-xs text-muted-foreground">
                        پرداخت امن از طریق درگاه زرین‌پال
                      </p>
                    </div>
                  </label>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Order Summary */}
          <div className="lg:col-span-1">
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle className="text-lg">خلاصه سفارش</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Items list */}
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center gap-3 text-sm"
                    >
                      {/* Thumbnail */}
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {item.image && !imgErrors[item.key] ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-full w-full object-cover"
                            onError={() =>
                              setImgErrors((prev) => ({
                                ...prev,
                                [item.key]: true,
                              }))
                            }
                          />
                        ) : (
                          <span className="text-sm font-bold text-muted-foreground/30">
                            {item.name[0] || "?"}
                          </span>
                        )}
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{item.name}</p>
                        {item.variantLabel && (
                          <p className="text-xs text-muted-foreground">
                            {item.variantLabel}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} × {formatPrice(item.price)}
                        </p>
                      </div>
                      <span className="font-medium shrink-0">
                        {formatPrice(item.price * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Coupon (Session 39) */}
                <div className="border-t pt-4 space-y-2">
                  {appliedCoupon ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950">
                      <div className="min-w-0">
                        <p className="text-xs font-bold font-mono" dir="ltr">
                          {appliedCoupon.code}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {appliedCoupon.type === "percent"
                            ? `${appliedCoupon.value}٪ تخفیف${
                                appliedCoupon.maxDiscount > 0
                                  ? ` (حداکثر ${formatPrice(
                                      appliedCoupon.maxDiscount
                                    )})`
                                  : ""
                              }`
                            : `${formatPrice(appliedCoupon.value)} تخفیف`}
                        </p>
                        {appliedCoupon.minSubtotal > totalPrice && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">
                            حداقل مبلغ سبد برای این کد:{" "}
                            {formatPrice(appliedCoupon.minSubtotal)}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                      >
                        حذف
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        placeholder="کد تخفیف"
                        dir="ltr"
                        className="text-left font-mono"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleApplyCoupon();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleApplyCoupon}
                        disabled={isApplyingCoupon || !couponCode.trim()}
                      >
                        {isApplyingCoupon ? "..." : "اعمال"}
                      </Button>
                    </div>
                  )}

                  {/* Session 44 — public coupon picker: lists only the
                      admin-opted-in public coupons; clicking pre-fills the input
                      and runs the SAME validate → claim flow (never bypasses it). */}
                  {!appliedCoupon && <PublicCouponPicker onPick={setCouponCode} />}
                </div>

                <div className="border-t pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">تعداد کالا</span>
                    <span className="font-medium">
                      {totalItems.toLocaleString("fa-IR")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">جمع جزء</span>
                    <span className="font-medium">
                      {formatPrice(totalPrice)}
                    </span>
                  </div>
                  {couponDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm text-emerald-600">
                      <span className="text-muted-foreground">
                        تخفیف ({appliedCoupon?.code})
                      </span>
                      <span className="font-medium">−{formatPrice(couponDiscount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">هزینه ارسال</span>
                    <Badge variant="secondary" className="text-xs">
                      متغیر
                    </Badge>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">قابل پرداخت</span>
                    <span className="text-xl font-bold text-emerald-600">
                      {formatPrice(payable)}
                    </span>
                  </div>
                </div>

                {/* Submit button */}
                <Button
                  type="submit"
                  className="w-full gap-2"
                  size="lg"
                  disabled={!isFormValid || !session || isSubmitting}
                  loading={isSubmitting}
                >
                  {isSubmitting ? (
                    isRedirecting
                      ? "در حال انتقال به درگاه پرداخت..."
                      : "در حال ثبت سفارش..."
                  ) : (
                    <>
                      <CreditCard className="h-5 w-5" />
                      ثبت سفارش
                    </>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  با ثبت سفارش، قوانین و مقررات فروشگاه را پذیرفته‌اید
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * Session 44 — inline public-coupon picker for the checkout summary card.
 * Reads GET /api/coupons/public (isPublic + active + in-window only). Clicking
 * a code pre-fills the coupon input; the customer still submits it through the
 * untouched /api/coupons/validate → /api/checkout claim flow. The picker is a
 * convenience, never a discount source of truth.
 */
function PublicCouponPicker({ onPick }: { onPick: (code: string) => void }) {
  const { data } = usePublicCoupons(1);
  if (!data || data.total === 0) return null;

  return (
    <div className="space-y-1.5 pt-1">
      <p className="text-[11px] text-muted-foreground">کدهای تخفیف فروشگاه:</p>
      <div className="flex flex-wrap gap-1.5">
        {data.data.map((c) => (
          <button
            key={c._id}
            type="button"
            onClick={() => {
              onPick(c.code);
              showToast.info(`کد ${c.code} درج شد — دکمه اعمال را بزنید`);
            }}
            className="rounded-md border border-dashed px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-emerald-400 hover:text-emerald-600 dark:hover:border-emerald-700 dark:hover:text-emerald-400"
            dir="ltr"
          >
            {c.code}
          </button>
        ))}
      </div>
    </div>
  );
}
