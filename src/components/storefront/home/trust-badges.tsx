import { Truck, ShieldCheck, Star, Headphones, Tag, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { ReactNode } from "react";

interface TrustBadge {
  title: string;
  description: string;
  icon: ReactNode;
}

/**
 * Trust Badges (Session 50) — «چرا فروشگاه من؟».
 * Reuses the original homepage feature cards (same copy + icons), extracted
 * into a self-contained section so the homepage stays a thin composition.
 */
const trustBadges: TrustBadge[] = [
  {
    title: "ارسال سریع",
    description:
      "ارسال سفارشات در کمترین زمان ممکن به سراسر کشور با پست پیشتاز و پیک موتوری",
    icon: <Truck className="h-6 w-6" />,
  },
  {
    title: "ضمانت اصالت کالا",
    description:
      "تمامی محصولات دارای ضمانت اصالت و گارانتی بازگشت وجه در صورت نارضایتی هستند",
    icon: <ShieldCheck className="h-6 w-6" />,
  },
  {
    title: "کیفیت عالی",
    description:
      "بهترین محصولات با بالاترین استانداردهای کیفی و قیمت‌های فوق‌العاده مناسب",
    icon: <Star className="h-6 w-6" />,
  },
  {
    title: "پشتیبانی ۲۴ ساعته",
    description:
      "تیم پشتیبانی ما در تمام ساعات شبانه‌روز آماده پاسخگویی به سوالات شماست",
    icon: <Headphones className="h-6 w-6" />,
  },
  {
    title: "تخفیف‌های ویژه",
    description:
      "تخفیف‌های فصلی و جشنواره‌های متنوع برای مشتریان وفادار فروشگاه",
    icon: <Tag className="h-6 w-6" />,
  },
  {
    title: "محصولات متنوع",
    description:
      "بیش از هزاران محصول در دسته‌بندی‌های مختلف با بهترین برندهای معروف",
    icon: <Package className="h-6 w-6" />,
  },
];

export function TrustBadges() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title="چرا فروشگاه من؟"
        subtitle="ما متعهد به ارائه بهترین تجربه خرید برای شما هستیم"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {trustBadges.map((badge) => (
          <Card
            key={badge.title}
            className="group border transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
          >
            <CardContent className="p-5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                {badge.icon}
              </div>
              <h3 className="mb-1.5 text-base font-semibold">{badge.title}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {badge.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
