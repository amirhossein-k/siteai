/**
 * Session 50 — Static homepage configuration.
 *
 * All homepage copy/art lives here so the homepage itself stays a thin
 * composition of sections. NO backend, NO schema, NO fake data:
 * every link points to a real route and every price shown comes from the
 * existing products API. Slides/banners use gradient art (no external
 * images) so the design never depends on image hosting.
 */
import { APP_NAME } from "@/lib/constants";

export interface HomepageHeroSlide {
  id: string;
  /** Big Persian headline */
  title: string;
  subtitle: string;
  cta: { label: string; href: string };
  /** Tailwind gradient classes for the slide background art */
  gradient: string;
  /** Small decorative chip text (e.g. a tagline above the title) */
  tagline?: string;
}

export interface HomepageCampaignBanner {
  title: string;
  subtitle: string;
  cta: { label: string; href: string };
  gradient: string;
}

export interface HomepageGiftCollection {
  id: string;
  title: string;
  description: string;
  cta: { label: string; href: string };
  gradient: string;
}

export const homepageConfig = {
  heroSlides: [
    {
      id: "welcome",
      tagline: `${APP_NAME} — خرید آسان، سریع و مطمئن`,
      title: "به فروشگاه من خوش آمدید",
      subtitle:
        "بهترین محصولات با کیفیت عالی و قیمت‌های واقعی. تجربه خریدی مدرن و لذت‌بخش را با ما داشته باشید.",
      cta: { label: "خرید کنید", href: "/products" },
      gradient: "from-zinc-900 via-zinc-800 to-zinc-700",
    },
    {
      id: "newest",
      tagline: "تازه‌های فروشگاه",
      title: "جدیدترین محصولات",
      subtitle:
        "هر روز محصولات جدید از فروشندگان معتبر. اولین نفری باشید که کالکشن تازه را می‌بینید.",
      cta: { label: "مشاهده جدیدترین‌ها", href: "/products?sort=newest" },
      gradient: "from-emerald-800 via-emerald-700 to-teal-600",
    },
    {
      id: "coupons",
      tagline: "خرید هوشمندانه",
      title: "کدهای تخفیف عمومی",
      subtitle:
        "کدهای تخفیف عمومی را ببینید و هنگام پرداخت استفاده کنید. بدون هیچ هزینه اضافه.",
      cta: { label: "مشاهده کدهای تخفیف", href: "/coupons" },
      gradient: "from-rose-800 via-rose-700 to-pink-600",
    },
  ] satisfies HomepageHeroSlide[],

  campaignBanner: {
    title: "پیشنهادهای ویژه فروشگاه",
    subtitle:
      "محصولات باکیفیت، قیمت‌های واقعی و ارسال سریع به سراسر کشور. همین حالا کالکشن ویژه را ببینید.",
    cta: { label: "مشاهده کالکشن ویژه", href: "/products?sort=price_desc" },
    gradient: "from-indigo-900 via-indigo-800 to-violet-700",
  } satisfies HomepageCampaignBanner,

  giftCollections: [
    {
      id: "gift-loved-ones",
      title: "هدیه برای عزیزان",
      description:
        "انتخاب‌های ویژه برای کسانی که دوستشان دارید — از وسایل خانه تا کالکشن‌های خاص.",
      cta: { label: "مشاهده هدیه‌ها", href: "/products" },
      gradient: "from-rose-900 via-rose-800 to-red-700",
    },
    {
      id: "gift-home",
      title: "هدیه برای خانه",
      description:
        "هر آنچه خانه شما را زیباتر و راحت‌تر می‌کند، در یک جا جمع شده است.",
      cta: { label: "خرید برای خانه", href: "/products" },
      gradient: "from-amber-800 via-amber-700 to-yellow-600",
    },
    {
      id: "gift-yourself",
      title: "هدیه برای خودتان",
      description:
        "چون لایق بهترین‌ها هستید. کالکشن پریمیوم را برای خودتان انتخاب کنید.",
      cta: { label: "خرید پریمیوم", href: "/products?sort=price_desc" },
      gradient: "from-slate-800 via-slate-700 to-zinc-600",
    },
  ] satisfies HomepageGiftCollection[],
};
