"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ArrowLeft,
  ShoppingBag,
  CreditCard,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice, isAllowedImageSrc } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { showToast } from "@/components/ui/toast";

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const totalPrice = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  // --- Empty State ---
  if (items.length === 0) {
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
            هنوز محصولی به سبد خرید خود اضافه نکرده‌اید
          </p>
          <Button size="lg" asChild>
            <Link href="/products">
              <ShoppingBag className="ml-2 h-5 w-5" />
              مشاهده محصولات
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">سبد خرید</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalItems.toLocaleString("fa-IR")} کالا
          </p>
        </div>
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="ml-2 h-4 w-4" />
          ادامه خرید
        </Button>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Cart Items */}
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <Card key={item.key} className="overflow-hidden">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start gap-4">
                  {/* Product image */}
                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {item.image &&
                    !imgErrors[item.key] &&
                    isAllowedImageSrc(item.image) ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="80px"
                        loading="eager"
                        className="object-cover"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [item.key]: true }))
                        }
                      />
                    ) : (
                      <span className="text-2xl font-bold text-muted-foreground/30">
                        {item.image ? (
                          <ImageOff className="h-6 w-6" />
                        ) : (
                          item.name[0] || "?"
                        )}
                      </span>
                    )}
                  </div>

                  {/* Item details */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/products/${item.slug}`}
                      className="text-sm font-medium transition-colors hover:text-primary line-clamp-2"
                    >
                      {item.name}
                    </Link>
                    {item.variantLabel && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.variantLabel}
                      </p>
                    )}
                    {item.sku && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground font-mono" dir="ltr">
                        SKU: {item.sku}
                      </p>
                    )}
                    <p className="mt-1 text-sm font-semibold text-emerald-600">
                      {formatPrice(item.price)}
                    </p>

                    {/* Quantity controls */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex items-center rounded-lg border">
                        <button
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground rounded-r-lg"
                          onClick={() =>
                            updateQuantity(item.key, item.quantity - 1)
                          }
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="flex h-8 w-10 items-center justify-center text-sm font-medium border-x">
                          {item.quantity}
                        </span>
                        <button
                          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground rounded-l-lg"
                          onClick={() =>
                            updateQuantity(item.key, item.quantity + 1)
                          }
                          disabled={item.quantity >= item.maxQuantity}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>

                      <span className="text-xs text-muted-foreground">
                        {item.quantity >= item.maxQuantity
                          ? "حداکثر موجودی"
                          : `${item.maxQuantity} عدد موجود`}
                      </span>

                      <button
                        className="mr-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          removeItem(item.key);
                          showToast.info(`${item.name} از سبد خرید حذف شد`);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Item total */}
                  <div className="text-left shrink-0">
                    <p className="text-sm font-bold">
                      {formatPrice(item.price * item.quantity)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      هر عدد {formatPrice(item.price)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle className="text-lg">خلاصه سفارش</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Items count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">تعداد کالا</span>
                <span className="font-medium">
                  {totalItems.toLocaleString("fa-IR")}
                </span>
              </div>

              {/* Subtotal */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">جمع جزء</span>
                <span className="font-medium">{formatPrice(totalPrice)}</span>
              </div>

              {/* Shipping */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">هزینه ارسال</span>
                <Badge variant="secondary" className="text-xs">
                  متغیر
                </Badge>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">جمع کل</span>
                  <span className="text-xl font-bold text-emerald-600">
                    {formatPrice(totalPrice)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  هزینه ارسال در مرحله بعد محاسبه می‌شود
                </p>
              </div>

              {/* Checkout button */}
              <Button className="w-full gap-2" size="lg" asChild>
                <Link href="/checkout">
                  <CreditCard className="h-5 w-5" />
                  تسویه حساب
                </Link>
              </Button>

              {/* Continue shopping */}
              <Button variant="outline" className="w-full gap-2" asChild>
                <Link href="/products">
                  <ShoppingBag className="h-4 w-4" />
                  ادامه خرید
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
